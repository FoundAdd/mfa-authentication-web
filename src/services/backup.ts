import type { TotpData } from '@/types'
import { normalizeSecret } from './totp'
import { createId } from '@/utils/uuid'
import {
  parseEnvelope,
  decryptEnvelope,
  decodePlainEnvelope,
  buildEncryptedEnvelope,
  buildPlainEnvelope,
} from './crypto'

/**
 * 指纹:secret(去空格转大写)+ issuer(trim 转小写) 规范化组合,作为合并去重唯一键。
 */
export function fingerprint(secret: string, issuer: string): string {
  return `${normalizeSecret(secret)}|${issuer.trim().toLowerCase()}`
}

/**
 * 导出为信封 JSON 文本。password 为空 → 明文(base64 编码)信封;否则用户密码加密信封。
 */
export async function buildExport(
  data: TotpData,
  password: string,
): Promise<{ json: string }> {
  if (password) {
    const env = await buildEncryptedEnvelope(data, password)
    return { json: JSON.stringify(env) }
  }
  const env = buildPlainEnvelope(data)
  return { json: JSON.stringify(env) }
}

/**
 * 生成导出文件名 `totp-backup-YYYYMMDD-HHmm.totp`。
 */
export function exportFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const min = pad(date.getMinutes())
  return `totp-backup-${yyyy}${mm}${dd}-${hh}${min}.totp`
}

/**
 * 解析文件内容 → 信封 → (按需解密) → 校验为 TotpData。
 */
export async function readBackup(
  serialized: string,
  password: string,
): Promise<TotpData> {
  const envelope = parseEnvelope(serialized)
  if (envelope.encrypted) {
    return decryptEnvelope(envelope, password)
  }
  return decodePlainEnvelope(envelope)
}

/**
 * 仅检测信封是否加密,用于导入流程决定是否要求输入密码。
 */
export function inspectBackup(serialized: string): { encrypted: boolean } {
  const envelope = parseEnvelope(serialized)
  return { encrypted: envelope.encrypted }
}

export interface MergeResult {
  result: TotpData
  added: number
  skipped: number
}

/**
 * 合并导入去重:
 *  - 以 fingerprint 为唯一键,查重范围包括本地现有条目与本次已新增条目;
 *  - 重复项跳过;新增条目分组名与本地同名分组则并入,否则进入"未分组";
 *  - 导入的 isExpanded 一律置为 false(默认折叠),不参与导入。
 */
export function mergeData(current: TotpData, incoming: TotpData): MergeResult {
  const result: TotpData = {
    groups: current.groups.map((g) => ({ ...g, items: [...g.items] })),
    ungrouped: [...current.ungrouped],
  }

  const seen = new Set<string>()
  const groupByName = new Map<string, string>()
  for (const g of result.groups) {
    groupByName.set(g.name, g.id)
    for (const item of g.items) seen.add(fingerprint(item.secret, item.issuer))
  }
  for (const item of result.ungrouped) seen.add(fingerprint(item.secret, item.issuer))

  let added = 0
  let skipped = 0

  const addItem = (item: TotpData['ungrouped'][number], groupId: string | null) => {
    const fp = fingerprint(item.secret, item.issuer)
    if (seen.has(fp)) {
      skipped++
      return
    }
    seen.add(fp)
    const full = toItem(item)
    if (groupId) {
      const group = result.groups.find((g) => g.id === groupId)
      if (group) group.items.push(full)
      else result.ungrouped.push(full)
    } else {
      result.ungrouped.push(full)
    }
    added++
  }

  for (const group of incoming.groups) {
    const targetId = groupByName.get(group.name) ?? null
    for (const item of group.items) {
      addItem(item, targetId)
    }
  }
  for (const item of incoming.ungrouped) {
    addItem(item, null)
  }

  return { result, added, skipped }
}

/**
 * 覆盖导入: 用导入数据整体替换现有数据,分组默认折叠。
 */
export function overwriteData(incoming: TotpData): TotpData {
  return {
    groups: incoming.groups.map((g) => ({ ...g, isExpanded: false, items: [...g.items] })),
    ungrouped: [...incoming.ungrouped],
  }
}

function toItem(item: TotpData['ungrouped'][number]): TotpData['ungrouped'][number] {
  const algorithm =
    item.algorithm === 'SHA256' || item.algorithm === 'SHA512'
      ? item.algorithm
      : 'SHA1'
  return {
    id: createId(),
    issuer: String(item.issuer ?? ''),
    label: String(item.label ?? ''),
    secret: String(item.secret ?? ''),
    algorithm: algorithm as 'SHA1' | 'SHA256' | 'SHA512',
    digits: Number(item.digits) || 6,
    period: Number(item.period) || 30,
  }
}