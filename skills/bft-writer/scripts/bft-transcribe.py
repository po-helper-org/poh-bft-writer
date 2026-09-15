#!/usr/bin/env python3
"""Локальная транскрибация аудиозаписи встречи в текстовый транскрипт для /bft-fast.

Использование:
    python3 bft-transcribe.py <аудио> [<аудио> ...] [--out <файл|каталог>]
        [--model large-v3-turbo] [--language ru] [--model-dir <каталог>]
        [--no-download] [--whisper-bin <путь>] [--ffmpeg-bin <путь>]

Запись с диктофона (iPhone — .m4a, любой контейнер, который читает ffmpeg)
конвертируется в 16 кГц моно WAV и распознаётся whisper.cpp (`whisper-cli`,
`brew install whisper-cpp`) **на этой машине**: аудио никуда не отправляется,
периметр /bft-fast («сам наружу не ходит») не нарушается. Единственное
обращение в сеть — разовая загрузка модели ggml с Hugging Face в кэш
(`--model-dir` → `$WHISPER_CPP_MODEL_DIR` → `~/.cache/whisper-cpp`);
`--no-download` её запрещает — тогда модель кладётся руками.

Результат — markdown-файл с frontmatter (источник, длительность, модель,
язык, дата) и текстом без таймстемпов: строка = сегмент распознавания.
Дефолтное имя — `<имя записи>.transcript.md` рядом с записью; несколько
записей → по файлу на каждую, `--out` тогда каталог.

Коды выхода: 0 — готово; 2 — аргументы/файл не найден/формат не поддержан;
3 — нет ffmpeg или whisper-cli; 4 — модель недоступна (нет в кэше, загрузка
запрещена или упала); 5 — распознавание упало или речи не найдено.
Стенографист на ненулевой код останавливается и сообщает причину — он
не эмулирует содержимое записи.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "large-v3-turbo"
DEFAULT_LANGUAGE = "ru"
MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin"
# Контейнеры, которые читает ffmpeg и в которых реально приходят записи
# встреч: диктофон iPhone (.m4a), Telegram (.ogg/.opus), Zoom/Meet (.mp4/.m4a),
# старые диктофоны (.wma/.amr). Расширение — первый фильтр: путь к .md или
# .csv сюда попасть не должен даже случайно.
AUDIO_EXTS = {
    ".m4a", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".wma",
    ".amr", ".caf", ".aiff", ".aif", ".mp4", ".mov", ".m4v", ".webm", ".mkv",
}

EXIT_ARGS = 2
EXIT_TOOLS = 3
EXIT_MODEL = 4
EXIT_TRANSCRIBE = 5


class TranscribeError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def is_audio_path(path: str) -> bool:
    """Похож ли путь на аудио/видео-запись — по расширению, без чтения файла."""
    return Path(path).suffix.lower() in AUDIO_EXTS


def resolve_tool(explicit: str | None, name: str, hint: str) -> str:
    binary = explicit or shutil.which(name)
    if not binary or not Path(binary).exists():
        raise TranscribeError(EXIT_TOOLS, f"не найден {name}: {hint}")
    return binary


def resolve_model(model: str, model_dir: Path, allow_download: bool) -> tuple[Path, str]:
    """Имя модели → путь к ggml-файлу в кэше (с разовой загрузкой) или явный путь."""
    candidate = Path(model).expanduser()
    if candidate.suffix == ".bin" or candidate.exists():
        if not candidate.exists():
            raise TranscribeError(EXIT_MODEL, f"файл модели не найден: {candidate}")
        return candidate, candidate.stem.removeprefix("ggml-")

    name = model.removeprefix("ggml-")
    target = model_dir / f"ggml-{name}.bin"
    if target.exists():
        return target, name
    if not allow_download:
        raise TranscribeError(
            EXIT_MODEL,
            f"модели {target} нет, загрузка запрещена (--no-download). "
            f"Положи файл вручную: {MODEL_URL.format(name=name)}",
        )
    download_model(name, target)
    return target, name


def download_model(name: str, target: Path) -> None:
    url = MODEL_URL.format(name=name)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(".bin.part")
    print(f"Модель {name} не в кэше — загружаю {url} → {target}", file=sys.stderr)
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(part, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            last_pct = -1
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    if pct // 10 != last_pct // 10:
                        print(f"  {pct}% ({done >> 20} МБ из {total >> 20})", file=sys.stderr)
                        last_pct = pct
    except (urllib.error.URLError, OSError) as exc:
        part.unlink(missing_ok=True)
        raise TranscribeError(
            EXIT_MODEL,
            f"загрузка модели {name} не удалась: {exc}. "
            f"Скачай вручную {url} в {target.parent} или укажи --model <путь к .bin>",
        ) from exc
    part.replace(target)


def probe_duration(audio: Path, ffprobe: str | None) -> str | None:
    if not ffprobe:
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(audio)],
            capture_output=True, text=True, timeout=60, check=False,
        ).stdout.strip()
        seconds = int(float(out))
    except (ValueError, subprocess.SubprocessError, OSError):
        return None
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def convert_to_wav(audio: Path, wav: Path, ffmpeg: str) -> None:
    """Любой контейнер → 16 кГц моно PCM: единственный вход, который понимает whisper-cli."""
    proc = subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(audio),
         "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0 or not wav.exists():
        reason = (proc.stderr or "").strip().splitlines()
        raise TranscribeError(
            EXIT_TRANSCRIBE,
            f"ffmpeg не смог прочитать {audio.name}: {reason[-1] if reason else 'код ' + str(proc.returncode)}",
        )


def run_whisper(wav: Path, model: Path, language: str, whisper: str, threads: int) -> str:
    out_base = wav.with_suffix("")
    cmd = [
        whisper, "-m", str(model), "-l", language, "-f", str(wav),
        "-t", str(threads), "-np", "-otxt", "-of", str(out_base),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    txt = out_base.with_suffix(".txt")
    if proc.returncode != 0 or not txt.exists():
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise TranscribeError(
            EXIT_TRANSCRIBE,
            f"whisper-cli завершился с кодом {proc.returncode}: {tail[-1] if tail else 'без вывода'}",
        )
    return txt.read_text(encoding="utf-8")


def tidy(text: str) -> str:
    """Сегменты whisper — по строке; пустые и служебные ([BLANK_AUDIO]) выбрасываем."""
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or (line.startswith("[") and line.endswith("]")):
            continue
        lines.append(line)
    return "\n".join(lines)


def render(audio: Path, body: str, model_name: str, language: str, duration: str | None) -> str:
    front = [
        "---",
        f"source_audio: {audio.resolve()}",
        f"duration: {duration or '[не определена]'}",
        f"model: {model_name}",
        f"language: {language}",
        f"transcribed: {dt.date.today().isoformat()}",
        "tool: whisper.cpp (whisper-cli)",
        "---",
        "",
        f"# Транскрипт: {audio.name}",
        "",
        "> Автоматическое распознавание речи, локально, без таймстемпов. "
        "Имена, термины и цифры проверяй по записи — распознавание ошибается на них чаще всего.",
        "",
        body,
        "",
    ]
    return "\n".join(front)


def transcribe_one(audio: Path, out: Path, args, tools: dict) -> tuple[Path, str | None]:
    if not audio.exists():
        raise TranscribeError(EXIT_ARGS, f"файл не найден: {audio}")
    if not is_audio_path(str(audio)):
        raise TranscribeError(
            EXIT_ARGS,
            f"{audio.name}: расширение {audio.suffix or '(нет)'} не похоже на запись; "
            f"поддерживаются {', '.join(sorted(AUDIO_EXTS))}",
        )
    model_path, model_name = resolve_model(args.model, Path(args.model_dir).expanduser(), not args.no_download)
    duration = probe_duration(audio, tools.get("ffprobe"))
    with tempfile.TemporaryDirectory(prefix="bft-transcribe-") as tmp:
        wav = Path(tmp) / "audio.wav"
        convert_to_wav(audio, wav, tools["ffmpeg"])
        raw = run_whisper(wav, model_path, args.language, tools["whisper"], args.threads)
    body = tidy(raw)
    if not body:
        raise TranscribeError(
            EXIT_TRANSCRIBE,
            f"в {audio.name} речь не распознана (пустой результат) — проверь запись и язык (--language {args.language})",
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(audio, body, model_name, args.language, duration), encoding="utf-8")
    return out, duration


def plan_outputs(inputs: list[Path], out_arg: str | None) -> list[Path]:
    if out_arg is None:
        return [p.with_name(f"{p.stem}.transcript.md") for p in inputs]
    out = Path(out_arg).expanduser()
    if len(inputs) == 1 and not out.is_dir() and out.suffix:
        return [out]
    return [out / f"{p.stem}.transcript.md" for p in inputs]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Локальная транскрибация записи встречи (whisper.cpp) для /bft-fast.",
    )
    parser.add_argument("audio", nargs="+", help="запись: .m4a/.mp3/.wav/.ogg/.mp4 и др.")
    parser.add_argument("--out", help="файл транскрипта (одна запись) или каталог (несколько)")
    parser.add_argument("--model", default=os.environ.get("BFT_TRANSCRIBE_MODEL", DEFAULT_MODEL),
                        help=f"имя модели ggml (дефолт {DEFAULT_MODEL}) или путь к .bin")
    parser.add_argument("--language", default=os.environ.get("BFT_TRANSCRIBE_LANGUAGE", DEFAULT_LANGUAGE),
                        help=f"язык речи (дефолт {DEFAULT_LANGUAGE}; auto — автоопределение)")
    parser.add_argument("--model-dir", default=os.environ.get("WHISPER_CPP_MODEL_DIR", "~/.cache/whisper-cpp"),
                        help="кэш моделей ggml")
    parser.add_argument("--no-download", action="store_true", help="не загружать модель из сети")
    parser.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    parser.add_argument("--whisper-bin", help="путь к whisper-cli (дефолт — из PATH)")
    parser.add_argument("--ffmpeg-bin", help="путь к ffmpeg (дефолт — из PATH)")
    args = parser.parse_args()

    inputs = [Path(p).expanduser() for p in args.audio]
    outputs = plan_outputs(inputs, args.out)
    try:
        tools = {
            "ffmpeg": resolve_tool(args.ffmpeg_bin, "ffmpeg", "brew install ffmpeg"),
            "whisper": resolve_tool(args.whisper_bin, "whisper-cli", "brew install whisper-cpp"),
            "ffprobe": shutil.which("ffprobe"),
        }
        for audio, out in zip(inputs, outputs):
            path, duration = transcribe_one(audio, out, args, tools)
            print(f"Транскрипт: {path} (запись {audio.name}, {duration or 'длительность не определена'}, модель {args.model})")
    except TranscribeError as exc:
        print(f"⚠️ Транскрибация не выполнена: {exc}", file=sys.stderr)
        return exc.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
