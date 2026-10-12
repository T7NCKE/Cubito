import { afterEach, describe, expect, it } from 'vitest'
import { formatClockTime } from './clock-time'
import { setActiveLanguage } from './i18n/translate'

const AT = Date.UTC(2026, 9, 12, 19, 6, 5)
const flat = (text: string): string => text.replace(/\s/g, ' ')

describe('formatClockTime', () => {
  afterEach(() => setActiveLanguage('en'))

  it('uses a 12h clock for English', () => {
    setActiveLanguage('en')
    expect(flat(formatClockTime(AT, 'UTC'))).toBe('7:06:05 PM')
  })

  it('uses a 24h clock for Spanish', () => {
    setActiveLanguage('es')
    expect(formatClockTime(AT, 'UTC')).toBe('19:06:05')
  })

  it('follows a language switch on the next call', () => {
    setActiveLanguage('en')
    const english = formatClockTime(AT, 'UTC')
    setActiveLanguage('es')
    expect(formatClockTime(AT, 'UTC')).not.toBe(english)
  })
})
