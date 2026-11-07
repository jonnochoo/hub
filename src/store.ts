import { create } from 'zustand'
import { vault } from './lib/fs'
import { hhmm, iso, parseDate, today } from './lib/dates'
import { mapItem, newItem, parseList, serializeList, type Item, type Line } from './lib/md'
import {
    LIST_KINDS,
    parseDaily,
    parseTicket,
    serializeDaily,
    serializeTicket,
    ticketFile,
    ticketLabel,
    type Active,
    type Daily,
    type ListKind,
    type Status,
    type Ticket,
} from './lib/model'

export type ViewId = 'today' | 'tickets' | ListKind | 'daily'
export type AddKind = 'task' | 'routine' | 'ticket' | 'learn' | 'question' | 'idea'

export type Modal =
    | { type: 'add'; kind: AddKind; due?: string }
    | {
          type: 'prompt'
          title: string
          value: string
          multiline?: boolean
          hint?: string
          validate?: (v: string) => string | null
          onSubmit: (v: string) => void
      }
    | { type: 'help' }
    | { type: 'settings' }

const LIST_HEADER: Record<ListKind, string> = {
    tasks: '# Tasks',
    routine: '# Daily routine (resets every day; done:DATE = last completed)',
    learn: '# Things to learn',
    questions: '# Questions',
    ideas: '# Future tasks & ideas',
}

export const ADD_TO_LIST: Record<Exclude<AddKind, 'ticket'>, ListKind> = {
    task: 'tasks',
    routine: 'routine',
    learn: 'learn',
    question: 'questions',
    idea: 'ideas',
}

// ---------------------------------------------------------------------------

interface State {
    ready: boolean
    vaultPath: string
    tickets: Ticket[]
    lists: Record<ListKind, Line[]>
    dailyDates: string[]
    dailies: Record<string, Daily>
    active: Active | null

    view: ViewId
    openTicket: string | null // ticket file shown in the detail page
    modal: Modal | null
    toastMsg: string
    search: string
    showDone: boolean
    openItem: { kind: ListKind; index: number } | null

    init(): Promise<void>
    reload(): Promise<void>
    setVault(path: string): Promise<void>
    setView(v: ViewId): void
    setOpenTicket(f: string | null): void
    setOpenItem(kind: ListKind, index: number | null): void
    openItemById(kind: ListKind, id: string): void
    setModal(m: Modal | null): void
    setSearch(s: string): void
    toggleShowDone(): void
    toast(msg: string): void

    addItem(kind: ListKind, text: string, extra?: Partial<Item>): Promise<void>
    patchItem(kind: ListKind, id: string, patch: Partial<Item>): Promise<void>
    toggleItem(kind: ListKind, id: string): Promise<void>
    removeItem(kind: ListKind, id: string): Promise<void>

    addTicket(input: { key: string; title: string; url: string; planned: string }): Promise<string>
    patchTicket(file: string, patch: Partial<Ticket>): Promise<void>
    setStatus(file: string, status: Status): Promise<void>
    editSubtasks(file: string, fn: (lines: Line[]) => Line[]): Promise<void>
    removeTicket(file: string): Promise<void>

    loadDaily(date: string): Promise<Daily>
    setDailyNotes(date: string, notes: string): Promise<void>
    appendLog(line: string, date?: string): Promise<void>

