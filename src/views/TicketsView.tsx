import { useMemo } from 'react'
import { useStore } from '../store'
import { addDays, fmtDate, fmtMins, parseDate, today } from '../lib/dates'
import { itemsOf, mapItem, newItem } from '../lib/md'
import { STATUSES, ticketLabel, ticketWhen, type Status, type Ticket, type When } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText } from '../lib/prompts'
import { openUrl } from '../lib/fs'
import { AddInput, Chip, Empty, InlineField, NotesField, PageHeader, Row, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

const ORDER: Status[] = ['in-progress', 'blocked', 'review', 'ready-to-deploy', 'todo', 'done']
type Group = When | 'active' | 'done'
const GROUPS: { id: Group; label: string; hint?: string }[] = [
    { id: 'later', label: 'Later' },
    { id: 'active', label: 'Active', hint: 'in progress, blocked, in review or ready to deploy: always on Today' },
    { id: 'date', label: 'Due Date', hint: 'todo with a date (no date = today)' },
    { id: 'done', label: 'Done' },
]
const groupOf = (t: Ticket): Group => (t.status === 'done' ? 'done' : t.status !== 'todo' ? 'active' : ticketWhen(t))

export const TicketsView = () => <TicketList />

function TicketList() {
    const s = useStore()
    const t = today()
    const q = s.search.trim().toLowerCase()

    const list = useMemo(() => {
        return s.tickets
            .filter((x) => (s.showDone || x.status !== 'done') && (!q || `${x.key} ${x.title} ${x.notes}`.toLowerCase().includes(q)))
            .sort(
                (a, b) =>
                    GROUPS.findIndex((g) => g.id === groupOf(a)) - GROUPS.findIndex((g) => g.id === groupOf(b)) ||
                    (a.planned || '9').localeCompare(b.planned || '9') ||
                    ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
                    a.key.localeCompare(b.key, undefined, { numeric: true })
            )
    }, [s.tickets, s.showDone, q])

    const { cur, setC, nav } = useCursor(list.length)
    const tk = list[cur]
    const setStatus = (st: Status) => tk && void s.setStatus(tk.file, st)
    const canPlan = (x: Ticket) => x.status === 'todo' || (s.toast('Only todo tickets are planned; others are always on Today'), false)

    useHotkeys({
        ...nav,
        Enter: () => tk && s.setOpenTicket(tk.file),
        l: () => tk && canPlan(tk) && void s.patchTicket(tk.file, { later: true }),
        o: () => tk?.url && void openUrl(tk.url),
        s: () => tk && void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) }),
        t: () => tk && canPlan(tk) && void s.patchTicket(tk.file, { planned: t }).then(() => s.toast('Planned for today')),
        p: () => tk && canPlan(tk) && void s.patchTicket(tk.file, { planned: addDays(tk.planned > t ? tk.planned : t, 1) }),
        d: () => tk && canPlan(tk) && promptDate('Plan ticket for', tk.planned, (v) => s.patchTicket(tk.file, { planned: v })),
        c: () => setStatus('done'),
        H: s.toggleShowDone,
        '#': () => {
            if (tk && confirm(`Delete ${ticketLabel(tk)}?`)) void s.removeTicket(tk.file)
        },
        ...Object.fromEntries(STATUSES.map((st, i) => [String(i + 1), () => setStatus(st)])),
        a: () => s.setModal({ type: 'add', kind: 'ticket' }),
    })

    let lastGroup: Group | null = null
    return (
        <div className="page">
            <PageHeader title="Tickets" sub={`${list.length} shown`} search={{ value: s.search, onChange: s.setSearch }}>
                <Chip>{s.showDone ? 'showing done' : 'H: show done'}</Chip>
            </PageHeader>
            {list.length === 0 && (
                <Empty>
                    No tickets. Press <kbd>a</kbd> and type e.g. <code>ABC-123 Fix login https://jira.example/browse/ABC-123</code>
                </Empty>
            )}
            {list.map((x, i) => {
                const g = groupOf(x)
                const head = g !== lastGroup ? GROUPS.find((y) => y.id === g)! : null
                lastGroup = g
                const subs = itemsOf(x.subtasks)
                const working = s.active?.kind === 'ticket' && s.active.ref === x.file
                return (
                    <div key={x.file}>
                        {head && (
                            <h3 className="group">
                                {head.label} {head.hint && <span className="muted"> · {head.hint}</span>}
                            </h3>
                        )}
                        <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(x.file)}>
                            <span className={`dot ${x.status}`} />
                            {x.key && <span className="key">{x.key}</span>}
                            <span className="title">{x.title}</span>
                            <Chip tone={`s-${x.status}`}>{x.status}</Chip>
                            {working && s.active && <Elapsed start={s.active.start} />}
                            {x.planned && <Chip tone={x.planned < t ? 'warn' : 'accent'}>{fmtDate(x.planned)}</Chip>}
                            {subs.length > 0 && (
                                <Chip>
                                    {subs.filter((y) => y.item.done).length}/{subs.length}
                                </Chip>
                            )}
                            {x.spent > 0 && <Chip>{fmtMins(x.spent)}</Chip>}
                        </Row>
                    </div>
                )
            })}
        </div>
    )
}

