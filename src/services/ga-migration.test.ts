import { describe, expect, it } from 'vitest'
import rawFixture from './fixtures/ga-migration.txt?raw'
import {
  parseGaMigration,
  parseGaMigrationChunk,
  GaBatchCollector,
  GaMigrationError,
  setPendingMigrationAccounts,
  takePendingMigrationAccounts,
} from './ga-migration'

const fixture = rawFixture.trim()

const CHUNK0_URL =
  'otpauth-migration://offline?data=Ci4KCkhlbGxvId6tvu8SEm9jdG9jYXRAZ2l0aHViLmNvbRoGR2l0SHViIAEoATACEAIYAiivwtKIAg'
const CHUNK1_URL =
  'otpauth-migration://offline?data=CigKClRlc3RTZWNyZXQSDG1lQGdtYWlsLmNvbRoGR29vZ2xlIAIoAjACEAIYAiABKK%2FC0ogC'
const SINGLE_URL =
  'otpauth-migration://offline?data=Ci4KCkhlbGxvId6tvu8SEm9jdG9jYXRAZ2l0aHViLmNvbRoGR2l0SHViIAEoATACEAIYAQ'
const OTHER_URL =
  'otpauth-migration://offline?data=CiIKCkhlbGxvId6tvu8SB3hAeS5jb20aBU90aGVyIAEoATACEAIYAiiJBg'
const NO_ISSUER_URL =
  'otpauth-migration://offline?data=ChkKCmFiY2RlZmdoaWoSBWFsaWNlIAEoATAC'
const RENAMED_COLON_URL =
  'otpauth-migration://offline?data=CiAKCkFBQUFBQUFBQUESDklzc3VlcjI6TGFiZWwyIAEoAQ%3D%3D'

describe('parseGaMigration', () => {
  it('parses the official-format fixture with SHA1/SHA256/SHA512 and 6/8 digits', () => {
    const accounts = parseGaMigration(fixture)
    expect(accounts).toHaveLength(4)

    const github = accounts[0]
    expect(github.algorithm).toBe('SHA1')
    expect(github.digits).toBe(6)
    expect(github.period).toBe(30)
    expect(github.issuer).toBe('GitHub')
    expect(github.label).toBe('octocat@github.com')
    expect(github.secret).toBe('JBSWY3DPEHPK3PXP')

    const google = accounts[1]
    expect(google.algorithm).toBe('SHA256')
    expect(google.digits).toBe(8)
    expect(google.issuer).toBe('Google')
    expect(google.label).toBe('me@gmail.com')
    expect(google.secret).toBe('KRSXG5CTMVRXEZLU')

    const aws = accounts[2]
    expect(aws.algorithm).toBe('SHA512')
    expect(aws.digits).toBe(6)
    expect(aws.period).toBe(30)

    const example = accounts[3]
    expect(example.issuer).toBe('Example')
    expect(example.digits).toBe(6)
  })

  it('handles standard base64 with + and / characters', () => {
    const accounts = parseGaMigration(fixture)
    expect(accounts.length).toBeGreaterThan(0)
  })

  it('throws unsupported for non-migration URI', () => {
    expect(() => parseGaMigration('otpauth://totp/I:L?secret=X')).toThrow(
      GaMigrationError,
    )
    expect(() => parseGaMigration('random text')).toThrow(GaMigrationError)
  })

  it('throws for missing data parameter', () => {
    expect(() =>
      parseGaMigration('otpauth-migration://offline?foo=bar'),
    ).toThrow(GaMigrationError)
  })

  it('throws for invalid base64 data', () => {
    expect(() =>
      parseGaMigration('otpauth-migration://offline?data=@@@@'),
    ).toThrow(GaMigrationError)
  })

  it('throws for no usable accounts', () => {
    // \x10\x02 => version=2 only, no otp_parameters
    expect(() =>
      parseGaMigration('otpauth-migration://offline?data=EAI='),
    ).toThrow(GaMigrationError)
  })

  it('throws for malformed protobuf (varint overrun)', () => {
    // many continuation bytes never terminate the varint
    expect(() =>
      parseGaMigration('otpauth-migration://offline?data=gICAgICAgICAgICAAA=='),
    ).toThrow(GaMigrationError)
  })
})

