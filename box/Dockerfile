FROM python:3.12-slim
# За корпоративным прокси с подменой сертификата: docker build --secret id=cabundle,src=ca.crt .
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=cabundle,required=false \
    if [ -s /run/secrets/cabundle ]; then export PIP_CERT=/run/secrets/cabundle SSL_CERT_FILE=/run/secrets/cabundle; fi \
 && pip install --no-cache-dir -r requirements.txt
COPY bftbox ./bftbox
COPY config ./config
COPY prompts ./prompts
RUN useradd -m -u 10001 box
USER box
ENV PYTHONUNBUFFERED=1
EXPOSE 8700
CMD ["python", "-m", "bftbox.mcp_server"]
