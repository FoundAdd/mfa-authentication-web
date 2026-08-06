export const DEVICE_KEY_STORAGE = '_dk'
export const DEVICE_KEY_BYTES = 32

export function hasDeviceKey(): boolean {
  return localStorage.getItem(DEVICE_KEY_STORAGE) !== null
}

export function getDeviceKey(): string | null {
  return localStorage.getItem(DEVICE_KEY_STORAGE)
}

export function generateDeviceKey(): string {
  const bytes = new Uint8Array(DEVICE_KEY_BYTES)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function getOrCreateDeviceKey(): string {
  const existing = getDeviceKey()
  if (existing !== null) return existing
  const key = generateDeviceKey()
  localStorage.setItem(DEVICE_KEY_STORAGE, key)
  return key
}

export function clearDeviceKey() {
  localStorage.removeItem(DEVICE_KEY_STORAGE)
}