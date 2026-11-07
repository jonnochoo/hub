// Thin wrapper over the Rust vault commands, with an in-browser fallback so the UI
// can be developed with plain `vite` (no Tauri) against a localStorage vault.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const KEY = 'hub:browser-vault'
function loadMem(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}')
    } catch {
        return {}
    }
}
function saveMem(m: Record<string, string>) {
    try {
        localStorage.setItem(KEY, JSON.stringify(m))
    } catch {
        /* ignore */
    }
}

export let lastOwnWrite = 0

export const vault = {
    async path(): Promise<string> {
        return isTauri ? invoke<string>('vault_path') : '(browser demo vault)'
    },
    async setPath(path: string): Promise<string> {
        return isTauri ? invoke<string>('set_vault_path', { path }) : path
    },
    async read(rel: string): Promise<string | null> {
        if (isTauri) return invoke<string | null>('read_file', { rel })
        return loadMem()[rel] ?? null
    },
    async write(rel: string, content: string): Promise<void> {
        lastOwnWrite = Date.now()
        if (isTauri) return invoke('write_file', { rel, content })
        const m = loadMem()
        m[rel] = content
        saveMem(m)
    },
    async remove(rel: string): Promise<void> {
        lastOwnWrite = Date.now()
        if (isTauri) return invoke('delete_file', { rel })
        const m = loadMem()
        delete m[rel]
        saveMem(m)
    },
    /** File names (not paths) of the `.md` files directly inside `dir`. */
    async list(dir: string): Promise<string[]> {
        if (isTauri) return invoke<string[]>('list_dir', { rel: dir })
        const prefix = dir ? dir + '/' : ''
        return Object.keys(loadMem())
            .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
            .map((k) => k.slice(prefix.length))
    },
    async onChange(cb: () => void): Promise<() => void> {
        if (!isTauri) return () => {}
        return listen('vault-changed', () => {
            // Ignore the echo of our own writes.
            if (Date.now() - lastOwnWrite < 700) return
            cb()
        })
    },
}

export async function openUrl(url: string) {
    if (isTauri) {
        const { openUrl: open } = await import('@tauri-apps/plugin-opener')
        await open(url)
    } else {
        window.open(url, '_blank')
    }
}

export async function setWindowTitle(title: string) {
    if (isTauri) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().setTitle(title)
    } else {
        document.title = title
    }
}
