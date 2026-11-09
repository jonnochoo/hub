const pad = (n: number) => String(n).padStart(2, '0')

export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const today = () => iso(new Date())
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** Local 'YYYY-MM-DD HH:MM', used for note created/updated stamps. */
export const stamp = (d = new Date()) => `${iso(d)} ${hhmm(d)}`

/** Display-only: rewrite 24h HH:MM stamps at the start of a log line as 12h (14:05 → 2:05pm, 09:00–10:30 → 9:00–10:30am). Files stay 24h. */
export function logTime12(line: string): string {
    const m = /^(\d{2}):(\d{2})(?:–(\d{2}):(\d{2}))?/.exec(line)
    if (!m) return line
    const part = (h: number, mm: string) => ({ t: `${h % 12 || 12}:${mm}`, ap: h < 12 ? 'am' : 'pm' })
    const a = part(Number(m[1]), m[2])
    let out = `${a.t}${a.ap}`
    if (m[3]) {
        const b = part(Number(m[3]), m[4])
        out = a.ap === b.ap ? `${a.t}–${b.t}${b.ap}` : `${a.t}${a.ap}–${b.t}${b.ap}`
    }
    return out + line.slice(m[0].length)
}

export function fromIso(s: string): Date {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number): string {
    const d = fromIso(s)
    d.setDate(d.getDate() + n)
    return iso(d)
}

export function daysBetween(a: string, b: string): number {
    return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000)
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/**
 * Natural-ish date entry: today, tom, mon..sun, +3, +2w, 2026-11-20, "25 dec", "dec 25".
 * Returns an ISO date or null when it can't be understood.
 */
export function parseDate(input: string, base = today()): string | null {
    const s = input.trim().toLowerCase()
    if (!s) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    if (['t', 'td', 'tod', 'today'].includes(s)) return base
    if (['tm', 'tom', 'tmr', 'tomorrow'].includes(s)) return addDays(base, 1)
    if (s === 'yesterday' || s === 'yes') return addDays(base, -1)
    if (s === 'nw' || s === 'nextweek') return nextWeekday(base, 1)

    const rel = s.match(/^\+?(\d+)\s*([dw]?)$/)
    if (rel) return addDays(base, Number(rel[1]) * (rel[2] === 'w' ? 7 : 1))

    const md = s.match(/^(\d{1,2})\s*([a-z]{3})[a-z]*$/) ?? s.match(/^([a-z]{3})[a-z]*\s*(\d{1,2})$/)
    if (md) {
        const [a, b] = /^\d/.test(md[1]) ? [md[1], md[2]] : [md[2], md[1]]
        const mi = MONTHS.indexOf(b)
        if (mi >= 0) {
            const now = fromIso(base)
            let d = new Date(now.getFullYear(), mi, Number(a))
            if (iso(d) < base) d = new Date(now.getFullYear() + 1, mi, Number(a))
            return iso(d)
        }
    }

    const dow = DAYS.findIndex((d) => s.startsWith(d))
    if (dow >= 0 && /^[a-z]{3,9}$/.test(s)) return nextWeekday(base, dow)
    return null
}

/** The next occurrence of a weekday strictly after `base`. */
function nextWeekday(base: string, dow: number): string {
    const cur = fromIso(base).getDay()
    let diff = (dow - cur + 7) % 7
    if (diff === 0) diff = 7
    return addDays(base, diff)
}

export function fmtDate(s: string, base = today()): string {
    const diff = daysBetween(base, s)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    if (diff === -1) return 'Yesterday'
    const d = fromIso(s)
    return `${cap(DAYS[d.getDay()])} ${d.getDate()} ${cap(MONTHS[d.getMonth()])}`
}

export function fmtLong(s: string): string {
    return fromIso(s).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    })
}

export function fmtDur(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const sec = total % 60
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function fmtMins(mins: number): string {
    if (mins < 60) return `${mins}m`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}h ${m}m` : `${h}h`
}
