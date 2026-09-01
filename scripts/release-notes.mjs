import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

/**
 * 生成 Release 发布说明(release-notes.md):
 * 总结上一个 Release tag 与本次发布之间的提交记录,仅保留功能性更新
 * (conventional commits 的 feat / fix),作为 Release 的发布说明。
 *
 * CI 中在 checkout(需 fetch-depth: 0)之后执行:
 *   RELEASE_TAG=v1.2.3 node scripts/release-notes.mjs
 */

// 每个 section 最多列出的提交数,防止超大发布把说明刷爆
const MAX_PER_SECTION = 50
// 首次发布(无上一个 tag)时全量提交的上限
const MAX_TOTAL_COMMITS = 200

const FEAT_RE = /^feat(\([^)]*\))?!?:\s/
const FIX_RE = /^fix(\([^)]*\))?!?:\s/

const currentTag = (process.env.RELEASE_TAG ?? '').trim()

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

/** 上一个 Release 的 tag:按版本号倒序的第一个、且不是本次发布的 tag */
function findPreviousTag() {
  const tags = git([
    'for-each-ref',
    'refs/tags',
    '--sort=-v:refname',
    '--format=%(refname:short)',
  ])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return tags.find((tag) => tag !== currentTag) ?? ''
}

function commitSubjects(range) {
  const log = git(['log', '--no-merges', '--pretty=format:%s', range])
  return log
    .split('\n')
    .map((subject) => subject.trim())
    .filter(Boolean)
    .slice(0, MAX_TOTAL_COMMITS)
}

function formatSection(title, subjects) {
  if (subjects.length === 0) return []
  return [`## ${title}`, ...subjects.map((subject) => `- ${subject}`), '']
}

function buildNotes() {
  const previousTag = findPreviousTag()
  // 首次发布没有上一个 tag,则总结全部提交历史
  const subjects = commitSubjects(previousTag ? `${previousTag}..HEAD` : 'HEAD')
  const lines = [
    ...formatSection('功能更新', subjects.filter((s) => FEAT_RE.test(s)).slice(0, MAX_PER_SECTION)),
    ...formatSection('问题修复', subjects.filter((s) => FIX_RE.test(s)).slice(0, MAX_PER_SECTION)),
  ]
  if (lines.length === 0) {
    lines.push('本次发布不包含功能性变更。')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

let notes
try {
  notes = buildNotes()
} catch (error) {
  // 发布说明生成失败不应阻塞发版,写入兜底文案
  console.error('Failed to generate release notes:', error?.message ?? error)
  notes = '## 功能更新\n\n- (发布说明生成失败,请查看提交记录)\n'
}

writeFileSync('release-notes.md', notes)
console.log(`Release notes written to release-notes.md:\n${notes}`)
