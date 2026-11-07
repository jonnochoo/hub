import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from '../lib/hotkeys'
import { fmtDate } from '../lib/dates'
import { ADD_TO_LIST, parseCapture, parseTicketInput, useStore, type AddKind } from '../store'
import { setTheme, THEMES, getTheme } from '../theme'

const KINDS: { kind: AddKind; label: string; hint: string }[] = [
    { kind: 'task', label: 'Task', hint: 'Reply to Bob ^tom !   (^date or ^later; no date = triage; ! = priority)' },
    { kind: 'routine', label: 'Daily', hint: 'Check PRs and email   (shows on Today every day)' },
    { kind: 'ticket', label: 'Ticket', hint: 'ABC-123 Fix login https://jira…/ABC-123   (^date = plan for)' },
    { kind: 'learn', label: 'Learn', hint: 'Rust lifetimes, https://…' },
    { kind: 'question', label: 'Question', hint: 'Why does the cache miss on cold start?' },
    { kind: 'idea', label: 'Idea', hint: 'Someday: …' },
]

export function Modals() {
    const modal = useStore((s) => s.modal)
    if (!modal) return null
    switch (modal.type) {
        case 'add':
            return <AddModal initial={modal.kind} due={modal.due} />
        case 'prompt':
            return <PromptModal {...modal} />
        case 'help':
            return <HelpModal />
        case 'settings':
            return <SettingsModal />
    }
}

