export const BACKUP_FLAG_KEY = '_backup_reminded'

export function hasShownBackupNotice(): boolean {
  return localStorage.getItem(BACKUP_FLAG_KEY) === '1'
}

export function markBackupNoticeShown() {
  localStorage.setItem(BACKUP_FLAG_KEY, '1')
}