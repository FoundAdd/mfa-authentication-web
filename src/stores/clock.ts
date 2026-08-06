import { defineStore } from 'pinia'
import { ref, onScopeDispose } from 'vue'
import { remainingSeconds } from '@/services/totp'

export const useClockStore = defineStore('clock', () => {
  const timestamp = ref(Date.now())

  let timer: ReturnType<typeof setInterval> | null = null

  function tick() {
    timestamp.value = Date.now()
  }

  function start() {
    if (timer !== null) return
    tick()
    timer = setInterval(tick, 1000)
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function remainingFor(period: number): number {
    return remainingSeconds(period, timestamp.value)
  }

  onScopeDispose(stop)

  start()

  return {
    timestamp,
    remainingFor,
    start,
    stop,
  }
})
