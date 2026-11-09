import { parseDoc, parseList, serializeDoc, serializeList, splitSection, stripHeadings, slug, type Line } from './md'
import { today } from './dates'

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
    later: boolean // parked. No planned date and not later = today
    spent: number // minutes clocked
    subtasks: Line[]
    notes: string
    extra: Record<string, string> // unknown frontmatter, preserved for agents/humans
}

const KNOWN = ['key', 'title', 'url', 'status', 'created', 'updated', 'planned', 'later', 'spent']

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
        notes: stripHeadings(sub.rest),
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
        ...t.extra,
    }
    const subs = t.subtasks.length ? serializeList(t.subtasks).trimEnd() : ''
    const body = [`# ${t.key ? `${t.key} ` : ''}${t.title}`, '', '## Subtasks', subs, '', '## Notes', t.notes].join('\n')
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

/** Kinds where every open item is either dated or parked (@later). No date = today. */
export const DATED_KINDS: ListKind[] = ['tasks', 'learn', 'questions']

export type When = 'later' | 'date'
export const ticketWhen = (t: Ticket): When => (t.later && !t.planned ? 'later' : 'date')
