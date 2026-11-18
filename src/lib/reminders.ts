import { create } from 'zustand'
import { vault } from './fs'
import { fromIso, minOf, nowMins, today } from './dates'
import { onDay, type Line } from './md'
import type { ListKind, Ticket } from './model'

/** Something on today's board that has a time. */
export interface Timed {
    key: string // stable for the day: date|kind|ref|at
    kind: ListKind | 'ticket'
    ref: string // ticket file, or item text
    id: string // list line id ('' for tickets)
    label: string
    at: string // 'HH:MM'
    mins: number
    done: boolean
}

export const timedKey = (date: string, kind: string, ref: string, at: string) => `${date}|${kind}|${ref}|${at}`

const TIMED_LISTS: ListKind[] = ['tasks', 'routine', 'reminders', 'learn', 'questions']

/**
 * Timed items that belong to `date`. A time only means something on its day, so a dated item
 * counts only on that exact date (rolled-over items are overdue, not alerting). Routine items
 * recur on their scheduled weekdays.
 */
export function timedToday(tickets: Ticket[], lists: Record<ListKind, Line[]>, date: string): Timed[] {
    const out: Timed[] = []
    const dow = fromIso(date).getDay()
    for (const t of tickets) {
        if (!t.at || t.later || t.planned !== date) continue
        out.push({ key: timedKey(date, 'ticket', t.file, t.at), kind: 'ticket', ref: t.file, id: '', label: t.key ? `${t.key} ${t.title}` : t.title, at: t.at, mins: minOf(t.at), done: t.status === 'done' })
    }
    for (const kind of TIMED_LISTS) {
        for (const l of lists[kind]) {
            const it = l.item
            if (!it?.at) continue
            const routine = kind === 'routine'
            if (routine ? !onDay(it, dow) : it.later || it.due !== date) continue
            out.push({ key: timedKey(date, kind, it.text, it.at), kind, ref: it.text, id: l.id, label: it.text, at: it.at, mins: minOf(it.at), done: routine ? it.completed === date : it.done })
        }
    }
    return out
}

// ---- alert state (fired / snoozed / ringing) --------------------------------

const FILE = '.hub/reminders.json'
/** An alert that is more than this late when first seen (app was closed) is marked fired without ringing. */
const STALE_MIN = 30
export const SNOOZE_MIN = 10

interface ReminderState {
    date: string
    fired: string[]
    snoozed: Record<string, number> // key -> minutes-of-day it should ring at instead
    ringing: string[]
    loaded: boolean
    load(): Promise<void>
    /** Ring everything that has come due. Returns the labels that just started ringing. */
    check(timed: Timed[]): Timed[]
    dismiss(keys?: string[]): void
    snooze(keys: string[], mins?: number): void
}

export const effMins = (t: Timed, snoozed: Record<string, number>) => snoozed[t.key] ?? t.mins

export const useReminders = create<ReminderState>((set, get) => {
    const persist = () => {
        const { date, fired, snoozed } = get()
        void vault.write(FILE, JSON.stringify({ date, fired, snoozed }))
    }
    // Start a fresh day: forget yesterday's state.
    const rollover = () => {
        if (get().date !== today()) set({ date: today(), fired: [], snoozed: {}, ringing: [] })
    }
    return {
        date: today(),
        fired: [],
        snoozed: {},
        ringing: [],
        loaded: false,

        async load() {
            try {
                const raw = await vault.read(FILE)
                const j = raw ? JSON.parse(raw) : null
                if (j?.date === today()) set({ date: j.date, fired: j.fired ?? [], snoozed: j.snoozed ?? {} })
            } catch {
                /* start clean */
            }
            set({ loaded: true })
        },

        check(timed) {
            rollover()
            const { fired, snoozed, ringing } = get()
            const now = nowMins()
            const nextFired = new Set(fired)
            const rang: Timed[] = []
            for (const t of timed) {
                if (t.done || nextFired.has(t.key)) continue
                const at = effMins(t, snoozed)
                if (at > now) continue
                nextFired.add(t.key)
                if (now - at <= STALE_MIN) rang.push(t)
            }
            if (nextFired.size === fired.length) return []
            set({ fired: [...nextFired], ringing: [...new Set([...ringing, ...rang.map((r) => r.key)])] })
            persist()
            return rang
        },

        dismiss(keys) {
            set((s) => ({ ringing: keys ? s.ringing.filter((k) => !keys.includes(k)) : [] }))
        },

        snooze(keys, mins = SNOOZE_MIN) {
            const at = Math.min(1439, nowMins() + mins)
            set((s) => ({
                fired: s.fired.filter((k) => !keys.includes(k)),
                ringing: s.ringing.filter((k) => !keys.includes(k)),
                snoozed: { ...s.snoozed, ...Object.fromEntries(keys.map((k) => [k, at])) },
            }))
            persist()
        },
    }
})

