import { beforeEach, describe, expect, it } from 'vitest'
import localforage from 'localforage'
import * as storage from '@/services/storage'
import { DATA_KEY } from '@/services/storage'
import type { TotpData } from '@/types'

function makeData(): TotpData {
  return {
    groups: [
      {
        id: 'g1',
        name: 'Work',
        isExpanded: true,
        items: [
          {
            id: 'i1',
            issuer: 'GitHub',
            label: 'user@example.com',
            secret: 'JBSWY3DPEHPK3PXP',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          },
        ],
      },
    ],
    ungrouped: [
      {
        id: 'i2',
        issuer: 'Google',
        label: 'me@gmail.com',
        secret: 'KRSXG5CTMVRXEZLU',
        algorithm: 'SHA256',
        digits: 8,
        period: 30,
      },
    ],
  }
}

beforeEach(async () => {
  await localforage.clear()
  localStorage.removeItem('_dk')
  localStorage.removeItem('_backup_reminded')
})

describe('storage encrypted persistence', () => {
  it('round-trips data through save/load', async () => {
    const data = makeData()
    await storage.save(data)
    const loaded = await storage.load()
    expect(loaded).toEqual(data)
  })

  it('stores ciphertext with no plaintext secret in totp_data', async () => {
    const data = makeData()
    await storage.save(data)
    const raw = (await localforage.getItem(DATA_KEY)) as {
      v: number
      iv: string
      ct: string
    }
    expect(raw).toBeDefined()
    expect(raw.v).toBe(1)
    expect(raw.iv.length).toBeGreaterThan(0)
    expect(raw.ct.length).toBeGreaterThan(0)
    const json = await localforage.getItem(DATA_KEY)
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('JBSWY3DPEHPK3PXP')
    expect(serialized).not.toContain('KRSXG5CTMVRXEZLU')
  })

  it('returns empty data when nothing is stored', async () => {
    await expect(storage.load()).resolves.toEqual({ groups: [], ungrouped: [] })
  })

  it('throws DataCorruptedError when data exists but device key is missing', async () => {
    await storage.save(makeData())
    localStorage.removeItem('_dk')
    await expect(storage.load()).rejects.toBeInstanceOf(storage.DataCorruptedError)
  })

  it('throws DataCorruptedError when device key is wrong', async () => {
    await storage.save(makeData())
    localStorage.setItem(
      '_dk',
      btoa(String.fromCharCode(...Array(32).fill(7))),
    )
    await expect(storage.load()).rejects.toBeInstanceOf(storage.DataCorruptedError)
  })
})