    startWork(a: Omit<Active, 'start'>): Promise<void>
    stopWork(): Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => {
    // ---- persistence helpers ------------------------------------------------
    const saveList = (kind: ListKind, lines: Line[]) => {
        set((s) => ({ lists: { ...s.lists, [kind]: lines } }))
        return vault.write(`${kind}.md`, serializeList(lines))
    }

    const saveTicket = (t: Ticket) => {
        const next = { ...t, updated: today() }
        set((s) => ({ tickets: s.tickets.map((x) => (x.file === t.file ? next : x)) }))
        return vault.write(t.file, serializeTicket(next))
    }

    const logDone = (text: string) => get().appendLog(`- ${hhmm(new Date())} ✓ ${text}`)

    async function loadAll() {
        const lists = {} as Record<ListKind, Line[]>
        for (const k of LIST_KINDS) {
            const src = await vault.read(`${k}.md`)
            lists[k] = src === null ? parseList(LIST_HEADER[k]) : parseList(src)
        }

        const tickets: Ticket[] = []
        for (const name of await vault.list('tickets')) {
            if (!name.endsWith('.md')) continue
            const src = await vault.read(`tickets/${name}`)
            if (src !== null) tickets.push(parseTicket(`tickets/${name}`, src))
        }
        tickets.sort((a, b) => a.key.localeCompare(b.key) || a.title.localeCompare(b.title))

        const dailyDates = (await vault.list('daily'))
            .map((n) => n.replace(/\.md$/, ''))
            .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
            .sort()
            .reverse()

        let active: Active | null = null
        try {
            const raw = await vault.read('.hub/active.json')
            if (raw && raw.trim() && raw.trim() !== 'null') active = JSON.parse(raw)
        } catch {
            active = null
        }

        // Re-read any daily notes we already had open so external edits show up.
        const dailies: Record<string, Daily> = {}
        for (const d of Object.keys(get().dailies)) dailies[d] = parseDaily(d, await vault.read(`daily/${d}.md`))

        set({ lists, tickets, dailyDates, active, dailies })
    }

    return {
        ready: false,
        vaultPath: '',
        tickets: [],
        lists: { tasks: [], routine: [], learn: [], questions: [], ideas: [] },
        dailyDates: [],
        dailies: {},
        active: null,
        view: 'today',
        openTicket: null,
        modal: null,
        toastMsg: '',
        search: '',
        showDone: false,
        openItem: null,

        async init() {
            const vaultPath = await vault.path()
            set({ vaultPath })
            await loadAll()
            if ((await vault.read('AGENTS.md')) === null) await vault.write('AGENTS.md', AGENTS_MD)
            set({ ready: true })
            let t: ReturnType<typeof setTimeout> | undefined
            await vault.onChange(() => {
                clearTimeout(t)
                t = setTimeout(() => void get().reload(), 250)
            })
        },

        async reload() {
            await loadAll()
        },

        async setVault(path) {
            const vaultPath = await vault.setPath(path)
            set({ vaultPath, dailies: {} })
            await loadAll()
            if ((await vault.read('AGENTS.md')) === null) await vault.write('AGENTS.md', AGENTS_MD)
        },

        setView(view) {
            set({ view, openTicket: null, openItem: null, search: '' })
        },
        setOpenTicket: (openTicket) => set({ openTicket, view: openTicket ? 'tickets' : get().view }),
        setOpenItem: (kind, index) => set({ openItem: index === null ? null : { kind, index }, view: kind }),
        openItemById(kind, id) {
            const index = get().lists[kind].findIndex((l) => l.id === id)
            if (index >= 0) set({ openItem: { kind, index }, view: kind, search: '' })
        },
        setModal: (modal) => set({ modal }),
        setSearch: (search) => set({ search }),
        toggleShowDone: () => set((s) => ({ showDone: !s.showDone })),
        toast(msg) {
            clearTimeout(toastTimer)
            set({ toastMsg: msg })
            toastTimer = setTimeout(() => set({ toastMsg: '' }), 2500)
        },

        // ---- list items -----------------------------------------------------
        async addItem(kind, text, extra = {}) {
            const lines = [...get().lists[kind], newItem(text, { added: today(), ...extra })]
            await saveList(kind, lines)
        },

        async patchItem(kind, id, patch) {
            const lines = mapItem(get().lists[kind], id, (it) => {
                const next = { ...it, ...patch }
                // A date and "later" are mutually exclusive; neither means triage.
                if (patch.due) next.later = undefined
                if (patch.later) next.due = undefined
                return next
            })
            await saveList(kind, lines)
        },

        async toggleItem(kind, id) {
            const line = get().lists[kind].find((l) => l.id === id)
            if (!line?.item) return
            // Routine items never stay ticked: they are done only if completed today.
            const isRoutine = kind === 'routine'
            const done = isRoutine ? line.item.completed !== today() : !line.item.done
            const { active } = get()
            if (done && active && active.kind === kind && active.ref === line.item.text) await get().stopWork()
            await get().patchItem(kind, id, { done: isRoutine ? false : done, completed: done ? today() : undefined })
            if (done) await logDone(line.item.text)
        },

        async removeItem(kind, id) {
            await saveList(
                kind,
                get().lists[kind].filter((l) => l.id !== id)
            )
        },

        // ---- tickets --------------------------------------------------------
        async addTicket({ key, title, url, planned }) {
            let file = ticketFile(key, title)
            const existing = new Set(get().tickets.map((t) => t.file))
            for (let n = 2; existing.has(file); n++) file = file.replace(/(-\d+)?\.md$/, `-${n}.md`)
            const t: Ticket = {
                file,
                key: key.toUpperCase(),
                title,
                url,
                status: 'todo',
                created: today(),
                updated: today(),
                planned,
                spent: 0,
                subtasks: [],
                notes: '',
                extra: {},
            }
            set((s) => ({ tickets: [...s.tickets, t] }))
            await vault.write(file, serializeTicket(t))
            return file
        },

        async patchTicket(file, patch) {
            const t = get().tickets.find((x) => x.file === file)
            if (t) await saveTicket({ ...t, ...patch })
        },

        async setStatus(file, status) {
            const t = get().tickets.find((x) => x.file === file)
            if (!t || t.status === status) return
            if (status === 'done' && get().active?.ref === file) await get().stopWork()
            await saveTicket({ ...t, status })
            await get().appendLog(`- ${hhmm(new Date())} ${status === 'done' ? '✓ ' : ''}[[${t.key || t.title}]] → ${status}`)
        },

        async editSubtasks(file, fn) {
            const t = get().tickets.find((x) => x.file === file)
            if (t) await saveTicket({ ...t, subtasks: fn(t.subtasks) })
        },

        async removeTicket(file) {
            set((s) => ({ tickets: s.tickets.filter((t) => t.file !== file), openTicket: null }))
            await vault.remove(file)
        },

        // ---- daily notes ----------------------------------------------------
        async loadDaily(date) {
            const d = parseDaily(date, await vault.read(`daily/${date}.md`))
            set((s) => ({ dailies: { ...s.dailies, [date]: d } }))
            return d
        },

        async setDailyNotes(date, notes) {
            const cur = parseDaily(date, await vault.read(`daily/${date}.md`))
            const next = { ...cur, notes }
            set((s) => ({
                dailies: { ...s.dailies, [date]: next },
                dailyDates: s.dailyDates.includes(date) || !notes.trim() ? s.dailyDates : [date, ...s.dailyDates].sort().reverse(),
            }))
            if (notes.trim() || cur.log.length || (await vault.read(`daily/${date}.md`)) !== null)
                await vault.write(`daily/${date}.md`, serializeDaily(next))
        },

        async appendLog(line, date = today()) {
            // Always append to what is on disk, so we never clobber external edits.
            const cur = parseDaily(date, await vault.read(`daily/${date}.md`))
            const next = { ...cur, log: [...cur.log, line] }
            set((s) => ({
                dailies: { ...s.dailies, [date]: next },
                dailyDates: s.dailyDates.includes(date) ? s.dailyDates : [date, ...s.dailyDates].sort().reverse(),
            }))
            await vault.write(`daily/${date}.md`, serializeDaily(next))
        },

        // ---- timer ----------------------------------------------------------
        async startWork(a) {
            if (get().active) await get().stopWork()
            const active: Active = { ...a, start: Date.now() }
            set({ active })
            await vault.write('.hub/active.json', JSON.stringify(active))
            get().toast(`Working on: ${a.label}`)
        },

        async stopWork() {
            const a = get().active
            if (!a) return
            const end = new Date()
            const startD = new Date(a.start)
            const mins = Math.round((end.getTime() - a.start) / 60000)
            set({ active: null })
            await vault.write('.hub/active.json', 'null')
            if (mins < 1) {
                get().toast('Clocked out (under a minute, not logged)')
                return
            }
            const where = a.kind === 'ticket' ? `[[${get().tickets.find((t) => t.file === a.ref)?.key || a.label}]] ` : ''
            const text = a.kind === 'ticket' ? get().tickets.find((t) => t.file === a.ref)?.title ?? a.label : a.label
            await get().appendLog(
                `- ${hhmm(startD)}–${hhmm(end)} (${mins}m) ${where}${text}`,
                iso(startD)
            )
            if (a.kind === 'ticket') {
                const t = get().tickets.find((x) => x.file === a.ref)
                if (t) await saveTicket({ ...t, spent: t.spent + mins })
            }
            get().toast(`Clocked out: ${mins}m on ${a.label}`)
        },
    }
})

