/**
 * «Управление БФТ» — страница PO (ADR-0009).
 *
 *  - BftMenu — кнопка в левом верхнем углу главной: «Новая заявка» /
 *    «Управление БФТ». Страница адресуема: #bft (запросы), #bft/board (доска).
 *  - Вкладка «Входящие запросы» — беклог корневых задач: название, статус,
 *    сколько висит в статусе (SLA), ответственный, прикреплённые БФТ.
 *  - Вкладка «Доска БФТ» — канбан задач «Проработка БФТ»: дни в статусе,
 *    ответственный, запросы, .html-шаблон. Перенос карточки — смена статуса.
 *  - Клик по задаче — карточка в Vikunja (новая вкладка).
 *
 * Компоненты — примитивы DSH UI; данные — узел bft-manager поверх REST Vikunja.
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactElement } from 'react'
import { Button, Input, Menu, Modal, Pill, SegmentedControl, SegmentedTabs, Tag, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ageLabel, BFT_STATUSES, FINAL_STATUSES, REQUEST_STATUSES, slaTone, STATUS_NEEDS_ASSIGNEE,
  type Board, type BoardKind, type Card, type MoveRequest, type MoveResult, type Overview, type Person,
} from '../model.js'
import { IconBack, IconBoard, IconChat, IconDoc, IconExternal, IconMenu, IconMore, IconRefresh, IconSearch, IconUser } from './icons.js'

export type Call = <T>(endpoint: string, payload?: unknown) => Promise<{ ok: true; value: T } | { ok: false; message: string }>

type Tab = 'requests' | 'board'

/** #bft → запросы, #bft/board → доска; иначе страница закрыта. */
function tabOfHash(hash: string): Tab | null {
  if (hash === '#bft' || hash === '#bft/requests') return 'requests'
  if (hash === '#bft/board') return 'board'
  return null
}

