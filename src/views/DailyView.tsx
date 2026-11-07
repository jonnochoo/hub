import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import { fmtDate, fmtLong, hhmm, today } from '../lib/dates'
import { useHotkeys } from '../lib/hotkeys'
import { promptText } from '../lib/prompts'
import { PageHeader, Row } from '../components/ui'
import { LogList } from './TodayView'

export function DailyView() {
    const s = useStore()
    const t = today()
    const dates = s.dailyDates.includes(t) ? s.dailyDates : [t, ...s.dailyDates]
    const [date, setDate] = useState(t)
    const idx = Math.max(0, dates.indexOf(date))
    const daily = s.dailies[date]
    const [text, setText] = useState('')
    const [editing, setEditing] = useState(false)
    const area = useRef<HTMLTextAreaElement>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
        void s.loadDaily(date)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date])

    // Pull in changes (including external edits) unless I'm mid-typing.
    useEffect(() => {
        if (!editing) setText(daily?.notes ?? '')
    }, [daily?.notes, date, editing])

    const flush = (value = text) => {
        clearTimeout(timer.current)
        if (value !== (daily?.notes ?? '')) void s.setDailyNotes(date, value)
    }
    const go = (d: number) => {
        flush()
        const next = dates[Math.min(dates.length - 1, Math.max(0, idx + d))]
        setDate(next)
    }

    useHotkeys({
        '[': () => go(1),
        ']': () => go(-1),
        j: () => go(1),
        k: () => go(-1),
        'g d': () => (flush(), setDate(t)),
        i: () => area.current?.focus(),
        n: () => area.current?.focus(),
        a: () =>
            promptText('Add a note to ' + fmtDate(date), '', (v) => {
                const stamp = date === t ? `${hhmm(new Date())} ` : ''
                const base = (daily?.notes ?? '').trimEnd()
                void s.setDailyNotes(date, `${base}${base ? '\n' : ''}- ${stamp}${v.trim()}`)
            }),
    })

    return (
        <div className="page daily">
            <PageHeader title="Daily note" sub={fmtLong(date)} />
            <div className="split daily-split">
                <nav className="dates">
                    {dates.map((d) => (
                        <Row key={d} selected={d === date} onClick={() => (flush(), setDate(d))}>
                            <span className="title">{fmtDate(d)}</span>
                            <span className="muted">{d.slice(5)}</span>
                        </Row>
                    ))}
                </nav>
                <div className="main">
                    <h3 className="group">Log</h3>
                    {daily && daily.log.length > 0 ? <LogList lines={daily.log} /> : <p className="muted">Nothing logged. Clock in with <kbd>s</kbd> or complete something and it lands here.</p>}

                    <h3 className="group">
                        Notes <span className="muted">(i to edit, Esc to leave)</span>
                    </h3>
                    <textarea
                        ref={area}
                        className="daily-area"
                        placeholder="What did I do, decide, or learn? Markdown. Use [[ABC-123]] to reference tickets."
                        value={text}
                        onFocus={() => setEditing(true)}
                        onBlur={() => {
                            setEditing(false)
                            flush()
                        }}
                        onChange={(e) => {
                            setText(e.target.value)
                            clearTimeout(timer.current)
                            const v = e.target.value
                            timer.current = setTimeout(() => flush(v), 600)
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') e.currentTarget.blur()
                        }}
                    />
                    {!editing && text.trim() && (
                        <div className="notes preview">
                            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
