import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper, type DOMWrapper } from '@vue/test-utils'
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

/** 按显示顺序返回各卡片头部的标题(分组在前、未分组最后) */
function cardNames(w: VueWrapper): string[] {
  return w.findAll('.group-card .group-name').map((el) => el.text())
}

function selectFilters(w: VueWrapper, value: string[]) {
  w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', value)
}

function selectFilter(w: VueWrapper, value: string) {
  selectFilters(w, [value])
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

describe('HomeView 多选模式', () => {
  function batchCount(w: VueWrapper): number | null {
    const el = w.find('.batch-title')
    if (!el.exists()) return null
    const match = el.text().match(/(\d+)/)
    return match ? Number(match[1]) : null
  }

  function findButtonByText(w: VueWrapper, text: string): DOMWrapper<Element> {
    const button = w.findAll('button').find((b) => b.text() === text)
    expect(button, `button "${text}" not found`).toBeDefined()
    return button!
  }

  function seedFiveInOneGroup(store: ReturnType<typeof useTotpStore>) {
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('A', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(gA.id, item('B', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(gA.id, item('C', 'c', 'MFRGGZDFMZTWQ2LK'))
    store.addItem(gA.id, item('D', 'd', 'MZXW6YTBOI======'))
    store.addItem(null, item('E', 'e', 'GEZDGNBVGY3TQOJQ'))
    return gA
  }

  it('长按进入多选后,再次长按另一行可区间选择', async () => {
    const store = useTotpStore()
    seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    rowWrappers(w)[0].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(1)

    // 进入多选触发重渲染,列表由 draggable 渲染、实例会重建,需重新查询
    rowWrappers(w)[3].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(4)
  })

  it('区间选择支持从后往前(锚点在后,长按在前)', async () => {
    const store = useTotpStore()
    seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    rowWrappers(w)[4].vm.$emit('longpress')
    await nextTick()
    rowWrappers(w)[2].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(3)
  })

  it('全选按钮选中当前视图全部条目,再次点击取消并退出多选', async () => {
    const store = useTotpStore()
    seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    rowWrappers(w)[0].vm.$emit('longpress')
    await nextTick()

    findButtonByText(w, '全选').trigger('click')
    await nextTick()
    expect(batchCount(w)).toBe(5)

    findButtonByText(w, '全不选').trigger('click')
    await nextTick()
    expect(batchCount(w)).toBeNull()
  })

  it('切换分组筛选后全选仅作用于当前视图,且已选条目跨筛选保留', async () => {
    const store = useTotpStore()
    const gA = seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()
    expect(rowWrappers(w)).toHaveLength(4)

    rowWrappers(w)[0].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(1)

    findButtonByText(w, '全选').trigger('click')
    await nextTick()
    expect(batchCount(w)).toBe(4)

    // 切回全部视图:已选的 4 项保留,不会丢失
    selectFilter(w, '__all__')
    await nextTick()
    expect(batchCount(w)).toBe(4)
  })

  it('锚点不在当前视图时长按退化为单选', async () => {
    const store = useTotpStore()
    const gA = seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 在全部视图以最后一行(未分组)为锚点
    rowWrappers(w)[4].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(1)

    // 切到分组视图,锚点行不可见 → 长按仅单选该行
    selectFilter(w, gA.id)
    await nextTick()
    rowWrappers(w)[0].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(2)
  })

  it('点选行会更新区间锚点', async () => {
    const store = useTotpStore()
    seedFiveInOneGroup(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    rowWrappers(w)[0].vm.$emit('longpress')
    await nextTick()

    // 重渲染后实例重建,重新查询后再点选
    rowWrappers(w)[1].vm.$emit('toggle')
    await nextTick()
    expect(batchCount(w)).toBe(2)

    // 锚点已更新为 B,长按 E 时应选中 B..E 而非 A..E
    rowWrappers(w)[4].vm.$emit('longpress')
    await nextTick()
    expect(batchCount(w)).toBe(5)
  })
})

describe('HomeView 分组卡片列表', () => {
  it('默认展示全部:分组卡片在前、未分组卡片固定最后,行内不再有分组标注', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    expect(cardNames(w)).toEqual(['工作', '个人', '未分组'])
    expect(rowIssuers(w)).toEqual(['GitHub', 'Google', 'Apple'])
    // 密钥名称独占标题行,行内不再渲染分组名标签
    expect(w.find('.issuer .group-tag').exists()).toBe(false)
  })

  it('选择指定分组后仅展示该分组卡片', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()

    expect(cardNames(w)).toEqual(['工作'])
    expect(rowIssuers(w)).toEqual(['GitHub'])
  })

  it('选择未分组后仅展示未分组卡片', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, '__ungrouped__')
    await nextTick()

    expect(cardNames(w)).toEqual(['未分组'])
    expect(rowIssuers(w)).toEqual(['Apple'])
  })

  it('点击卡片头可折叠分组,再次点击展开', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    await w.findAll('.group-card .group-header')[0].trigger('click')
    await nextTick()
    expect(store.data.groups[0].isExpanded).toBe(false)
    // 工作组折叠后仅剩未分组卡片中的 Apple
    expect(rowIssuers(w)).toEqual(['Apple'])

    await w.findAll('.group-card .group-header')[0].trigger('click')
    await nextTick()
    expect(store.data.groups[0].isExpanded).toBe(true)
    expect(rowIssuers(w)).toEqual(['GitHub', 'Apple'])
  })

  it('搜索跨分组匹配 issuer:命中分组自动展开,未分组命中排在最后', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 'e' 同时命中 Google(个人) 与 Apple(未分组)
    store.searchQuery = 'e'
    await nextTick()

    expect(cardNames(w)).toEqual(['个人', '未分组'])
    expect(rowIssuers(w)).toEqual(['Google', 'Apple'])
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

    expect(cardNames(w)).toEqual(['工作'])
    expect(rowIssuers(w)).toEqual(['GitHub'])
  })

  it('空分组卡片展示占位提示', async () => {
    const store = useTotpStore()
    store.addGroup('空分组')
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    expect(cardNames(w)).toEqual(['空分组', '未分组'])
    expect(w.find('.group-card .group-empty').text()).toBe('该分组暂无条目')
  })

  it('复选多个分组时展示所选分组卡片并集,顺序仍为分组在前、未分组最后', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilters(w, [gA.id, gB.id])
    await nextTick()

    expect(cardNames(w)).toEqual(['工作', '个人'])
    expect(rowIssuers(w)).toEqual(['GitHub', 'Google'])

    // 分组与未分组混选,顺序仍为分组在前、未分组最后
    selectFilters(w, [gB.id, '__ungrouped__'])
    await nextTick()

    expect(cardNames(w)).toEqual(['个人', '未分组'])
    expect(rowIssuers(w)).toEqual(['Google', 'Apple'])
  })

  it('"全部"与具体分组互斥:新勾选全部替换原选择,在全部基础上勾选分组则移除全部', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const gB = store.addGroup('个人')
    store.addItem(gB.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 在"全部"基础上勾选具体分组 → "全部"被移除,仅剩该分组
    selectFilters(w, ['__all__', gA.id])
    await nextTick()
    expect(rowIssuers(w)).toEqual(['GitHub'])

    // 新勾选"全部" → 替换为仅"全部"
    selectFilters(w, ['__all__', gB.id])
    await nextTick()
    expect(rowIssuers(w)).toEqual(['GitHub', 'Google'])
    expect(cardNames(w)).toEqual(['工作', '个人'])
  })

  it('清空选择后回退到全部视图', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilters(w, [])
    await nextTick()

    expect(rowIssuers(w)).toEqual(['GitHub'])
    expect(cardNames(w)).toEqual(['工作'])
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

  it('分组卡片内的行内菜单携带正确的分组上下文', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    const gitHub = store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const apple = store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 工作组卡片内的 GitHub 行 → 编辑动作携带其密钥 id
    rowWrappers(w)[0].vm.$emit('menu', 'edit')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/edit')
    expect(router.currentRoute.value.query.id).toBe(gitHub.id)
    expect(store.findItem(apple.id)).not.toBeNull()
  })
})
