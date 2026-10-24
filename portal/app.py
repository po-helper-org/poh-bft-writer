"""Портал заказчика (ADR-0007): «Введите свои мысли» — и всё.

Один экран: кто вы + текст/голос/файлы/ссылки. Отправка создаёт задачу-запрос
в Vikunja (<1с до ссылки), дальше микродиалог на быстрой модели (glm-5-turbo)
добирает контекст по канону БФТ: ФИО/email, суть, ASIS, GAP, TOBE, HowToDemo,
глоссарий. Итог — Summary + файл полного контекста в комментариях задачи.

Модель отвечает JSON (response_format json_object — тот же режим, что у
коробки): {reply, fields, questions} — фронт рисует виджет-скоркарту.
"""
from __future__ import annotations

import json
import os
import smtplib
import subprocess
import tempfile
import uuid
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

app = FastAPI(title="bft-portal")

DATA = Path(os.environ.get("PORTAL_DATA", "/data/requests"))
DATA.mkdir(parents=True, exist_ok=True)

VIKUNJA = os.environ.get("TRACKER_URL", "http://tracker:3456/api/v1").rstrip("/")
VIKUNJA_PUBLIC = os.environ.get("TRACKER_PUBLIC_URL", "http://127.0.0.1:3456")
VIKUNJA_USER = os.environ.get("TRACKER_USER", "bft-admin")
VIKUNJA_PASSWORD = os.environ.get("TRACKER_PASSWORD", "")
PROJECT_PREFIX = os.environ.get("TRACKER_PROJECT_PREFIX", "БФТ")

ZAI_KEY = os.environ.get("ZAI_API_KEY", "")
ZAI_MODEL = os.environ.get("PORTAL_MODEL", "glm-5-turbo")
ZAI_URL = "https://api.z.ai/api/paas/v4/chat/completions"

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "bft-portal@localhost")

# Канон постановки БФТ — что должен собрать диалог (задание владельца).
FIELDS = ["customer", "summary", "asis", "gap", "tobe", "howtodemo", "glossary"]
FIELD_TITLES = {
    "customer": "Заказчик (ФИО + email)",
    "summary": "Суть инициативы",
    "asis": "ASIS — как работает сейчас",
    "gap": "GAP — почему не устраивает",
    "tobe": "TOBE — как должно работать",
    "howtodemo": "HowToDemo — сценарий приёмки",
    "glossary": "Глоссарий сокращений",
}

SYSTEM_PROMPT = """Ты — ассистент сбора постановки БФТ. Заказчик уже описал инициативу.
Твоя задача — ДОБРАТЬ контекст по полям и НЕ мучить лишними вопросами.

Поля: customer (ФИО+email), summary (суть), asis (как сейчас), gap (почему не устраивает),
tobe (как должно), howtodemo (пошаговый сценарий приёмки: где и как заказчик проверит работу),
glossary (расшифровка всех сокращений/аббревиатур из текста).

Правила:
- Отвечай КОРОТКО (1-3 предложения), по-русски, живо, без канцелярита.
- За один ход спрашивай ТОЛЬКО о самых важных пробелах (максимум 2-3 вопроса, можно списком).
- Сокращение без расшифровки — спроси расшифровку, добавь в glossary.
- Когда все поля заполнены достаточно — попрощайся одним предложением, questions=[].
- howtodemo: если заказчик не описал, спроси «как и где вы будете проверять результат? по шагам».

Ответ СТРОГО JSON:
{"reply": "текст заказчику",
 "fields": {"customer": "...|null", "summary": "...|null", "asis": "...|null", "gap": "...|null", "tobe": "...|null", "howtodemo": "...|null", "glossary": [{"term": "...", "expansion": "..."}]},
 "questions": ["вопрос1", ...]}"""


# ── Vikunja ────────────────────────────────────────────────────────────────
_vk_token: Optional[str] = None
_vk_project: Optional[int] = None


async def vk() -> httpx.AsyncClient:
    global _vk_token
    client = httpx.AsyncClient(base_url=VIKUNJA, timeout=15)
    if not _vk_token:
        r = await client.post("/login", json={"username": VIKUNJA_USER, "password": VIKUNJA_PASSWORD})
        r.raise_for_status()
        _vk_token = r.json()["token"]
    client.headers["Authorization"] = f"Bearer {_vk_token}"
    return client


async def vk_project_id(client: httpx.AsyncClient) -> int:
    global _vk_project
    if _vk_project:
        return _vk_project
    r = await client.get("/projects")
    r.raise_for_status()
    for p in r.json():
        if p["title"].startswith(PROJECT_PREFIX):
            _vk_project = p["id"]
            return _vk_project
    raise HTTPException(500, f"проект «{PROJECT_PREFIX}…» не найден")


