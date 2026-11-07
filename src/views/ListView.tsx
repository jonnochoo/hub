import { useMemo } from 'react'
import { useStore, type AddKind } from '../store'
import { addDays, fmtDate, parseDate, today } from '../lib/dates'
import { LIST_TITLE, type ListKind } from '../lib/model'
import type { ItemLine } from '../lib/md'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate } from '../lib/prompts'
import { Chip, Empty, InlineField, NotesField, openFirstUrl, PageHeader, Rich, Row, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

const ADD_KIND: Record<ListKind, AddKind> = { tasks: 'task', routine: 'routine', learn: 'learn', questions: 'question', ideas: 'idea' }
const SINGULAR: Record<ListKind, string> = { tasks: 'Task', routine: 'Routine item', learn: 'Thing to learn', questions: 'Question', ideas: 'Idea' }
const EMPTY: Record<ListKind, string> = {
    tasks: 'No tasks. Quick things that sit outside your tickets go here.',
    routine: 'No daily routine yet. Things you do every day (standup, check PRs, inbox zero) go here and show on Today.',
    learn: 'Nothing to learn yet. Capture it when you stumble on it.',
    questions: 'No open questions. Write down what you do not understand yet; answer it in the notes later.',
    ideas: 'No ideas parked. Future work and "someday" thoughts go here.',
}

/** Kinds where every open item is dated, parked (@later), or waiting in triage. */
export const TRIAGED: ListKind[] = ['tasks', 'learn', 'questions']
type Group = 'triage' | 'due' | 'later' | 'done'
const GROUPS: { id: Group; label: string; hint?: string }[] = [
    { id: 'triage', label: 'Triage', hint: 'decide: l for later, or d to give it a date' },
    { id: 'later', label: 'Later' },
    { id: 'due', label: 'Due date' },
    { id: 'done', label: 'Done' },
]
export const groupOf = (l: ItemLine): Group => (l.item.done ? 'done' : l.item.due ? 'due' : l.item.later ? 'later' : 'triage')

export const ListView = ({ kind }: { kind: ListKind }) => <ItemList kind={kind} />

function ItemList({ kind }: { kind: ListKind }) {
    const s = useStore()
    const t = today()
    const q = s.search.trim().toLowerCase()
    const triaged = TRIAGED.includes(kind)
    const lines = s.lists[kind]

    const rows = useMemo(() => {
        const all = lines.filter((l): l is ItemLine => !!l.item)
        const shown = all.filter((l) => (s.showDone || kind === 'routine' || !l.item.done) && (!q || `${l.item.text} ${l.item.notes.join(' ')}`.toLowerCase().includes(q)))
        if (!triaged) return shown
        const order = GROUPS.map((g) => g.id)
        return [...shown].sort(
            (a, b) =>
                order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)) ||
                Number(!!b.item.pri) - Number(!!a.item.pri) ||
                (a.item.due ?? '9').localeCompare(b.item.due ?? '9')
        )
    }, [lines, s.showDone, q, kind, triaged])

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]
    const openRow = (l: ItemLine | undefined) => l && s.openItemById(kind, l.id)

    useHotkeys({
        ...nav,
        Enter: () => openRow(row),
        e: () => openRow(row),
        l: () => triaged && row && !row.item.done && void s.patchItem(kind, row.id, { later: true }),
        c: () => row && void s.toggleItem(kind, row.id),
        x: () => row && void s.toggleItem(kind, row.id),
        s: () => row && void s.startWork({ kind, ref: row.item.text, label: row.item.text }),
        d: () => row && promptDate('Due date', row.item.due, (v) => s.patchItem(kind, row.id, v ? { due: v } : { due: undefined })),
        t: () => row && void s.patchItem(kind, row.id, { due: t }).then(() => s.toast('Due today')),
        p: () => row && void s.patchItem(kind, row.id, { due: addDays(row.item.due && row.item.due > t ? row.item.due : t, 1) }),
        '!': () => row && void s.patchItem(kind, row.id, { pri: !row.item.pri }),
        o: () => row && !openFirstUrl(row.item.text, ...row.item.notes) && s.toast('No link in this item'),
        H: s.toggleShowDone,
        '#': () => {
            if (row && confirm(`Delete "${row.item.text}"?`)) void s.removeItem(kind, row.id)
        },
        a: () => s.setModal({ type: 'add', kind: ADD_KIND[kind] }),
    })

    let lastGroup: Group | null = null
    return (
        <div className="page">
            <PageHeader title={LIST_TITLE[kind]} sub={`${rows.length} shown`} search={{ value: s.search, onChange: s.setSearch }}>
                <Chip>{s.showDone ? 'showing done' : 'H: show done'}</Chip>
            </PageHeader>
            {rows.length === 0 && <Empty>{EMPTY[kind]}</Empty>}
            {rows.map((l, i) => {
                const g = triaged ? groupOf(l) : null
                const head = g && g !== lastGroup ? GROUPS.find((x) => x.id === g)! : null
                lastGroup = g
                const isDone = kind === 'routine' ? l.item.completed === t : l.item.done
                const working = s.active?.kind === kind && s.active.ref === l.item.text
                const overdue = l.item.due && l.item.due < t && !l.item.done
                return (
                    <div key={l.id}>
                        {head && (
                            <h3 className="group">
                                {head.label} {head.hint && <span className="muted"> · {head.hint}</span>}
                            </h3>
                        )}
                        <Row selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => openRow(l)}>
                            <span className={`check${isDone ? ' on' : ''}`} onClick={() => void s.toggleItem(kind, l.id)} />
                            <span className="title-block">
                                <span className={`title${isDone ? ' done' : ''}`}>
                                    {l.item.pri && <span className="pri">!</span>}
                                    <Rich text={l.item.text} />
                                </span>
                                {l.item.notes.length > 0 && <span className="note-preview">{l.item.notes.join(' ')}</span>}
                            </span>
                            {working && s.active && <Elapsed start={s.active.start} />}
                            {kind !== 'routine' && l.item.due && <Chip tone={overdue ? 'warn' : l.item.due === t ? 'accent' : undefined}>{fmtDate(l.item.due)}</Chip>}
                                        </Row>
                    </div>
                )
            })}
        </div>
    )
}