function Shell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
    return (
        <div className="overlay" onMouseDown={onClose}>
            <div className={`modal${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    )
}

function AddModal({ initial, due }: { initial: AddKind; due?: string }) {
    const { setModal, addItem, addTicket, toast } = useStore.getState()
    const [kind, setKind] = useState<AddKind>(initial)
    const [text, setText] = useState('')
    const ref = useRef<HTMLInputElement>(null)
    useEffect(() => ref.current?.focus(), [kind])

    const cycle = (dir: number) => {
        const i = KINDS.findIndex((k) => k.kind === kind)
        setKind(KINDS[(i + dir + KINDS.length) % KINDS.length].kind)
    }

    async function submit(keepOpen: boolean) {
        const raw = text.trim()
        if (!raw) return
        if (kind === 'ticket') {
            const t = parseTicketInput(raw)
            const file = await addTicket(t)
            toast(`Ticket added${t.key ? ` (${t.key})` : ''}`)
            if (!keepOpen) useStore.getState().setOpenTicket(file)
        } else {
            const { text: body, due: d, pri, later } = parseCapture(raw)
            if (!body) return
            await addItem(ADD_TO_LIST[kind], body, {
                pri: pri || undefined,
                later: later && kind !== 'idea' ? true : undefined,
                due: d ?? (kind === 'task' ? due : undefined),
            })
            toast(`${KINDS.find((k) => k.kind === kind)!.label} added`)
        }
        if (keepOpen) {
            setText('')
            ref.current?.focus()
        } else if (useStore.getState().modal?.type === 'add') setModal(null)
    }

    const cur = KINDS.find((k) => k.kind === kind)!
    return (
        <Shell onClose={() => setModal(null)}>
            <div className="tabs">
                {KINDS.map((k) => (
                    <button key={k.kind} className={k.kind === kind ? 'on' : ''} onClick={() => setKind(k.kind)}>
                        {k.label}
                    </button>
                ))}
            </div>
            <input
                ref={ref}
                className="big-input"
                value={text}
                placeholder={cur.hint}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setModal(null)
                    else if (e.key === 'Tab') {
                        e.preventDefault()
                        cycle(e.shiftKey ? -1 : 1)
                    } else if (e.key === 'Enter') {
                        e.preventDefault()
                        void submit(e.shiftKey)
                    }
                }}
            />
            {kind === 'task' && due && <div className="hint">Due {fmtDate(due)} unless you add ^date</div>}
            <div className="hint">
                <kbd>Enter</kbd> add · <kbd>Shift+Enter</kbd> add &amp; keep going · <kbd>Tab</kbd> change type ·{' '}
                <kbd>Esc</kbd> cancel
            </div>
        </Shell>
    )
}

function PromptModal({
    title,
    value,
    multiline,
    hint,
    validate,
    onSubmit,
}: {
    title: string
    value: string
    multiline?: boolean
    hint?: string
    validate?: (v: string) => string | null
    onSubmit: (v: string) => void
}) {
    const close = () => useStore.getState().setModal(null)
    const [v, setV] = useState(value)
    const [err, setErr] = useState('')
    const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
    useEffect(() => {
        ref.current?.focus()
        ref.current?.setSelectionRange(v.length, v.length)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function submit() {
        const e = validate?.(v) ?? null
        if (e) return setErr(e)
        close()
        onSubmit(v)
    }
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') close()
        else if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
            e.preventDefault()
            submit()
        }
    }
    return (
        <Shell onClose={close} wide={multiline}>
            <h2>{title}</h2>
            {multiline ? (
                <textarea ref={ref} className="big-input area" rows={10} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKeyDown} />
            ) : (
                <input ref={ref} className="big-input" value={v} onChange={(e) => (setV(e.target.value), setErr(''))} onKeyDown={onKeyDown} />
            )}
            {err && <div className="error">{err}</div>}
            <div className="hint">
                {hint && <>{hint} · </>}
                <kbd>{multiline ? 'Ctrl+Enter' : 'Enter'}</kbd> save · <kbd>Esc</kbd> cancel
            </div>
        </Shell>
    )
}

export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
    {
        group: 'Go to',
        keys: [
            ['g t', 'Today'],
            ['g i', 'Tickets'],
            ['g a', 'Tasks'],
            ['g r', 'Daily routine'],
            ['g d', 'Daily note'],
            ['g l', 'Things to learn'],
            ['g q', 'Questions'],
            ['g f', 'Future / ideas'],
        ],
    },
    {
        group: 'Anywhere',
        keys: [
            ['a', 'Add (Tab switches task / ticket / learn / question / idea)'],
            ['S', 'Clock out of the active item'],
            ['/', 'Search'],
            ['r', 'Reload from disk'],
            [',', 'Settings'],
            ['?', 'This help'],
        ],
    },
    {
        group: 'Lists',
        keys: [
            ['j / k', 'Down / up'],
            ['g g / G', 'Top / bottom'],
            ['Ctrl+d / Ctrl+u', 'Jump 5 down / up'],
            ['s', 'Start working (clock in)'],
            ['c', 'Complete / reopen'],
            ['e', 'Open the item page (everything editable inline)'],
            ['n', '(on an item page) edit notes'],
            ['d', 'Set due / plan date  (today, tom, mon, +3, +2w, 25 dec)'],
            ['t', 'Plan for today'],
            ['l', 'Park as Later (tasks, learn, questions). Triage is the start state only'],
            ['p', 'Postpone a day'],
            ['!', 'Toggle priority'],
            ['o', 'Open first link'],
            ['H', 'Show / hide completed'],
            ['#', 'Delete'],
            ['Enter', 'Open'],
        ],
    },
    {
        group: 'Tickets',
        keys: [
            ['1 – 5', 'Status: todo / in-progress / blocked / review / done'],
            ['Enter', 'Open ticket'],
            ['Esc', 'Back to list'],
            ['x', '(in a ticket) tick subtask'],
            ['a', '(in a ticket) add subtask (inline)'],
            ['r', '(in a ticket) rename subtask'],
            ['e / u / n', '(in a ticket) edit title / url / notes'],
            ['D', '(in a ticket) delete ticket'],
        ],
    },
    {
        group: 'Daily note',
        keys: [
            ['[ / ]', 'Previous / next day'],
            ['a', 'Append a timestamped note'],
            ['i', 'Edit notes (Esc to leave)'],
        ],
    },
]

function HelpModal() {
    const close = () => useStore.getState().setModal(null)
    useHotkeys({ Escape: close, '?': close, q: close }, { modal: true })
    return (
        <Shell onClose={close} wide>
            <h2>Keyboard shortcuts</h2>
            <div className="help-grid">
                {SHORTCUTS.map((g) => (
                    <section key={g.group}>
                        <h3>{g.group}</h3>
                        {g.keys.map(([k, what]) => (
                            <div className="help-row" key={k + what}>
                                <span className="keys">
                                    {k.split(' ').map((p, i) => (
                                        <kbd key={i}>{p}</kbd>
                                    ))}
                                </span>
                                <span>{what}</span>
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </Shell>
    )
}

function SettingsModal() {
    const { vaultPath, setVault, setModal, toast } = useStore()
    const [path, setPath] = useState(vaultPath)
    const [theme, setT] = useState(getTheme())
    const close = () => setModal(null)
    return (
        <Shell onClose={close}>
            <h2>Settings</h2>
            <label className="field">
                <span>Vault folder (markdown lives here)</span>
                <input
                    className="big-input"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={async (e) => {
                        if (e.key === 'Escape') close()
                        if (e.key === 'Enter') {
                            await setVault(path)
                            toast('Vault changed')
                            close()
                        }
                    }}
                />
            </label>
            <label className="field">
                <span>Theme</span>
                <select
                    value={theme}
                    onChange={(e) => {
                        setTheme(e.target.value)
                        setT(e.target.value)
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && close()}
                >
                    {THEMES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>
            </label>
            <div className="hint">
                <kbd>Enter</kbd> in the path field applies it · <kbd>Esc</kbd> close
            </div>
        </Shell>
    )
}
