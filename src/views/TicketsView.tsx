import { useMemo } from 'react'
import { useStore } from '../store'
import { addDays, fmtDate, fmtMins, logTime12, parseDate, stamp, today } from '../lib/dates'
import { itemsOf, mapItem, newItem } from '../lib/md'
import { STATUSES, ticketLabel, ticketWhen, type Status, type Ticket, type When } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText } from '../lib/prompts'
import { openUrl } from '../lib/fs'
import { AddInput, Chip, Empty, InlineField, NotesField, PageHeader, Row, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

const ORDER: Status[] = ['in-progress', 'blocked', 'review', 'ready-to-deploy', 'todo', 'done']
type Group = When | 'done'
const GROUPS: { id: Group; label: string; hint?: string }[] = [
    { id: 'later', label: 'Later' },
    { id: 'active', label: 'Active', hint: 'always on Today until done' },
    { id: 'date', label: 'Date', hint: 'on Today from its date' },
    { id: 'done', label: 'Done' },
]
const groupOf = (t: Ticket): Group => (t.status === 'done' ? 'done' : ticketWhen(t))

export const TicketsView = () => <TicketList />

function TicketList() {
    const s = useStore()
    const t = today()
    const q = s.search.trim().toLowerCase()

    const list = useMemo(() => {
        return s.tickets
            .filter((x) => (s.showDone || x.status !== 'done') && (!q || `${x.key} ${x.title} ${x.next} ${x.notes.map((n) => n.text).join(' ')}`.toLowerCase().includes(q)))
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

    useHotkeys({
        ...nav,
        Enter: () => tk && s.setOpenTicket(tk.file),
        n: () => {
            if (!tk) return
            s.setOpenTicket(tk.file)
            setTimeout(() => document.getElementById('notes-new-view')?.click(), 50)
        },
        e: () => {
            if (!tk) return
            s.setOpenTicket(tk.file)
            setTimeout(() => document.getElementById('f-title')?.focus(), 50)
        },
        l: () => tk && void s.patchTicket(tk.file, { later: true }),
        A: () => tk && void s.patchTicket(tk.file, { later: false, planned: '' }),
        o: () => tk?.url && void openUrl(tk.url),
        s: () => tk && void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) }),
        t: () => tk && void s.patchTicket(tk.file, { planned: t }).then(() => s.toast('Planned for today')),
        p: () => tk && void s.patchTicket(tk.file, { planned: addDays(tk.planned > t ? tk.planned : t, 1) }),
        d: () => tk && promptDate('Plan ticket for', tk.planned, (v) => s.patchTicket(tk.file, { planned: v })),
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
        n: () => document.getElementById('notes-new-view')?.click(),
        N: () => document.getElementById('f-next')?.focus(),
        o: () => tk.url && void openUrl(tk.url),
        s: () => (working ? void s.stopWork() : void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) })),
        t: () => void s.patchTicket(file, { planned: t }).then(() => s.toast('Planned for today')),
        l: () => void s.patchTicket(file, { later: true }),
        A: () => void s.patchTicket(file, { later: false, planned: '' }),
        p: () => void s.patchTicket(file, { planned: addDays(tk.planned > t ? tk.planned : t, 1) }),
        d: () => {
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
                <InlineField id="f-next" label="Next (N)" value={tk.next} placeholder="What is the next step? Shown on Today" onCommit={(v) => void s.patchTicket(file, { next: v.trim() })} />
                <div className="ifield">
                    <span className="ifield-label">Status (1–6)</span>
                    <div className="statuses">
                        {STATUSES.map((st, i) => (
                            <button key={st} className={`status-btn ${st}${tk.status === st ? ' on' : ''}`} onClick={() => void s.setStatus(file, st)}>
                                <span className={`dot ${st}`} /> {st} <kbd>{i + 1}</kbd>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="ifield">
                    <span className="ifield-label">When</span>
                    <div className="seg">
                        <button className={`status-btn${when === 'later' ? ' on' : ''}`} onClick={() => void s.patchTicket(file, { later: true })}>
                            Later <kbd>l</kbd>
                        </button>
                        <button className={`status-btn${when === 'active' ? ' on' : ''}`} onClick={() => void s.patchTicket(file, { later: false, planned: '' })} title="Always on Today until done">
                            Active <kbd>A</kbd>
                        </button>
                        <button className={`status-btn${when === 'date' ? ' on' : ''}`} onClick={() => !tk.planned && void s.patchTicket(file, { planned: t })} title="On Today from that date">
                            Date <kbd>d</kbd>
                        </button>
                        {tk.spent > 0 && <Chip>{fmtMins(tk.spent)} clocked</Chip>}
                    </div>
                </div>
                {when === 'date' && (
                    <InlineField
                        id="f-plan"
                        label="Date"
                        value={tk.planned}
                        placeholder="today, tom, mon, +3, 25 dec · empty makes it Active"
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
                Notes <span className="muted">(n for a new note, markdown)</span>
            </h3>
            <NotesField
                id="notes-new"
                value=""
                placeholder="+ New note (n)"
                onCommit={(v) => v.trim() && void s.patchTicket(file, { notes: [...tk.notes, { created: stamp(), updated: stamp(), text: v.trim() }] })}
            />
            {tk.notes
                .map((n, i) => ({ n, i }))
                .reverse()
                .map(({ n, i }) => (
                    <div key={i} className="note-entry">
                        <div className="note-meta muted">
                            {n.created ? `${fmtDate(n.created.slice(0, 10))} ${logTime12(n.created.slice(11))}` : 'Earlier note'}
                            {n.created && n.updated !== n.created && ` · updated ${fmtDate(n.updated.slice(0, 10))} ${logTime12(n.updated.slice(11))}`}
                            <button
                                className="note-x"
                                title="Delete note"
                                onClick={() => confirm('Delete this note?') && void s.patchTicket(file, { notes: tk.notes.filter((_, j) => j !== i) })}
                            >
                                ✕
                            </button>
                        </div>
                        <NotesField
                            id={`note-${i}`}
                            value={n.text}
                            placeholder=""
                            onCommit={(v) =>
                                void s.patchTicket(file, {
                                    notes: v.trim()
                                        ? tk.notes.map((x, j) => (j === i ? { ...x, text: v.trim(), updated: x.created ? stamp() : '' } : x))
                                        : tk.notes.filter((_, j) => j !== i),
                                })
                            }
                        />
                    </div>
                ))}
            <p className="muted foot">
                <kbd>1</kbd>–<kbd>5</kbd> status · <kbd>s</kbd> clock in/out · <kbd>Esc</kbd> back · <kbd>?</kbd> all keys
            </p>
        </div>
    )
}
