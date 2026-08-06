import localforage from 'localforage'
import type { TotpData } from '@/types'
import {
  getDeviceKey,
  getOrCreateDeviceKey,
  clearDeviceKey,
} from './deviceKey'

export const DATA_KEY = 'totp_data'

const IV_BYTES = 12
const ENVELOPE_VERSION = 1

export class DataCorruptedError extends Error {
  constructor() {
    super('data-corrupted')
    this.name = 'DataCorruptedError'
  }
}

interface Envelope {
  v: number
  iv: string
  ct: string
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyBase64),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptString(plaintext: string, key: CryptoKey): Promise<Envelope> {
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    v: ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptString(envelope: Envelope, key: CryptoKey): Promise<string> {
  const iv = base64ToBytes(envelope.iv)
  const ciphertext = base64ToBytes(envelope.ct)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

export async function save(data: TotpData): Promise<void> {
  const keyBase64 = getOrCreateDeviceKey()
  const key = await importKey(keyBase64)
  const envelope = await encryptString(JSON.stringify(data), key)
  await localforage.setItem(DATA_KEY, envelope)
}

export async function load(): Promise<TotpData> {
  const envelope = await localforage.getItem<Envelope>(DATA_KEY)
  if (!envelope) {
    return { groups: [], ungrouped: [] }
  }
  const keyBase64 = getDeviceKey()
  if (keyBase64 === null) {
    throw new DataCorruptedError()
  }
  const key = await importKey(keyBase64)
  try {
    const plaintext = await decryptString(envelope, key)
    return JSON.parse(plaintext) as TotpData
  } catch {
    throw new DataCorruptedError()
  }
}

export async function hasStoredData(): Promise<boolean> {
  return (await localforage.getItem<Envelope>(DATA_KEY)) !== null
}

export async function clearData() {
  await localforage.removeItem(DATA_KEY)
  clearDeviceKey()
}