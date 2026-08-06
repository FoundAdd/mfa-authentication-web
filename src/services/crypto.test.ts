import { describe, expect, it } from 'vitest'
import {
  buildEncryptedEnvelope,
  decryptEnvelope,
  buildPlainEnvelope,
  decodePlainEnvelope,
  parseEnvelope,
  validateEnvelope,
  EnvelopeError,
} from './crypto'
import type { TotpData } from '@/types'

function makeData(): TotpData {
  return {
    groups: [
      {
        id: 'g1',
        name: '工作',
        isExpanded: true,
        items: [
          {
            id: 'i1',
            issuer: 'GitHub',
            label: '用户@示例.com',
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
        label: '你好@example.com',
        secret: 'KRSXG5CTMVRXEZLU',
        algorithm: 'SHA256',
        digits: 8,
        period: 30,
      },
    ],
  }
}

describe('encrypted envelope', () => {
  it('round-trips encrypted export → decrypt with password', async () => {
    const data = makeData()
    const envelope = await buildEncryptedEnvelope(data, '正确密码')
    expect(envelope.v).toBe(1)
    expect(envelope.encrypted).toBe(true)
    expect(envelope.salt).toMatch(/^[0-9a-f]{64}$/)
    expect(envelope.iter).toBe(250000)
    const decrypted = await decryptEnvelope(envelope, '正确密码')
    expect(decrypted).toEqual(data)
  })

  it('throws unified decrypt-failed error on wrong password', async () => {
    const envelope = await buildEncryptedEnvelope(makeData(), 'secret')
    const promise = decryptEnvelope(envelope, 'wrong')
    await expect(promise).rejects.toBeInstanceOf(EnvelopeError)
    await expect(promise).rejects.toMatchObject({ reason: 'decrypt-failed' })
  })

  it('throws decrypt-failed on corrupted ciphertext', async () => {
    const envelope = await buildEncryptedEnvelope(makeData(), 'secret')
    envelope.ct = envelope.ct.slice(0, -2) + 'AA'
    await expect(decryptEnvelope(envelope, 'secret')).rejects.toMatchObject({
      reason: 'decrypt-failed',
    })
  })

  it('uses random salt so same data yields different ciphertext', async () => {
    const data = makeData()
    const a = await buildEncryptedEnvelope(data, 'pw')
    const b = await buildEncryptedEnvelope(data, 'pw')
    expect(a.salt).not.toBe(b.salt)
    expect(a.ct).not.toBe(b.ct)
  })
})

describe('plain envelope', () => {
  it('round-trips plain export → decode (with Chinese items)', () => {
    const data = makeData()
    const envelope = buildPlainEnvelope(data)
    expect(envelope.v).toBe(1)
    expect(envelope.encrypted).toBe(false)
    expect(envelope.data.length).toBeGreaterThan(0)
    expect(decodePlainEnvelope(envelope)).toEqual(data)
  })

  it('rejects malformed plain data', () => {
    expect(() =>
      decodePlainEnvelope({ v: 1, encrypted: false, data: '!!!not-base64!!!' }),
    ).toThrow(EnvelopeError)
  })
})

describe('envelope parsing/validation', () => {
  it('rejects non-JSON input', () => {
    expect(() => parseEnvelope('not json')).toThrow(EnvelopeError)
  })

  it('rejects unsupported version', () => {
    expect(() => parseEnvelope(JSON.stringify({ v: 2, encrypted: false, data: '' }))).toThrow(
      EnvelopeError,
    )
  })

  it('rejects encrypted envelope missing salt', () => {
    expect(() =>
      validateEnvelope({ v: 1, encrypted: true, iter: 250000, ct: 'x' }),
    ).toThrow(EnvelopeError)
  })

  it('rejects unknown envelope type', () => {
    expect(() =>
      validateEnvelope({ v: 1, encrypted: 'maybe' }),
    ).toThrow(EnvelopeError)
  })

  it('rejects non-object input', () => {
    expect(() => validateEnvelope('string')).toThrow(EnvelopeError)
  })

  it('parses a valid plain envelope from JSON text', () => {
    const envelope = buildPlainEnvelope(makeData())
    const parsed = parseEnvelope(JSON.stringify(envelope))
    expect(parsed.encrypted).toBe(false)
    expect(decodePlainEnvelope(parsed as never)).toEqual(makeData())
  })
})
