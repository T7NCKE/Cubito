import { activeLanguage } from './i18n/translate'

/** Wall-clock time in the active UI language's convention (12h en, 24h es), seconds included. */
export function formatClockTime(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(activeLanguage(), {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone })
  }).format(new Date(at))
}