function useRoute(): [Tab | null, (tab: Tab | null) => void] {
  const [tab, setTab] = useState<Tab | null>(() => tabOfHash(location.hash))
  useEffect(() => {
    const onHash = () => setTab(tabOfHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((next: Tab | null) => {
    const hash = next === 'board' ? '#bft/board' : next === 'requests' ? '#bft' : ''
    if (hash) location.hash = hash
    else history.replaceState(null, '', location.pathname + location.search) // без «#» в адресе
    setTab(next)
  }, [])
  return [tab, go]
}

/** Фильтр «Ответственный» помнит браузер: PO открывает страницу сразу со своими задачами. */
const OWNER_KEY = 'bft-manager.owner'
function storedOwner(): string {
  try { return localStorage.getItem(OWNER_KEY) ?? 'all' } catch { return 'all' }
}

export function BftManager({ call }: { call: Call }): ReactElement {
  const [tab, go] = useRoute()
  return (
    <>
      {tab === null ? <BftMenu onOpen={() => go('requests')} /> : null}
      {tab !== null ? <BftPage call={call} tab={tab} onTab={go} onClose={() => go(null)} /> : null}
    </>
  )
}

function BftMenu({ onOpen }: { onOpen(): void }): ReactElement {
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = [
    { id: 'chat', label: 'Новая заявка', icon: <IconChat size={16} /> },
    { id: 'bft', label: 'Управление БФТ', icon: <IconBoard size={16} /> },
  ]
  return (
    <div className="bm-trigger" data-bft-menu>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        align="start"
        items={items}
        onSelect={(id) => { setOpen(false); if (id === 'bft') onOpen() }}
        anchor={<Button variant="toolbar" size="sm" icon={<IconMenu size={16} />} aria-label="Меню" title="Меню" onClick={() => setOpen((v) => !v)} />}
      />
    </div>
  )
}

type Load = { phase: 'loading' } | { phase: 'ready'; data: Overview } | { phase: 'error'; message: string }

interface Pending { card: Card; status: string }

function BftPage({ call, tab, onTab, onClose }: { call: Call; tab: Tab; onTab(tab: Tab): void; onClose(): void }): ReactElement {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [banner, setBanner] = useState('')
  const [query, setQuery] = useState('')
  const [owner, setOwnerState] = useState(storedOwner)
  const [pending, setPending] = useState<Pending | null>(null)

  const setOwner = (value: string) => {
    setOwnerState(value)
    try { localStorage.setItem(OWNER_KEY, value) } catch { /* приватное окно — фильтр просто не запомнится */ }
  }

  const refresh = useCallback(async () => {
    const res = await call<Overview>('bft-manager.overview')
    if (res.ok) { setLoad({ phase: 'ready', data: res.value }); setBanner('') }
    else setLoad((prev) => prev.phase === 'ready' ? (setBanner(res.message), prev) : { phase: 'error', message: res.message })
  }, [call])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60_000) // статусы меняют и в UI Vikunja
    return () => clearInterval(timer)
  }, [refresh])

  const move = useCallback(async (req: MoveRequest): Promise<boolean> => {
    const res = await call<MoveResult>('bft-manager.move', req)
    if (!res.ok) { setBanner(res.message); return false }
    setBanner('')
    await refresh()
    return true
  }, [call, refresh])

  /** «Ожидает PO» — через окно (ответственный + проработка БФТ), остальное — сразу. */
  const requestMove = (kind: BoardKind, card: Card, status: string) => {
    if (card.status === status) return
    if (kind === 'requests' && status === STATUS_NEEDS_ASSIGNEE) setPending({ card, status })
    else void move({ kind, taskId: card.id, status })
  }

  const data = load.phase === 'ready' ? load.data : undefined
  const match = useMemo(() => cardFilter(query, owner), [query, owner])
  const ownerLabel = owner === 'all' ? 'Все' : owner === 'none' ? 'Без ответственного' : data?.people.find((p) => String(p.id) === owner)?.name ?? '…'

  const tabs = [
    { value: 'requests' as const, label: `Входящие запросы${data ? ` · ${countOf(data.requests)}` : ''}`, id: 'bm-tab-requests', panelId: 'bm-panel-requests' },
    { value: 'board' as const, label: `Доска БФТ${data ? ` · ${countOf(data.bft)}` : ''}`, id: 'bm-tab-board', panelId: 'bm-panel-board' },
  ] as const

  return (
    <div className="bm-page" data-bft-page={tab}>
      <header className="bm-header">
        <Button variant="ghost" size="sm" icon={<IconBack size={14} />} onClick={onClose}>Новая заявка</Button>
        <h1 className="bm-title">Управление БФТ</h1>
        <SegmentedTabs items={tabs} value={tab} onChange={onTab} label="Раздел" />
        <span className="bm-spacer" />
        <div className="bm-tools">
          <Input className="bm-search" icon={<IconSearch size={14} />} placeholder="Название или #номер" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск" />
          <OwnerFilter people={data?.people ?? []} value={owner} label={ownerLabel} onChange={setOwner} />
          <Button variant="outline" size="sm" icon={<IconRefresh size={14} />} onClick={() => { void refresh() }} title="Обновить из Vikunja">Обновить</Button>
          {data ? (
            <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => window.open(tab === 'board' ? data.bft.viewUrl : data.requests.viewUrl, '_blank', 'noopener')}>
              Vikunja
            </Button>
          ) : null}
        </div>
      </header>
      {banner ? <div className="bm-banner" role="alert">{banner}</div> : null}
      <div className="bm-body" id={tab === 'board' ? 'bm-panel-board' : 'bm-panel-requests'} role="tabpanel">
        {load.phase === 'loading' ? <div className="bm-empty">Загружаю беклог из Vikunja…</div> : null}
        {load.phase === 'error' ? <div className="bm-empty">Не удалось загрузить доски: {load.message}</div> : null}
        {data && tab === 'requests' ? <RequestsList board={data.requests} match={match} onMove={(card, status) => requestMove('requests', card, status)} /> : null}
        {data && tab === 'board' ? <BftBoard board={data.bft} match={match} onMove={(card, status) => requestMove('bft', card, status)} /> : null}
      </div>
      {pending && data ? (
        <AwaitPoDialog
          card={pending.card}
          people={data.people}
          bft={data.bft}
          onClose={() => setPending(null)}
          onConfirm={async (assigneeId, attachTo) => {
            const ok = await move({ kind: 'requests', taskId: pending.card.id, status: pending.status, assigneeId, attachTo })
            if (ok) setPending(null)
            return ok
          }}
        />
      ) : null}
    </div>
  )
}

function countOf(board: Board): number {
  return board.columns.reduce((sum, column) => sum + column.count, 0)
}

