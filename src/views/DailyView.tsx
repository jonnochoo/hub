import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { fmtDate, fmtLong, hhmm, today } from '../lib/dates'
import { useHotkeys } from '../lib/hotkeys'
import { promptText } from '../lib/prompts'
import { NotesField, PageHeader, Row } from '../components/ui'
import { LogList } from './TodayView'

export function DailyView() {
    const s = useStore()
    const t = today()
    const dates = s.dailyDates.includes(t) ? s.dailyDates : [t, ...s.dailyDates]
    const [date, setDate] = useState(t)
    const [tab, setTab] = useState<'notes' | 'log'>('notes')
    const idx = Math.max(0, dates.indexOf(date))
    const daily = s.dailies[date]

    useEffect(() => {
        void s.loadDaily(date)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [date])

    const editNotes = () => {
        setTab('notes')
        setTimeout(() => document.getElementById('notes-daily-view')?.click(), 0)
    }

    const go = (d: number) => setDate(dates[Math.min(dates.length - 1, Math.max(0, idx + d))])

    useHotkeys({
        '[': () => go(1),
        ']': () => go(-1),
        j: () => go(1),
        k: () => go(-1),
        'g d': () => setDate(t),
        i: editNotes,
        n: editNotes,
        l: () => setTab('log'),
        a: () =>
            promptText('Add a note to ' + fmtDate(date), '', (v) => {
                const stamp = date === t ? `${hhmm(new Date())} ` : ''
                const base = (daily?.notes ?? '').trimEnd()
                void s.setDailyNotes(date, `${base}${base ? '\n' : ''}- ${stamp}${v.trim()}`)
            }),
    })

    return (
        <div className="page daily">
            <PageHeader title="Daily Notes" sub={fmtLong(date)} />
            <div className="split daily-split">
                <nav className="dates">
                    {dates.map((d) => (
                        <Row key={d} selected={d === date} onClick={() => setDate(d)}>
                            <span className="title">{fmtDate(d)}</span>
                            <span className="muted">{d.slice(5)}</span>
                        </Row>
                    ))}
                </nav>
                <div className="main">
                    <div className="tabs">
                        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
                            Notes
                        </button>
                        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
                            Log{daily && daily.log.length > 0 ? ` (${daily.log.length})` : ''}
                        </button>
                    </div>
                    {tab === 'notes' ? (
                        <>
                            <h3 className="group">
                                Notes <span className="muted">(i to edit, Esc to save)</span>
                            </h3>
                            <NotesField
                                id="notes-daily"
                                value={daily?.notes ?? ''}
                                placeholder="What did I do, decide, or learn? Click or press i to write. Markdown; [[ABC-123]] links a ticket."
                                onCommit={(v) => void s.setDailyNotes(date, v)}
                            />
                        </>
                    ) : daily && daily.log.length > 0 ? (
                        <LogList lines={daily.log} />
                    ) : (
                        <p className="muted">Nothing logged. Clock in with <kbd>s</kbd> or complete something and it lands here.</p>
                    )}
                </div>
            </div>
        </div>
    )
}