describe('parseGaMigrationChunk', () => {
  it('returns accounts and batch metadata for each chunk', () => {
    const chunk0 = parseGaMigrationChunk(CHUNK0_URL)
    expect(chunk0.version).toBe(2)
    expect(chunk0.batchSize).toBe(2)
    expect(chunk0.batchIndex).toBe(0)
    expect(chunk0.batchId).toBe(555000111)
    expect(chunk0.accounts).toHaveLength(1)
    expect(chunk0.accounts[0].issuer).toBe('GitHub')
    expect(chunk0.accounts[0].label).toBe('octocat@github.com')

    const chunk1 = parseGaMigrationChunk(CHUNK1_URL)
    expect(chunk1.batchSize).toBe(2)
    expect(chunk1.batchIndex).toBe(1)
    expect(chunk1.batchId).toBe(555000111)
    expect(chunk1.accounts).toHaveLength(1)
    expect(chunk1.accounts[0].issuer).toBe('Google')
    expect(chunk1.accounts[0].algorithm).toBe('SHA256')
    expect(chunk1.accounts[0].digits).toBe(8)
  })

  it('defaults to single-chunk metadata when fields are absent', () => {
    const single = parseGaMigrationChunk(SINGLE_URL)
    expect(single.batchSize).toBe(1)
    expect(single.batchIndex).toBe(0)
    expect(single.accounts).toHaveLength(1)
  })

  it('maps DigitCount enum values and falls back to name as issuer', () => {
    const accounts = parseGaMigration(NO_ISSUER_URL)
    expect(accounts[0].digits).toBe(6)
    // GA 中重命名过的条目只有 name 没有 issuer,名称直接作为服务名展示
    expect(accounts[0].issuer).toBe('alice')
    expect(accounts[0].label).toBe('')
  })

  it('splits a renamed "Issuer:Label" name when issuer field is absent', () => {
    const accounts = parseGaMigration(RENAMED_COLON_URL)
    expect(accounts[0].issuer).toBe('Issuer2')
    expect(accounts[0].label).toBe('Label2')
  })
})

describe('GaBatchCollector', () => {
  it('is incomplete until all chunk indices are collected', () => {
    const collector = new GaBatchCollector()
    const first = collector.add(parseGaMigrationChunk(CHUNK0_URL))
    expect(first.complete).toBe(false)
    expect(first.collected).toBe(1)
    expect(first.total).toBe(2)
    expect(first.accounts).toBeNull()
  })

  it('merges chunks in batch_index order when complete', () => {
    const collector = new GaBatchCollector()
    collector.add(parseGaMigrationChunk(CHUNK1_URL))
    const result = collector.add(parseGaMigrationChunk(CHUNK0_URL))
    expect(result.complete).toBe(true)
    expect(result.collected).toBe(2)
    expect(result.total).toBe(2)
    expect(result.accounts).toHaveLength(2)
    // 按 batchIndex 升序合并:index0(GitHub) 在前
    expect(result.accounts![0].issuer).toBe('GitHub')
    expect(result.accounts![1].issuer).toBe('Google')
  })

  it('restarts collection when a different batch_id is scanned', () => {
    const collector = new GaBatchCollector()
    collector.add(parseGaMigrationChunk(CHUNK0_URL))
    const other = collector.add(parseGaMigrationChunk(OTHER_URL))
    // OTHER_URL 属于 batchId=777 的另一批,视为新一轮收集
    expect(other.complete).toBe(false)
    expect(other.collected).toBe(1)
    expect(other.total).toBe(2)
  })
})

describe('pending migration accounts', () => {
  it('round-trips a buffered account list', () => {
    expect(takePendingMigrationAccounts()).toBeNull()
    const accounts = parseGaMigrationChunk(CHUNK0_URL).accounts
    setPendingMigrationAccounts(accounts)
    const taken = takePendingMigrationAccounts()
    expect(taken).toEqual(accounts)
    // 取后清空
    expect(takePendingMigrationAccounts()).toBeNull()
  })
})
