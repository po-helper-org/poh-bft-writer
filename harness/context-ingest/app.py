"""
context-ingest: материал заказчика → Markdown, который модель читает быстро.

  POST /ingest?name=<имя файла>   тело — байты файла
  → {"kind": "audio"|"document", "markdown": "...", "durationSec": 35.2, "elapsedMs": 900}
  POST /transcribe                тело — запись микрофона композера (WAV)
  → {"text": "...", "audioSeconds": 4.2, "inferenceSeconds": 0.3}
  POST /chunks?name=&max=240      тело — аудиофайл
  → {"durationSec": 899, "chunks": [{"start": 0.0, "mp3": "<base64>"}, …]}
    куски до max секунд, разрезанные по паузам (громкость), mp3 32 кбит/с:
    для облачного распознавания, если GigaAM не справился (ключей здесь нет —
    в облако их отправляет customer-form).
  GET  /health

Аудио: ffmpeg (любой контейнер, в т.ч. m4a диктофона iPhone) → 16 кГц моно →
Silero VAD режет речь на фразы → GigaAM v3 CTC (русский, с пунктуацией) →
строки «[мм:сс] текст»: метки времени дают модели и PO ссылаться на место.
Документы: Microsoft MarkItDown — заголовки, списки и таблицы как Markdown.
Сканы и фото (ADR-0008): картинки и PDF без текстового слоя — Tesseract
rus+eng, страницы PDF растрирует pdftoppm и распознаются параллельно.
Сеть наружу сервису не нужна; ключей и трекера здесь нет.
"""
import glob
import io
from concurrent.futures import ThreadPoolExecutor
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
# По одной фразе быстрее всего: в пакете короткие фразы дополняются до длинной.
ASR_BATCH = int(os.environ.get("INGEST_ASR_BATCH", 1))
THREADS = int(os.environ.get("INGEST_ASR_THREADS", max(1, min(4, os.cpu_count() or 1))))
AUDIO = {".m4a", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".aac", ".flac", ".webm",
         ".mp4", ".mov", ".amr", ".caf", ".3gp", ".wma"}

IMAGES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif", ".heic", ".heif"}
OCR_LANGS = os.environ.get("INGEST_OCR_LANGS", "rus+eng")
OCR_DPI = int(os.environ.get("INGEST_OCR_DPI", 300))
OCR_MAX_PAGES = int(os.environ.get("INGEST_OCR_MAX_PAGES", 30))
OCR_WORKERS = int(os.environ.get("INGEST_OCR_WORKERS", max(1, min(4, os.cpu_count() or 1))))
# Текстовый слой короче этого на страницу — скан: распознаём картинку.
SCAN_CHARS_PER_PAGE = 80

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
    out = []
    with _asr_lock:  # CPU: одна расшифровка за раз, потоки — внутри ONNX
        rec = recognizer()
        segments = speech_segments(samples)
        # Пакетами: 180 фраз 15-минутной встречи одним decode_streams съедали
        # 5,6 ГБ и роняли сервис по лимиту памяти.
        for i in range(0, len(segments), ASR_BATCH):
            batch = segments[i:i + ASR_BATCH]
            streams = []
            for _, chunk in batch:
                stream = rec.create_stream()
                stream.accept_waveform(SR, chunk)
                streams.append(stream)
            rec.decode_streams(streams)
            out += [(start, s.result.text.strip()) for (start, _), s in zip(batch, streams) if s.result.text.strip()]
    return out


def transcribe(data: bytes, ext: str) -> dict:
    samples = decode_audio(data, ext)
    lines = [f"[{stamp(start)}] {text}" for start, text in recognize(samples)]
    return {"kind": "audio", "markdown": "\n".join(lines) or "(речь не распознана)", "durationSec": round(len(samples) / SR, 1)}


