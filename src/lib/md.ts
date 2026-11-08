let counter = 0
export const uid = () => `l${++counter}`

export interface Item {
    done: boolean
    text: string
    due?: string
    added?: string
    completed?: string
    pri?: boolean
    later?: boolean // parked: no date yet, deliberately not now
    every?: string // routine schedule: 'daily', or e.g. 'mon,wed,fri'. Undefined = weekdays
    notes: string[]
}
export interface RawLine {
    id: string
    raw: string
    item?: undefined
}
export interface ItemLine {
    id: string
    item: Item
    raw?: undefined
}
export type Line = RawLine | ItemLine

const ITEM = /^- \[( |x|X)\] ?(.*)$/
const DATE = '\\d{4}-\\d{2}-\\d{2}'

function parseItemText(s: string): Omit<Item, 'done' | 'notes'> {
    const out: Omit<Item, 'done' | 'notes'> = { text: s }
    out.text = out.text.replace(new RegExp(`(?:^|\\s)(due|added|done):(${DATE})(?=\\s|$)`, 'g'), (_m, k, v) => {
        if (k === 'due') out.due = v
        else if (k === 'added') out.added = v
        else out.completed = v
        return ''
    })
    out.text = out.text.replace(/(?:^|\s)!(?=\s|$)/g, () => {
        out.pri = true
        return ''
    })
    out.text = out.text.replace(/(?:^|\s)@later(?=\s|$)/g, () => {
        out.later = true
        return ''
    })
    out.text = out.text.replace(/(?:^|\s)every:([a-z,]+)(?=\s|$)/gi, (m, v: string) => {
        const n = normalizeEvery(v)
        if (n === null) return m
        out.every = n || undefined
        return ''
    })
    out.text = out.text.trim()
    return out
}

/** Parse a markdown checklist file. Non-checklist lines are preserved verbatim. */
export function parseList(content: string): Line[] {
    const src = content.replace(/\r\n/g, '\n').split('\n')
    while (src.length && src[src.length - 1] === '') src.pop()
    const out: Line[] = []
    for (const line of src) {
        const m = line.match(ITEM)
        if (m) {
            out.push({ id: uid(), item: { done: m[1] !== ' ', notes: [], ...parseItemText(m[2]) } })
            continue
        }
        const last = out[out.length - 1]
        if (last?.item && /^( {2,}|\t)\S/.test(line)) {
            last.item.notes.push(line.replace(/^( {2}|\t)/, ''))
            continue
        }
        out.push({ id: uid(), raw: line })
    }
    return out
}

export function serializeItem(it: Item): string[] {
    let head = `- [${it.done ? 'x' : ' '}] ${it.text}`
    if (it.pri) head += ' !'
    if (it.later) head += ' @later'
    if (it.every) head += ` every:${it.every}`
    if (it.due) head += ` due:${it.due}`
    if (it.added) head += ` added:${it.added}`
    if (it.completed) head += ` done:${it.completed}`
    return [head, ...it.notes.map((n) => (n ? `  ${n}` : ''))]
}

export function serializeList(lines: Line[]): string {
    const out: string[] = []
    for (const l of lines) {
        if (l.item) out.push(...serializeItem(l.item))
        else out.push(l.raw)
    }
    return out.join('\n') + '\n'
}

export const newItem = (text: string, extra: Partial<Item> = {}): ItemLine => ({
    id: uid(),
    item: { done: false, text, notes: [], ...extra },
})

export const itemsOf = (lines: Line[]): ItemLine[] => lines.filter((l): l is ItemLine => !!l.item)

// ---- frontmatter + sections ------------------------------------------------

