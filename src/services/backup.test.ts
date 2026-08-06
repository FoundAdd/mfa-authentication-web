import { describe, expect, it } from 'vitest'
import {
  fingerprint,
  buildExport,
  exportFilename,
  readBackup,
  inspectBackup,
  mergeData,
  overwriteData,
} from './backup'
import { EnvelopeError } from './crypto'
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

function countItems(data: TotpData): number {
  return data.ungrouped.length + data.groups.reduce((s, g) => s + g.items.length, 0)
}

function makeIncoming(): TotpData {
  return {
    groups: [
      {
        id: 'x',
        name: 'Work',
        isExpanded: true,
        items: [
          {
            id: 'x1',
            issuer: 'GitHub',
            label: 'user@example.com',
            secret: 'JBSWY3DPEHPK3PXP',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          },
          {
            id: 'x2',
            issuer: 'Dropbox',
            label: 'drop@example.com',
            secret: 'GEZDGNBVGY3TQOJQ',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          },
        ],
      },
      {
        id: 'y',
        name: 'NoSuchGroup',
        isExpanded: true,
        items: [
          {
            id: 'y1',
            issuer: 'Slack',
            label: 'team@example.com',
            secret: 'MFRGGZDFMZTWQ2LK',
            algorithm: 'SHA256',
            digits: 8,
            period: 30,
          },
        ],
      },
    ],
    ungrouped: [
      {
        id: 'z1',
        issuer: 'Amazon',
        label: 'aws@example.com',
        secret: '4SJNAWDPFZXGOELG',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      },
    ],
  }
}

describe('fingerprint', () => {
  it('normalizes secret (uppercase, no spaces) and issuer (trim lowercase)', () => {
    expect(fingerprint(' jbswy3 dpehpk3pxp ', '  GitHub ')).toBe(
      'JBSWY3DPEHPK3PXP|github',
    )
  })
})

describe('export filename', () => {
  it('formats as totp-backup-YYYYMMDD-HHmm.totp', () => {
    const d = new Date(2026, 7, 6, 9, 5)
    expect(exportFilename(d)).toBe('totp-backup-20260806-0905.totp')
  })
})

describe('buildExport / readBackup round-trip', () => {
  it('plain export → import preserves data (incl. Chinese)', async () => {
    const data: TotpData = {
      groups: [
        {
          id: 'g',
          name: '工作',
          isExpanded: true,
          items: [
            {
              id: 'i',
              issuer: '支付宝',
              label: '你好@ali.com',
              secret: 'JBSWY3DPEHPK3PXP',
              algorithm: 'SHA1',
              digits: 6,
              period: 30,
            },
          ],
        },
      ],
      ungrouped: [],
    }
    const { json } = await buildExport(data, '')
    expect(inspectBackup(json).encrypted).toBe(false)
    await expect(readBackup(json, '')).resolves.toEqual(data)
  })

  it('encrypted export → import with correct password', async () => {
    const data = makeData()
    const { json } = await buildExport(data, 'pw123')
    expect(inspectBackup(json).encrypted).toBe(true)
    await expect(readBackup(json, 'pw123')).resolves.toEqual(data)
  })

  it('encrypted import with wrong password throws decrypt-failed', async () => {
    const { json } = await buildExport(makeData(), 'pw123')
    const promise = readBackup(json, 'nope')
    await expect(promise).rejects.toBeInstanceOf(EnvelopeError)
    await expect(promise).rejects.toMatchObject({ reason: 'decrypt-failed' })
  })

  it('import of invalid file throws EnvelopeError', async () => {
    await expect(readBackup('{ not valid', '')).rejects.toBeInstanceOf(EnvelopeError)
  })
})

describe('mergeData de-dup', () => {
  it('skips duplicate fingerprint, adds new; merges into same-name group else ungrouped', () => {
    const { result, added, skipped } = mergeData(makeData(), makeIncoming())
    // dup GitHub skipped; Dropbox + Slack + Amazon added
    expect(added).toBe(3)
    expect(skipped).toBe(1)
    // "NoSuchGroup" not created: Slack lands in ungrouped
    expect(result.groups.length).toBe(1)
    // existing group "Work" now has GitHub + Dropbox
    const work = result.groups[0]
    expect(work.name).toBe('Work')
    expect(work.items.map((i) => i.issuer).sort()).toEqual(['Dropbox', 'GitHub'])
    // ungrouped: Google + Amazon + Slack
    expect(result.ungrouped.map((i) => i.issuer).sort()).toEqual([
      'Amazon',
      'Google',
      'Slack',
    ])
  })

  it('does not duplicate items within the import itself', () => {
    const data = makeData()
    const incoming = JSON.parse(JSON.stringify(data)) as TotpData
    // import a copy of current data → all skipped
    const { added, skipped } = mergeData(data, incoming)
    expect(added).toBe(0)
    expect(skipped).toBe(countItems(data))
  })

  it('newly added items are counted in de-dup of subsequent items', () => {
    const current = { groups: [], ungrouped: [] }
    const incoming: TotpData = {
      groups: [],
      ungrouped: [
        { id: 'a', issuer: 'X', label: '', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
        { id: 'b', issuer: 'x', label: '', secret: 'jbswy3 dpehpk3pxp', algorithm: 'SHA1', digits: 6, period: 30 },
      ],
    }
    const { added, skipped } = mergeData(current, incoming)
    expect(added).toBe(1)
    expect(skipped).toBe(1)
  })
})

describe('overwriteData', () => {
  it('replaces data and collapses groups', () => {
    const incoming = makeIncoming()
    incoming.groups[0].isExpanded = true
    const result = overwriteData(incoming)
    expect(result.groups[0].isExpanded).toBe(false)
    expect(result.ungrouped.length).toBe(1)
    expect(result.groups).toHaveLength(2)
  })
})