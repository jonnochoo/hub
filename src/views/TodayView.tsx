import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { addDays, daysBetween, fmtDate, fmtMins, today } from '../lib/dates'
import { itemsOf, type Item } from '../lib/md'
import { ticketLabel, type ListKind, type Ticket } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate } from '../lib/prompts'
import { Chip, Empty, PageHeader, Rich, Row, TypeIcon, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

type Section = 'routine' | 'focus' | 'questions' | 'learn'
type TRow =
    | { kind: 'ticket'; key: string; t: Ticket; date: string }
    | { kind: 'item'; list: 'tasks' | 'routine' | 'questions' | 'learn'; key: string; id: string; item: Item; date: string }

const SECTION_TITLE: Record<Section, string> = {
    routine: 'Daily routine',
    focus: 'Focus',
    questions: 'Questions due',
    learn: 'Learn due',
}
const sectionOf = (r: TRow): Section => (r.kind === 'ticket' ? 'focus' : r.list === 'tasks' ? 'focus' : r.list)

const daySeed = (d: string) => [...d].reduce((a, c) => a + c.charCodeAt(0), 0)

export function TodayView() {
    const s = useStore()
    const t = today()

    useEffect(() => {
        void s.loadDaily(t)
        const prev = s.dailyDates.find((d) => d < t)
        if (prev) void s.loadDaily(prev)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, s.dailyDates.length])

    // Only what is due today (or overdue / already in progress) belongs on the board.
    const rows = useMemo<TRow[]>(() => {
        const routine: TRow[] = []
        for (const l of s.lists.routine) if (l.item) routine.push({ kind: 'item', list: 'routine', key: l.id, id: l.id, item: l.item, date: t })

        const focus: TRow[] = []
        for (const tk of s.tickets) {
            if (tk.status === 'done') continue
            if (tk.status === 'in-progress' || (tk.planned && tk.planned <= t)) focus.push({ kind: 'ticket', key: tk.file, t: tk, date: tk.planned || t })
        }
        for (const l of s.lists.tasks)
            if (l.item && !l.item.done && l.item.due && l.item.due <= t) focus.push({ kind: 'item', list: 'tasks', key: l.id, id: l.id, item: l.item, date: l.item.due })
        const weight = (r: TRow) => (r.kind === 'ticket' ? (r.t.status === 'in-progress' ? 0 : 1) : r.item.pri ? 0 : 2)
        focus.sort((a, b) => a.date.localeCompare(b.date) || weight(a) - weight(b))

        const dueOf = (list: 'questions' | 'learn'): TRow[] =>
            s.lists[list]
                .filter((l) => l.item && !l.item.done && l.item.due && l.item.due <= t)
                .map((l) => ({ kind: 'item', list, key: l.id, id: l.id, item: l.item!, date: l.item!.due! }) as TRow)
                .sort((a, b) => a.date.localeCompare(b.date))

        return [...routine, ...focus, ...dueOf('questions'), ...dueOf('learn')]
    }, [s.tickets, s.lists, t])

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]
    const firstOf = (sec: Section) => rows.find((r) => sectionOf(r) === sec)
    const routineRows = rows.filter((r) => sectionOf(r) === 'routine')
    const routineDone = routineRows.filter((r) => r.kind === 'item' && r.item.completed === t).length

    const start = (r: TRow) =>
        r.kind === 'ticket'
            ? s.startWork({ kind: 'ticket', ref: r.t.file, label: ticketLabel(r.t) })
            : s.startWork({ kind: r.list as ListKind, ref: r.item.text, label: r.item.text })

    useHotkeys({
        ...nav,
        Enter: () => {
            if (!row) return
            if (row.kind === 'ticket') s.setOpenTicket(row.t.file)
            else s.openItemById(row.list, row.id)
        },
        s: () => row && void start(row),
        c: () => {
            if (!row) return
            if (row.kind === 'ticket') void s.setStatus(row.t.file, 'done')
            else void s.toggleItem(row.list, row.id)
        },
        p: () => {
            if (!row || (row.kind === 'item' && row.list === 'routine')) return
            const next = addDays(row.date > t ? row.date : t, 1)
            if (row.kind === 'ticket') void s.patchTicket(row.t.file, { planned: next })
            else void s.patchItem(row.list, row.id, { due: next })
            s.toast(`Postponed to ${fmtDate(next)}`)
        },
        d: () => {
            if (!row || (row.kind === 'item' && row.list === 'routine')) return
            if (row.kind === 'ticket') promptDate('Plan ticket for', row.t.planned, (v) => s.patchTicket(row.t.file, { planned: v }))
            else promptDate('Due date', row.item.due, (v) => s.patchItem(row.list, row.id, { due: v || undefined }))
        },
        '!': () => row?.kind === 'item' && row.list !== 'routine' && void s.patchItem(row.list, row.id, { pri: !row.item.pri }),
        n: () => document.getElementById('f-today-notes')?.focus(),
        a: () => s.setModal({ type: 'add', kind: 'task', due: t }),
    })

    const todayLog = s.dailies[t]?.log ?? []
    const clocked = todayLog.reduce((sum, l) => sum + Number(l.match(/^- \d\d:\d\d–\d\d:\d\d \((\d+)m\)/)?.[1] ?? 0), 0)
    const prevDate = s.dailyDates.find((d) => d < t)
    const prev = prevDate ? s.dailies[prevDate] : undefined
    const triageCount = (['tasks', 'learn', 'questions'] as const).reduce(
        (n, k) => n + itemsOf(s.lists[k]).filter((l) => !l.item.done && !l.item.due && !l.item.later).length,
        0
    )

    const stale = s.tickets
        .filter((tk) => tk.status !== 'done' && daysBetween(tk.updated, t) >= 4)
        .sort((a, b) => a.updated.localeCompare(b.updated))
        .slice(0, 4)

    const resurface = (['questions', 'learn', 'ideas'] as const)
        .map((k) => {
            const open = itemsOf(s.lists[k]).filter((l) => !l.item.done && !l.item.due)
            return open.length ? { k, item: open[daySeed(t + k) % open.length].item } : null
        })
        .filter((x) => x !== null)

    return (
        <div className="page today">
            <PageHeader title="Today" sub={fmtDate(t) + ' · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}>
                {triageCount > 0 && <Chip tone="warn">{triageCount} to triage</Chip>}
                {clocked > 0 && <Chip tone="accent">⏱ {fmtMins(clocked)} clocked</Chip>}
            </PageHeader>

            <div className="today-cols">
                {/* ---- work ------------------------------------------------ */}
                <div className="col">
                    <h2 className="col-title">Work</h2>
                    {rows.length === 0 && (
                        <Empty>
                            Nothing due today. Press <kbd>a</kbd> to add a task, or plan a ticket with <kbd>t</kbd>.
                        </Empty>
                    )}
                    {rows.map((r, i) => {
                        const sec = sectionOf(r)
                        const head =
                            firstOf(sec) === r ? (
                                <h3 className="group">
                                    {SECTION_TITLE[sec]}
                                    {sec === 'routine' && (
                                        <span className="muted">
                                            {' '}
                                            · {routineDone}/{routineRows.length}
                                        </span>
                                    )}
                                </h3>
                            ) : null
                        const rolled = r.date < t

                        if (r.kind === 'ticket') {
                            const subs = itemsOf(r.t.subtasks)
                            const working = s.active?.kind === 'ticket' && s.active.ref === r.t.file
                            const next = subs.find((x) => !x.item.done)
                            const age = daysBetween(r.t.updated, t)
                            const detail = [
                                next ? `next: ${next.item.text}` : r.t.notes.split(String.fromCharCode(10)).find((l) => l.trim())?.replace(/^[#>*\-\s]+/, ''),
                                hostOf(r.t.url),
                                age > 0 ? `updated ${age}d ago` : 'updated today',
                            ]
                                .filter(Boolean)
                                .join(' · ')
                            return (
                                <div key={r.key}>
                                    {head}
                                    <Row selected={i === cur} working={working} type="ticket" onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(r.t.file)}>
                                        <TypeIcon kind="ticket" />
                                        {r.t.key && <span className="key">{r.t.key}</span>}
                                        <span className="title-block tight">
                                            <span className="title">{r.t.title}</span>
                                            {detail && <span className="note-preview">{detail}</span>}
                                        </span>
                                        <Chip tone={`s-${r.t.status}`}>{r.t.status}</Chip>
                                        {working && s.active && <Elapsed start={s.active.start} />}
                                        {rolled && <Chip tone="warn">from {fmtDate(r.date)}</Chip>}
                                        {subs.length > 0 && (
                                            <Chip>
                                                ☑ {subs.filter((x) => x.item.done).length}/{subs.length}
                                            </Chip>
                                        )}
                                        {r.t.spent > 0 && <Chip>⏱ {fmtMins(r.t.spent)}</Chip>}
                                    </Row>
                                </div>
                            )
                        }

                        const done = r.list === 'routine' ? r.item.completed === t : r.item.done
                        const working = s.active?.kind === r.list && s.active.ref === r.item.text
                        const iconKind = r.list === 'tasks' ? 'task' : r.list === 'routine' ? 'routine' : r.list === 'questions' ? 'question' : 'learn'
                        return (
                            <div key={r.key}>
                                {head}
                                <Row selected={i === cur} working={working} type={iconKind} onClick={() => setC(i)} onDoubleClick={() => s.openItemById(r.list, r.id)}>
                                    <TypeIcon kind={iconKind} />
                                    <span className={`check${done ? ' on' : ''}`} onClick={() => void s.toggleItem(r.list, r.id)} />
                                    <span className={`title${done ? ' done' : ''}`}>
                                        {r.item.pri && <span className="pri">!</span>}
                                        <Rich text={r.item.text} />
                                    </span>
                                    {working && s.active && <Elapsed start={s.active.start} />}
                                    {rolled && r.list !== 'routine' && <Chip tone="warn">due {fmtDate(r.date)}</Chip>}
                                </Row>
                            </div>
                        )
                    })}
                </div>

                {/* ---- notes ----------------------------------------------- */}
                <div className="col col-notes">
                    <h2 className="col-title">
                        Notes <span className="muted">(n)</span>
                    </h2>
                    <TodayNotes date={t} />
                </div>

                {/* ---- log ------------------------------------------------- */}
                <div className="col">
                    <h2 className="col-title">Log</h2>
                    <section>
                        <h3>Today</h3>
                        {todayLog.length === 0 ? <p className="muted">Nothing logged yet.</p> : <LogList lines={todayLog} />}
                    </section>

                    {prev && prev.log.length > 0 && (
                        <section>
                            <h3>Last time · {fmtDate(prev.date)}</h3>
                            <LogList lines={prev.log.slice(-6)} />
                        </section>
                    )}

                    {stale.length > 0 && (
                        <section>
                            <h3>Going stale</h3>
                            {stale.map((tk) => (
                                <div key={tk.file} className="mini" onClick={() => s.setOpenTicket(tk.file)}>
                                    <span className="key">{tk.key}</span> {tk.title}
                                    <span className="muted"> · {daysBetween(tk.updated, t)}d</span>
                                </div>
                            ))}
                        </section>
                    )}

                    {resurface.length > 0 && (
                        <section>
                            <h3>Don't forget</h3>
                            {resurface.map((x) => (
                                <div key={x.k} className="mini">
                                    <Chip>{x.k === 'questions' ? 'question' : x.k === 'learn' ? 'learn' : 'idea'}</Chip> <Rich text={x.item.text} />
                                </div>
                            ))}
                        </section>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Today's daily note, editable in place and autosaved. */
function TodayNotes({ date }: { date: string }) {
    const notes = useStore((s) => s.dailies[date]?.notes ?? '')
    const setDailyNotes = useStore((s) => s.setDailyNotes)
    const [text, setText] = useState(notes)
    const [editing, setEditing] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
        if (!editing) setText(notes)
    }, [notes, editing])

    const flush = (v: string) => {
        clearTimeout(timer.current)
        if (v !== notes) void setDailyNotes(date, v)
    }
    return (
        <textarea
            id="f-today-notes"
            className="daily-area today-notes"
            placeholder="What did I do, decide, or learn today? Markdown; [[ABC-123]] links a ticket. Saved to today's daily note."
            value={text}
            onFocus={() => setEditing(true)}
            onBlur={() => {
                setEditing(false)
                flush(text)
            }}
            onChange={(e) => {
                setText(e.target.value)
                clearTimeout(timer.current)
                const v = e.target.value
                timer.current = setTimeout(() => flush(v), 600)
            }}
            onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur()
            }}
        />
    )
}

export function LogList({ lines }: { lines: string[] }) {
    return (
        <ul className="log">
            {lines.map((l, i) => (
                <li key={i}>
                    <Rich text={l.replace(/^- /, '')} />
                </li>
            ))}
        </ul>
    )
}

function hostOf(url: string): string {
    try {
        return url ? new URL(url).host.replace(/^www\./, '') : ''
    } catch {
        return ''
    }
}
