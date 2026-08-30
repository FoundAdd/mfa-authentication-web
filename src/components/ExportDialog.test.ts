import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ElementPlus from 'element-plus'
import localforage from 'localforage'
import ExportDialog from './ExportDialog.vue'
import { useTotpStore } from '@/stores/totp'
import zhCN from '@/locales/zh-CN'
import type { TotpItem } from '@/types'

function item(issuer: string, label: string, secret: string): Omit<TotpItem, 'id'> {
  return {
    issuer,
    label,
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }
}

const SECRETS = [
  'JBSWY3DPEHPK3PXP',
  'KRSXG5CTMVRXEZLU',
  'MFRGGZDFMZTWQ2LK',
  'MZXW6YTBOI======',
  'GEZDGNBVGY3TQOJQ',
  'JBSWY3DPK5XXE5DE',
  'KRSXG5CTMVRXEZLU',
]

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en: zhCN },
})

let wrapper: VueWrapper | null = null

// 弹窗内容通过 append-to-body 挂到 document.body,需从 body 上查询
function bodyButton(text: string): HTMLButtonElement | null {
  return (
    Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  )
}

function bodyEl<T extends Element = Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector)
}

async function mountDialog(): Promise<VueWrapper> {
  wrapper = mount(ExportDialog, {
    props: { modelValue: true },
    global: { plugins: [i18n, ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

async function switchToQrMode(w: VueWrapper) {
  w.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'qr')
  await nextTick()
}

beforeEach(async () => {
  await localforage.clear()
  localStorage.removeItem('_dk')
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ExportDialog 二维码导出', () => {
  it('默认为文件导出模式', async () => {
    const store = useTotpStore()
    store.addItem(null, item('GitHub', 'a', SECRETS[0]))
    await store.saveNow()

    await mountDialog()

    expect(bodyButton('导出')).not.toBeNull()
    expect(bodyButton('生成二维码')).toBeNull()
  })

  it('按每页 6 个账号分页展示二维码,并支持前后翻页', async () => {
    const store = useTotpStore()
    const group = store.addGroup('工作')
    for (let i = 0; i < 6; i++) {
      store.addItem(group.id, item(`Svc${i}`, 'a', SECRETS[i]))
    }
    store.addItem(null, item('Solo', 'b', SECRETS[6]))
    await store.saveNow()

    const w = await mountDialog()
    await switchToQrMode(w)

    const generate = bodyButton('生成二维码')
    expect(generate).not.toBeNull()
    generate!.click()
    await flushPromises()

    // 7 个账号 → 2 页(6 + 1)
    expect(bodyEl('.qr-page')?.textContent).toContain('第 1 / 2 页')
    expect(bodyEl('.qr-box svg')).not.toBeNull()
    // 第一页时"上一页"禁用
    expect(bodyButton('上一页')?.hasAttribute('disabled')).toBe(true)

    bodyButton('下一页')!.click()
    await flushPromises()
    expect(bodyEl('.qr-page')?.textContent).toContain('第 2 / 2 页')
    expect(bodyButton('下一页')?.hasAttribute('disabled')).toBe(true)

    bodyButton('上一页')!.click()
    await flushPromises()
    expect(bodyEl('.qr-page')?.textContent).toContain('第 1 / 2 页')
  })

  it('展示阶段可返回配置阶段', async () => {
    const store = useTotpStore()
    store.addItem(null, item('GitHub', 'a', SECRETS[0]))
    await store.saveNow()

    const w = await mountDialog()
    await switchToQrMode(w)
    bodyButton('生成二维码')!.click()
    await flushPromises()

    bodyButton('返回')!.click()
    await nextTick()

    expect(bodyButton('生成二维码')).not.toBeNull()
  })

  it('存在周期/位数超出迁移格式的密钥时展示提示', async () => {
    const store = useTotpStore()
    store.addItem(null, item('GitHub', 'a', SECRETS[0]))
    const odd = store.addItem(null, item('Odd', 'b', SECRETS[1]))
    store.updateItem(odd.id, { period: 60 })
    await store.saveNow()

    const w = await mountDialog()
    await switchToQrMode(w)

    const warnings = Array.from(
      document.body.querySelectorAll('.warning-box'),
    ).map((node) => node.textContent ?? '')
    expect(warnings.some((text) => text.includes('1 条密钥'))).toBe(true)
  })
})
