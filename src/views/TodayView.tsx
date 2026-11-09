import { useEffect, useMemo } from 'react'
import { MAX_POSTITS, useStore } from '../store'
import { addDays, daysBetween, fmtDate, fmtMins, fromIso, logTime12, today } from '../lib/dates'
import { itemsOf, onDay, type Item, type ItemLine } from '../lib/md'
import { STATUSES, ticketLabel, type ListKind, type Status, type Ticket } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText } from '../lib/prompts'
import { openUrl } from '../lib/fs'
import { Chip, Empty, NotesField, openFirstUrl, PageHeader, Rich, Row, TypeIcon, useCursor } from '../components/ui'
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

// Focus is grouped by ticket status, with due tasks last.
type FocusGroup = Status | 'tasks'
const FOCUS_ORDER: FocusGroup[] = ['in-progress', 'blocked', 'review', 'ready-to-deploy', 'todo', 'tasks']
const FOCUS_LABEL: Record<FocusGroup, string> = {
    'in-progress': 'In progress',
    blocked: 'Blocked',
    review: 'Review',
    'ready-to-deploy': 'Ready to deploy',
    todo: 'Todo',
    done: 'Done',
    tasks: 'Tasks due',
}
const focusGroupOf = (r: TRow): FocusGroup => (r.kind === 'ticket' ? r.t.status : 'tasks')

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
        for (const l of s.lists.routine) if (l.item && onDay(l.item, fromIso(t).getDay())) routine.push({ kind: 'item', list: 'routine', key: l.id, id: l.id, item: l.item, date: t })

        const focus: TRow[] = []
        for (const tk of s.tickets) {
            if (tk.status === 'done') continue
            if (!tk.later && (!tk.planned || tk.planned <= t)) focus.push({ kind: 'ticket', key: tk.file, t: tk, date: tk.planned || t })
        }
        for (const l of s.lists.tasks)
            if (l.item && !l.item.done && !l.item.later && (!l.item.due || l.item.due <= t)) focus.push({ kind: 'item', list: 'tasks', key: l.id, id: l.id, item: l.item, date: l.item.due || t })
        const weight = (r: TRow) => (r.kind === 'item' && r.item.pri ? 0 : 1)
        focus.sort(
            (a, b) =>
                FOCUS_ORDER.indexOf(focusGroupOf(a)) - FOCUS_ORDER.indexOf(focusGroupOf(b)) || weight(a) - weight(b) || a.date.localeCompare(b.date)
        )

        const dueOf = (list: 'questions' | 'learn'): TRow[] =>
            s.lists[list]
                .filter((l) => l.item && !l.item.done && !l.item.later && (!l.item.due || l.item.due <= t))
                .map((l) => ({ kind: 'item', list, key: l.id, id: l.id, item: l.item!, date: l.item!.due || t }) as TRow)
                .sort((a, b) => a.date.localeCompare(b.date))

        return [...routine, ...focus, ...dueOf('questions'), ...dueOf('learn')]
    }, [s.tickets, s.lists, t])

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]
    const postits = itemsOf(s.lists.reminders).filter((l) => !l.item.done).slice(0, MAX_POSTITS)
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
        e: () => {
            if (!row) return
            // Open the main detail page with the name field focused.
            if (row.kind === 'ticket') s.setOpenTicket(row.t.file)
            else s.openItemById(row.list, row.id)
            setTimeout(() => document.getElementById(row.kind === 'ticket' ? 'f-title' : 'f-text')?.focus(), 50)
        },
        x: () => (row?.kind === 'ticket' ? void s.setStatus(row.t.file, 'done') : row && void s.toggleItem(row.list, row.id)),
        // Same keys as the detail views, applied to the highlighted row.
        l: () => {
            if (!row || (row.kind === 'item' && row.list === 'routine')) return
            if (row.kind === 'ticket') {
                void s.patchTicket(row.t.file, { later: true })
            } else void s.patchItem(row.list, row.id, { later: true })
            s.toast('Moved to Later')
        },
        f: () => {
            if (!row || (row.kind === 'item' && row.list === 'routine')) return
            if (row.kind === 'ticket') void s.patchTicket(row.t.file, { later: false, planned: '' })
            else void s.patchItem(row.list, row.id, { later: undefined, due: undefined })
            s.toast('Active: always on Today')
        },
        t: () => {
            if (!row || (row.kind === 'item' && row.list === 'routine')) return
            if (row.kind === 'ticket') {
                void s.patchTicket(row.t.file, { planned: t })
            } else void s.patchItem(row.list, row.id, { due: t })
            s.toast('Set for today')
        },
        o: () => {
            if (!row) return
            if (row.kind === 'ticket') return row.t.url ? void openUrl(row.t.url) : s.toast('No link on this ticket')
            if (!openFirstUrl(row.item.text, ...row.item.notes)) s.toast('No link in this item')
        },
        '#': () => {
            if (!row) return
            if (row.kind === 'ticket') {
                if (confirm(`Delete ${ticketLabel(row.t)}?`)) void s.removeTicket(row.t.file)
            } else if (confirm(`Delete "${row.item.text}"?`)) void s.removeItem(row.list, row.id)
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
        // n: notes of the highlighted row (opens its page, editing notes). i: Today's daily notes.
        n: () => {
            if (!row) return document.getElementById('notes-today-view')?.click()
            if (row.kind === 'ticket') s.setOpenTicket(row.t.file)
            else s.openItemById(row.list, row.id)
            setTimeout(() => document.getElementById(row.kind === 'ticket' ? 'notes-new-view' : 'notes-detail-view')?.click(), 50)
        },
        i: () => document.getElementById('notes-today-view')?.click(),
        m: () => s.setModal({ type: 'add', kind: 'reminder' }),
        // On a highlighted ticket, 1-6 set its status (same keys as the Tickets view).
        // Otherwise 1 and 2 clear the first two post-its.
        ...Object.fromEntries(
            STATUSES.map((st, i) => [
                String(i + 1),
                () => {
                    if (row?.kind === 'ticket') return void s.setStatus(row.t.file, st).then(() => s.toast(`${row.t.key || row.t.title} → ${st}`))
                    if (i < 2 && postits[i]) void s.toggleItem('reminders', postits[i].id)
                },
            ])
        ),
        a: () => s.setModal({ type: 'add', kind: 'task', due: t }),
    })

    const todayLog = s.dailies[t]?.log ?? []
    const clocked = todayLog.reduce((sum, l) => sum + Number(l.match(/^- \d\d:\d\d–\d\d:\d\d \((\d+)m\)/)?.[1] ?? 0), 0)
    const prevDate = s.dailyDates.find((d) => d < t)
    const prev = prevDate ? s.dailies[prevDate] : undefined

    const stale = s.tickets
        .filter((tk) => tk.status !== 'done' && daysBetween(tk.updated, t) >= 4)
        .sort((a, b) => a.updated.localeCompare(b.updated))
        .slice(0, 4)

    return (
        <div className="page today">
            <PageHeader title="Today" sub={fmtDate(t) + ' · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}>
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
                        const fg = sec === 'focus' ? focusGroupOf(r) : null
                        const subHead =
                            fg && (i === 0 || sectionOf(rows[i - 1]) !== 'focus' || focusGroupOf(rows[i - 1]) !== fg) ? (
                                <h4 className="group sub">{FOCUS_LABEL[fg]}</h4>
                            ) : null
                        const rolled = r.date < t

                        if (r.kind === 'ticket') {
                            const subs = itemsOf(r.t.subtasks)
                            const working = s.active?.kind === 'ticket' && s.active.ref === r.t.file
                            const age = daysBetween(r.t.updated, t)
                            const latestNote = r.t.notes[r.t.notes.length - 1]?.text ?? ''
                            const detail = [
                                r.t.next ? `next: ${r.t.next}` : latestNote.split(String.fromCharCode(10)).find((l) => l.trim())?.replace(/^[#>*\-\s]+/, ''),
                                hostOf(r.t.url),
                                age > 0 ? `updated ${age}d ago` : 'updated today',
                            ]
                                .filter(Boolean)
                                .join(' · ')
                            return (
                                <div key={r.key}>
                                    {head}
                                    {subHead}
                                    <Row selected={i === cur} working={working} type="ticket" onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(r.t.file)}>
                                        <TypeIcon kind="ticket" />
                                        {r.t.key && <span className="key">{r.t.key}</span>}
                                        <span className="title-block tight">
                                            <span className="title">{r.t.title}</span>
                                            {detail && <span className="note-preview">{detail}</span>}
                                        </span>
                                        {working && s.active && <Elapsed start={s.active.start} />}
                                        {rolled && <Chip tone="warn">from {fmtDate(r.date)}</Chip>}
                                        {subs.length > 0 && (
                                            <Chip>
                                                ☑ {subs.filter((x) => x.item.done).length}/{subs.length}
                                            </Chip>
                                        )}
                                        {r.t.spent > 0 && <Chip>⏱ {fmtMins(r.t.spent)}</Chip>}
                                        <Chip tone={`s-${r.t.status}`}>{r.t.status}</Chip>
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
                                {subHead}
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
                        Notes <span className="muted">(i)</span>
                    </h2>
                    <TodayNotes date={t} />
                </div>

                {/* ---- log ------------------------------------------------- */}
                <div className="col col-log">
                    <PostIts postits={postits} />
                    <div className="log-scroll">
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

                    </div>
                </div>
            </div>
        </div>
    )
}

/** Up to two sticky notes. Tick (or press 1 / 2) to clear; double-click to edit. */
function PostIts({ postits }: { postits: ItemLine[] }) {
    const s = useStore()
    if (postits.length === 0)
        return (
            <div className="postit-empty" onClick={() => s.setModal({ type: 'add', kind: 'reminder' })}>
                + post-it <kbd>m</kbd>
            </div>
        )
    return (
        <div className="postits">
            {postits.map((p, i) => (
                <div
                    key={p.id}
                    className={`postit n${i}`}
                    onDoubleClick={() => promptText('Edit post-it', p.item.text, (v) => s.patchItem('reminders', p.id, { text: v.trim() }))}
                >
                    <button className="postit-x" title="Clear" onClick={() => void s.toggleItem('reminders', p.id)}>
                        <kbd>{i + 1}</kbd> ✓
                    </button>
                    <div className="postit-text">
                        <Rich text={p.item.text} />
                    </div>
                </div>
            ))}
            {postits.length < MAX_POSTITS && (
                <div className="postit-empty" onClick={() => s.setModal({ type: 'add', kind: 'reminder' })}>
                    + post-it <kbd>m</kbd>
                </div>
            )}
        </div>
    )
}

/** Today's daily note: markdown when idle, click (or n) to edit. */
function TodayNotes({ date }: { date: string }) {
    const notes = useStore((s) => s.dailies[date]?.notes ?? '')
    const setDailyNotes = useStore((s) => s.setDailyNotes)
    return (
        <NotesField
            id="notes-today"
            fill
            value={notes}
            placeholder="What did I do, decide, or learn today? Click or press n to write. Markdown; [[ABC-123]] links a ticket. Saved to today's daily note."
            onCommit={(v) => void setDailyNotes(date, v)}
        />
    )
}

export function LogList({ lines }: { lines: string[] }) {
    return (
        <ul className="log">
            {/* Stored oldest-first (appended); shown newest-first. */}
            {[...lines].reverse().map((l, i) => (
                <li key={i}>
                    <Rich text={logTime12(l.replace(/^- /, ''))} />
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
