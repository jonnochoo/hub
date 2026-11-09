import { parseDoc, parseList, serializeDoc, serializeList, splitSection, stripHeadings, slug, type Line } from './md'
import { today } from './dates'

/** A ticket note, oldest first. Stamps are local 'YYYY-MM-DD HH:MM' ('' for a legacy note with no stamp). */
export interface TicketNote {
    created: string
    updated: string
    text: string
}

const STAMP = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}'
const NOTE_HEAD = new RegExp(`^### (${STAMP})(?: · updated (${STAMP}))?\\s*$`)

/** `### created · updated stamp` headings split the Notes section. Text before the first heading is a legacy, unstamped note. */
export function parseNotes(src: string): TicketNote[] {
    const notes: TicketNote[] = []
    let cur: TicketNote = { created: '', updated: '', text: '' }
    const flush = () => {
        if (cur.text.trim()) notes.push({ ...cur, text: cur.text.trim() })
    }
    for (const line of src.split('\n')) {
        const m = NOTE_HEAD.exec(line)
        if (m) {
            flush()
            cur = { created: m[1], updated: m[2] ?? m[1], text: '' }
        } else cur.text += line + '\n'
    }
    flush()
    return notes
}

export function serializeNotes(notes: TicketNote[]): string {
    return notes
        .map((n) => (n.created ? `### ${n.created}${n.updated && n.updated !== n.created ? ` · updated ${n.updated}` : ''}\n${n.text}` : n.text))
        .join('\n\n')
}

export const STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'ready-to-deploy', 'done'] as const
export type Status = (typeof STATUSES)[number]

export interface Ticket {
    file: string // path inside the vault, e.g. tickets/ABC-123.md
    key: string
    title: string
    url: string
    status: Status
    created: string
    updated: string
    planned: string // the day I intend to work on it ('' = none)
    later: boolean // parked. No planned date and not later = active (always on Today)
    spent: number // minutes clocked
    subtasks: Line[]
    next: string // what to do next; shown on Today
    notes: TicketNote[]
    extra: Record<string, string> // unknown frontmatter, preserved for agents/humans
}

const KNOWN = ['key', 'title', 'url', 'status', 'created', 'updated', 'planned', 'later', 'spent', 'next']

export function parseTicket(file: string, src: string): Ticket {
    const { fm, body } = parseDoc(src)
    const sub = splitSection(body, 'Subtasks')
    const extra: Record<string, string> = {}
    for (const [k, v] of Object.entries(fm)) if (!KNOWN.includes(k)) extra[k] = v
    const h1 = body.match(/^# (.+)$/m)?.[1]
    const status = (STATUSES as readonly string[]).includes(fm.status) ? (fm.status as Status) : 'todo'
    return {
        file,
        key: fm.key ?? '',
        title: fm.title || h1 || file.replace(/^.*\//, '').replace(/\.md$/, ''),
        url: fm.url ?? '',
        status,
        created: fm.created || today(),
        updated: fm.updated || fm.created || today(),
        planned: /^\d{4}-\d{2}-\d{2}$/.test(fm.planned ?? '') ? fm.planned : '',
        later: fm.later === 'true' || fm.planned === 'later',
        spent: Number(fm.spent) || 0,
        subtasks: parseList(sub.lines.join('\n')),
        next: fm.next ?? '',
        notes: parseNotes(stripHeadings(sub.rest)),
        extra,
    }
}

export function serializeTicket(t: Ticket): string {
    const fm: Record<string, string> = {
        key: t.key,
        title: t.title,
        url: t.url,
        status: t.status,
        created: t.created,
        updated: t.updated,
        planned: t.planned,
        later: t.later ? 'true' : '',
        spent: t.spent ? String(t.spent) : '',
        next: t.next,
        ...t.extra,
    }
    const subs = t.subtasks.length ? serializeList(t.subtasks).trimEnd() : ''
    const body = [`# ${t.key ? `${t.key} ` : ''}${t.title}`, '', '## Subtasks', subs, '', '## Notes', serializeNotes(t.notes)].join('\n')
    return serializeDoc(fm, body)
}

export function ticketFile(key: string, title: string): string {
    return `tickets/${key ? key.toUpperCase() : slug(title)}.md`
}

export const ticketLabel = (t: Ticket) => (t.key ? `${t.key} ${t.title}` : t.title)

// ---- daily notes -----------------------------------------------------------

export interface Daily {
    date: string
    log: string[] // raw "- ..." lines under ## Log
    notes: string
}

export function parseDaily(date: string, src: string | null): Daily {
    if (!src) return { date, log: [], notes: '' }
    const { body } = parseDoc(src)
    const log = splitSection(body, 'Log')
    return {
        date,
        log: log.lines.filter((l) => l.trim()),
        notes: stripHeadings(log.rest),
    }
}

export function serializeDaily(d: Daily): string {
    const body = ['## Log', d.log.join('\n'), '', '## Notes', d.notes].join('\n')
    return serializeDoc({ date: d.date }, body)
}

// ---- timer -----------------------------------------------------------------

export interface Active {
    kind: 'ticket' | ListKind | 'free'
    ref: string // ticket file, or item text
    label: string
    start: number // epoch ms
}

export type ListKind = 'tasks' | 'routine' | 'reminders' | 'learn' | 'questions' | 'ideas'
export const LIST_KINDS: ListKind[] = ['tasks', 'routine', 'reminders', 'learn', 'questions', 'ideas']
export const LIST_TITLE: Record<ListKind, string> = {
    tasks: 'Tasks',
    routine: 'Daily routine',
    reminders: 'Post-its',
    learn: 'Things to learn',
    questions: 'Questions',
    ideas: 'Future & ideas',
}

/** Kinds where every open item is either dated, parked (@later) or Active (no date: always on Today). */
export const DATED_KINDS: ListKind[] = ['tasks', 'learn', 'questions']

/** Tickets: later = parked, date = on Today from that day, active = always on Today until done. */
export type When = 'later' | 'active' | 'date'
export const ticketWhen = (t: Ticket): When => (t.planned ? 'date' : t.later ? 'later' : 'active')

// ---- bookmarks -------------------------------------------------------------

export interface Bookmark {
    title: string
    url: string
}

const hostOf = (url: string) => {
    try {
        return new URL(url).host.replace(/^www\./, '')
    } catch {
        return url
    }
}

/** bookmarks.md: one `- [Title](url)` line per bookmark (a bare `- https://…` line also works). */
export function parseBookmarks(src: string | null): Bookmark[] {
    const out: Bookmark[] = []
    for (const line of (src ?? '').split('\n')) {
        const md = /^\s*[-*]\s*\[(.*?)\]\((\S+?)\)/.exec(line)
        if (md) {
            out.push({ title: md[1].trim() || hostOf(md[2]), url: md[2] })
            continue
        }
        const bare = /^\s*[-*]\s*(https?:\/\/\S+)(?:\s+(.*))?$/.exec(line)
        if (bare) out.push({ title: bare[2]?.trim() || hostOf(bare[1]), url: bare[1] })
    }
    return out
}

export const serializeBookmarks = (b: Bookmark[]): string => ['# Bookmarks', '', ...b.map((x) => `- [${x.title}](${x.url})`), ''].join('\n')

/** "https://example.com Optional title" (or "Title example.com"). */
export function parseBookmarkInput(input: string): Bookmark | null {
    const m = /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]\S*)?/i.exec(input)
    if (!m) return null
    const url = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`
    const title = (input.slice(0, m.index) + input.slice(m.index + m[0].length)).trim()
    return { title: title || hostOf(url), url }
}