// ---------------------------------------------------------------------------
// Quick-capture parsing:  "Reply to Bob ^tom !"   "ABC-123 Fix login https://jira/…"

export function parseCapture(input: string): { text: string; due?: string; pri: boolean; later?: boolean } {
    let due: string | undefined
    let later: boolean | undefined
    let pri = false
    let text = input.replace(/(?:^|\s)\^(\S+)/, (m, d: string) => {
        if (d.toLowerCase() === 'later') {
            later = true
            return ''
        }
        const p = parseDate(d)
        if (!p) return m
        due = p
        return ''
    })
    text = text.replace(/(?:^|\s)!(?=\s|$)/g, () => {
        pri = true
        return ''
    })
    return { text: text.trim(), due, pri, later }
}

export function parseTicketInput(input: string): { key: string; title: string; url: string; planned: string } {
    const { text, due } = parseCapture(input)
    let url = ''
    let rest = text.replace(/https?:\/\/\S+/, (u) => {
        url = u
        return ''
    })
    let key = ''
    rest = rest
        .split(/\s+/)
        .filter((tok) => {
            if (!key && /^[A-Za-z][A-Za-z0-9]+-\d+$/.test(tok)) {
                key = tok.toUpperCase()
                return false
            }
            return true
        })
        .join(' ')
        .trim()
    if (!key && url) key = url.match(/([A-Z][A-Z0-9]+-\d+)/)?.[1] ?? ''
    return { key, title: rest || key || 'Untitled', url, planned: due ?? '' }
}