function cardFilter(query: string, owner: string): (card: Card) => boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '')
  return (card) => {
    if (owner === 'none' && card.assignee) return false
    if (owner !== 'all' && owner !== 'none' && String(card.assignee?.id) !== owner) return false
    return !q || card.title.toLowerCase().includes(q) || String(card.id) === q
  }
}

function OwnerFilter({ people, value, label, onChange }: { people: Person[]; value: string; label: string; onChange(value: string): void }): ReactElement {
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = [
    { id: 'all', label: 'Все' },
    { id: 'none', label: 'Без ответственного' },
    { type: 'separator', id: 'sep' },
    ...people.map((p) => ({ id: String(p.id), label: p.name, icon: <Avatar person={p} /> })),
  ]
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      items={items}
      selectedId={value}
      selection="check"
      onSelect={(id) => { setOpen(false); onChange(id) }}
      anchor={<Button variant="outline" size="sm" icon={<IconUser size={14} />} onClick={() => setOpen((v) => !v)}>Ответственный: {label}</Button>}
    />
  )
}

function initials(name: string): string {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
}

function Avatar({ person }: { person: Person }): ReactElement {
  return <span className="bm-avatar" aria-hidden>{initials(person.name)}</span>
}

function PersonLabel({ person }: { person: Person | null }): ReactElement {
  return person
    ? <span className="bm-person" title={person.name}><Avatar person={person} /><span>{person.name}</span></span>
    : <span className="bm-person bm-none"><span>Без ответственного</span></span>
}

/** Сколько висит в статусе: тон по SLA, «≥» — если точного момента нет. */
function SlaTag({ card }: { card: Card }): ReactElement {
  const tone = slaTone(card.status, card.since)
  const age = `${card.sinceExact ? '' : '≥ '}${ageLabel(card.since)}`
  return (
    <span title={`В статусе «${card.status}» с ${new Date(card.since).toLocaleString('ru-RU')}${card.sinceExact ? '' : ' (не позже)'}`}>
      <Tag tone={tone === 'neutral' ? 'quiet' : tone}>{age}</Tag>
    </span>
  )
}

function statusTone(status: string): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
  if (status.startsWith('Отмен')) return 'danger'
  if (status.startsWith('В работу') || status === 'Утвержден заказчиком') return 'success'
  if (status === 'Создан' || status === 'Backlog') return 'neutral'
  if (status === STATUS_NEEDS_ASSIGNEE || status === 'Ожидает согласования') return 'warning'
  return 'info'
}

function StatusMenu({ statuses, current, onSelect }: { statuses: readonly string[]; current: string; onSelect(status: string): void }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <span onClick={(e: MouseEvent) => e.stopPropagation()}>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        items={[{ type: 'label', id: 'h', text: 'Перевести в статус' }, ...statuses.map((s) => ({ id: s, label: s, disabled: s === current }))]}
        selectedId={current}
        selection="check"
        onSelect={(status) => { setOpen(false); onSelect(status) }}
        anchor={<Button variant="ghost" size="sm" icon={<IconMore size={16} />} aria-label="Сменить статус" title="Сменить статус" onClick={() => setOpen((v) => !v)} />}
      />
    </span>
  )
}

const openTask = (card: { url: string }) => window.open(card.url, '_blank', 'noopener')