export function ItemDetail({ kind, index }: { kind: ListKind; index: number }) {
    const s = useStore()
    const line = s.lists[kind][index] as ItemLine
    const it = line.item
    const id = line.id
    const t = today()
    const triaged = TRIAGED.includes(kind)
    const isRoutine = kind === 'routine'
    const done = isRoutine ? it.completed === t : it.done
    const working = s.active?.kind === kind && s.active.ref === it.text
    const mode: Group = it.due ? 'due' : it.later ? 'later' : 'triage'
    const back = () => s.setOpenItem(kind, null)
    const patch = (p: Parameters<typeof s.patchItem>[2]) => void s.patchItem(kind, id, p)
    const toggleClock = () => (working ? void s.stopWork() : void s.startWork({ kind, ref: it.text, label: it.text }))

    useHotkeys({
        Escape: back,
        h: back,
        e: () => document.getElementById('f-text')?.focus(),
        d: () => {
            if (!it.due) patch({ due: t })
            setTimeout(() => document.getElementById('f-due')?.focus(), 50)
        },
        n: () => document.getElementById('notes-detail-view')?.click(),
        l: () => triaged && patch({ later: true }),
        t: () => patch({ due: t }),
        p: () => patch({ due: addDays(it.due && it.due > t ? it.due : t, 1) }),
        '!': () => patch({ pri: !it.pri }),
        c: () => void s.toggleItem(kind, id),
        s: toggleClock,
        o: () => !openFirstUrl(it.text, ...it.notes) && s.toast('No link in this item'),
        '#': () => {
            if (confirm(`Delete "${it.text}"?`)) {
                back()
                void s.removeItem(kind, id)
            }
        },
    }, { modal: true })

    return (
        <div className="page detail">
            <PageHeader title={SINGULAR[kind]} sub={`added ${it.added ? fmtDate(it.added) : '—'}${it.completed ? ` · completed ${fmtDate(it.completed)}` : ''}`}>
                {working && s.active && <Elapsed start={s.active.start} />}
                <button className={`btn${working ? ' on' : ''}`} onClick={toggleClock}>
                    {working ? 'Clock out' : 'Clock in'} <kbd>s</kbd>
                </button>
            </PageHeader>

            <div className="card">
                <InlineField id="f-text" label="Text (e)" value={it.text} onCommit={(v) => v && patch({ text: v })} />

                {triaged && (
                    <div className="ifield">
                        <span className="ifield-label">When</span>
                        <div className="seg">
                            {mode === 'triage' && <span className="status-btn triage on">Triage: choose one</span>}
                            <button className={`status-btn${mode === 'later' ? ' on' : ''}`} onClick={() => patch({ later: true })}>
                                Later <kbd>l</kbd>
                            </button>
                            <button className={`status-btn${mode === 'due' ? ' on' : ''}`} onClick={() => !it.due && patch({ due: t })}>
                                Due date <kbd>d</kbd>
                            </button>
                        </div>
                    </div>
                )}

                {!isRoutine && (!triaged || mode === 'due') && (
                    <InlineField
                        id="f-due"
                        label="Due date (d)"
                        value={it.due ?? ''}
                        placeholder="today, tom, mon, +3, +2w, 25 dec, 2026-12-01 · empty moves to Later"
                        onCommit={(v) => {
                            if (!v) return patch({ due: undefined })
                            const d = parseDate(v)
                            if (d) patch({ due: d })
                            else s.toast(`Can't read "${v}" as a date`)
                        }}
                    >
                        {it.due && <Chip tone={it.due < t && !done ? 'warn' : 'accent'}>{fmtDate(it.due)}</Chip>}
                    </InlineField>
                )}

                <div className="ifield">
                    <span className="ifield-label">State</span>
                    <div className="seg">
                        <button className={`status-btn${done ? ' on' : ''}`} onClick={() => void s.toggleItem(kind, id)}>
                            <span className={`check${done ? ' on' : ''}`} /> {done ? 'Done' : 'Mark done'} <kbd>c</kbd>
                        </button>
                        {!isRoutine && (
                            <button className={`status-btn${it.pri ? ' on' : ''}`} onClick={() => patch({ pri: !it.pri })}>
                                <span className="pri">!</span> Priority <kbd>!</kbd>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <h3 className="group">
                {kind === 'questions' ? 'Answer / notes' : 'Notes'} <span className="muted">(n to edit)</span>
            </h3>
            <NotesField
                id="notes-detail"
                value={it.notes.join('\n')}
                placeholder={kind === 'questions' ? 'Not answered yet. Click or press n to write what you find.' : 'No notes. Click or press n to add some.'}
                onCommit={(v) => patch({ notes: v ? v.split('\n') : [] })}
            />
            <p className="muted foot">
                <kbd>Esc</kbd> back · <kbd>#</kbd> delete · <kbd>o</kbd> open link · <kbd>?</kbd> all keys
            </p>
        </div>
    )
}
