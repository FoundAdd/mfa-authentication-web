import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn(async () => ({
      name: 'MFA Authenticator',
      id: 'cn.hy.mfaauthenticator',
      build: '10000',
      version: '1.0.0',
    })),
  },
}))

import {
  apkFileName,
  checkForUpdate,
  compareVersions,
  fetchLatestRelease,
  isNewerVersion,
  pickLatestRelease,
  resolveReleaseApiEndpoint,
} from './appUpdate'
import { App } from '@capacitor/app'
import type { LatestRelease, RawRelease } from './appUpdate'

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

describe('compareVersions', () => {
  it('按数值逐段比较', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0)
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('容忍 v 前缀与缺失段', () => {
    expect(compareVersions('v1.0.0', '1.0')).toBe(0)
    expect(compareVersions('V1.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.1.0', '1.0.0')).toBeGreaterThan(0)
  })

  it('预发布版本小于同版本号正式版', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })
})

describe('isNewerVersion', () => {
  it('仅当候选版本严格更新时为 true', () => {
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('v1.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('v0.9.9', '1.0.0')).toBe(false)
  })
})

describe('resolveReleaseApiEndpoint', () => {
  it('GitHub 仓库走 api.github.com', () => {
    expect(resolveReleaseApiEndpoint('https://github.com/foo/bar')).toBe(
      'https://api.github.com/repos/foo/bar/releases?per_page=10',
    )
  })

  it('自建 Git(Gitea)走 /api/v1,并容忍尾斜杠与 .git 后缀', () => {
    expect(
      resolveReleaseApiEndpoint('https://git.example.com/foo/bar.git/'),
    ).toBe('https://git.example.com/api/v1/repos/foo/bar/releases?limit=10')
  })

  it('非法输入返回 null', () => {
    expect(resolveReleaseApiEndpoint('')).toBeNull()
    expect(resolveReleaseApiEndpoint('not a url')).toBeNull()
    expect(resolveReleaseApiEndpoint('http://git.example.com/foo/bar')).toBeNull()
    expect(resolveReleaseApiEndpoint('https://git.example.com/foo')).toBeNull()
  })
})

describe('pickLatestRelease', () => {
  const apkAsset = {
    name: 'mfa-authenticator-v1.1.0.apk',
    browser_download_url: 'https://git.example.com/foo/bar/releases/download/v1.1.0/app.apk',
  }

  it('跳过 draft 与 prerelease,取第一个稳定版', () => {
    const releases: RawRelease[] = [
      { tag_name: 'v1.2.0', prerelease: true, assets: [apkAsset] },
      { tag_name: 'v1.1.5', draft: true, assets: [apkAsset] },
      { tag_name: 'v1.1.0', assets: [apkAsset] },
    ]
    const latest = pickLatestRelease(releases)
    expect(latest?.tagName).toBe('v1.1.0')
    expect(latest?.apkUrl).toBe(apkAsset.browser_download_url)
  })

  it('大小写不敏感地匹配 APK 资产并忽略其它资产', () => {
    const latest = pickLatestRelease([
      {
        tag_name: 'v1.1.0',
        name: 'Release 1.1.0',
        body: '## 功能更新\n- feat(x): y',
        html_url: 'https://git.example.com/foo/bar/releases/tag/v1.1.0',
        assets: [
          { name: 'web.zip', browser_download_url: 'https://git.example.com/web.zip' },
          { name: 'APP.PACKAGE.APK', browser_download_url: 'https://git.example.com/app.apk' },
        ],
      },
    ])
    expect(latest).toEqual({
      tagName: 'v1.1.0',
      name: 'Release 1.1.0',
      notes: '## 功能更新\n- feat(x): y',
      htmlUrl: 'https://git.example.com/foo/bar/releases/tag/v1.1.0',
      apkUrl: 'https://git.example.com/app.apk',
      apkName: 'APP.PACKAGE.APK',
    } satisfies LatestRelease)
  })

  it('无 APK 资产或无有效 tag 时返回 null', () => {
    expect(pickLatestRelease([{ tag_name: 'v1.1.0', assets: [] }])?.apkUrl).toBeNull()
    expect(pickLatestRelease([{ assets: [] }])).toBeNull()
    expect(pickLatestRelease([])).toBeNull()
  })
})

describe('fetchLatestRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('解析 Gitea 风格的 releases 列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([{ tag_name: 'v1.1.0', body: 'notes', assets: [{}] }]),
      ),
    )
    const latest = await fetchLatestRelease('https://git.example.com/api/v1/repos/foo/bar/releases?limit=10')
    expect(latest?.tagName).toBe('v1.1.0')
  })

  it('非 2xx 响应抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'nope' }, 404)))
    await expect(
      fetchLatestRelease('https://git.example.com/api/v1/repos/foo/bar/releases'),
    ).rejects.toThrow('404')
  })

  it('非数组响应抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ tag_name: 'v1' })))
    await expect(
      fetchLatestRelease('https://git.example.com/api/v1/repos/foo/bar/releases'),
    ).rejects.toThrow()
  })
})

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.mocked(App.getInfo).mockResolvedValue({
      name: 'MFA Authenticator',
      id: 'cn.hy.mfaauthenticator',
      build: '10000',
      version: '1.0.0',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('发现带 APK 的新版本时返回更新信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          {
            tag_name: 'v1.2.0',
            body: '## 功能更新\n- feat(update): 应用内更新',
            assets: [
              {
                name: 'mfa-authenticator-v1.2.0.apk',
                browser_download_url: 'https://git.example.com/app.apk',
              },
            ],
          },
        ]),
      ),
    )
    const release = await checkForUpdate()
    expect(release?.tagName).toBe('v1.2.0')
    expect(release?.apkUrl).toBe('https://git.example.com/app.apk')
  })

  it('已是最新版本时返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([{ tag_name: 'v1.0.0', assets: [{}] }])),
    )
    await expect(checkForUpdate()).resolves.toBeNull()
  })

  it('Release 未附带 APK 时返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([{ tag_name: 'v2.0.0', assets: [] }])),
    )
    await expect(checkForUpdate()).resolves.toBeNull()
  })

  it('仓库不可达时抛出错误,由调用方决定是否静默', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)))
    await expect(checkForUpdate()).rejects.toThrow()
  })
})

describe('apkFileName', () => {
  it('由 tag 生成缓存文件名并过滤非法字符', () => {
    expect(apkFileName('v1.2.3')).toBe('update-v1.2.3.apk')
    expect(apkFileName('v1.2.3/beta x')).toBe('update-v1.2.3_beta_x.apk')
  })
})