function RequestsList({ board, match, onMove }: { board: Board; match(card: Card): boolean; onMove(card: Card, status: string): void }): ReactElement {
  const [status, setStatus] = useState<string>('active')
  const all = board.columns.flatMap((c) => c.cards)
  const active = all.filter((c) => !FINAL_STATUSES.includes(c.status))
  const shown = (status === 'active' ? active : status === 'all' ? all : all.filter((c) => c.status === status))
    .filter(match)
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since))
  const statuses = board.columns.map((c) => c.title)
  return (
    <>
      <div className="bm-pills" role="toolbar" aria-label="Статус запроса">
        <Pill active={status === 'active'} onClick={() => setStatus('active')}>В работе у PO · {active.length}</Pill>
        {board.columns.map((column) => (
          <Pill key={column.bucketId} active={status === column.title} onClick={() => setStatus(column.title)}>{column.title} · {column.count}</Pill>
        ))}
        <Pill active={status === 'all'} onClick={() => setStatus('all')}>Все · {all.length}</Pill>
      </div>
      <div className="bm-list" data-bft-requests>
        <div className="bm-row bm-row-head">
          <span>Запрос</span><span>Статус</span><span>В статусе</span><span>Ответственный</span><span>БФТ</span><span />
        </div>
        {shown.length === 0 ? <div className="bm-empty">Запросов с такими условиями нет.</div> : null}
        {shown.map((card) => (
          <div key={card.id} className="bm-row" data-request={card.id} onClick={() => openTask(card)} title="Открыть в Vikunja">
            <div className="bm-name"><b>{card.title}</b><span className="bm-muted">#{card.id} · создан {new Date(card.created).toLocaleDateString('ru-RU')}</span></div>
            <div className="bm-cell-wide"><Tag tone={statusTone(card.status)}>{card.status}</Tag></div>
            <div className="bm-cell-wide"><SlaTag card={card} /></div>
            <div className="bm-cell-wide"><PersonLabel person={card.assignee} /></div>
            <div className="bm-links bm-cell-wide">
              {card.links.length ? card.links.map((l) => (
                <span key={l.id} title={`${l.title}${l.status ? ` — ${l.status}` : ''}`} onClick={(e) => { e.stopPropagation(); openTask({ url: card.url.replace(/\/tasks\/\d+$/, `/tasks/${l.id}`) }) }}>
                  <Tag tone="outline">#{l.id}{l.status ? ` · ${l.status}` : ''}</Tag>
                </span>
              )) : <span className="bm-muted">—</span>}
            </div>
            <StatusMenu statuses={statuses.length ? statuses : REQUEST_STATUSES} current={card.status} onSelect={(s) => onMove(card, s)} />
          </div>
        ))}
      </div>
    </>
  )
}

