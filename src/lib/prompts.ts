import { useStore } from '../store'
import { fmtDate, fmtTime12, parseDate, parseTime } from './dates'

const open = (m: Parameters<ReturnType<typeof useStore.getState>['setModal']>[0]) => useStore.getState().setModal(m)

export function promptText(title: string, value: string, onSubmit: (v: string) => void, opts: { multiline?: boolean; hint?: string; allowEmpty?: boolean; validate?: (v: string) => string | null } = {}) {
    open({
        type: 'prompt',
        title,
        value,
        multiline: opts.multiline,
        hint: opts.hint,
        validate: opts.validate ?? (opts.allowEmpty ? undefined : (v) => (v.trim() ? null : 'Cannot be empty')),
        onSubmit,
    })
}

/** Ask for a date in natural language. Empty input clears (passes ''). */
export function promptDate(title: string, current: string | undefined, onSubmit: (iso: string) => void) {
    open({
        type: 'prompt',
        title,
        value: '',
        hint: current ? `Currently ${fmtDate(current)} · empty clears` : 'today, tom, mon, +3, +2w, 25 dec, 2026-12-01',
        validate: (v) => (!v.trim() || parseDate(v) ? null : `Can't read "${v}" as a date`),
        onSubmit: (v) => onSubmit(v.trim() ? parseDate(v)! : ''),
    })
}

/** Ask for a time of day. Empty input clears (passes ''). */
export function promptTime(title: string, current: string | undefined, onSubmit: (hhmm: string) => void) {
    open({
        type: 'prompt',
        title,
        value: '',
        hint: current ? `Currently ${fmtTime12(current)} · empty clears` : '2pm, 14:30, 2:30pm, +30m (from now), +1h30',
        validate: (v) => (!v.trim() || parseTime(v) ? null : `Can't read "${v}" as a time`),
        onSubmit: (v) => onSubmit(v.trim() ? parseTime(v)! : ''),
    })
}
