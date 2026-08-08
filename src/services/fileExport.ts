import { isNativePlatform } from '@/utils/capacitor'
import { Share } from '@capacitor/share'
import { Filesystem, Directory } from '@capacitor/filesystem'

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * App 端通过 @capacitor/share 调起系统分享面板(零存储权限);
 * 原生插件不可用或分享失败时回退为 Blob 下载。
 */
export async function exportTextFile(
  filename: string,
  content: string,
): Promise<'shared' | 'downloaded'> {
  if (isNativePlatform()) {
    try {
      const file = await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Cache,
      })
      await Share.share({
        title: filename,
        files: [file.uri],
      })
      return 'shared'
    } catch {
      // fall through to download
    }
  }
  downloadTextFile(filename, content)
  return 'downloaded'
}
