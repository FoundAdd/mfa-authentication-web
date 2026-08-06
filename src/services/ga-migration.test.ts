import { describe, expect, it } from 'vitest'
import rawFixture from './fixtures/ga-migration.txt?raw'
import { parseGaMigration, GaMigrationError } from './ga-migration'

const fixture = rawFixture.trim()

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
    expect(aws.period).toBe(60)

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