export const isTicketActive = (a: Active | null, t: Ticket) => !!a && a.kind === 'ticket' && a.ref === t.file
export { ticketLabel }

const AGENTS_MD = `# Hub vault

This folder is the storage for the Hub desktop app. Everything is plain markdown,
so you (a human or an AI agent) can read and edit it directly. The app watches the
folder and reloads when files change.

## Layout

- \`tasks.md\`      quick tasks outside normal ticket work
- \`routine.md\`    daily routine: recurring items shown on Today every day. \`done:DATE\` is the last day completed (done today = DATE is today); items are never ticked \`[x]\`
- \`learn.md\`      things to learn
- \`questions.md\`  open questions (indented lines under an item are the answer/notes)
- \`ideas.md\`      future tasks and ideas
- \`tickets/*.md\`  one file per ticket
- \`daily/YYYY-MM-DD.md\`  daily notes: a \`## Log\` of what happened, then free-form \`## Notes\`
- \`.hub/active.json\`  the currently clocked-in item (ignore)

## Checklist format (tasks.md, learn.md, questions.md, ideas.md, ticket subtasks)

\`\`\`
- [ ] Reply to Bob ! due:2026-11-09 added:2026-11-07
- [x] Ship the thing added:2026-11-01 done:2026-11-05
  indented lines are notes for the item above
\`\`\`

- Tasks, learn and questions are either dated (\`due:\`), parked (\`@later\`), or neither = triage.
- \`!\` marks high priority, \`due:\` is the due date, \`added:\` / \`done:\` are bookkeeping dates (ISO).
- Other lines (headings, prose) are preserved as-is.

## Tickets

Frontmatter: \`key\`, \`title\`, \`url\`, \`status\` (todo | in-progress | blocked | review | done),
\`created\`, \`updated\`, \`planned\` (the day I intend to work on it), \`spent\` (minutes clocked).
Body: \`## Subtasks\` checklist, then \`## Notes\`.

## Daily log lines

\`\`\`
- 09:30–10:15 (45m) [[ABC-123]] Fix login      <- a clocked work session
- 14:05 ✓ Reply to Bob                         <- something completed
- 14:20 [[ABC-123]] → review                   <- ticket status change
\`\`\`
`
