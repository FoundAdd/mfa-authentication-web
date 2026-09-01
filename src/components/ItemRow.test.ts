import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ElementPlus from 'element-plus'
import ItemRow from './ItemRow.vue'
import zhCN from '@/locales/zh-CN'
import type { TotpItem } from '@/types'

function makeItem(): TotpItem {
  return {
    id: 'item-1',
    issuer: 'GitHub',
    label: 'dev',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }
}

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en: zhCN },
})

let wrapper: VueWrapper | null = null

function mountRow() {
  wrapper = mount(ItemRow, {
    props: { item: makeItem(), batchMode: false, selected: false },
    global: { plugins: [i18n, ElementPlus] },
  })
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('ItemRow 长按手势', () => {
  it('按住行体达到阈值后触发 longpress', () => {
    const w = mountRow()
    w.find('.item-row').trigger('pointerdown')
    vi.advanceTimersByTime(500)
    expect(w.emitted('longpress')).toHaveLength(1)
    w.find('.item-row').trigger('pointerup')
  })

  it('未达到阈值抬起不触发 longpress', () => {
    const w = mountRow()
    w.find('.item-row').trigger('pointerdown')
    vi.advanceTimersByTime(499)
    w.find('.item-row').trigger('pointerup')
    vi.advanceTimersByTime(100)
    expect(w.emitted('longpress')).toBeUndefined()
  })

  it('按住拖动把手不触发 longpress,拖拽不被多选中断', () => {
    const w = mountRow()
    // 从把手的图标深处按下,模拟真实按压路径
    w.find('.drag-handle .el-icon').trigger('pointerdown')
    vi.advanceTimersByTime(500)
    expect(w.emitted('longpress')).toBeUndefined()
    // 长按阈值已过后再按下把手同样不启动计时
    w.find('.drag-handle .el-icon').trigger('pointerup')
    w.find('.drag-handle .el-icon').trigger('pointerdown')
    vi.advanceTimersByTime(500)
    expect(w.emitted('longpress')).toBeUndefined()
  })
})
