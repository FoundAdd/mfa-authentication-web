import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import localforage from 'localforage'
import draggable from 'vuedraggable'
import HomeView from './HomeView.vue'
import ItemRow from '@/components/ItemRow.vue'
import GroupCard from '@/components/GroupCard.vue'
import BatchBar from '@/components/BatchBar.vue'
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
  // 取消未落地的防抖持久化,避免跨测试污染存储;
  // 先冲刷深度订阅的 watcher,确保 saveNow 能取到新排的定时器
  await nextTick()
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

  it('搜索时已折叠的分组与未分组卡片自动展开并仅显示命中条目', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(gA.id, item('GitLab', 'b', 'KRSXG5CTMVRXEZLU'))
    store.addItem(null, item('AWS', 'prod@example.com', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 折叠全部卡片:工作、未分组
    const headers = w.findAll('.group-card .group-header')
    expect(headers).toHaveLength(2)
    await headers[0].trigger('click')
    await nextTick()
    await w.findAll('.group-card .group-header')[1].trigger('click')
    await nextTick()
    expect(rowWrappers(w)).toHaveLength(0)

    // 搜索命中折叠分组内的条目 → 分组自动展开,仅显示命中项
    store.searchQuery = 'hub'
    await nextTick()
    expect(cardNames(w)).toEqual(['工作'])
    expect(rowIssuers(w)).toEqual(['GitHub'])

    // 搜索命中折叠未分组卡片内的条目 → 未分组自动展开
    store.searchQuery = 'prod'
    await nextTick()
    expect(cardNames(w)).toEqual(['未分组'])
    expect(rowIssuers(w)).toEqual(['AWS'])
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

describe('HomeView 拖拽排序', () => {
  function seedForDrag(store: ReturnType<typeof useTotpStore>) {
    const gA = store.addGroup('工作')
    const gB = store.addGroup('个人')
    const a1 = store.addItem(gA.id, item('A1', 'a1', 'JBSWY3DPEHPK3PXP'))
    const a2 = store.addItem(gA.id, item('A2', 'a2', 'KRSXG5CTMVRXEZLU'))
    const b1 = store.addItem(gB.id, item('B1', 'b1', 'MFRGGZDFMZTWQ2LK'))
    const u1 = store.addItem(null, item('U1', 'u1', 'MZXW6YTBOI======'))
    const u2 = store.addItem(null, item('U2', 'u2', 'GEZDGNBVGY3TQOJQ'))
    return { gA, gB, a1, a2, b1, u1, u2 }
  }

  /** 按卡片标题定位分组卡片("未分组"标题来自文案) */
  function findCard(w: VueWrapper, name: string) {
    const card = w
      .findAllComponents(GroupCard)
      .find((c) => c.props('name') === name)
    if (!card) throw new Error(`group card not found: ${name}`)
    return card
  }

  it('全部视图按卡片渲染,分组卡片带整卡拖拽把手', async () => {
    const store = useTotpStore()
    seedForDrag(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    expect(cardNames(w)).toEqual(['工作', '个人', '未分组'])
    expect(rowIssuers(w)).toEqual(['A1', 'A2', 'B1', 'U1', 'U2'])
    // 分组名由卡片标题承载;仅分组卡片有拖拽把手,未分组固定在最后
    expect(w.findAll('.group-grip')).toHaveLength(2)
  })

  it('整卡拖拽落地后持久化新的分组顺序', async () => {
    const store = useTotpStore()
    const { gA, gB } = seedForDrag(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 模拟 vuedraggable 落地:以新顺序回推 v-model
    const sort = w
      .findAllComponents(draggable)
      .find((d) => d.classes().includes('group-sort'))
    if (!sort) throw new Error('group-sort draggable not found')
    sort.vm.$emit('update:modelValue', [gB, gA])
    await nextTick()

    expect(store.data.groups.map((g) => g.id)).toEqual([gB.id, gA.id])
    expect(cardNames(w)).toEqual(['个人', '工作', '未分组'])
  })

  it('未分组卡片内拖拽重排:仅映射回未分组,分组条目不受影响', async () => {
    const store = useTotpStore()
    seedForDrag(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    // 模拟 Sortable 落地后的原地重排:U2 与 U1 对调
    const ungrouped = store.data.ungrouped
    ;[ungrouped[0], ungrouped[1]] = [ungrouped[1], ungrouped[0]]
    findCard(w, '未分组').vm.$emit('itemDragEnd')
    await nextTick()

    expect(store.data.ungrouped.map((i) => i.issuer)).toEqual(['U2', 'U1'])
    expect(store.data.groups[0].items.map((i) => i.issuer)).toEqual(['A1', 'A2'])
    expect(store.data.groups[1].items.map((i) => i.issuer)).toEqual(['B1'])
  })

  it('子集筛选下关闭整卡拖拽,卡片内重排仅影响所选分组', async () => {
    const store = useTotpStore()
    const { gA } = seedForDrag(store)
    await store.saveNow()

    const w = await mountHome()
    await nextTick()

    selectFilter(w, gA.id)
    await nextTick()

    // 部分筛选视图不渲染整卡排序容器,避免拖拽破坏分组全局顺序
    expect(w.find('.group-sort').exists()).toBe(false)
    expect(w.findAll('.group-grip')).toHaveLength(0)

    // 模拟 Sortable 在"工作"卡片内落地的原地重排:A2 与 A1 对调
    const items = store.data.groups[0].items
    ;[items[0], items[1]] = [items[1], items[0]]
    findCard(w, '工作').vm.$emit('itemDragEnd')
    await nextTick()

    expect(store.data.groups[0].items.map((i) => i.issuer)).toEqual(['A2', 'A1'])
    expect(store.data.groups[1].items.map((i) => i.issuer)).toEqual(['B1'])
    expect(store.data.ungrouped.map((i) => i.issuer)).toEqual(['U1', 'U2'])
  })
})

describe('HomeView 移动到分组弹窗', () => {
  function findButtonByText(
    root: VueWrapper | DOMWrapper<Element>,
    text: string,
  ): DOMWrapper<Element> {
    const button = body().findAll('button').find((b) => b.text() === text)
    expect(button, `button "${text}" not found`).toBeDefined()
    return button!
  }

  const body = () => new DOMWrapper(document.body)

  async function openMoveDialog(w: VueWrapper, rowIndex = 0) {
    rowWrappers(w)[rowIndex].vm.$emit('longpress')
    await nextTick()
    // 多选模式下底部 BatchBar 打开移动弹窗
    w.findComponent(BatchBar).vm.$emit('move')
    await nextTick()
  }

  it('移动弹窗提供"新增分组并移动"选项,确认后创建分组并移入', async () => {
    const store = useTotpStore()
    store.addGroup('已有分组')
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()
    await openMoveDialog(w)

    // 弹窗内除"未分组"目标外,末尾展示"新增分组并移动"
    const createEntry = body().find('.move-target.move-create')
    expect(createEntry.exists()).toBe(true)
    expect(createEntry.text()).toContain('新增分组并移动')

    createEntry.trigger('click')
    await nextTick()
    const input = body().find('.move-list input')
    expect(input.exists()).toBe(true)

    await input.setValue('新分组')
    await findButtonByText(body(), '创建并移入').trigger('click')
    await nextTick()

    // 新分组已创建,条目移入,多选模式退出
    expect(store.data.groups.map((g) => g.name)).toEqual(['已有分组', '新分组'])
    const created = store.data.groups.find((g) => g.name === '新分组')!
    expect(created.items.map((i) => i.issuer)).toEqual(['Apple'])
    expect(store.data.ungrouped).toHaveLength(0)
    expect(w.find('.batch-title').exists()).toBe(false)
  })

  it('输入重名分组(大小写不敏感)时直接移入已有分组,不重复创建', async () => {
    const store = useTotpStore()
    const gA = store.addGroup('工作')
    store.addItem(gA.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()
    await openMoveDialog(w, 1)

    body().find('.move-target.move-create').trigger('click')
    await nextTick()
    await body().find('.move-list input').setValue('工作')
    await findButtonByText(body(), '创建并移入').trigger('click')
    await nextTick()

    // 不产生重名分组,Apple 移入已有的"工作"分组
    expect(store.data.groups).toHaveLength(1)
    expect(store.data.groups[0].items.map((i) => i.issuer)).toEqual([
      'GitHub',
      'Apple',
    ])
    expect(store.data.ungrouped).toHaveLength(0)
  })

  it('未输入名称时确认按钮禁用,取消后停留在弹窗', async () => {
    const store = useTotpStore()
    store.addGroup('已有分组')
    store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))
    await store.saveNow()

    const w = await mountHome()
    await nextTick()
    await openMoveDialog(w)

    body().find('.move-target.move-create').trigger('click')
    await nextTick()

    const confirmBtn = body()
      .findAll('button')
      .find((b) => b.text() === '创建并移入')!
    expect((confirmBtn.element as HTMLButtonElement).disabled).toBe(true)

    await body().find('.move-list input').setValue('  ')
    expect(
      (
        body().findAll('button').find((b) => b.text() === '创建并移入')!
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    // 取消后回到目标列表,未创建分组
    await findButtonByText(body(), '取消').trigger('click')
    await nextTick()
    expect(body().find('.move-list input').exists()).toBe(false)
    expect(body().find('.move-target.move-create').exists()).toBe(true)
    expect(store.data.groups.map((g) => g.name)).toEqual(['已有分组'])
  })
})
