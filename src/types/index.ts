export interface TotpItem {
  id: string
  issuer: string
  label: string
  secret: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period: number
}

export interface TotpGroup {
  id: string
  name: string
  isExpanded: boolean
  items: TotpItem[]
}

export interface TotpData {
  groups: TotpGroup[]
  ungrouped: TotpItem[]
}