# ── модель (микродиалог) ───────────────────────────────────────────────────
async def ask_model(messages: list[dict]) -> dict:
    if not ZAI_KEY:
        return {
            "reply": "Ключ модели не настроен (ZAI_API_KEY): диалог недоступен, "
                     "запрос сохранён — PO заберёт контекст вручную.",
            "fields": {}, "questions": [],
        }
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(ZAI_URL, headers={"Authorization": f"Bearer {ZAI_KEY}"}, json={
            "model": ZAI_MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
        })
        r.raise_for_status()
        try:
            return json.loads(r.json()["choices"][0]["message"]["content"])
        except Exception:  # noqa: BLE001
            return {"reply": "…(модель ответала не по форме, повторите)", "fields": {}, "questions": []}


# ── состояние диалога ──────────────────────────────────────────────────────
def state_path(task_id: int) -> Path:
    return DATA / str(task_id) / "state.json"


def load_state(task_id: int) -> dict:
    p = state_path(task_id)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"messages": [], "fields": {}, "glossary": [], "email": "", "name": ""}


def save_state(task_id: int, st: dict) -> None:
    p = state_path(task_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def merge_fields(st: dict, fields: dict, glossary: list) -> dict:
    """Ответы модели не затирают сказанное заказчиком напрямую: только заполняют пустое."""
    for k in FIELDS[:-1]:
        v = (fields or {}).get(k)
        if v and not st["fields"].get(k):
            st["fields"][k] = str(v).strip()
    seen = {g["term"].lower() for g in st["glossary"]}
    for g in glossary or []:
        t, e = g.get("term", "").strip(), g.get("expansion", "").strip()
        if t and e and t.lower() not in seen:
            st["glossary"].append({"term": t, "expansion": e})
            seen.add(t.lower())
    return st


def scorecard(st: dict) -> dict:
    """Виджет: какие поля собраны (заказчик видит прогресс постановки)."""
    rows = []
    for k in FIELDS:
        filled = bool(st["fields"].get(k)) or (k == "glossary" and bool(st["glossary"]))
        rows.append({"key": k, "title": FIELD_TITLES[k], "filled": filled})
    return {"rows": rows, "done": sum(r["filled"] for r in rows), "total": len(rows)}


# ── email ──────────────────────────────────────────────────────────────────
def send_email(to: str, subject: str, body: str) -> None:
    if not (SMTP_HOST and to):
        return
    try:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = SMTP_FROM, to, subject
        msg.set_content(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
    except Exception:  # noqa: BLE001 — письмо не должно ронять портал
        pass


# ── API ────────────────────────────────────────────────────────────────────
class SubmitIn(BaseModel):
    name: str = ""
    email: str = ""
    text: str = ""
    links: list[str] = []
    files: list[str] = []   # имена, загруженные через /api/upload заранее


@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "index.html")


@app.get("/api/health")
async def health():
    return {"ok": True, "model": bool(ZAI_KEY), "tracker": bool(VIKUNJA_PASSWORD)}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    """Файл — сразу на диск (каталог запроса создаст submit по task_id)."""
    rid = uuid.uuid4().hex[:10]
    folder = DATA / "inbox" / rid
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / (file.filename or "file").replace("/", "_")
    dest.write_bytes(await file.read())
    return {"ref": f"inbox/{rid}/{dest.name}", "name": dest.name, "size": dest.stat().st_size}


def fmt_description(name: str, email: str, text: str, links: list[str], files: list[str]) -> str:
    parts = ["# Запрос инициативы (портал заказчика)", ""]
    if name or email:
        parts.append(f"**Заказчик:** {name} {f'<{email}>' if email else ''}".strip())
    parts += ["", text.strip() or "(текст будет добавлен в диалоге)", ""]
    if links:
        parts.append("**Ссылки:** " + "\n- ".join([""] + links))
    if files:
        parts.append("**Вложения:** " + "\n- ".join([""] + files))
    return "\n".join(parts)


@app.post("/api/submit")
async def submit(body: SubmitIn):
    """Создать задачу-запрос в Vikunja — быстро (<1с до ссылки заказчику)."""
    if not (body.text.strip() or body.files or body.links):
        raise HTTPException(400, "пустой запрос: нужен текст, файлы или ссылки")
    client = await vk()
    pid = await vk_project_id(client)
    r = await client.put(f"/projects/{pid}/tasks", json={
        "title": (body.text.strip()[:80] or "Запрос с портала") + ("…" if len(body.text.strip()) > 80 else ""),
        "description": fmt_description(body.name, body.email, body.text, body.links, body.files),
        "label_titles": ["запрос"],
    })
    if r.status_code not in (200, 201):
        raise HTTPException(502, f"трекер: {r.status_code}")
    task = r.json()
    tid = task["id"]
    # лейбл «запрос»: Vikunja не принимает label_titles при создании —
    # привязываем отдельно (id ищем в /labels, не плодя дублей).
    lr = await client.get("/labels")
    if lr.status_code == 200:
        lab = next((l for l in lr.json() if l["title"] == "запрос"), None)
        if lab:
            await client.put(f"/tasks/{tid}/labels", json={"label_id": lab["id"]})
    # вложения: перекладываем inbox-файлы в задачу (Vikunja attachments API)
    for ref in body.files:
        src = DATA / ref
        if not src.exists():
            continue
        await client.put(f"/tasks/{tid}/attachments",
                          files={"files": (src.name, src.read_bytes())})
        (DATA / str(tid)).mkdir(parents=True, exist_ok=True)
        src.rename(DATA / str(tid) / src.name)
    st = load_state(tid)
    st.update({"email": body.email, "name": body.name,
               "fields": {"customer": f"{body.name} {body.email}".strip() or None},
               "initial": {"text": body.text, "links": body.links, "files": body.files}})
    st["messages"].append({"role": "user",
                           "content": f"Инициатива заказчика (может быть сырая):\n{body.text}\n"
                                      f"Ссылки: {body.links}\nВложения: {body.files}"})
    save_state(tid, st)
    send_email(body.email, "Ваш запрос принят",
               f"Запрос создан: {VIKUNJA_PUBLIC}/tasks/{tid}\n"
               f"Отслеживание: {VIKUNJA_PUBLIC}\n\nСпасибо! Ассистент задаст уточняющие вопросы в чате.")
    return {"task_id": tid, "url": f"{VIKUNJA_PUBLIC}/tasks/{tid}"}


class ChatIn(BaseModel):
    task_id: int
    message: str


@app.post("/api/chat")
async def chat(body: ChatIn):
    st = load_state(body.task_id)
    st["messages"].append({"role": "user", "content": body.message})
    out = await ask_model(st["messages"][-14:])
    st["messages"].append({"role": "assistant", "content": out.get("reply", "")})
    merge_fields(st, out.get("fields") or [], out.get("glossary") or out.get("fields", {}).get("glossary") or [])
    # email/ФИО из ответа заказчика
    if not st["email"] and "@" in body.message:
        word = next((w for w in body.message.split() if "@" in w), None)
        if word:
            st["email"] = word.strip("<>,.")
    save_state(body.task_id, st)
    return {"reply": out.get("reply", ""), "questions": out.get("questions", []),
            "scorecard": scorecard(st), "glossary": st["glossary"]}


@app.get("/api/state/{task_id}")
async def state(task_id: int):
    st = load_state(task_id)
    return {"scorecard": scorecard(st), "glossary": st["glossary"],
            "email": st.get("email", "")}


@app.post("/api/finalize/{task_id}")
async def finalize(task_id: int):
    """Summary + файл полного контекста — комментарием в задачу; письмо со ссылкой."""
    st = load_state(task_id)
    client = await vk()
    lines = [f"**Summary (собрано ассистентом):**", ""]
    for k in FIELDS[:-1]:
        v = st["fields"].get(k)
        lines.append(f"- **{FIELD_TITLES[k]}:** {v or '— не заполнено, спросит PO —'}")
    if st["glossary"]:
        lines.append(f"- **Глоссарий:** " + "; ".join(f"{g['term']} — {g['expansion']}" for g in st["glossary"]))
    await client.put(f"/tasks/{task_id}/comments", json={"comment": "\n".join(lines)})
    # файл полного контекста (диалог + постановка) — вложением
    full = [f"# Полный контекст запроса #{task_id}", "",
            fmt_description(st.get("name", ""), st.get("email", ""),
                            st["initial"].get("text", ""), st["initial"].get("links", []),
                            st["initial"].get("files", [])), "", "## Диалог ассистента", ""]
    for m in st["messages"]:
        who = "Заказчик" if m["role"] == "user" else "Ассистент"
        full.append(f"**{who}:** {m['content']}")
    folder = DATA / str(task_id)
    folder.mkdir(parents=True, exist_ok=True)
    fpath = folder / f"context-{task_id}.md"
    fpath.write_text("\n".join(full), encoding="utf-8")
    await client.put(f"/tasks/{task_id}/attachments",
                      files={"files": (fpath.name, fpath.read_bytes())})
    url = f"{VIKUNJA_PUBLIC}/tasks/{task_id}"
    send_email(st.get("email", ""), f"Контекст запроса #{task_id} собран",
               f"Постановка собрана. Отслеживание: {url}\nДоска: {VIKUNJA_PUBLIC}")
    return {"url": url, "board": VIKUNJA_PUBLIC, "scorecard": scorecard(st)}
