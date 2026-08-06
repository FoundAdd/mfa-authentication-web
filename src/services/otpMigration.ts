export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export interface ParsedOtpAccount {
  issuer: string
  label: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

export interface OtpMigrationPayload {
  version: number
  otpParameters: ParsedOtpAccount[]
  batchSize: number
}
