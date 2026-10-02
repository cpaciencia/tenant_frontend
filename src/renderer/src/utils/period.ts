/**
 * Period presets shared by the Backoffice report screens (Actividad, Tickets):
 * local calendar days, inclusive.
 */
import { addDays, localDate } from '../../../shared/shifts'

export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' }
]

/** The from/to days of a preset (`custom` uses the picked range). */
export function resolvePeriod(
  preset: PeriodPreset,
  customRange: (Date | null)[] | null,
  now: Date = new Date()
): { from: string; to: string } {
  const today = localDate(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
    case 'custom': {
      const [start, end] = customRange ?? []
      return start
        ? { from: localDate(start), to: localDate(end ?? start) }
        : { from: addDays(today, -6), to: today }
    }
    default:
      return { from: addDays(today, -6), to: today }
  }
}
