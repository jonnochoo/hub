import { useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import { addDays, fmtDate, fmtMins, today } from '../lib/dates'
import { itemsOf, mapItem, newItem } from '../lib/md'
import { STATUSES, ticketLabel, type Status, type Ticket } from '../lib/model'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText } from '../lib/prompts'
import { openUrl } from '../lib/fs'
import { Chip, Empty, InlineField, PageHeader, Row, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

const ORDER: Status[] = ['in-progress', 'blocked', 'review', 'todo', 'done']

export function TicketsView() {
    const openTicket = useStore((s) => s.openTicket)
    const exists = useStore((s) => s.tickets.some((t) => t.file === s.openTicket))
    return openTicket && exists ? <TicketDetail file={openTicket} /> : <TicketList />
}

function TicketList() {
    const s = useStore()
    const t = today()
    const q = s.search.trim().toLowerCase()

    const list = useMemo(() => {
        return s.tickets
            .filter((x) => (s.showDone || x.status !== 'done') && (!q || `${x.key} ${x.title} ${x.notes}`.toLowerCase().includes(q)))
            .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.key.localeCompare(b.key, undefined, { numeric: true }))
    }, [s.tickets, s.showDone, q])

    const { cur, setC, nav } = useCursor(list.length)
    const tk = list[cur]
    const setStatus = (st: Status) => tk && void s.setStatus(tk.file, st)

    useHotkeys({
        ...nav,
        Enter: () => tk && s.setOpenTicket(tk.file),
        l: () => tk && s.setOpenTicket(tk.file),
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

    let lastStatus: Status | null = null
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
                const head = x.status !== lastStatus ? x.status : null
                lastStatus = x.status
                const subs = itemsOf(x.subtasks)
                const working = s.active?.kind === 'ticket' && s.active.ref === x.file
                return (
                    <div key={x.file}>
                        {head && <h3 className="group">{head}</h3>}
                        <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => s.setOpenTicket(x.file)}>
                            <span className={`dot ${x.status}`} />
                            {x.key && <span className="key">{x.key}</span>}
                            <span className="title">{x.title}</span>
                            {working && s.active && <Elapsed start={s.active.start} />}
                            {x.planned && <Chip tone={x.planned < t ? 'warn' : 'accent'}>plan {fmtDate(x.planned)}</Chip>}
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

function TicketDetail({ file }: { file: string }) {
    const s = useStore()
    const tk = s.tickets.find((x) => x.file === file) as Ticket
    const subs = itemsOf(tk.subtasks)
    const { cur, setC, nav } = useCursor(subs.length)
    const sub = subs[cur]
    const t = today()
    const working = s.active?.kind === 'ticket' && s.active.ref === tk.file

    useHotkeys({
        ...nav,
        Escape: () => s.setOpenTicket(null),
        h: () => s.setOpenTicket(null),
        x: () => sub && void s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, done: !it.done }))),
        Enter: () => sub && void s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, done: !it.done }))),
        a: () => promptText('Add subtask', '', (v) => s.editSubtasks(file, (ls) => [...ls, newItem(v.trim())])),
        r: () => sub && promptText('Rename subtask', sub.item.text, (v) => s.editSubtasks(file, (ls) => mapItem(ls, sub.id, (it) => ({ ...it, text: v.trim() })))),
        '#': () => sub && void s.editSubtasks(file, (ls) => ls.filter((l) => l.id !== sub.id)),
        e: () => document.getElementById('f-title')?.focus(),
        u: () => document.getElementById('f-url')?.focus(),
        n: () => promptText('Notes (markdown)', tk.notes, (v) => s.patchTicket(file, { notes: v.trim() }), { multiline: true, allowEmpty: true }),
        o: () => tk.url && void openUrl(tk.url),
        s: () => (working ? void s.stopWork() : void s.startWork({ kind: 'ticket', ref: tk.file, label: ticketLabel(tk) })),
        t: () => void s.patchTicket(file, { planned: t }).then(() => s.toast('Planned for today')),
        d: () => promptDate('Plan ticket for', tk.planned, (v) => s.patchTicket(file, { planned: v })),
        D: () => {
            if (confirm(`Delete ${ticketLabel(tk)}?`)) void s.removeTicket(file)
        },
        ...Object.fromEntries(STATUSES.map((st, i) => [String(i + 1), () => void s.setStatus(file, st)])),
    })

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
                <div className="ifield">
                    <span className="ifield-label">Planned (d / t)</span>
                    <div className="statuses">
                        <button className="btn" onClick={() => promptDate('Plan ticket for', tk.planned, (v) => s.patchTicket(file, { planned: v }))}>
                            {tk.planned ? fmtDate(tk.planned) : 'Not planned'}
                        </button>
                        {tk.spent > 0 && <Chip>{fmtMins(tk.spent)} clocked</Chip>}
                    </div>
                </div>
            </div>

            <h3 className="group">Subtasks</h3>
            {subs.length === 0 && (
                <p className="muted">
                    None yet. Press <kbd>a</kbd> to add one.
                </p>
            )}
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

            <h3 className="group">
                Notes <span className="muted">(n to edit)</span>
            </h3>
            <div className="notes">
                {tk.notes ? <Markdown remarkPlugins={[remarkGfm]}>{tk.notes}</Markdown> : <p className="muted">No notes.</p>}
            </div>
            <p className="muted foot">
                <kbd>1</kbd>–<kbd>5</kbd> status · <kbd>s</kbd> clock in/out · <kbd>Esc</kbd> back · <kbd>?</kbd> all keys
            </p>
        </div>
    )
}
