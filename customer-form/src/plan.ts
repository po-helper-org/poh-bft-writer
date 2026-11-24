/**
 * «Планирование» (ADR-0025): из полного БФТ — сразу к декомпозиции с командой.
 * Экран: слева заметка (Вопросы, Декомпозиция, Риски, Сроки), справа доска
 * Excalidraw. «Сохранить» кладёт в папку заявки plan/: note.md, board.excalidraw,
 * board.svg, board.pdf (WeasyPrint) и архив planirovanie.zip — он же артефакт
 * внизу страницы БФТ и вложение комментария при публикации в Confluence.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

export const PLAN_TEMPLATE = ['## Вопросы', '- ', '', '## Декомпозиция', '- ', '', '## Риски', '- ', '', '## Сроки', '- ', ''].join('\n')

export const PLAN_LIMITS = { note: 200_000, scene: 25_000_000, svg: 25_000_000, by: 120 }

export interface PlanFiles { dir: string; note: string; scene: string; svg: string; pdf: string; zip: string; meta: string }

export const planFiles = (requestDir: string): PlanFiles => {
  const dir = join(requestDir, 'plan')
  return { dir, note: join(dir, 'note.md'), scene: join(dir, 'board.excalidraw'), svg: join(dir, 'board.svg'), pdf: join(dir, 'board.pdf'), zip: join(dir, 'planirovanie.zip'), meta: join(dir, 'meta.json') }
}

export interface PlanMeta { savedAt: string; by?: string; rev: number; pdf: boolean; elements: number }

export interface SavedPlan { note: string; scene: string; meta: PlanMeta }

export async function readPlan(requestDir: string): Promise<SavedPlan | undefined> {
  const f = planFiles(requestDir)
  try {
    const meta = JSON.parse(await readFile(f.meta, 'utf8')) as PlanMeta
    return { note: await readFile(f.note, 'utf8').catch(() => ''), scene: await readFile(f.scene, 'utf8').catch(() => ''), meta }
  } catch {
    return undefined
  }
}

export interface PlanInput { note: string; scene: string; svg: string; by?: string }

/** Проверка входа «Сохранить»: строки, размеры, сцена — JSON Excalidraw. */
export function validatePlan(body: unknown): PlanInput | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const note = typeof b.note === 'string' ? b.note : ''
  const scene = typeof b.scene === 'string' ? b.scene : ''
  const svg = typeof b.svg === 'string' ? b.svg : ''
  const by = typeof b.by === 'string' ? b.by.trim().slice(0, PLAN_LIMITS.by) : ''
  if (note.length > PLAN_LIMITS.note) return { error: 'заметка длиннее 200 000 знаков' }
  if (scene.length > PLAN_LIMITS.scene || svg.length > PLAN_LIMITS.svg) return { error: 'доска больше 25 МБ — уберите крупные картинки' }
  if (scene) {
    try {
      const parsed = JSON.parse(scene) as { type?: unknown; elements?: unknown }
      if (parsed.type !== 'excalidraw' || !Array.isArray(parsed.elements)) return { error: 'доска — не сцена Excalidraw' }
    } catch {
      return { error: 'доска — не JSON' }
    }
  }
  if (svg && !/^<svg[\s>]/.test(svg.trim())) return { error: 'изображение доски — не SVG' }
  if (!note.trim() && !elementsOf(scene)) return { error: 'пусто: ни заметки, ни рисунка на доске' }
  return { note, scene, svg, ...(by ? { by } : {}) }
}

function elementsOf(scene: string): number {
  try {
    const els = (JSON.parse(scene) as { elements?: Array<{ isDeleted?: boolean }> }).elements ?? []
    return els.filter((e) => !e.isDeleted).length
  } catch {
    return 0
  }
}

/** SVG доски без скриптов и обработчиков: его отдаёт портал и встраивает PDF. */
export function safeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#')
}

const run = (cmd: string, args: string[], cwd: string) => new Promise<void>((resolve, reject) => {
  execFile(cmd, args, { cwd, timeout: 120_000 }, (e) => (e ? reject(e) : resolve()))
})

