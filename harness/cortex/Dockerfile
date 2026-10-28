# Кортекс (ADR-0011): память организации poh-cortex как сервис коробки — только на чтение.
# Инструмент — тот же bin/cortex (стандартная библиотека Python), версия закреплена.
# Память организации монтируется в /vault (CORTEX_VAULT); без неё — демо-память образа.
FROM python:3.12-slim
ARG CORTEX_REF=990919caf172eda80b83e279c792729e42d4d54c
RUN python - <<PY
import io, tarfile, urllib.request
url = "https://codeload.github.com/po-helper-org/poh-cortex/tar.gz/${CORTEX_REF}"
data = urllib.request.urlopen(url, timeout=60).read()
with tarfile.open(fileobj=io.BytesIO(data)) as tar:
    top = tar.getnames()[0].split("/")[0]
    tar.extractall("/opt", filter="data")
import os; os.rename(f"/opt/{top}", "/opt/poh-cortex")
PY
# Демо-память: шаблон + несколько узлов о покупке билетов; включены Нексусы
# processes и landscape (в шаблоне они закомментированы — заводятся по нужде).
COPY demo/ /opt/demo-overlay/
RUN cp -r /opt/poh-cortex /opt/demo-vault \
 && cp -r /opt/demo-overlay/GROUND/. /opt/demo-vault/GROUND/ \
 && sed -i -E 's/^  # - (\{slug: (landscape|processes),)/  - \1/' /opt/demo-vault/GROUND/NEXUS/_registry.yaml \
 && python3 /opt/demo-vault/bin/cortex --root /opt/demo-vault report | tail -3
COPY server.py /opt/cortex-server.py
RUN useradd -m -u 10002 cortex
USER cortex
EXPOSE 8095
HEALTHCHECK --interval=10s --retries=6 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8095/health', timeout=3)"
CMD ["python3", "/opt/cortex-server.py"]