export function TicketDetail({ file }: { file: string }) {
    const s = useStore()
    const tk = s.tickets.find((x) => x.file === file) as Ticket
    const subs = itemsOf(tk.subtasks)
    const { cur, setC, nav } = useCursor(subs.length)
    const sub = subs[cur]
    const t = today()
    const working = s.active?.kind === 'ticket' && s.active.ref === tk.file
    const when = ticketWhen(tk)
    const canPlan = () => tk.status === 'todo' || (s.toast('Only todo tickets are planned; others are always on Today'), false)

    useHotkeys({
        ...nav,
        Escape: () => s.setOpenTicket(null),
        h: () => s.setOpenTicket(null),
        x: () => sub && void s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, done: !it.done }))),
        Enter: () => sub && void s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, done: !it.done }))),
        a: () => document.getElementById('f-sub')?.focus(),
        r: () => sub && promptText('Rename subtask', sub.item.text, (v) => s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, text: v.trim() })))),
        '#': () => sub && void s.editSubtasks(file, (ls) => ls.filter((l) => l.id !== sub.id)),
        e: () => document.getElementById('f-title')?.focus(),
        u: () => document.getElementById('f-url')?.focus(),
        n: () => document.getElementById('notes-detail-view')?.click(),
        o: () => tk.url && void openUrl(tk.url),
        s: () => (working ? void s.stopWork() : void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) })),
        t: () => canPlan() && void s.patchTicket(file, { planned: t }).then(() => s.toast('Planned for today')),
        l: () => canPlan() && void s.patchTicket(file, { later: true }),
        p: () => canPlan() && void s.patchTicket(file, { planned: addDays(tk.planned > t ? tk.planned : t, 1) }),
        d: () => {
            if (!canPlan()) return
            if (!tk.planned) void s.patchTicket(file, { planned: t })
            setTimeout(() => document.getElementById('f-plan')?.focus(), 50)
        },
        D: () => {
            if (confirm(`Delete ${ticketLabel(tk)}?`)) void s.removeTicket(file)
        },
        ...Object.fromEntries(STATUSES.map((st, i) => [String(i + 1), () => void s.setStatus(file, st)])),
    }, { modal: true })

    return (
        <div className="page detail">
            <PageHeader title={tk.key || 'Ticket'} sub={`created ${fmtDate(tk.created)} · updated ${fmtDate(tk.updated)}`}>
                {working && s.active && <Elapsed start={s.active.start} />}
                <button className={`btn${working ? ' on' : ''}`} onClick={() => (working ? void s.stopWork() : void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) }))}>
                    {working ? 'Clock out' : 'Clock in'} <kbd>s</kbd>
                </button>
            </PageHeader>

            <div className="card">
                <InlineField id="f-title" label="Title (e)" value={tk.title} onCommit={(v) => v && void s.patchTicket(file, { title: v })} />
                <InlineField id="f-url" label="URL (u)" value={tk.url} placeholder="https://jira.example.com/browse/ABC-123" onCommit={(v) => void s.patchTicket(file, { url: v })}>
                    <button className="btn" disabled={!tk.url} onClick={() => void openUrl(tk.url)}>
                        Open <kbd>o</kbd>
                    </button>
                </InlineField>
                <div className="ifield">
                    <span className="ifield-label">Status (1–5)</span>
                    <div className="statuses">
                        {STATUSES.map((st, i) => (
                            <button key={st} className={`status-btn ${st}${tk.status === st ? ' on' : ''}`} onClick={() => void s.setStatus(file, st)}>
                                <span className={`dot ${st}`} /> {st} <kbd>{i + 1}</kbd>
                            </button>
                        ))}
                    </div>
                </div>
                {tk.status !== 'todo' ? (
                    <div className="ifield">
                        <span className="ifield-label">When</span>
                        <span className="muted">Always on Today while {tk.status}. Planning applies to todo tickets.</span>
                        {tk.spent > 0 && <Chip>{fmtMins(tk.spent)} clocked</Chip>}
                    </div>
                ) : (
                    <>
                <div className="ifield">
                    <span className="ifield-label">When</span>
                    <div className="seg">
                        <button className={`status-btn${when === 'later' ? ' on' : ''}`} onClick={() => void s.patchTicket(file, { later: true })}>
                            Later <kbd>l</kbd>
                        </button>
                        <button className={`status-btn${when === 'date' ? ' on' : ''}`} onClick={() => !tk.planned && void s.patchTicket(file, { planned: t })}>
                            Due date <kbd>d</kbd>
                        </button>
                        {tk.spent > 0 && <Chip>{fmtMins(tk.spent)} clocked</Chip>}
                    </div>
                </div>
                {when === 'date' && (
                    <InlineField
                        id="f-plan"
                        label="Due date"
                        value={tk.planned}
                        placeholder="today, tom, mon, +3, 25 dec · empty moves to Later"
                        onCommit={(v) => {
                            if (!v) return void s.patchTicket(file, { planned: '' })
                            const d = parseDate(v)
                            if (d) void s.patchTicket(file, { planned: d })
                            else s.toast(`Cannot read "${v}" as a date`)
                        }}
                    >
                        <Chip tone={tk.planned < t ? 'warn' : 'accent'}>{fmtDate(tk.planned)}</Chip>
                    </InlineField>
                )}
                    </>
                )}
            </div>

            <h3 className="group">Subtasks</h3>
            {subs.map((l, i) => (
                <Row
                    key={l.id}
                    selected={i === cur}
                    onClick={() => setC(i)}
                    onDoubleClick={() => s.editSubtasks(file, (ls) => mapItem(ls, l.id, (it) => ({ ...it, done: !it.done })))}
                >
                    <span className={`check${l.item.done ? ' on' : ''}`} />
                    <span className={`title${l.item.done ? ' done' : ''}`}>{l.item.text}</span>
                </Row>
            ))}

            <AddInput id="f-sub" placeholder="+ Add subtask (a)" onAdd={(v) => s.editSubtasks(file, (ls) => [...ls, newItem(v)])} />

            <h3 className="group">
                Notes <span className="muted">(n to edit, markdown)</span>
            </h3>
            <NotesField id="notes-detail" value={tk.notes} placeholder="No notes. Click or press n to add some." onCommit={(v) => void s.patchTicket(file, { notes: v })} />
            <p className="muted foot">
                <kbd>1</kbd>–<kbd>5</kbd> status · <kbd>s</kbd> clock in/out · <kbd>Esc</kbd> back · <kbd>?</kbd> all keys
            </p>
        </div>
    )
}
