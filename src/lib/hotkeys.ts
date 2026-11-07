import { useEffect, useRef } from 'react'

export type Bindings = Record<string, (e: KeyboardEvent) => void>
interface Handler {
    get: () => Bindings
    modal: boolean
}

const stack: Handler[] = []
let buf = ''
let timer: ReturnType<typeof setTimeout> | undefined

const MODS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

function chord(e: KeyboardEvent): string {
    return (e.ctrlKey ? 'C-' : '') + e.key
}

function onKey(e: KeyboardEvent) {
    if (MODS.has(e.key) || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return

    const hasModal = stack.some((h) => h.modal)
    const active = stack.filter((h) => !hasModal || h.modal).reverse()
    const k = chord(e)
    const seq = buf ? `${buf} ${k}` : k

    for (const h of active) {
        const fn = h.get()[seq]
        if (fn) {
            e.preventDefault()
            buf = ''
            clearTimeout(timer)
            fn(e)
            return
        }
    }
    if (!buf && active.some((h) => Object.keys(h.get()).some((b) => b.startsWith(k + ' ')))) {
        e.preventDefault()
        buf = k
        clearTimeout(timer)
        timer = setTimeout(() => (buf = ''), 900)
        return
    }
    buf = ''
}

let installed = false
function install() {
    if (installed) return
    installed = true
    window.addEventListener('keydown', onKey)
}

/**
 * Register key bindings while the component is mounted. Later registrations win,
 * so a view can override a global key. Chords are space separated: "g t".
 * While any `modal` handler is mounted, only modal handlers receive keys.
 */
export function useHotkeys(bindings: Bindings, opts: { modal?: boolean } = {}) {
    const ref = useRef(bindings)
    ref.current = bindings
    const modal = !!opts.modal
    useEffect(() => {
        install()
        const h: Handler = { get: () => ref.current, modal }
        stack.push(h)
        return () => {
            stack.splice(stack.indexOf(h), 1)
        }
    }, [modal])
}