export function parseDoc(src: string): { fm: Record<string, string>; body: string } {
    const text = src.replace(/\r\n/g, '\n')
    if (!text.startsWith('---\n')) return { fm: {}, body: text }
    const end = text.indexOf('\n---', 4)
    if (end < 0) return { fm: {}, body: text }
    const fm: Record<string, string> = {}
    for (const line of text.slice(4, end).split('\n')) {
        const i = line.indexOf(':')
        if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    return { fm, body: text.slice(end + 4).replace(/^\n/, '') }
}

export function serializeDoc(fm: Record<string, string>, body: string): string {
    const head = Object.entries(fm)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    return `---\n${head}\n---\n\n${body.trim()}\n`
}

/** Pull a `## Name` section out of a body. `rest` is everything else. */
export function splitSection(body: string, name: string): { lines: string[]; rest: string } {
    const all = body.split('\n')
    const start = all.findIndex((l) => l.trim().toLowerCase() === `## ${name.toLowerCase()}`)
    if (start < 0) return { lines: [], rest: body.trim() }
    let end = all.length
    for (let i = start + 1; i < all.length; i++) {
        if (/^## /.test(all[i])) {
            end = i
            break
        }
    }
    const lines = all.slice(start + 1, end)
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    while (lines.length && lines[0].trim() === '') lines.shift()
    const rest = [...all.slice(0, start), ...all.slice(end)].join('\n').trim()
    return { lines, rest }
}

/** Drop a leading `# Title` and/or `## Notes` heading from a body fragment. */
export function stripHeadings(text: string): string {
    const lines = text.split('\n')
    while (lines.length) {
        const first = lines[0].trim()
        if (first === '' || /^# /.test(first) || /^## notes\s*$/i.test(first)) lines.shift()
        else break
    }
    return lines.join('\n').trim()
}

export const slug = (s: string) =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'untitled'

/** Return `lines` with the item `id` replaced by `fn(item)`. */
export function mapItem(lines: Line[], id: string, fn: (it: Item) => Item): Line[] {
    return lines.map((l) => (l.id === id && l.item ? { id: l.id, item: fn(l.item) } : l))
}

// ---- routine schedules ------------------------------------------------------
// No `every:` means weekdays (Mon-Fri). `every:daily` includes weekends.

export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** Display order: Monday first. Values are Date#getDay() indexes. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAYS = [1, 2, 3, 4, 5]

const daySet = (every: string | undefined): Set<number> =>
    !every ? new Set(WEEKDAYS) : every === 'daily' ? new Set(WEEK) : new Set(every.split(',').map((d) => DAY_NAMES.indexOf(d)))

function canonical(days: Set<number>): string {
    if (days.size === 7) return 'daily'
    if (days.size === 5 && WEEKDAYS.every((d) => days.has(d))) return '' // the default
    return WEEK.filter((d) => days.has(d))
        .map((d) => DAY_NAMES[d])
        .join(',')
}

/**
 * Canonical schedule for user input like "weekdays", "mon wed fri", "daily".
 * Returns '' for the default (weekdays), 'daily', or a day list; null if unreadable.
 */
export function normalizeEvery(input: string): string | null {
    const tokens = input
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean)
    if (!tokens.length) return null
    const days = new Set<number>()
    for (const tok of tokens) {
        if (tok === 'daily' || tok === 'everyday' || tok === 'day') return 'daily'
        if (tok === 'weekdays') WEEKDAYS.forEach((d) => days.add(d))
        else if (tok === 'weekends') [6, 0].forEach((d) => days.add(d))
        else {
            const i = DAY_NAMES.findIndex((d) => tok.startsWith(d))
            if (i < 0 || tok.length < 3) return null
            days.add(i)
        }
    }
    return canonical(days)
}

/** Is a routine item scheduled on this weekday (Date#getDay index)? */
export const onDay = (it: Item, day: number): boolean => daySet(it.every).has(day)

export function everyLabel(every: string | undefined): string {
    if (!every) return 'Weekdays'
    if (every === 'daily') return 'Daily'
    if (every === 'sat,sun') return 'Weekends'
    return every.split(',').map((d) => d[0].toUpperCase() + d.slice(1)).join(' ')
}

/** Flip one weekday in a schedule. Never leaves it empty. Returns undefined for the default. */
export function toggleDay(every: string | undefined, day: number): string | undefined {
    const cur = daySet(every)
    if (cur.has(day)) cur.delete(day)
    else cur.add(day)
    if (cur.size === 0) return every
    return canonical(cur) || undefined
}
