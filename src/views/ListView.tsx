import { useMemo } from 'react'
import { ADD_TO_LIST, useStore, type AddKind } from '../store'
import { addDays, fmtDate, today } from '../lib/dates'
import type { ListKind } from '../lib/model'
import { LIST_TITLE } from '../lib/model'
import type { ItemLine } from '../lib/md'
import { useHotkeys } from '../lib/hotkeys'
import { promptDate, promptText } from '../lib/prompts'
import { Chip, Empty, openFirstUrl, PageHeader, Rich, Row, useCursor } from '../components/ui'
import { Elapsed } from '../components/Elapsed'

const ADD_KIND: Record<ListKind, AddKind> = { tasks: 'task', routine: 'routine', learn: 'learn', questions: 'question', ideas: 'idea' }
const EMPTY: Record<ListKind, string> = {
    routine: 'No daily routine yet. Things you do every day (standup, check PRs, inbox zero) go here and show on Today.',
    tasks: 'No tasks. Quick things that sit outside your tickets go here.',
    learn: 'Nothing to learn yet. Capture it when you stumble on it.',
    questions: 'No open questions. Write down what you do not understand yet; answer it as indented notes later.',
    ideas: 'No ideas parked. Future work and "someday" thoughts go here.',
}
// Sanity check that every add kind maps to a list.
void ADD_TO_LIST

export function ListView({ kind }: { kind: ListKind }) {
    const s = useStore()
    const t = today()
    const q = s.search.trim().toLowerCase()
    const lines = s.lists[kind]

    const rows = useMemo(() => {
        const all = lines.filter((l): l is ItemLine => !!l.item)
        const shown = all.filter((l) => (s.showDone || kind === 'routine' || !l.item.done) && (!q || `${l.item.text} ${l.item.notes.join(' ')}`.toLowerCase().includes(q)))
        if (kind !== 'tasks') return shown
        const rank = (l: ItemLine) => (l.item.done ? 3 : l.item.pri ? 0 : l.item.due ? 1 : 2)
        return [...shown].sort((a, b) => rank(a) - rank(b) || (a.item.due ?? '9').localeCompare(b.item.due ?? '9'))
    }, [lines, s.showDone, q, kind])

    const { cur, setC, nav } = useCursor(rows.length)
    const row = rows[cur]
    const editText = () => row && promptText('Edit', row.item.text, (v) => s.patchItem(kind, row.id, { text: v.trim() }))
    const editNotes = () =>
        row &&
        promptText(kind === 'questions' ? 'Answer / notes' : 'Notes', row.item.notes.join('\n'), (v) => s.patchItem(kind, row.id, { notes: v.trimEnd() ? v.trimEnd().split('\n') : [] }), {
            multiline: true,
            allowEmpty: true,
        })

    useHotkeys({
        ...nav,
        Enter: () => (kind === 'tasks' ? editText() : editNotes()),
        e: editText,
        n: editNotes,
        c: () => row && void s.toggleItem(kind, row.id),
        x: () => row && void s.toggleItem(kind, row.id),
        s: () => row && void s.startWork({ kind, ref: row.item.text, label: row.item.text }),
        d: () => row && promptDate('Due date', row.item.due, (v) => s.patchItem(kind, row.id, { due: v || undefined })),
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

    return (
        <div className="page">
            <PageHeader title={LIST_TITLE[kind]} sub={`${rows.length} shown`} search={{ value: s.search, onChange: s.setSearch }}>
                <Chip>{s.showDone ? 'showing done' : 'H: show done'}</Chip>
            </PageHeader>
            {rows.length === 0 && <Empty>{EMPTY[kind]}</Empty>}
            {rows.map((l, i) => {
                const working = s.active?.kind === kind && s.active.ref === l.item.text
                const isDone = kind === 'routine' ? l.item.completed === t : l.item.done
                const overdue = l.item.due && l.item.due < t && !l.item.done
                return (
                    <Row key={l.id} selected={i === cur} working={working} onClick={() => setC(i)} onDoubleClick={() => void s.toggleItem(kind, l.id)}>
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
                )
            })}
        </div>
    )
}
