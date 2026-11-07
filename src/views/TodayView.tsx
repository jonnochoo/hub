import { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { addDays, daysBetween, fmtDate, fmtMins, today } from '../lib/dates'
import { itemsOf, type Item } from '../lib/md'
import { ticketLabel, type Ticket } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate } from '../lib/prompts'
import { Chip, Empty, PageHeader, Rich, Row, TypeIcon, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

type TRow =
    | { kind: 'ticket'; key: string; t: Ticket; date: string; other?: boolean }
    | { kind: 'task'; key: string; id: string; item: Item; date: string }
    | { kind: 'routine'; key: string; id: string; item: Item; date: string }

const daySeed = (d: string) => [...d].reduce((a, c) => a + c.charCodeAt(0), 0)

export function TodayView() {
    const s = useStore()
    const t = today()

    useEffect(() => {
        void s.loadDaily(t)
        if (s.dailyDates.find((d) => d < t)) void s.loadDaily(s.dailyDates.find((d) => d < t)!)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, s.dailyDates.length])

    const rows = useMemo<TRow[]>(() => {
        const out: TRow[] = []
        const others: TRow[] = []
        for (const tk of s.tickets) {
            if (tk.status === 'done') continue
            const focus = tk.status === 'in-progress' || (tk.planned && tk.planned <= t)
            if (focus) out.push({ kind: 'ticket', key: tk.file, t: tk, date: tk.planned || t })
            else others.push({ kind: 'ticket', key: tk.file, t: tk, date: tk.planned || t, other: true })
        }
        for (const l of s.lists.tasks) {
            if (l.item && !l.item.done && l.item.due && l.item.due <= t)
                out.push({ kind: 'task', key: l.id, id: l.id, item: l.item, date: l.item.due })
        }
        const weight = (r: TRow) => (r.kind === 'ticket' ? (r.t.status === 'in-progress' ? 0 : 1) : r.item.pri ? 0 : 2)
        out.sort((a, b) => a.date.localeCompare(b.date) || weight(a) - weight(b))
        // Every other open ticket follows, so nothing falls off the board.
        const rank = (x: TRow) => (x.kind === 'ticket' ? ['blocked', 'review', 'todo'].indexOf(x.t.status) : 0)
        others.sort((a, b) => rank(a) - rank(b) || (a.kind === 'ticket' && b.kind === 'ticket' ? a.t.key.localeCompare(b.t.key, undefined, { numeric: true }) : 0))
        out.push(...others)
        // The daily routine leads the board, in file order.
        const routine: TRow[] = []
        for (const l of s.lists.routine)
            if (l.item) routine.push({ kind: 'routine', key: l.id, id: l.id, item: l.item, date: t })
        return [...routine, ...out]
    }, [s.tickets, s.lists.tasks, s.lists.routine, t])
    const focusCount = rows.filter((r) => r.kind !== 'routine' && !(r.kind === 'ticket' && r.other)).length
    const firstFocus = rows.find((r) => r.kind !== 'routine')
    const firstOther = rows.find((r) => r.kind === 'ticket' && r.other)
    const routineRows = rows.filter((r) => r.kind === 'routine')
    const routineDone = routineRows.filter((r) => r.item.completed === t).length

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]

    const start = (r: TRow) =>
        r.kind === 'ticket'
            ? s.startWork({ kind: 'ticket', ref: r.t.file, label: ticketLabel(r.t) })
            : s.startWork({ kind: r.kind === 'routine' ? 'routine' : 'tasks', ref: r.item.text, label: r.item.text })

    useHotkeys({
        ...nav,
        Enter: () => {
            if (!row) return
            if (row.kind === 'ticket') s.setOpenTicket(row.t.file)
            else s.openItemById(row.kind === 'routine' ? 'routine' : 'tasks', row.id)
        },
        s: () => row && void start(row),
        c: () => {
            if (!row) return
            if (row.kind === 'ticket') void s.setStatus(row.t.file, 'done')
            else void s.toggleItem(row.kind === 'routine' ? 'routine' : 'tasks', row.id)
        },
        p: () => {
            if (!row || row.kind === 'routine') return
            const next = addDays(row.date > t ? row.date : t, 1)
            if (row.kind === 'ticket') void s.patchTicket(row.t.file, { planned: next })
            else void s.patchItem('tasks', row.id, { due: next })
            s.toast(`Postponed to ${fmtDate(next)}`)
        },
        d: () => {
            if (!row || row.kind === 'routine') return
            if (row.kind === 'ticket') promptDate('Plan ticket for', row.t.planned, (v) => s.patchTicket(row.t.file, { planned: v }))
            else promptDate('Due date', row.item.due, (v) => s.patchItem('tasks', row.id, { due: v || undefined }))
        },
        '!': () => row?.kind === 'task' && void s.patchItem('tasks', row.id, { pri: !row.item.pri }),
        a: () => s.setModal({ type: 'add', kind: 'task', due: t }),
    })

    const triageCount = (['tasks', 'learn', 'questions'] as const).reduce(
        (n, k) => n + itemsOf(s.lists[k]).filter((l) => !l.item.done && !l.item.due && !l.item.later).length,
        0
    )
    const todayLog = s.dailies[t]?.log ?? []
    const clocked = todayLog.reduce((sum, l) => sum + Number(l.match(/^- \d\d:\d\d–\d\d:\d\d \((\d+)m\)/)?.[1] ?? 0), 0)
    const prevDate = s.dailyDates.find((d) => d < t)
    const prev = prevDate ? s.dailies[prevDate] : undefined

    const stale = s.tickets
        .filter((tk) => tk.status !== 'done' && daysBetween(tk.updated, t) >= 4)
        .sort((a, b) => a.updated.localeCompare(b.updated))
        .slice(0, 4)

    const resurface = (['questions', 'learn', 'ideas'] as const)
        .map((k) => {
            const open = itemsOf(s.lists[k]).filter((l) => !l.item.done)
            return open.length ? { k, item: open[daySeed(t + k) % open.length].item } : null
        })
        .filter((x) => x !== null)

    return (
        <div className="page">
            <PageHeader title="Today" sub={fmtDate(t) + ' · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}>
                {triageCount > 0 && <Chip tone="warn">{triageCount} to triage</Chip>}
                {clocked > 0 && <Chip tone="accent">⏱ {fmtMins(clocked)} clocked</Chip>}
            </PageHeader>
            <div className="split">
                <div className="main">
                    {focusCount === 0 && (
                        <Empty>
                            Nothing in focus. Press <kbd>a</kbd> to add a task, or plan a ticket with <kbd>t</kbd> in the Tickets view.
                        </Empty>
                    )}
                    {rows.map((r, i) => {
                        const rolled = r.date < t
                        if (r.kind === 'routine') {
                            const done = r.item.completed === t
                            const working = s.active?.kind === 'routine' && s.active.ref === r.item.text
                            return (
                                <div key={r.key}>
                                    {r === routineRows[0] && (
                                        <h3 className="group">
                                            Daily routine{' '}
                                            <span className="muted">
                                                · {routineDone}/{routineRows.length}
                                            </span>
                                        </h3>
                                    )}
                                    <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => void s.toggleItem('routine', r.id)} type="routine">
                                        <TypeIcon kind="routine" />
                                        <span className={`check${done ? ' on' : ''}`} onClick={() => void s.toggleItem('routine', r.id)} />
                                        <span className={`title${done ? ' done' : ''}`}>
                                            <Rich text={r.item.text} />
                                        </span>
                                        {working && s.active && <Elapsed start={s.active.start} />}
                                    </Row>
                                </div>
                            )
                        }
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
                                {r === firstFocus && routineRows.length > 0 && <h3 className="group">Focus</h3>}
                                {r === firstOther && <h3 className="group">Other open tickets</h3>}
                                <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(r.t.file)} type="ticket">
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
                                    {r.t.planned && r.t.planned > t && <Chip tone="accent">plan {fmtDate(r.t.planned)}</Chip>}
                                </Row>
                                </div>
                            )
                        }
                        const working = s.active?.kind === 'tasks' && s.active.ref === r.item.text
                        return (
                            <div key={r.key}>
                            {r === firstFocus && routineRows.length > 0 && <h3 className="group">Focus</h3>}
                            <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => void s.toggleItem('tasks', r.id)} type="task">
                                <TypeIcon kind="task" />
                                <span className="check" onClick={() => void s.toggleItem('tasks', r.id)} />
                                <span className="title">
                                    {r.item.pri && <span className="pri">!</span>}
                                    <Rich text={r.item.text} />
                                </span>
                                {working && s.active && <Elapsed start={s.active.start} />}
                                {rolled && <Chip tone="warn">due {fmtDate(r.date)}</Chip>}
                            </Row>
                            </div>
                        )
                    })}
                </div>

                <aside className="aside">
                    <section>
                        <h3>Today's log</h3>
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
                </aside>
            </div>
        </div>
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
