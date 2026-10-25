"""
context-ingest: материал заказчика → Markdown, который модель читает быстро.

  POST /ingest?name=<имя файла>   тело — байты файла
  → {"kind": "audio"|"document", "markdown": "...", "durationSec": 35.2, "elapsedMs": 900}
  POST /transcribe                тело — запись микрофона композера (WAV)
  → {"text": "...", "audioSeconds": 4.2, "inferenceSeconds": 0.3}
  GET  /health

Аудио: ffmpeg (любой контейнер, в т.ч. m4a диктофона iPhone) → 16 кГц моно →
Silero VAD режет речь на фразы → GigaAM v3 CTC (русский, с пунктуацией) →
строки «[мм:сс] текст»: метки времени дают модели и PO ссылаться на место.
Документы: Microsoft MarkItDown — заголовки, списки и таблицы как Markdown.
Сеть наружу сервису не нужна; ключей и трекера здесь нет.
"""
import glob
import io
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import sherpa_onnx
from markitdown import MarkItDown

SR = 16000
MAX_BYTES = int(os.environ.get("INGEST_MAX_BYTES", 200 * 1024 * 1024))
THREADS = int(os.environ.get("INGEST_ASR_THREADS", max(1, min(4, os.cpu_count() or 1))))
AUDIO = {".m4a", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".aac", ".flac", ".webm",
         ".mp4", ".mov", ".amr", ".caf", ".3gp", ".wma"}

_asr_lock = threading.Lock()
_recognizer = None
_markitdown = MarkItDown(enable_plugins=False)


def recognizer():
    """GigaAM v3 CTC: модель грузится один раз (прогрев — на старте)."""
    global _recognizer
    if _recognizer is None:
        models = sorted(glob.glob("/models/asr/model*.onnx"), key=lambda p: "int8" not in p)
        _recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=models[0], tokens="/models/asr/tokens.txt", num_threads=THREADS,
            sample_rate=SR, feature_dim=int(os.environ.get("INGEST_FEATURE_DIM", 64)),
            decoding_method="greedy_search")
    return _recognizer


def decode_audio(data: bytes, ext: str) -> np.ndarray:
    # Во временный файл, а не в pipe: у m4a индекс (moov) бывает в конце файла.
    with tempfile.NamedTemporaryFile(suffix=ext) as src:
        src.write(data)
        src.flush()
        pcm = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src.name,
             "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"],
            capture_output=True, check=True, timeout=600).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def speech_segments(samples: np.ndarray):
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = "/models/silero_vad.onnx"
    cfg.silero_vad.min_silence_duration = 0.4
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = 20
    cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=len(samples) / SR + 30)
    window = cfg.silero_vad.window_size
    segments = []

    def drain():
        while not vad.empty():
            segments.append((vad.front.start / SR, np.array(vad.front.samples, dtype=np.float32)))
            vad.pop()

    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i:i + window])
        drain()
    vad.flush()
    drain()
    return segments


def stamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m // 60}:{m % 60:02d}:{s:02d}" if m >= 60 else f"{m:02d}:{s:02d}"


def recognize(samples: np.ndarray):
    """Фразы записи: [(начало в секундах, текст)]."""
    with _asr_lock:  # CPU: одна расшифровка за раз, потоки — внутри ONNX
        rec = recognizer()
        segments = speech_segments(samples)
        streams = []
        for _, chunk in segments:
            stream = rec.create_stream()
            stream.accept_waveform(SR, chunk)
            streams.append(stream)
        if streams:
            rec.decode_streams(streams)
    return [(start, s.result.text.strip()) for (start, _), s in zip(segments, streams) if s.result.text.strip()]


def transcribe(data: bytes, ext: str) -> dict:
    samples = decode_audio(data, ext)
    lines = [f"[{stamp(start)}] {text}" for start, text in recognize(samples)]
    return {"kind": "audio", "markdown": "\n".join(lines) or "(речь не распознана)", "durationSec": round(len(samples) / SR, 1)}


def convert_document(data: bytes, ext: str) -> dict:
    result = _markitdown.convert_stream(io.BytesIO(data), file_extension=ext)
    text = getattr(result, "markdown", None) or getattr(result, "text_content", "") or ""
    return {"kind": "document", "markdown": text.strip() or "(текст не извлечён)"}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ok": True, "asrReady": _recognizer is not None})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/ingest", "/transcribe"):
            return self.reply(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BYTES:
            return self.reply(413, {"error": f"файл пустой или больше {MAX_BYTES // 2**20} МБ"})
        name = (parse_qs(url.query).get("name") or ["file"])[0]
        ext = os.path.splitext(name)[1].lower()
        data = self.rfile.read(length)
        started = time.monotonic()
        if url.path == "/transcribe":
            return self.dictation(data, started)
        try:
            out = transcribe(data, ext) if ext in AUDIO else convert_document(data, ext)
        except subprocess.CalledProcessError as e:
            return self.reply(422, {"error": f"аудио не декодируется: {e.stderr.decode(errors='replace')[:200]}"})
        except Exception as e:  # формат, который MarkItDown не знает, битый файл
            return self.reply(422, {"error": f"{type(e).__name__}: {str(e)[:200]}"})
        out["elapsedMs"] = int((time.monotonic() - started) * 1000)
        print(f"[ingest] {name}: {out['kind']} {len(out['markdown'])} симв. за {out['elapsedMs']} мс", flush=True)
        self.reply(200, out)

    def dictation(self, data: bytes, started: float) -> None:
        """Микрофон композера (провайдер ctx.speechToText): текст без меток времени."""
        try:
            samples = decode_audio(data, ".wav")
            text = " ".join(t for _, t in recognize(samples))
        except subprocess.CalledProcessError as e:
            return self.reply(422, {"error": f"аудио не декодируется: {e.stderr.decode(errors='replace')[:200]}"})
        elapsed = time.monotonic() - started
        print(f"[transcribe] {len(samples) / SR:.1f} с речи → {len(text)} симв. за {int(elapsed * 1000)} мс", flush=True)
        self.reply(200, {"text": text, "audioSeconds": round(len(samples) / SR, 2), "inferenceSeconds": round(elapsed, 3)})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    threading.Thread(target=recognizer, daemon=True).start()  # прогрев ASR
    port = int(os.environ.get("INGEST_PORT", 8090))
    print(f"[ingest] :{port}, ASR потоков: {THREADS}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