function BftBoard({ board, match, onMove }: { board: Board; match(card: Card): boolean; onMove(card: Card, status: string): void }): ReactElement {
  const [over, setOver] = useState<number | null>(null)
  const cards = new Map(board.columns.flatMap((c) => c.cards.map((card) => [card.id, card] as const)))
  const statuses = board.columns.map((c) => c.title)
  const drop = (column: string) => (e: DragEvent) => {
    e.preventDefault()
    setOver(null)
    const card = cards.get(Number(e.dataTransfer.getData('text/bft-card')))
    if (card) onMove(card, column)
  }
  return (
    <div className="bm-board" data-bft-board>
      {board.columns.map((column) => {
        const shown = column.cards.filter(match)
        return (
          <section
            key={column.bucketId}
            className={`bm-col${over === column.bucketId ? ' bm-drop' : ''}`}
            data-column={column.title}
            onDragOver={(e) => { e.preventDefault(); setOver(column.bucketId) }}
            onDragLeave={() => setOver((v) => (v === column.bucketId ? null : v))}
            onDrop={drop(column.title)}
          >
            <header className="bm-col-head">
              <Tag tone={statusTone(column.title)}>{column.title}</Tag>
              <span className="bm-muted">{shown.length === column.count ? column.count : `${shown.length} из ${column.count}`}</span>
            </header>
            <div className="bm-col-body">
              {shown.map((card) => (
                <article
                  key={card.id}
                  className="bm-card"
                  data-card={card.id}
                  data-tone={slaTone(card.status, card.since)}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/bft-card', String(card.id)); e.dataTransfer.effectAllowed = 'move' }}
                  onClick={() => openTask(card)}
                  title="Открыть в Vikunja"
                >
                  <div className="bm-card-title">{card.title.replace(/^Проработка БФТ:\s*/, '')}</div>
                  <div className="bm-card-meta">
                    <span className="bm-muted">#{card.id}</span>
                    <SlaTag card={card} />
                    {card.links.length ? <span title={card.links.map((l) => `#${l.id} ${l.title}`).join('\n')}><Tag tone="outline">Запросов: {card.links.length}</Tag></span> : null}
                    {card.hasHtml ? <span title="Приложен .html-шаблон БФТ"><Tag tone="success"><IconDoc size={12} /> .html</Tag></span> : null}
                  </div>
                  <div className="bm-card-foot">
                    <PersonLabel person={card.assignee} />
                    <StatusMenu statuses={statuses.length ? statuses : BFT_STATUSES} current={card.status} onSelect={(s) => onMove(card, s)} />
                  </div>
                </article>
              ))}
              {shown.length === 0 ? <div className="bm-muted" style={{ padding: '6px 4px' }}>Пусто</div> : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/**
 * Переход запроса в «Ожидает PO»: ответственный обязателен; к запросу
 * прикрепляется проработка БФТ — новая или уже существующая (несколько
 * запросов → одно БФТ).
 */
function AwaitPoDialog({ card, people, bft, onClose, onConfirm }: {
  card: Card
  people: Person[]
  bft: Board
  onClose(): void
  onConfirm(assigneeId: number | undefined, attachTo: number | 'new' | undefined): Promise<boolean>
}): ReactElement {
  const linked = card.links[0]
  const [assignee, setAssignee] = useState<number | undefined>(card.assignee?.id)
  const [mode, setMode] = useState<'new' | 'existing'>(linked ? 'existing' : 'new')
  const candidates = bft.columns.filter((c) => !c.title.startsWith('Отмен')).flatMap((c) => c.cards)
  const [target, setTarget] = useState<number | undefined>(linked?.id)
  const [busy, setBusy] = useState(false)
  const [openPeople, setOpenPeople] = useState(false)
  const [openBft, setOpenBft] = useState(false)
  const person = people.find((p) => p.id === assignee)
  const chosen = candidates.find((c) => c.id === target)
  const ready = !!assignee && (mode === 'new' || !!target) && !busy

  return (
    <Modal
      open
      onClose={onClose}
      title="Передать запрос PO"
      description={`#${card.id} «${card.title}» → «${STATUS_NEEDS_ASSIGNEE}». Ответственный обязателен; к запросу прикрепится задача «Проработка БФТ».`}
      closeLabel="Закрыть"
      className="bm-modal"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={async () => {
              setBusy(true)
              const ok = await onConfirm(assignee === card.assignee?.id ? undefined : assignee, mode === 'new' ? (linked ? 'new' : undefined) : target)
              if (!ok) setBusy(false)
            }}
          >
            {busy ? 'Передаю…' : 'Передать PO'}
          </Button>
        </>
      )}
    >
      <label className="bm-field">
        <span>Ответственный исполнитель *</span>
        <Menu
          open={openPeople}
          onClose={() => setOpenPeople(false)}
          align="start"
          items={people.map((p) => ({ id: String(p.id), label: p.name, icon: <Avatar person={p} /> }))}
          selectedId={assignee ? String(assignee) : undefined}
          selection="check"
          onSelect={(id) => { setOpenPeople(false); setAssignee(Number(id)) }}
          anchor={<Button variant="outline" className="bm-select" icon={<IconUser size={14} />} onClick={() => setOpenPeople((v) => !v)}>{person?.name ?? 'Выберите ответственного'}</Button>}
        />
      </label>
      <div className="bm-field">
        <span>Проработка БФТ</span>
        <SegmentedControl
          id="bm-attach-mode"
          label="Проработка БФТ"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: linked ? 'Ещё одна проработка' : 'Новая проработка' },
            { value: 'existing', label: 'Прикрепить к существующему БФТ', disabled: candidates.length === 0 },
          ]}
        />
      </div>
      {mode === 'existing' ? (
        <label className="bm-field">
          <span>БФТ-требование</span>
          <Menu
            open={openBft}
            onClose={() => setOpenBft(false)}
            align="start"
            items={candidates.map((c) => ({ id: String(c.id), label: `#${c.id} ${c.title.replace(/^Проработка БФТ:\s*/, '')} · ${c.status}` }))}
            selectedId={target ? String(target) : undefined}
            selection="check"
            onSelect={(id) => { setOpenBft(false); setTarget(Number(id)) }}
            anchor={<Button variant="outline" className="bm-select" onClick={() => setOpenBft((v) => !v)}>{chosen ? `#${chosen.id} ${chosen.title.replace(/^Проработка БФТ:\s*/, '')}` : 'Выберите БФТ'}</Button>}
          />
        </label>
      ) : (
        <p className="bm-muted" style={{ margin: 0 }}>Будет заведена задача «Проработка БФТ: {card.title}» в колонке Backlog доски БФТ с тем же ответственным.</p>
      )}
    </Modal>
  )
}
