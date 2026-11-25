import { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { fmtMins, fmtTime12, hmOf, minOf, nowMins, today } from '../lib/dates'
import { useHotkeys } from '../lib/hotkeys'
import { effMins, SNOOZE_MIN, timedKey, timedToday, useReminders, type Timed } from '../lib/reminders'
import { Chip, useNow } from './ui'

/** Today's timed items, recomputed as the store changes. */
export function useTimedToday(): Timed[] {
    const tickets = useStore((s) => s.tickets)
    const lists = useStore((s) => s.lists)
    const date = today()
    return useMemo(() => timedToday(tickets, lists, date), [tickets, lists, date])
}

function beep() {
    try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.55)
        osc.onended = () => void ctx.close()
    } catch {
        /* no audio: the card is still there */
    }
}

/** How a timed item should look right now. */
export function timeTone(eff: number, now: number, done: boolean): '' | 'soon' | 'late' | 'done' {
    if (done) return 'done'
    if (eff <= now) return 'late'
    if (eff - now <= 15) return 'soon'
    return ''
}

/** ⏰ 2:30pm chip: plain when later, amber within 15 minutes, red once passed. */
export function TimeChip({ kind, refKey, at, done }: { kind: string; refKey: string; at: string; done?: boolean }) {
    const now = nowMins(new Date(useNow(true, 15_000)))
    const snoozed = useReminders((r) => r.snoozed)
    const key = timedKey(today(), kind, refKey, at)
    const moved = snoozed[key]
    const tone = timeTone(moved ?? minOf(at), now, !!done)
    return (
        <Chip tone={`time ${tone}`}>
            ⏰ {fmtTime12(at)}
            {moved !== undefined && ` → ${fmtTime12(hmOf(moved))}`}
        </Chip>
    )
}

/**
 * Runs the alarm clock and shows ringing reminders as cards. Mounted once in App so alerts
 * fire from any view. The hub must be open: there is no background service.
 */
export function Reminders() {
    const s = useStore()
    const r = useReminders()
    const now = useNow(true, 10_000)
    const timed = useTimedToday()

    useEffect(() => void r.load(), []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!r.loaded || !s.ready) return
        if (r.check(timed).length) beep()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, timed, r.loaded, s.ready])

    const cards = timed.filter((t) => r.ringing.includes(t.key) && !t.done)
    const keys = cards.map((c) => c.key)

    useHotkeys({
        Z: () => keys.length && r.snooze(keys),
        X: () => keys.length && r.dismiss(keys),
    })

    if (cards.length === 0) return null
    const done = (t: Timed) => (t.kind === 'ticket' ? s.setTicketDone(t.ref, true) : s.toggleItem(t.kind, t.id))
    return (
        <div className="alerts" role="alert">
            {cards.map((t) => (
                <div className="alert-card" key={t.key}>
                    <div className="alert-time">⏰ {fmtTime12(t.at)}</div>
                    <div className="alert-label">{t.label}</div>
                    <div className="alert-actions">
                        <button onClick={() => void done(t)}>Done</button>
                        <button onClick={() => r.snooze([t.key])}>Snooze {SNOOZE_MIN}m</button>
                        <button onClick={() => r.dismiss([t.key])}>Dismiss</button>
                    </div>
                </div>
            ))}
            {cards.length > 1 && (
                <div className="alert-all">
                    <kbd>Z</kbd> snooze all · <kbd>X</kbd> dismiss all
                </div>
            )}
            {cards.length === 1 && (
                <div className="alert-all">
                    <kbd>Z</kbd> snooze · <kbd>X</kbd> dismiss
                </div>
            )}
        </div>
    )
}

// The work day, in minutes since midnight: blue work, purple lunch, yellow ready-for-home.
const DAY_START = 8 * 60 + 30
const DAY_END = 17 * 60
const SEGMENTS = [
    { from: DAY_START, to: 12 * 60, cls: 'work', label: 'Work' },
    { from: 12 * 60, to: 13 * 60, cls: 'lunch', label: 'Lunch' },
    { from: 13 * 60, to: 16 * 60, cls: 'work', label: 'Work' },
    { from: 16 * 60, to: DAY_END, cls: 'home', label: 'Ready for home' },
]
// Split at the hour so each hour reads as its own block.
const BLOCKS = SEGMENTS.flatMap((seg) => {
    const out: typeof SEGMENTS = []
    for (let from = seg.from; from < seg.to; ) {
        const to = Math.min(seg.to, (Math.floor(from / 60) + 1) * 60)
        out.push({ ...seg, from, to })
        from = to
    }
    return out
})

/** The day timeline at the top of Today (8:30am-5pm): fills as time passes, one dot per timed item. */
export function ScheduleStrip() {
    const timed = useTimedToday()
    const snoozed = useReminders((r) => r.snoozed)
    const ringing = useReminders((r) => r.ringing)
    const now = nowMins(new Date(useNow(true, 15_000)))

    const effs = timed.map((t) => effMins(t, snoozed))
    const span = DAY_END - DAY_START
    const clamp = (m: number) => Math.min(DAY_END, Math.max(DAY_START, m))
    const pct = (m: number) => `${((clamp(m) - DAY_START) / span) * 100}%`
    const open = timed.filter((t) => !t.done).sort((a, b) => effMins(a, snoozed) - effMins(b, snoozed))
    const overdue = open.filter((t) => effMins(t, snoozed) <= now)
    const next = open.find((t) => effMins(t, snoozed) > now)

    const hours: number[] = []
    for (let h = 9; h * 60 <= DAY_END; h++) hours.push(h)

    return (
        <div className="sched">
            <div className="sched-line">
                <b className="sched-clock">{fmtTime12(hmOf(now))}</b>
                {overdue.length > 0 && <span className="sched-over">{overdue.length} overdue</span>}
                {next ? (
                    <span>
                        Next <b>{fmtTime12(hmOf(effMins(next, snoozed)))}</b> {next.label} <span className="muted">· in {fmtMins(effMins(next, snoozed) - now)}</span>
                    </span>
                ) : (
                    overdue.length === 0 && <span className="muted">Nothing else timed today</span>
                )}
            </div>
            <div className="sched-bar">
                {BLOCKS.map((seg) => (
                    <div
                        key={seg.from}
                        className={`sched-seg ${seg.cls}`}
                        title={`${seg.label} ${fmtTime12(hmOf(seg.from))}–${fmtTime12(hmOf(seg.to))}`}
                        style={{ left: pct(seg.from), width: `${((seg.to - seg.from) / span) * 100}%` }}
                    >
                        <div className="sched-fill" style={{ width: `${(Math.min(Math.max(now, seg.from), seg.to) - seg.from) / (seg.to - seg.from) * 100}%` }} />
                    </div>
                ))}
                {hours.map((h) => (
                    <span key={h} className="sched-tick" style={{ left: pct(h * 60) }}>
                        {fmtTime12(hmOf(h * 60))}
                    </span>
                ))}
                {now >= DAY_START && now <= DAY_END && <span className="sched-now" style={{ left: pct(now) }} title={`Now ${fmtTime12(hmOf(now))}`} />}
                {timed.map((t, i) => (
                    <span
                        key={t.key}
                        className={`sched-dot ${timeTone(effs[i], now, t.done)}${ringing.includes(t.key) ? ' ringing' : ''}`}
                        style={{ left: pct(effs[i]) }}
                        title={`${fmtTime12(hmOf(effs[i]))} · ${t.label}`}
                    />
                ))}
            </div>
        </div>
    )
}