/** PDF доски: SVG на странице по размеру рисунка (WeasyPrint, как выгрузка БФТ). */
export async function boardPdf(f: PlanFiles, title: string): Promise<boolean> {
  const svg = await readFile(f.svg, 'utf8').catch(() => '')
  if (!svg) return false
  const w = Number(/\bwidth="([\d.]+)/.exec(svg)?.[1]) || 1200
  const h = Number(/\bheight="([\d.]+)/.exec(svg)?.[1]) || 800
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${Math.ceil(w)}px ${Math.ceil(h)}px;margin:0}html,body{margin:0}img{display:block;width:${Math.ceil(w)}px;height:${Math.ceil(h)}px}</style>
</head><body><img src="board.svg" alt=""></body></html>`
  const page = join(f.dir, 'board.html')
  await writeFile(page, html, 'utf8')
  try {
    await run('weasyprint', [page, f.pdf], f.dir)
    return true
  } catch (e) {
    console.error('[customer-form] PDF доски не собран:', (e as Error).message)
    return false
  }
}

/** Сохранить планирование: файлы, PDF доски, архив. Возвращает метаданные. */
export async function savePlan(requestDir: string, input: PlanInput, title: string, now = new Date()): Promise<PlanMeta> {
  const f = planFiles(requestDir)
  await mkdir(f.dir, { recursive: true })
  const prev = await readPlan(requestDir)
  const put = async (path: string, text: string) => { await writeFile(`${path}.tmp`, text, 'utf8'); await rename(`${path}.tmp`, path) }
  await put(f.note, input.note)
  await put(f.scene, input.scene || '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}')
  await put(f.svg, safeSvg(input.svg))
  const pdf = input.svg ? await boardPdf(f, title) : false
  const meta: PlanMeta = { savedAt: now.toISOString(), ...(input.by ? { by: input.by } : {}), rev: (prev?.meta.rev ?? 0) + 1, pdf, elements: elementsOf(input.scene) }
  await put(f.meta, JSON.stringify(meta, undefined, 1))
  const entries: ZipEntry[] = [
    { name: 'zametka.md', data: Buffer.from(noteDocument(input.note, title, meta), 'utf8') },
    { name: 'doska.excalidraw', data: await readFile(f.scene) },
  ]
  if (input.svg) entries.push({ name: 'doska.svg', data: await readFile(f.svg) })
  if (pdf) entries.push({ name: 'doska.pdf', data: await readFile(f.pdf) })
  await writeFile(f.zip, zip(entries, now))
  return meta
}

/** Заметка документом: заголовок, кто и когда, текст как есть. */
export function noteDocument(note: string, title: string, meta: Pick<PlanMeta, 'savedAt' | 'by'>): string {
  return `# Планирование: ${title}\n\n_${moscow(meta.savedAt)}${meta.by ? ` · ${meta.by}` : ''}_\n\n${note.trim()}\n`
}

/** Комментарий к странице Confluence: текст заметки и что приложено. */
export function confluenceComment(plan: SavedPlan, title: string, names: { zip: string; pdf?: string }): string {
  return [
    `**Планирование** по «${title}» — ${moscow(plan.meta.savedAt)}${plan.meta.by ? `, ${plan.meta.by}` : ''}`,
    '',
    plan.note.trim() || '_Заметки нет — только доска._',
    '',
    `Вложения: ${names.zip} (заметка и доска)${names.pdf ? `, ${names.pdf} (доска)` : ''}.`,
  ].join('\n')
}

export function moscow(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export async function planUpdatedAt(requestDir: string): Promise<number> {
  return stat(planFiles(requestDir).meta).then((s) => s.mtimeMs, () => 0)
}

// ── ZIP без зависимостей (deflate, CRC-32) ─────────────────────────────────

export interface ZipEntry { name: string; data: Buffer }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(entries: ZipEntry[], when = new Date()): Buffer {
  const time = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff
  const date = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const packed = deflateRawSync(e.data)
    const crc = crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(e.data.length, 24); central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

// ── Страницы ───────────────────────────────────────────────────────────────

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const jsonInScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export interface PlanLinks { page: string; zip: string; pdf: string; note: string }

/** Блок на странице полного БФТ: кнопка «Планирование» вверху и артефакт внизу. */
export function planButton(links: PlanLinks): string {
  return `<p class="plan-bar"><a class="plan-btn" href="${escHtml(links.page)}" target="_blank" rel="noopener" title="Заметка и доска для декомпозиции с командой">🗂 Планирование</a></p>
<style>.plan-bar{margin:.4rem 0 1.2rem}.plan-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;
border:1px solid rgba(127,127,127,.35);color:inherit;font:600 13px/1.2 system-ui,sans-serif;text-decoration:none}
.plan-btn:hover{border-color:rgba(127,127,127,.7)}@media print{.plan-bar{display:none}}</style>`
}

/** Кнопка — сразу под заголовком документа (в потоке страницы: правый верх занят переключателем панели). */
export function insertPlanButton(page: string, links: PlanLinks): string {
  const main = page.indexOf('<main')
  const h1 = page.indexOf('</h1>', main < 0 ? 0 : main)
  if (h1 < 0) return appendBeforeBody(page, planButton(links))
  return page.slice(0, h1 + 5) + planButton(links) + page.slice(h1 + 5)
}

function appendBeforeBody(page: string, html: string): string {
  const at = page.lastIndexOf('</body>')
  return at < 0 ? page + html : page.slice(0, at) + html + page.slice(at)
}

export function planArtifact(plan: SavedPlan | undefined, links: PlanLinks): string {
  if (!plan) return ''
  const lines = plan.note.split('\n').filter((l) => /^#{1,3} /.test(l)).map((l) => l.replace(/^#+ /, '')).slice(0, 6)
  return `<section class="plan-art" id="planirovanie" data-plan>
<h2>Планирование</h2>
<p class="plan-meta">Сохранено ${escHtml(moscow(plan.meta.savedAt))}${plan.meta.by ? ` · ${escHtml(plan.meta.by)}` : ''} · версия ${plan.meta.rev}${lines.length ? ` · ${escHtml(lines.join(' · '))}` : ''}</p>
<p class="plan-links"><a href="${escHtml(links.page)}" target="_blank" rel="noopener">Открыть</a>
<a href="${escHtml(links.zip)}" download>Скачать .zip</a>${plan.meta.pdf ? `<a href="${escHtml(links.pdf)}" download>Доска .pdf</a>` : ''}<a href="${escHtml(links.note)}" download>Заметка .md</a></p>
<style>.plan-art{margin:2.5rem 0 1rem;padding:1rem 1.2rem;border:1px solid rgba(127,127,127,.3);border-radius:12px}.plan-art h2{margin:0 0 .3rem}
.plan-meta{margin:.2rem 0 .6rem;color:#777;font-size:.9rem}.plan-links{display:flex;flex-wrap:wrap;gap:1rem;margin:0}.plan-links a{font-weight:600}</style>
</section>`
}

export interface PlanPageInput {
  title: string
  slug: string
  saved?: SavedPlan | undefined
  saveUrl: string
  bftUrl: string
  assetUrl: (file: 'board.js' | 'board.css') => string
  links: PlanLinks
}

/** Экран «Планирование»: заметка слева, доска справа, «Сохранить». */
export function planPage(v: PlanPageInput): string {
  let scene: unknown = null
  try { scene = v.saved?.scene ? JSON.parse(v.saved.scene) : null } catch { scene = null }
  const cfg = { scene, note: v.saved?.note ?? PLAN_TEMPLATE, saveUrl: v.saveUrl, savedAt: v.saved?.meta.savedAt ?? null, rev: v.saved?.meta.rev ?? 0, draftKey: `bft-plan:${v.slug}`, links: v.links }
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Планирование · ${escHtml(v.title)}</title>
<link rel="stylesheet" href="${escHtml(v.assetUrl('board.css'))}">
<style>
:root{--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--bg:#fff;--panel:#fafafa;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--fg:#e6e6e6;--muted:#9ca3af;--line:#2d2f34;--bg:#141517;--panel:#1b1c1f;--accent:#60a5fa}}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.top{height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--line)}
.top h1{font-size:15px;margin:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.top a.back{color:var(--muted);text-decoration:none;white-space:nowrap}.top a.back:hover{color:var(--fg)}
.st{color:var(--muted);font-size:12px;white-space:nowrap}
button.save{padding:7px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer}
button.save:disabled{opacity:.6;cursor:default}
.wrap{display:grid;grid-template-columns:minmax(300px,34%) 1fr;height:calc(100% - 52px)}
.note{display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--panel);min-height:0}
textarea{flex:1;width:100%;border:0;outline:0;resize:none;padding:16px 18px 40px;background:transparent;color:inherit;font:15px/1.65 ui-sans-serif,system-ui,sans-serif;tab-size:2}
#board{min-height:0;position:relative}
.zip{display:none;color:var(--muted);font-size:13px;text-decoration:none}.zip.on{display:inline}.zip:hover{color:var(--fg)}
.st.dirty::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-right:6px;vertical-align:1px}
@media (max-width:820px){.wrap{grid-template-columns:1fr;grid-template-rows:40% 60%}.note{border-right:0;border-bottom:1px solid var(--line)}}
</style></head><body>
<header class="top">
  <a class="back" href="${escHtml(v.bftUrl)}">‹ БФТ</a>
  <h1>Планирование · ${escHtml(v.title)}</h1>
  <span class="st" id="st"></span>
  <a class="zip" id="done" href="${escHtml(v.links.zip)}" download title="Скачать .zip">.zip</a>
  <button class="save" id="save" type="button" title="Ctrl/⌘ + S">Сохранить</button>
</header>
<div class="wrap">
  <section class="note"><textarea id="note" spellcheck="true" aria-label="Заметка планирования"></textarea></section>
  <section id="board" aria-label="Доска"></section>
</div>
<script>window.PLAN=${jsonInScript({ scene: cfg.scene })};window.EXCALIDRAW_ASSET_PATH=location.origin+"/";</script>
<script src="${escHtml(v.assetUrl('board.js'))}"></script>
<script>(function(){
var CFG=${jsonInScript(cfg)};
var note=document.getElementById("note"),st=document.getElementById("st"),btn=document.getElementById("save"),done=document.getElementById("done");
var draft=null;try{draft=JSON.parse(localStorage.getItem(CFG.draftKey)||"null")}catch(e){}
note.value=draft&&draft.rev===CFG.rev&&typeof draft.note==="string"?draft.note:CFG.note;
var dirty=false;
function when(iso){return new Date(iso).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}
function mark(t,d){st.textContent=t;st.classList.toggle("dirty",!!d)}
mark(CFG.savedAt?"Сохранено в "+when(CFG.savedAt):"");
if(CFG.savedAt)done.classList.add("on");
function changed(){dirty=true;mark("Не сохранено",true);try{localStorage.setItem(CFG.draftKey,JSON.stringify({rev:CFG.rev,note:note.value}))}catch(e){}}
note.addEventListener("input",changed);
note.addEventListener("keydown",function(e){
  if(e.key==="Tab"){e.preventDefault();var s=note.selectionStart;note.setRangeText("  ",s,note.selectionEnd,"end");changed();return}
  if(e.key==="Enter"&&!e.shiftKey){var s=note.selectionStart,line=note.value.slice(note.value.lastIndexOf("\\n",s-1)+1,s),m=/^(\\s*)([-*] |\\d+\\. )/.exec(line);
    if(m){e.preventDefault();if(line.trim()===m[2].trim()){note.setRangeText("",s-line.length,s,"end")}else{var n=/\\d+/.test(m[2])?(parseInt(m[2],10)+1)+". ":m[2];note.setRangeText("\\n"+m[1]+n,s,note.selectionEnd,"end")}changed()}}
  if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();save()}
});
document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();save()}});
var first=true;window.planBoard=window.planBoard||{};window.planBoard.onChange=function(){if(first){first=false;return}if(!dirty){dirty=true;mark("Не сохранено",true)}};
window.addEventListener("beforeunload",function(e){if(dirty){e.preventDefault();e.returnValue=""}});
async function save(){
  if(btn.disabled)return;btn.disabled=true;mark("Сохраняю…");
  try{
    var b=window.planBoard||{},scene=b.scene?b.scene():"",svg=b.svg&&!(b.empty&&b.empty())?await b.svg():"";
    var r=await fetch(CFG.saveUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({note:note.value,scene:scene,svg:svg})});
    var out=await r.json().catch(function(){return{}});
    if(!r.ok||!out.ok)throw new Error(out.error||("ошибка "+r.status));
    CFG.rev=out.rev;dirty=false;try{localStorage.removeItem(CFG.draftKey)}catch(e){}
    mark("Сохранено в "+when(out.savedAt));done.classList.add("on");
  }catch(e){mark("Не сохранилось: "+e.message,true)}
  finally{btn.disabled=false}
}
btn.addEventListener("click",save);
})();</script>
</body></html>`
}
