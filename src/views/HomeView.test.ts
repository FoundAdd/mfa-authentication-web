import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import localforage from 'localforage'
import HomeView from './HomeView.vue'
import ItemRow from '@/components/ItemRow.vue'
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

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en: zhCN },
})

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/scan', component: { template: '<div />' } },
    { path: '/add', component: { template: '<div />' } },
    { path: '/edit', component: { template: '<div />' } },
  ],
})

let wrapper: VueWrapper | null = null

// 挂载前必须先通过 saveNow() 把预置数据写入存储:
// 组件 onMounted 的 init() 会用存储内容覆盖 store,挂载后再预置会被水合覆盖
async function mountHome(): Promise<VueWrapper> {
  wrapper = mount(HomeView, {
    global: { plugins: [router, i18n, ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

function rowWrappers(w: VueWrapper) {
  return w.findAllComponents(ItemRow)
}

function rowIssuers(w: VueWrapper): string[] {
  return rowWrappers(w).map((row) => row.props('item').issuer)
}

function rowTags(w: VueWrapper): (string | undefined)[] {
  return rowWrappers(w).map((row) => row.props('groupTag'))
}

function selectFilter(w: VueWrapper, value: string) {
  w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', value)
}

beforeEach(async () => {
  await localforage.clear()
  localStorage.removeItem('_dk')
  // 跳过备份提醒弹窗,避免 ElMessageBox 干扰挂载断言
  localStorage.setItem('_backup_reminded', '1')
  setActivePinia(createPinia())
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  // 取消未落地的防抖持久化,避免跨测试污染存储
  await useTotpStore().saveNow()
})

describe('HomeView 分组列表', () => {
  it('默认展示全部:分组条目按分组顺序在前,未分组固定最后,且带分组名标注', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    expect(rowIssuers(w)).toEqual(['GitHub', 'Google', 'Apple'])
    expect(rowTags(w)).toEqual(['工作', '个人', '未分组'])
  })

  it('选择指定分组后仅展示该分组条目,不再重复展示分组标注', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()

    expect(rowIssuers(w)).toEqual(['GitHub'])
    expect(rowTags(w)).toEqual([undefined])
  })

  it('选择未分组后仅展示未分组条目', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, '__ungrouped__')
    await nextTick()

    expect(rowIssuers(w)).toEqual(['Apple'])
  })

  it('搜索跨分组匹配 issuer,保留分组名标注', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(gA.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    store.searchQuery = 'git'
    await nextTick()

    expect(rowIssuers(w)).toEqual(['GitHub'])
    expect(rowTags(w)).toEqual(['工作'])
  })

  it('搜索命中分组名时展示该分组全部条目', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    store.searchQuery = '工作'
    await nextTick()

    expect(rowIssuers(w)).toEqual(['GitHub'])
    expect(rowTags(w)).toEqual(['工作'])
  })

  it('空分组展示占位提示', async () => {
    const store = useTotpStore()
    store.addGroup('空分组')
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, store.data.groups[0].id)
    await nextTick()

    expect(rowWrappers(w)).toHaveLength(0)
    expect(w.find('.empty-hint').text()).toBe('该分组暂无条目')
  })

  it('删除当前筛选的分组后自动回退到全部视图', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()
    expect(rowIssuers(w)).toEqual(['GitHub'])

    store.removeGroup(gA.id, true)
    await nextTick()

    expect(rowIssuers(w)).toEqual(['Apple'])
  })

  it('上移分组会调整全部视图中的分组顺序', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    store.moveGroup(gB.id, -1)
    await nextTick()

    expect(rowIssuers(w)).toEqual(['Google', 'GitHub'])
    expect(store.data.groups.map((g) => g.name)).toEqual(['个人', '工作'])
  })

  it('单分组视图下的行内菜单携带正确的分组上下文', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    const gitHub = store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const apple = store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()

    rowWrappers(w)[0].vm.$emit('menu', 'edit')
    await flushPromises()

    // 编辑动作应携带所选行的密钥 id
    expect(router.currentRoute.value.path).toBe('/edit')
    expect(router.currentRoute.value.query.id).toBe(gitHub.id)
    expect(store.findItem(apple.id)).not.toBeNull()
  })
})
