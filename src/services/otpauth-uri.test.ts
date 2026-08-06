import { describe, expect, it } from 'vitest'
import { parseOtpUri, buildOtpUri, OtpUriError } from './otpauth-uri'

const FULL_URI =
  'otpauth://totp/Google:alice%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google&algorithm=SHA1&digits=6&period=30'

describe('parseOtpUri', () => {
  it('parses a full URI with all params', () => {
    const result = parseOtpUri(FULL_URI)
    expect(result.issuer).toBe('Google')
    expect(result.label).toBe('alice@gmail.com')
    expect(result.secret).toBe('JBSWY3DPEHPK3PXP')
    expect(result.algorithm).toBe('SHA1')
    expect(result.digits).toBe(6)
    expect(result.period).toBe(30)
  })

  it('prefers issuer param over path issuer', () => {
    const uri =
      'otpauth://totp/Other:alice?secret=JBSWY3DPEHPK3PXP&issuer=ActualIssuer'
    const result = parseOtpUri(uri)
    expect(result.issuer).toBe('ActualIssuer')
  })

  it('handles label without colon (no path issuer)', () => {
    const uri = 'otpauth://totp/alice%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'
    const result = parseOtpUri(uri)
    expect(result.issuer).toBe('GitHub')
    expect(result.label).toBe('alice@gmail.com')
  })

  it('handles label without colon AND no issuer param', () => {
    const uri = 'otpauth://totp/alice%40gmail.com?secret=JBSWY3DPEHPK3PXP'
    const result = parseOtpUri(uri)
    expect(result.issuer).toBe('')
    expect(result.label).toBe('alice@gmail.com')
  })

  it('uses path issuer when no issuer param', () => {
    const uri = 'otpauth://totp/Google:alice?secret=JBSWY3DPEHPK3PXP'
    const result = parseOtpUri(uri)
    expect(result.issuer).toBe('Google')
    expect(result.label).toBe('alice')
  })

  it('defaults algorithm to SHA1 when missing', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP'
    const result = parseOtpUri(uri)
    expect(result.algorithm).toBe('SHA1')
  })

  it('accepts case-insensitive algorithm', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP&algorithm=sha256'
    const result = parseOtpUri(uri)
    expect(result.algorithm).toBe('SHA256')
  })

  it('accepts SHA-256 variant', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP&algorithm=sha-256'
    const result = parseOtpUri(uri)
    expect(result.algorithm).toBe('SHA256')
  })

  it('defaults digits to 6 when missing', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP'
    const result = parseOtpUri(uri)
    expect(result.digits).toBe(6)
  })

  it('defaults period to 30 when missing', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP'
    const result = parseOtpUri(uri)
    expect(result.period).toBe(30)
  })

  it('parses 8-digit and 60-second period', () => {
    const uri = 'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP&digits=8&period=60'
    const result = parseOtpUri(uri)
    expect(result.digits).toBe(8)
    expect(result.period).toBe(60)
  })

  it('throws for non-otpauth URI', () => {
    expect(() => parseOtpUri('not-a-uri')).toThrow(OtpUriError)
  })

  it('throws for unsupported protocol (otpauth://hotp/)', () => {
    const uri = 'otpauth://hotp/I:L?secret=JBSWY3DPEHPK3PXP'
    expect(() => parseOtpUri(uri)).toThrow(OtpUriError)
  })

  it('throws for missing secret', () => {
    const uri = 'otpauth://totp/I:L'
    expect(() => parseOtpUri(uri)).toThrow(OtpUriError)
  })

  it('ignores unknown params', () => {
    const uri =
      'otpauth://totp/I:L?secret=JBSWY3DPEHPK3PXP&unknown=1&foo=bar'
    const result = parseOtpUri(uri)
    expect(result.secret).toBe('JBSWY3DPEHPK3PXP')
  })

  it('normalizes secret (uppercases)', () => {
    const uri = 'otpauth://totp/I:L?secret=jbswy3dpehpk3pxp&issuer=I'
    const result = parseOtpUri(uri)
    expect(result.secret).toBe('JBSWY3DPEHPK3PXP')
  })
})

describe('buildOtpUri', () => {
  it('round-trips with parseOtpUri', () => {
    const input = {
      issuer: 'Google',
      label: 'alice@gmail.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1' as const,
      digits: 6,
      period: 30,
    }
    const uri = buildOtpUri(input)
    const parsed = parseOtpUri(uri)
    expect(parsed).toEqual(input)
  })

  it('handles empty label', () => {
    const input = {
      issuer: 'Google',
      label: '',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA256' as const,
      digits: 8,
      period: 60,
    }
    const uri = buildOtpUri(input)
    const parsed = parseOtpUri(uri)
    expect(parsed.issuer).toBe('Google')
    expect(parsed.label).toBe('')
    expect(parsed.algorithm).toBe('SHA256')
    expect(parsed.digits).toBe(8)
    expect(parsed.period).toBe(60)
  })
})