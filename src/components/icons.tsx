import type { ReactNode } from 'react'

// Minimal stroke icons (24x24 grid), coloured via currentColor.
const PATHS: Record<string, ReactNode> = {
    note: (
        <>
            <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
            <path d="M14 3v5h5M8.5 13h7M8.5 17h5" />
        </>
    ),
    today: (
        <>
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4" />
            <circle cx="12" cy="15" r="1.6" fill="currentColor" />
        </>
    ),
    tickets: (
        <>
            <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-1a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
            <path d="M14 6v12" strokeDasharray="2 2" />
        </>
    ),
    tasks: (
        <>
            <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
            <path d="m8 12 3 3 5-6" />
        </>
    ),
    routine: (
        <>
            <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
            <path d="M4 4v5h5" />
            <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
            <path d="M20 20v-5h-5" />
        </>
    ),
    daily: (
        <>
            <path d="M5 3h10l4 4v14H5z" />
            <path d="M14 3v5h5M8 13h8M8 17h5" />
        </>
    ),
    questions: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
            <circle cx="12" cy="17" r=".7" fill="currentColor" />
        </>
    ),
    learn: (
        <>
            <path d="M3 7l9-4 9 4-9 4z" />
            <path d="M7 9.5V15c0 1.5 2.2 3 5 3s5-1.500 5-3V9.5" />
            <path d="M21 7v6" />
        </>
    ),
    ideas: <path d="M12 3l2.1 5.4L20 9l-4.4 3.800L17 19l-5-3-5 3 1.400-6.200L4 9l5.900-.6z" />,
    add: <path d="M12 5v14M5 12h14" />,
    help: (
        <>
            <rect x="2.500" y="6" width="19" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </>
    ),
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
    return (
        <svg
            className="icon"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.800}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {PATHS[name]}
        </svg>
    )
}
