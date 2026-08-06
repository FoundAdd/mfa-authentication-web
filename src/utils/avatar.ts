const PALETTE = [
  '#3498db',
  '#e74c3c',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#34495e',
  '#16a085',
  '#c0392b',
  '#8e44ad',
  '#2980b9',
]

export function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash
}

export function avatarColor(issuer: string): string {
  const source = issuer.trim() || '?'
  return PALETTE[hashString(source) % PALETTE.length]
}

export function avatarInitial(issuer: string): string {
  const trimmed = issuer.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}