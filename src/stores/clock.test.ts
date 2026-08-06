import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useClockStore } from '@/stores/clock'

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('clock store', () => {
  it('ticks and advances timestamp on interval', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const store = useClockStore()
    const start = store.timestamp

    vi.advanceTimersByTime(1000)

    expect(store.timestamp).toBeGreaterThan(start)
  })

  it('reports remaining seconds for a current moment', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:15.000Z'))
    expect(useClockStore().remainingFor(30)).toBe(15)
  })

  it('counts down to 1 second before a boundary', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:29.000Z'))
    expect(useClockStore().remainingFor(30)).toBe(1)
  })

  it('resets to full period when crossing a boundary', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:30.000Z'))
    expect(useClockStore().remainingFor(30)).toBe(30)
  })

  it('stop halts timestamp updates', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const store = useClockStore()
    const before = store.timestamp

    store.stop()
    vi.setSystemTime(new Date('2024-01-01T00:00:10.000Z'))
    vi.advanceTimersByTime(3000)

    expect(store.timestamp).toBe(before)
  })
})