def ocr_png(path: str) -> str:
    # OMP_THREAD_LIMIT=1: параллелим страницы, а не потоки внутри одной.
    out = subprocess.run(["tesseract", path, "-", "-l", OCR_LANGS, "--psm", "3"],
                         capture_output=True, check=True, timeout=180, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    return out.stdout.decode(errors="replace").strip()


def ocr_image(data: bytes) -> dict:
    """Фото документа или скриншот (в т.ч. HEIC с iPhone) → текст."""
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("L")
    if image.width < 1600:  # мелкий текст Tesseract читает хуже: увеличиваем
        scale = 1600 / image.width
        image = image.resize((1600, int(image.height * scale)), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png") as png:
        image.save(png.name)
        text = ocr_png(png.name)
    return {"kind": "document", "ocr": True, "markdown": text or "(текст на изображении не найден)"}


def pdf_pages(path: str) -> int:
    info = subprocess.run(["pdfinfo", path], capture_output=True, timeout=30).stdout.decode(errors="replace")
    for line in info.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    return 1


def ocr_pdf(data: bytes) -> dict:
    """PDF-скан: страницы → PNG (pdftoppm) → Tesseract параллельно."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.pdf")
        with open(src, "wb") as f:
            f.write(data)
        total = pdf_pages(src)
        pages = min(total, OCR_MAX_PAGES)
        subprocess.run(["pdftoppm", "-r", str(OCR_DPI), "-gray", "-png", "-l", str(pages), src, os.path.join(tmp, "p")],
                       capture_output=True, check=True, timeout=600)
        images = sorted(glob.glob(os.path.join(tmp, "p-*.png")))
        with ThreadPoolExecutor(OCR_WORKERS) as pool:
            texts = list(pool.map(ocr_png, images))
    parts = [f"## Страница {i}\n\n{t}" for i, t in enumerate(texts, 1) if t]
    if total > pages:
        parts.append(f"[… распознаны первые {pages} из {total} страниц …]")
    return {"kind": "document", "ocr": True, "pages": total, "markdown": "\n\n".join(parts) or "(текст в скане не найден)"}


def pause_points(samples: np.ndarray) -> np.ndarray:
    """Середины пауз ≥0,3 с (тихие кадры по 30 мс) — места для разреза, в отсчётах.
    Громкость numpy-ом, без Silero: 15 минут — миллисекунды вместо секунд."""
    frame = int(SR * 0.03)
    n = len(samples) // frame
    if n == 0:
        return np.array([], dtype=np.int64)
    rms = np.sqrt(np.mean(samples[:n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    quiet = rms < max(np.percentile(rms, 20) * 1.8, 10 ** (-45 / 20))
    edges = np.flatnonzero(np.diff(np.concatenate(([0], quiet.astype(np.int8), [0]))))
    starts, ends = edges[::2], edges[1::2]
    long = (ends - starts) >= 10  # 10 кадров = 0,3 с
    return ((starts[long] + ends[long]) // 2 * frame).astype(np.int64)


def audio_chunks(data: bytes, ext: str, max_sec: float) -> dict:
    """Запись → куски до max_sec, разрез — в паузах, mp3 32 кбит/с для облака."""
    import base64
    samples = decode_audio(data, ext)
    total = len(samples)
    limit = int(max_sec * SR)
    pauses = pause_points(samples)
    cuts = [0]
    while total - cuts[-1] > limit:
        window = pauses[(pauses > cuts[-1] + limit // 3) & (pauses <= cuts[-1] + limit)]
        cuts.append(int(window[-1]) if len(window) else cuts[-1] + limit)  # нет паузы — жёстко
    cuts.append(total)
    spans = [(a, b) for a, b in zip(cuts, cuts[1:]) if b - a >= SR // 2]

    def encode(span):
        a, b = span
        pcm = (samples[a:b] * 32767).astype(np.int16).tobytes()
        mp3 = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1",
                              "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "32k", "-f", "mp3", "pipe:1"],
                             input=pcm, capture_output=True, check=True, timeout=300).stdout
        return {"start": round(a / SR, 2), "mp3": base64.b64encode(mp3).decode()}

    with ThreadPoolExecutor(OCR_WORKERS) as pool:
        chunks = list(pool.map(encode, spans))
    return {"durationSec": round(total / SR, 1), "chunks": chunks}


def convert_document(data: bytes, ext: str) -> dict:
    if ext in IMAGES:
        return ocr_image(data)
    result = _markitdown.convert_stream(io.BytesIO(data), file_extension=ext)
    text = (getattr(result, "markdown", None) or getattr(result, "text_content", "") or "").strip()
    if ext == ".pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf") as src:
            src.write(data)
            src.flush()
            pages = pdf_pages(src.name)
        if len(text) < SCAN_CHARS_PER_PAGE * pages:
            return ocr_pdf(data)
    return {"kind": "document", "markdown": text or "(текст не извлечён)"}


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
        if url.path not in ("/ingest", "/transcribe", "/chunks"):
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
        if url.path == "/chunks":
            try:
                max_sec = float((parse_qs(url.query).get("max") or ["240"])[0])
                out = audio_chunks(data, ext, max(30.0, min(max_sec, 600.0)))
            except subprocess.CalledProcessError as e:
                return self.reply(422, {"error": f"аудио не декодируется: {e.stderr.decode(errors='replace')[:200]}"})
            print(f"[chunks] {name}: {out['durationSec']} с → {len(out['chunks'])} кусков за {int((time.monotonic() - started) * 1000)} мс", flush=True)
            return self.reply(200, out)
        try:
            out = transcribe(data, ext) if ext in AUDIO else convert_document(data, ext)
        except subprocess.CalledProcessError as e:
            return self.reply(422, {"error": f"аудио не декодируется: {e.stderr.decode(errors='replace')[:200]}"})
        except Exception as e:  # формат, который MarkItDown не знает, битый файл
            return self.reply(422, {"error": f"{type(e).__name__}: {str(e)[:200]}"})
        out["elapsedMs"] = int((time.monotonic() - started) * 1000)
        kind = "OCR" if out.get("ocr") else out["kind"]
        print(f"[ingest] {name}: {kind} {len(out['markdown'])} симв. за {out['elapsedMs']} мс", flush=True)
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
