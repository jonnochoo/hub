import { fmtDur } from '../lib/dates'
import { useNow } from './ui'

export function Elapsed({ start, big }: { start: number; big?: boolean }) {
    const now = useNow(true)
    return <span className={big ? 'elapsed big' : 'elapsed'}>{fmtDur(now - start)}</span>
}
