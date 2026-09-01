import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Filesystem, Directory } from '@capacitor/filesystem'

/**
 * 应用内更新检测(仅原生环境使用):
 * - 查询 Release 仓库(GitHub / 自建 Gitea 兼容 API)的最新稳定版;
 * - 与安装包 versionName 对比,判断是否存在新版本;
 * - 下载 Release APK 到应用缓存目录,并调起系统安装器。
 * Release 仓库地址可在构建期通过 VITE_RELEASE_REPO_URL 覆盖(CI 会注入)。
 */
const DEFAULT_RELEASE_REPO_URL = 'https://git.singledog.dpdns.org/FoundWay/mfa-authentication-web'

const RELEASE_LIST_SIZE = 10
const FETCH_TIMEOUT_MS = 15_000

export interface LatestRelease {
  tagName: string
  name: string | null
  notes: string
  htmlUrl: string
  apkUrl: string | null
  apkName: string | null
}

interface RawReleaseAsset {
  name?: string
  browser_download_url?: string
}

export interface RawRelease {
  tag_name?: string
  name?: string | null
  body?: string | null
  html_url?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: RawReleaseAsset[]
}

interface AppUpdateInstallerPlugin {
  installApk(options: { path: string }): Promise<{ status?: string }>
}

const AppUpdateInstaller = registerPlugin<AppUpdateInstallerPlugin>('AppUpdateInstaller')

/** 解析版本号为 { 数值段, 预发布后缀 },"v1.0.0-beta.1" → [1,0,0] + "-beta.1" */
function parseVersion(input: string): { nums: number[]; suffix: string } {
  const cleaned = input.trim().replace(/^[vV]/, '')
  const parts = cleaned.split('.')
  const nums: number[] = []
  let suffix = ''
  for (let i = 0; i < 3; i++) {
    const part = parts[i] ?? ''
    const match = /^(\d+)(.*)$/.exec(part)
    if (match) {
      nums.push(Number(match[1]))
      if (!suffix && match[2]) suffix = match[2]
    } else {
      nums.push(0)
      if (!suffix && part) suffix = part
    }
  }
  return { nums, suffix }
}

/** 语义化版本比较:返回负数/0/正数;缺省段按 0 处理("1.0" 等价 "1.0.0") */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] - vb.nums[i]
  }
  // 数值段相同时预发布版本视为更小(1.0.0-beta < 1.0.0)
  if (va.suffix && !vb.suffix) return -1
  if (!va.suffix && vb.suffix) return 1
  if (va.suffix && vb.suffix) {
    return va.suffix < vb.suffix ? -1 : va.suffix > vb.suffix ? 1 : 0
  }
  return 0
}

/** candidate 是否比 current 更新 */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/**
 * 由 Release 仓库页面地址推导 releases 列表 API。
 * github.com 走 api.github.com,其余按 Gitea(自建 Git)的 /api/v1 处理;
 * 仅支持 https 下载,避免 APK 被明文劫持。无法解析时返回 null。
 */
export function resolveReleaseApiEndpoint(repoUrl: string): string | null {
  const trimmed = repoUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const repo = segments[1].replace(/\.git$/, '')
  if (url.host === 'github.com') {
    return `https://api.github.com/repos/${segments[0]}/${repo}/releases?per_page=${RELEASE_LIST_SIZE}`
  }
  return `${url.origin}/api/v1/repos/${segments[0]}/${repo}/releases?limit=${RELEASE_LIST_SIZE}`
}

function findApkAsset(assets: RawReleaseAsset[]): RawReleaseAsset | null {
  return (
    assets.find(
      (asset) =>
        typeof asset?.name === 'string' &&
        /\.apk$/i.test(asset.name) &&
        typeof asset?.browser_download_url === 'string' &&
        asset.browser_download_url !== '',
    ) ?? null
  )
}

/** 从 releases 列表中选出最新稳定版(跳过 draft / prerelease) */
export function pickLatestRelease(releases: RawRelease[]): LatestRelease | null {
  for (const release of releases) {
    if (release?.draft || release?.prerelease) continue
    const tagName = (release?.tag_name ?? '').trim()
    if (!tagName) continue
    const apk = findApkAsset(release?.assets ?? [])
    return {
      tagName,
      name: release?.name ?? null,
      notes: (release?.body ?? '').trim(),
      htmlUrl: release?.html_url ?? '',
      apkUrl: apk?.browser_download_url ?? null,
      apkName: apk?.name ?? null,
    }
  }
  return null
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLatestRelease(endpoint: string): Promise<LatestRelease | null> {
  const response = await fetchWithTimeout(endpoint)
  if (!response.ok) {
    throw new Error(`Release API responded with status ${response.status}`)
  }
  const data: unknown = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Unexpected release API response')
  }
  return pickLatestRelease(data as RawRelease[])
}

/** 当前安装包的 versionName;获取失败返回空串 */
export async function getInstalledVersion(): Promise<string> {
  try {
    const info = await App.getInfo()
    return (info.version ?? '').trim()
  } catch {
    return ''
  }
}

const RELEASE_REPO_URL = import.meta.env.VITE_RELEASE_REPO_URL || DEFAULT_RELEASE_REPO_URL

/**
 * 检查是否有可安装的新版本:存在更新且 Release 附带 APK 时返回更新信息,
 * 否则(已是最新 / 无 APK / 仓库不可达之外的配置问题)返回 null。
 * 仓库不可达、接口异常时抛出错误,由调用方决定是否静默。
 */
export async function checkForUpdate(): Promise<LatestRelease | null> {
  const endpoint = resolveReleaseApiEndpoint(RELEASE_REPO_URL)
  if (!endpoint) return null
  const [latest, current] = await Promise.all([
    fetchLatestRelease(endpoint),
    getInstalledVersion(),
  ])
  if (!latest || !latest.apkUrl) return null
  if (!isNewerVersion(latest.tagName, current)) return null
  return latest
}

/** 由 tag 生成缓存目录内的 APK 文件名 */
export function apkFileName(tagName: string): string {
  const safe = tagName.replace(/[^\w.-]/g, '_')
  return `update-${safe}.apk`
}

/** 下载 Release APK 到应用缓存目录,onProgress 回调下载百分比(0-100) */
export async function downloadReleaseApk(
  release: LatestRelease,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!release.apkUrl) throw new Error('Release has no APK asset')
  const listener = onProgress
    ? await Filesystem.addListener('progress', (status) => {
        if (status.contentLength > 0) {
          onProgress(Math.min(100, Math.round((status.bytes / status.contentLength) * 100)))
        }
      })
    : null
  try {
    await Filesystem.downloadFile({
      url: release.apkUrl,
      path: apkFileName(release.tagName),
      directory: Directory.Cache,
      progress: Boolean(onProgress),
    })
  } finally {
    await listener?.remove()
  }
}

/** 调起系统安装器安装已下载的 APK;需要用户授予"安装未知应用"权限时返回 'permission' */
export async function installDownloadedApk(
  release: LatestRelease,
): Promise<'started' | 'permission'> {
  const result = await AppUpdateInstaller.installApk({ path: apkFileName(release.tagName) })
  return result?.status === 'permission_required' ? 'permission' : 'started'
}
