export const THEMES = ['night', 'paper', 'mocha', 'forest'] as const

const KEY = 'hub:theme'

export function getTheme(): string {
    try {
        return localStorage.getItem(KEY) || 'night'
    } catch {
        return 'night'
    }
}

export function setTheme(t: string) {
    document.documentElement.dataset.theme = t
    try {
        localStorage.setItem(KEY, t)
    } catch {
        /* ignore */
    }
}

export const applyTheme = () => setTheme(getTheme())
