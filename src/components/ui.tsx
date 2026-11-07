import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { openUrl } from '../lib/fs'
import type { Bindings } from '../lib/hotkeys'

export function useNow(active: boolean, ms = 1000): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!active) return
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), ms)
        return () => clearInterval(id)
    }, [active, ms])
    return now
}

/** Keyboard cursor over a list of `len` rows, with vim-style movement bindings. */
export function useCursor(len: number) {
    const [c, setC] = useState(0)
    const cur = Math.min(c, Math.max(0, len - 1))
    const down = () => setC(Math.min(len - 1, cur + 1))
    const up = () => setC(Math.max(0, cur - 1))
    const nav: Bindings = {
        j: down,
        k: up,
        ArrowDown: down,
        ArrowUp: up,
        G: () => setC(Math.max(0, len - 1)),
        'g g': () => setC(0),
        'C-d': () => setC(Math.min(len - 1, cur + 5)),
        'C-u': () => setC(Math.max(0, cur - 5)),
    }
    return { cur, setC, nav }
}

export function Row({
    selected,
    working,
    onClick,
    onDoubleClick,
    type,
    children,
}: {
    type?: 'ticket' | 'task' | 'routine'
    selected: boolean
    working?: boolean
    onClick?: () => void
    onDoubleClick?: () => void
    children: ReactNode
}) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
    }, [selected])
    return (
        <div
            ref={ref}
            className={`row${selected ? ' selected' : ''}${working ? ' working' : ''}${type ? ` t-${type}` : ''}`}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
        >
            {children}
        </div>
    )
}

export const Chip = ({ children, tone }: { children: ReactNode; tone?: string }) => (
    <span className={`chip${tone ? ` ${tone}` : ''}`}>{children}</span>
)

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>

export function PageHeader({
    title,
    sub,
    search,
    children,
}: {
    title: string
    sub?: string
    search?: { value: string; onChange: (v: string) => void }
    children?: ReactNode
}) {
    return (
        <header className="page-header">
            <div>
                <h1>{title}</h1>
                {sub && <div className="sub">{sub}</div>}
            </div>
            <div className="spacer" />
            {children}
            {search && (
                <input
                    id="search"
                    className="search"
                    placeholder="/ search"
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            search.onChange('')
                            e.currentTarget.blur()
                        } else if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                />
            )}
        </header>
    )
}

const URL_RE = /https?:\/\/[^\s)>\]]+/

export function openFirstUrl(...sources: string[]): boolean {
    for (const s of sources) {
        const m = s.match(URL_RE)
        if (m) {
            void openUrl(m[0])
            return true
        }
    }
    return false
}

/** Renders item text with bare URLs and [[wikilinks]] softened. */
export function Rich({ text }: { text: string }) {
    const parts = text.split(/(https?:\/\/[^\s)>\]]+|\[\[[^\]]+\]\])/g)
    return (
        <>
            {parts.map((p, i) =>
                /^https?:\/\//.test(p) ? (
                    <a
                        key={i}
                        href={p}
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void openUrl(p)
                        }}
                    >
                        {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
                    </a>
                ) : p.startsWith('[[') ? (
                    <span key={i} className="wikilink">
                        {p.slice(2, -2)}
                    </span>
                ) : (
                    p
                )
            )}
        </>
    )
}

/** Single-line field that commits on Enter/blur and reverts on Escape. */
export function InlineField({
    id,
    label,
    value,
    placeholder,
    onCommit,
    children,
}: {
    id: string
    label: string
    value: string
    placeholder?: string
    onCommit: (v: string) => void
    children?: ReactNode
}) {
    const [v, setV] = useState(value)
    const [focused, setFocused] = useState(false)
    useEffect(() => {
        if (!focused) setV(value)
    }, [value, focused])
    return (
        <label className="ifield">
            <span className="ifield-label">{label}</span>
            <input
                id={id}
                value={v}
                placeholder={placeholder}
                onChange={(e) => setV(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                    setFocused(false)
                    if (v.trim() !== value) onCommit(v.trim())
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    else if (e.key === 'Escape') {
                        setV(value)
                        e.currentTarget.blur()
                    }
                }}
            />
            {children}
        </label>
    )
}

const ICONS = {
    // ticket stub
    ticket: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7zm10-2v14',
    // lightning bolt: quick task
    task: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
    // repeat
    routine: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
}

export function TypeIcon({ kind }: { kind: 'ticket' | 'task' | 'routine' }) {
    return (
        <span className={`type-icon ${kind}`} title={kind}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[kind]} />
            </svg>
        </span>
    )
}

/** Markdown notes shown rendered; click (or press n) to edit in place, blur to save. */
export function NotesField({
    value,
    placeholder,
    onCommit,
    markdown = true,
}: {
    value: string
    placeholder: string
    onCommit: (v: string) => void
    markdown?: boolean
}) {
    const [editing, setEditing] = useState(false)
    const [v, setV] = useState(value)
    const ref = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
        if (!editing) setV(value)
    }, [value, editing])
    useEffect(() => {
        if (editing) ref.current?.focus()
    }, [editing])

    if (!editing)
        return (
            <div id="f-notes-view" className="notes-view" onClick={() => setEditing(true)}>
                {value.trim() ? (
                    markdown ? (
                        <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
                    ) : (
                        <div className="plain">
                            <Rich text={value} />
                        </div>
                    )
                ) : (
                    <p className="muted">{placeholder}</p>
                )}
            </div>
        )
    return (
        <textarea
            ref={ref}
            className="daily-area"
            value={v}
            rows={Math.max(6, v.split('\n').length + 1)}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => {
                setEditing(false)
                if (v.trimEnd() !== value) onCommit(v.trimEnd())
            }}
            onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) e.currentTarget.blur()
            }}
        />
    )
}

/** An always-visible input that adds an entry on Enter and stays focused. */
export function AddInput({ id, placeholder, onAdd }: { id: string; placeholder: string; onAdd: (v: string) => void }) {
    const [v, setV] = useState('')
    return (
        <input
            id={id}
            className="add-input"
            value={v}
            placeholder={placeholder}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && v.trim()) {
                    onAdd(v.trim())
                    setV('')
                } else if (e.key === 'Escape') {
                    setV('')
                    e.currentTarget.blur()
                }
            }}
        />
    )
}
