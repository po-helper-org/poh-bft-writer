# syntax=docker/dockerfile:1
# context-ingest (ADR-0007 rev8): материалы заказчика → Markdown для модели.
#
# Документы — Microsoft MarkItDown (PDF, DOCX, PPTX, XLSX, HTML, CSV, JSON…),
# аудио (диктофон iPhone m4a и др.) — ffmpeg → Silero VAD → GigaAM v3 CTC
# с пунктуацией (sherpa-onnx, CPU). Отдельный контейнер без ключей и без
# доступа к трекеру: недоверенные файлы разбираются здесь, а не в портале.
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl bzip2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      "markitdown[pdf,docx,pptx,xlsx,xls]==0.1.8" \
      "sherpa-onnx==1.13.8" \
      "numpy==2.5.3"

ARG ASR_MODEL=sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16
ARG ASR_RELEASE=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
RUN mkdir -p /models \
 && curl -fsSL "${ASR_RELEASE}/${ASR_MODEL}.tar.bz2" | tar xj -C /models \
 && mv "/models/${ASR_MODEL}" /models/asr \
 && curl -fsSL -o /models/silero_vad.onnx "${ASR_RELEASE}/silero_vad.onnx" \
 && ls -la /models/asr

COPY app.py /app/app.py
ENV PYTHONUNBUFFERED=1 INGEST_PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD curl -fsS http://127.0.0.1:8090/health || exit 1
CMD ["python", "/app/app.py"]
