import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_POSTITS, useStore } from '../store'
import { addDays, daysBetween, fmtDate, fmtMins, fmtTime12, fromIso, logTime12, today } from '../lib/dates'
import { itemsOf, onDay, type Item, type ItemLine } from '../lib/md'
import { parseBookmarkInput, parseBookmarks, serializeBookmarks, STATUSES, ticketLabel, type ListKind, type Status, type Ticket } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText, promptTime } from '../lib/prompts'
import { timedKey, useReminders } from '../lib/reminders'
import { openUrl } from '../lib/fs'
import { Chip, Empty, NoteMark, NotesField, openFirstUrl, PageHeader, Rich, Row, TypeIcon, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'
import { ScheduleStrip, TimeChip, useTimedToday } from '../components/Reminders'

type Section = 'routine' | 'focus' | 'questions' | 'learn' | 'waiting' | 'done'
type TRow =
    | { kind: 'ticket'; key: string; t: Ticket; date: string }
    | { kind: 'item'; list: 'tasks' | 'routine' | 'questions' | 'learn'; key: string; id: string; item: Item; date: string }

const SECTION_TITLE: Record<Section, string> = {
    routine: 'Daily routine',
    focus: 'Focus',
    questions: 'Questions due',
    learn: 'Learn due',
    waiting: 'Waiting',
    done: 'Completed today',
}
const atOf = (r: TRow) => (r.kind === 'ticket' ? r.t.at : r.item.at) || '99:99'
const WAITING: FocusGroup[] = ['blocked', 'review', 'ready-to-deploy']
const isDoneRow = (r: TRow) => (r.kind === 'ticket' ? r.t.status === 'done' : r.list !== 'routine' && r.item.done)
const sectionOf = (r: TRow): Section =>
    isDoneRow(r) ? 'done' : r.kind === 'ticket' ? (WAITING.includes(r.t.status) ? 'waiting' : 'focus') : r.list === 'tasks' ? 'focus' : r.list

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
    const timed = useTimedToday()
    const timedKeys = useMemo(() => new Set(timed.map((x) => x.key)), [timed])
    const [showDone, setShowDone] = useState(false)
    const ringing = useReminders((r) => r.ringing)
    // Is this row's time live today, and is it ringing right now?
    const timeOf = (r: TRow) => {
        const at = atOf(r)
        if (at === '99:99') return null
        const kind = r.kind === 'ticket' ? 'ticket' : r.list
        const ref = r.kind === 'ticket' ? r.t.file : r.item.text
        const key = timedKey(t, kind, ref, at)
        return timedKeys.has(key) ? { at, kind, ref, key } : null
    }

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
        routine.sort((a, b) => atOf(a).localeCompare(atOf(b)))
        // Once every routine item is ticked off, the section goes away (unless completed are shown).
        const routineShown = showDone || routine.some((r) => r.kind === 'item' && r.item.completed !== t) ? routine : []

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
                FOCUS_ORDER.indexOf(focusGroupOf(a)) - FOCUS_ORDER.indexOf(focusGroupOf(b)) || weight(a) - weight(b) || atOf(a).localeCompare(atOf(b)) || a.date.localeCompare(b.date)
        )

        const dueOf = (list: 'questions' | 'learn'): TRow[] =>
            s.lists[list]
                .filter((l) => l.item && !l.item.done && !l.item.later && (!l.item.due || l.item.due <= t))
                .map((l) => ({ kind: 'item', list, key: l.id, id: l.id, item: l.item!, date: l.item!.due || t }) as TRow)
                .sort((a, b) => a.date.localeCompare(b.date))

        // Completed today, only when the toggle is on.
        const finished: TRow[] = []
        if (showDone) {
            for (const tk of s.tickets) if (tk.status === 'done' && tk.updated === t) finished.push({ kind: 'ticket', key: tk.file, t: tk, date: t })
            for (const list of ['tasks', 'questions', 'learn'] as const)
                for (const l of s.lists[list]) if (l.item && l.item.done && l.item.completed === t) finished.push({ kind: 'item', list, key: l.id, id: l.id, item: l.item, date: t })
        }

        // Column order: everything active first, then the "waiting" tickets that live in the third column.
        const active = focus.filter((r) => sectionOf(r) === 'focus')
        const waiting = focus.filter((r) => sectionOf(r) === 'waiting')
        return [...routineShown, ...active, ...dueOf('questions'), ...dueOf('learn'), ...finished, ...waiting]
    }, [s.tickets, s.lists, t, showDone])

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]

    // The cursor is an index, so when a status change moves a row to another group the
    // highlight would land on a different row. Follow the row by key instead.
    const lastKey = useRef<string | undefined>(undefined)
    const lastRows = useRef(rows)
    useEffect(() => {
        if (rows !== lastRows.current) {
            lastRows.current = rows
            const idx = lastKey.current ? rows.findIndex((r) => r.key === lastKey.current) : -1
            if (idx >= 0 && idx !== cur) return setC(idx)
        }
        lastKey.current = rows[cur]?.key
    })
    const postits = itemsOf(s.lists.reminders).filter((l) => !l.item.done).slice(0, MAX_POSTITS)
    const routineRows = rows.filter((r) => sectionOf(r) === 'routine')
    const colRows = (waiting: boolean) => rows.map((r, i) => ({ r, i })).filter(({ r }) => (sectionOf(r) === 'waiting') === waiting)
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
        H: () => setShowDone((v) => !v),
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
        // w: set a reminder time (today only). Empty clears. z: snooze a ringing / due reminder.
        w: () => {
            if (!row) return
            const cur = row.kind === 'ticket' ? row.t.at : row.item.at
            promptTime('Remind at', cur, (v) => {
                const stay = row.kind === 'item' && row.list === 'routine' // routines recur: keep them undated
                if (row.kind === 'ticket') void s.patchTicket(row.t.file, { at: v, ...(v ? { planned: t } : {}) })
                else void s.patchItem(row.list, row.id, { at: v || undefined, ...(v && !stay ? { due: t } : {}) })
                s.toast(v ? `Reminder set for ${fmtTime12(v)}` : 'Reminder cleared')
            })
        },
        z: () => {
            const tm = row && timeOf(row)
            if (!tm) return s.toast('No reminder on this row (w sets one)')
            useReminders.getState().snooze([tm.key])
            s.toast('Snoozed 10 minutes')
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
        // Bookmarks: b 1-9 opens, b a adds, b e edits the whole list.
        ...Object.fromEntries(
            Array.from({ length: 9 }, (_, i) => [
                `b ${i + 1}`,
                () => {
                    const b = s.bookmarks[i]
                    if (b) void openUrl(b.url)
                },
            ])
        ),
        'b a': () =>
            promptText(
                'Add bookmark',
                '',
                (v) => {
                    const b = parseBookmarkInput(v)
                    if (b) void s.setBookmarks([...s.bookmarks, b]).then(() => s.toast(`Bookmarked ${b.title}`))
                },
                { hint: 'URL and optional title, e.g. github.com/org/repo Repo', validate: (v) => (parseBookmarkInput(v) ? null : 'Needs a URL') }
            ),
        'b e': () =>
            promptText('Edit bookmarks', serializeBookmarks(s.bookmarks).replace(/^# Bookmarks\n\n/, ''), (v) => void s.setBookmarks(parseBookmarks(v)), {
                multiline: true,
                allowEmpty: true,
                hint: 'One per line: - [Title](url). Reorder or delete lines; the first 9 get keys b 1 to b 9',
            }),
    })

    const todayLog = s.dailies[t]?.log ?? []
    const clocked = todayLog.reduce((sum, l) => sum + Number(l.match(/^- \d\d:\d\d–\d\d:\d\d \((\d+)m\)/)?.[1] ?? 0), 0)
    const prevDate = s.dailyDates.find((d) => d < t)
    const prev = prevDate ? s.dailies[prevDate] : undefined

    const stale = s.tickets
        .filter((tk) => tk.status !== 'done' && daysBetween(tk.updated, t) >= 4)
        .sort((a, b) => a.updated.localeCompare(b.updated))
        .slice(0, 4)

    const renderRows = (list: { r: TRow; i: number }[]) =>
        list.map(({ r, i }, n) => {
                        const sec = sectionOf(r)
                        const prevRow = list[n - 1]?.r
                        const head =
                            !prevRow || sectionOf(prevRow) !== sec ? (
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
                        const fg = sec === 'focus' || sec === 'waiting' ? focusGroupOf(r) : null
                        const subHead =
                            fg && (!prevRow || sectionOf(prevRow) !== 'focus' || focusGroupOf(prevRow) !== fg) ? (
                                <h4 className="group sub">{FOCUS_LABEL[fg]}</h4>
                            ) : null
                        const rolled = r.date < t

                        if (r.kind === 'ticket') {
                            const subs = itemsOf(r.t.subtasks)
                            const working = s.active?.kind === 'ticket' && s.active.ref === r.t.file
                            const tm = timeOf(r)
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
                                    <Row selected={i === cur} working={working} ringing={!!tm && ringing.includes(tm.key)} type="ticket" onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(r.t.file)}>
                                        <TypeIcon kind="ticket" />
                                        {r.t.key && <span className="key">{r.t.key}</span>}
                                        <span className="title-block tight">
                                            <span className="title">{r.t.title}</span>
                                            {detail && <span className="note-preview">{detail}</span>}
                                        </span>
                                        {r.t.notes.length > 0 && <NoteMark />}
                                        {working && s.active && <Elapsed start={s.active.start} />}
                                        {tm && <TimeChip kind="ticket" refKey={tm.ref} at={tm.at} />}
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
                        const tm = timeOf(r)
                        const iconKind = r.list === 'tasks' ? 'task' : r.list === 'routine' ? 'routine' : r.list === 'questions' ? 'question' : 'learn'
                        return (
                            <div key={r.key}>
                                {head}
                                {subHead}
                                <Row selected={i === cur} working={working} ringing={!!tm && ringing.includes(tm.key)} type={iconKind} onClick={() => setC(i)} onDoubleClick={() => s.openItemById(r.list, r.id)}>
                                    <TypeIcon kind={iconKind} />
                                    <span className={`check${done ? ' on' : ''}`} onClick={() => void s.toggleItem(r.list, r.id)} />
                                    <span className={`title${done ? ' done' : ''}`}>
                                        {r.item.pri && <span className="pri">!</span>}
                                        <Rich text={r.item.text} />
                                    </span>
                                    {r.item.notes.some((n) => n.trim()) && <NoteMark />}
                                    {working && s.active && <Elapsed start={s.active.start} />}
                                    {tm && <TimeChip kind={tm.kind} refKey={tm.ref} at={tm.at} done={done} />}
                                    {rolled && r.list !== 'routine' && <Chip tone="warn">due {fmtDate(r.date)}</Chip>}
                                </Row>
                            </div>
                        )
                    })

    return (
        <div className="page today">
            <PageHeader title="Today" sub={fmtDate(t) + ' · ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}>
                {clocked > 0 && <Chip tone="accent">⏱ {fmtMins(clocked)} clocked</Chip>}
            </PageHeader>

            <div className="today-cols">
                {/* ---- work ------------------------------------------------ */}
                <div className="col">
                    <h2 className="col-title">
                        Active <span className="muted">(w sets a time)</span>
                        <button className={`toggle-done${showDone ? ' on' : ''}`} onClick={() => setShowDone((v) => !v)} title="Show tasks completed today (H)">
                            {showDone ? 'Hide' : 'Show'} completed today
                        </button>
                    </h2>
                    <ScheduleStrip />
                    {rows.length === 0 && (
                        <Empty>
                            Nothing due today. Press <kbd>a</kbd> to add a task, or plan a ticket with <kbd>t</kbd>.
                        </Empty>
                    )}
                    {renderRows(colRows(false))}
                </div>

                {/* ---- notes ----------------------------------------------- */}
                <div className="col col-notes">
                    <h2 className="col-title">
                        Notes <span className="muted">(i)</span>
                    </h2>
                    <TodayNotes date={t} />
                    <Bookmarks />
                </div>

                {/* ---- log ------------------------------------------------- */}
                <div className="col col-log">
                    {colRows(true).length > 0 && (
                        <>
                            <div className="col-waiting">{renderRows(colRows(true))}</div>
                        </>
                    )}
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
/** Top of the third column: quick links, opened from the keyboard with b 1-9. */
function Bookmarks() {
    const s = useStore()
    return (
        <div className="bookmarks">
            <h3 className="bm-head">
                Bookmarks <span className="muted">b a add · b e edit</span>
            </h3>
            {s.bookmarks.length === 0 && (
                <div className="bm-empty" onClick={() => promptText('Add bookmark', '', (v) => { const b = parseBookmarkInput(v); if (b) void s.setBookmarks([...s.bookmarks, b]) }, { validate: (v) => (parseBookmarkInput(v) ? null : 'Needs a URL') })}>
                    + bookmark <kbd>b a</kbd>
                </div>
            )}
            {s.bookmarks.slice(0, 9).map((b, i) => (
                <div key={i} className="bm" title={b.url} onClick={() => void openUrl(b.url)}>
                    <kbd>b {i + 1}</kbd>
                    <span className="bm-title">{b.title}</span>
                </div>
            ))}
            {s.bookmarks.length > 9 && <div className="muted bm-more">+{s.bookmarks.length - 9} more (b e)</div>}
        </div>
    )
}

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
                    {p.item.at && p.item.due === today() && <TimeChip kind="reminders" refKey={p.item.text} at={p.item.at} />}
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
