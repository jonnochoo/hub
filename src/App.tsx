import { useEffect } from 'react'
import { useStore, type AddKind, type ViewId } from './store'
import { useHotkeys } from './lib/hotkeys'
import { setWindowTitle } from './lib/fs'
import { fmtDur } from './lib/dates'
import { Elapsed } from './components/Elapsed'
import { useNow } from './components/ui'
import { Modals } from './components/Modals'
import { TodayView } from './views/TodayView'
import { TicketDetail, TicketsView } from './views/TicketsView'
import { ItemDetail, ListView } from './views/ListView'
import { DailyView } from './views/DailyView'

const NAV: { id: ViewId; label: string; key: string }[] = [
    { id: 'today', label: 'Today', key: 't' },
    { id: 'tickets', label: 'Tickets', key: 'i' },
    { id: 'tasks', label: 'Tasks', key: 'a' },
    { id: 'routine', label: 'Daily routine', key: 'r' },
    { id: 'daily', label: 'Daily note', key: 'd' },
    { id: 'learn', label: 'To learn', key: 'l' },
    { id: 'questions', label: 'Questions', key: 'q' },
    { id: 'ideas', label: 'Future', key: 'f' },
]

const DEFAULT_ADD: Partial<Record<ViewId, AddKind>> = {
    tickets: 'ticket',
    routine: 'routine',
    learn: 'learn',
    questions: 'question',
    ideas: 'idea',
}

export default function App() {
    const s = useStore()

    useEffect(() => {
        void s.init()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useHotkeys(
        Object.fromEntries([
            ...NAV.map((n) => [`g ${n.key}`, () => s.setView(n.id)]),
            ['a', () => s.setModal({ type: 'add', kind: DEFAULT_ADD[s.view] ?? 'task' })],
            ['S', () => void s.stopWork()],
            ['?', () => s.setModal({ type: 'help' })],
            [',', () => s.setModal({ type: 'settings' })],
            ['r', () => void s.reload().then(() => s.toast('Reloaded from disk'))],
            ['/', () => document.getElementById('search')?.focus()],
        ])
    )

    // Window title shows what I'm clocked into, even when the app is in the background.
    const now = useNow(!!s.active, 30_000)
    useEffect(() => {
        void setWindowTitle(s.active ? `⏱ ${fmtDur(now - s.active.start).replace(/:\d\d$/, '')} · ${s.active.label}` : 'Hub')
    }, [s.active, now])

    if (!s.ready) return <div className="loading">Opening vault…</div>

    return (
        <div className={`app${s.active ? ' working' : ''}`}>
            <aside className="sidebar">
                <div className="brand">Hub</div>
                {NAV.map((n) => (
                    <button key={n.id} className={`nav${s.view === n.id ? ' on' : ''}`} onClick={() => s.setView(n.id)}>
                        <span>{n.label}</span>
                        <kbd>g {n.key}</kbd>
                    </button>
                ))}
                <div className="spacer" />
                <button className="nav" onClick={() => s.setModal({ type: 'add', kind: 'task' })}>
                    <span>+ Add</span>
                    <kbd>a</kbd>
                </button>
                <button className="nav" onClick={() => s.setModal({ type: 'help' })}>
                    <span>Shortcuts</span>
                    <kbd>?</kbd>
                </button>
                <div className="vault" title={s.vaultPath} onClick={() => s.setModal({ type: 'settings' })}>
                    {s.vaultPath}
                </div>
            </aside>

            <div className="content">
                {s.active && (
                    <div className="banner">
                        <span className="pulse" />
                        <div className="banner-text">
                            <div className="banner-label">Working on</div>
                            <div className="banner-title">{s.active.label}</div>
                        </div>
                        <Elapsed start={s.active.start} big />
                        <button onClick={() => void s.stopWork()}>
                            Clock out <kbd>S</kbd>
                        </button>
                    </div>
                )}
                <main>
                    <View />
                </main>
            </div>

            <DetailModal />
            <Modals />
            {s.toastMsg && <div className="toast">{s.toastMsg}</div>}
        </div>
    )
}

function View() {
    const view = useStore((s) => s.view)
    switch (view) {
        case 'today':
            return <TodayView />
        case 'tickets':
            return <TicketsView />
        case 'daily':
            return <DailyView />
        default:
            return <ListView key={view} kind={view} />
    }
}

/** Ticket / item detail, shown as a modal over whichever view is current. */
function DetailModal() {
    const ticket = useStore((s) => (s.openTicket && s.tickets.some((t) => t.file === s.openTicket) ? s.openTicket : null))
    const item = useStore((s) => (s.openItem && s.lists[s.openItem.kind][s.openItem.index]?.item ? s.openItem : null))
    const { setOpenTicket, setOpenItem } = useStore.getState()
    if (!ticket && !item) return null
    const close = () => (ticket ? setOpenTicket(null) : setOpenItem(item!.kind, null))
    return (
        <div className="overlay detail-overlay" onMouseDown={close}>
            <div className="modal detail-modal" onMouseDown={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={close} title="Close">
                    Esc ✕
                </button>
                {ticket ? <TicketDetail file={ticket} /> : <ItemDetail kind={item!.kind} index={item!.index} />}
            </div>
        </div>
    )
}
