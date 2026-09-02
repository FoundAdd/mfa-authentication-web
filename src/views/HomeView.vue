<template>
  <div class="home">
    <div class="topbar">
      <template v-if="batchMode">
        <span class="batch-title">{{ t('common.selected', { count: selected.size }) }}</span>
        <span class="spacer" />
        <el-button text @click="toggleSelectAll">
          {{ allVisibleSelected ? t('common.unselectAll') : t('common.selectAll') }}
        </el-button>
        <el-button text @click="exitBatch">{{ t('common.cancel') }}</el-button>
      </template>
      <template v-else>
        <div class="app-name">{{ t('app.name') }}</div>
        <div class="search">
          <el-input
            v-model="totpStore.searchQuery"
            :placeholder="t('common.search')"
            clearable
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
        <el-button text circle @click="settingsVisible = true">
          <el-icon><Setting /></el-icon>
        </el-button>
      </template>
    </div>

    <div v-if="!batchMode && !isEmpty && !searchActive" class="toolbar">
      <el-button text type="primary" @click="router.push('/scan')">
        <el-icon><Camera /></el-icon>
        <span>{{ t('guide.scan') }}</span>
      </el-button>
      <el-button text @click="router.push('/add')">
        <el-icon><Plus /></el-icon>
        <span>{{ t('guide.manual') }}</span>
      </el-button>
      <el-button text @click="promptAddGroup">
        <el-icon><FolderAdd /></el-icon>
        <span>{{ t('group.addGroup') }}</span>
      </el-button>
    </div>

    <EmptyGuide v-if="isEmpty && !searchActive" />

    <div v-else-if="searchActive && visibleRows.length === 0" class="empty-state">
      <p>{{ t('empty.noMatch', { query: searchQuery }) }}</p>
    </div>

    <template v-else>
      <div class="filter-bar">
        <el-select
          :model-value="activeFilters"
          multiple
          collapse-tags
          collapse-tags-tooltip
          class="group-select"
          @update:model-value="onFiltersUpdate"
        >
          <el-option :value="ALL_FILTER" :label="t('group.all')" />
          <el-option :value="UNGROUPED_FILTER" :label="t('group.ungrouped')" />
          <el-option
            v-for="g in totpStore.data.groups"
            :key="g.id"
            :value="g.id"
            :label="g.name"
          />
        </el-select>
      </div>

      <div class="list">
        <!-- 分组卡片在前:仅"全部"视图支持按头部把手整卡拖拽排序 -->
        <draggable
          v-if="canReorderGroups"
          v-model="groupList"
          handle=".group-grip"
          :animation="200"
          item-key="id"
          class="group-sort"
          @end="persistGroupOrder"
        >
          <template #item="{ element }">
            <GroupCard
              :name="element.name"
              :items="element.items"
              :display-items="groupDisplayItems(element)"
              :expanded="searchActive || element.isExpanded"
              :show-menu="true"
              :can-reorder="true"
              :can-move-up="canMoveGroupUp(element.id)"
              :can-move-down="canMoveGroupDown(element.id)"
              :batch-mode="batchMode"
              :search-active="searchActive"
              :selected-ids="selected"
              @toggle="toggleGroup(element)"
              @rename="renameGroup(element)"
              @delete="openGroupDelete(element)"
              @up="totpStore.moveGroup(element.id, -1)"
              @down="totpStore.moveGroup(element.id, 1)"
              @item-toggle="onItemToggle"
              @item-long-press="onItemLongPress"
              @item-menu="(item, action) => onItemMenuAction(item, element.id, action)"
              @item-drag-end="onGroupItemsDragEnd(element)"
            />
          </template>
        </draggable>
        <template v-else>
          <GroupCard
            v-for="group in visibleGroups"
            :key="group.id"
            :name="group.name"
            :items="group.items"
            :display-items="groupDisplayItems(group)"
            :expanded="searchActive || group.isExpanded"
            :show-menu="true"
            :can-reorder="false"
            :can-move-up="canMoveGroupUp(group.id)"
            :can-move-down="canMoveGroupDown(group.id)"
            :batch-mode="batchMode"
            :search-active="searchActive"
            :selected-ids="selected"
            @toggle="toggleGroup(group)"
            @rename="renameGroup(group)"
            @delete="openGroupDelete(group)"
            @up="totpStore.moveGroup(group.id, -1)"
            @down="totpStore.moveGroup(group.id, 1)"
            @item-toggle="onItemToggle"
            @item-long-press="onItemLongPress"
            @item-menu="(item, action) => onItemMenuAction(item, group.id, action)"
            @item-drag-end="onGroupItemsDragEnd(group)"
          />
        </template>

        <!-- 未分组卡片固定在所有分组之后 -->
        <GroupCard
          v-if="showUngroupedCard"
          :name="t('group.ungrouped')"
          :items="totpStore.data.ungrouped"
          :display-items="visibleUngrouped"
          :expanded="searchActive || ungroupedExpanded"
          :show-menu="false"
          :batch-mode="batchMode"
          :search-active="searchActive"
          :selected-ids="selected"
          @toggle="ungroupedExpanded = !ungroupedExpanded"
          @item-toggle="onItemToggle"
          @item-long-press="onItemLongPress"
          @item-menu="(item, action) => onItemMenuAction(item, null, action)"
          @item-drag-end="onUngroupedDragEnd"
        />
      </div>
    </template>

    <BatchBar
      v-if="batchMode"
      @move="openMove"
      @delete="confirmBatchDelete"
      @cancel="exitBatch"
    />

    <ResponsiveDialog
      v-model="moveVisible"
      :title="t('group.moveToGroup')"
      @closed="onMoveClosed"
    >
      <div class="move-list">
        <div
          v-for="target in moveTargets"
          :key="target.id ?? 'ungrouped'"
          class="move-target"
          @click="confirmMove(target.id)"
        >
          {{ target.name }}
        </div>
      </div>
    </ResponsiveDialog>

    <ResponsiveDialog
      v-model="groupDeleteVisible"
      :title="t('group.deleteGroup')"
      @closed="groupDeleteTarget = null"
    >
      <p v-if="groupDeleteTarget" class="group-delete-msg">
        {{ t('group.deleteGroupConfirm', { name: groupDeleteTarget.name }) }}
      </p>
      <el-checkbox v-model="groupDeleteItems">
        {{ t('group.deleteGroupItems') }}
      </el-checkbox>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="groupDeleteVisible = false">
            {{ t('common.cancel') }}
          </el-button>
          <el-button type="danger" @click="confirmGroupDelete">
            {{ t('common.delete') }}
          </el-button>
        </div>
      </template>
    </ResponsiveDialog>

    <SettingsDialog v-model="settingsVisible" />

    <ResponsiveDialog
      v-model="corruptedVisible"
      :title="t('data.corrupted')"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <p class="dialog-msg">{{ t('data.corruptedDesc') }}</p>
      <template #footer>
        <div class="dialog-footer">
          <el-button type="danger" @click="resetCorrupted">
            {{ t('data.reset') }}
          </el-button>
        </div>
      </template>
    </ResponsiveDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import draggable from 'vuedraggable'
import {
  Camera,
  FolderAdd,
  Plus,
  Search,
  Setting,
} from '@element-plus/icons-vue'
import { useTotpStore, type ItemRef } from '@/stores/totp'
import type { TotpGroup, TotpItem } from '@/types'
import GroupCard from '@/components/GroupCard.vue'
import EmptyGuide from '@/components/EmptyGuide.vue'
import BatchBar from '@/components/BatchBar.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import ResponsiveDialog from '@/components/ResponsiveDialog.vue'

const ALL_FILTER = '__all__'
const UNGROUPED_FILTER = '__ungrouped__'

const router = useRouter()
const { t } = useI18n()
const totpStore = useTotpStore()

const batchMode = ref(false)
const selected = ref<Set<string>>(new Set())
const settingsVisible = ref(false)
// 列表分组筛选(下拉复选):'__all__'(全部,与其他选项互斥) /
// '__ungrouped__'(未分组) / 分组 id,可同时勾选多个
const activeFilters = ref<string[]>([ALL_FILTER])
// 未分组卡片无持久化的 isExpanded 字段,折叠状态仅页面内记忆
const ungroupedExpanded = ref(true)

const moveVisible = ref(false)
const groupDeleteVisible = ref(false)
const groupDeleteTarget = ref<TotpGroup | null>(null)
const groupDeleteItems = ref(false)
const corruptedVisible = ref(false)

const searchQuery = computed(() => totpStore.searchQuery.trim().toLowerCase())
const searchActive = computed(() => searchQuery.value.length > 0)

const itemCount = computed(
  () =>
    totpStore.data.ungrouped.length +
    totpStore.data.groups.reduce((sum, g) => sum + g.items.length, 0),
)
const isEmpty = computed(
  () =>
    totpStore.data.groups.length === 0 &&
    totpStore.data.ungrouped.length === 0,
)

function itemMatches(item: TotpItem): boolean {
  const q = searchQuery.value
  if (!q) return true
  return (
    item.issuer.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
  )
}

/**
 * 归一化多选结果:
 *  - 清空 → 回退到"全部";
 *  - 新勾选"全部" → 只保留"全部";
 *  - 在"全部"基础上勾选具体分组 → 移除"全部"。
 */
function normalizeFilters(next: string[], prev: string[]): string[] {
  if (next.length === 0) return [ALL_FILTER]
  const hadAll = prev.includes(ALL_FILTER)
  const hasAll = next.includes(ALL_FILTER)
  if (hasAll && !hadAll) return [ALL_FILTER]
  if (hasAll && hadAll && next.length > 1) {
    return next.filter((v) => v !== ALL_FILTER)
  }
  return next
}

function onFiltersUpdate(value: unknown) {
  const next = Array.isArray(value) ? value.map(String) : [String(value)]
  activeFilters.value = normalizeFilters(next, activeFilters.value)
}

// 可见的分组卡片:搜索时仅保留组名命中或含命中条目的分组;
// 筛选时展示所选分组并集;顺序始终沿用分组的存储顺序
const visibleGroups = computed<TotpGroup[]>(() => {
  const q = searchQuery.value
  if (q) {
    return totpStore.data.groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || g.items.some(itemMatches),
    )
  }
  if (activeFilters.value.includes(ALL_FILTER)) return totpStore.data.groups
  const picked = new Set(activeFilters.value)
  return totpStore.data.groups.filter((g) => picked.has(g.id))
})

// 卡片体内实际渲染的条目:搜索时组名命中展示整组,否则仅展示命中条目
function groupDisplayItems(group: TotpGroup): TotpItem[] {
  const q = searchQuery.value
  if (!q || group.name.toLowerCase().includes(q)) return group.items
  return group.items.filter(itemMatches)
}

const visibleUngrouped = computed<TotpItem[]>(() => {
  const q = searchQuery.value
  if (q) return totpStore.data.ungrouped.filter(itemMatches)
  if (activeFilters.value.includes(ALL_FILTER)) {
    return totpStore.data.ungrouped
  }
  return activeFilters.value.includes(UNGROUPED_FILTER)
    ? totpStore.data.ungrouped
    : []
})

const showUngroupedCard = computed(() => {
  if (visibleUngrouped.value.length > 0) return true
  // 明确筛选"未分组"时保留空卡片,给出占位提示
  return !searchActive.value && activeFilters.value.includes(UNGROUPED_FILTER)
})

// 扁平行集合(分组在前、未分组最后),供多选区间/全选按可见顺序计算
const visibleRows = computed<TotpItem[]>(() => {
  const rows: TotpItem[] = []
  for (const group of visibleGroups.value) {
    rows.push(...groupDisplayItems(group))
  }
  rows.push(...visibleUngrouped.value)
  return rows
})

// 仅"全部"视图(所有分组可见)允许整卡拖拽排序,
// 部分筛选下拖拽会破坏分组间的全局顺序
const canReorderGroups = computed(
  () =>
    !batchMode.value &&
    !searchActive.value &&
    activeFilters.value.includes(ALL_FILTER),
)

const groupList = computed<TotpGroup[]>({
  get: () => totpStore.data.groups,
  set: (groups) => totpStore.reorderGroups(groups.map((g) => g.id)),
})

// 当前筛选的分组被删除(或被导入覆盖)时剔除失效选项,避免停留在失效筛选上
watch(
  () => totpStore.data.groups.map((g) => g.id),
  (ids) => {
    const valid = activeFilters.value.filter(
      (v) => v === ALL_FILTER || v === UNGROUPED_FILTER || ids.includes(v),
    )
    if (valid.length !== activeFilters.value.length) {
      activeFilters.value = valid.length > 0 ? valid : [ALL_FILTER]
    }
  },
)

function toggleGroup(group: TotpGroup) {
  if (searchActive.value || batchMode.value) return
  group.isExpanded = !group.isExpanded
}

function groupIndex(id: string): number {
  return totpStore.data.groups.findIndex((g) => g.id === id)
}

function canMoveGroupUp(id: string): boolean {
  return groupIndex(id) > 0
}

function canMoveGroupDown(id: string): boolean {
  const idx = groupIndex(id)
  return idx !== -1 && idx < totpStore.data.groups.length - 1
}

// ---- batch ----
function buildItemRefs(ids: Set<string>): ItemRef[] {
  const refs: ItemRef[] = []
  for (const group of totpStore.data.groups) {
    for (const item of group.items) {
      if (ids.has(item.id)) refs.push({ groupId: group.id, itemId: item.id })
    }
  }
  for (const item of totpStore.data.ungrouped) {
    if (ids.has(item.id)) refs.push({ groupId: null, itemId: item.id })
  }
  return refs
}

// 区间选择锚点:进入多选/最近一次点选的行
const anchorId = ref<string | null>(null)

function onItemLongPress(item: TotpItem) {
  if (!batchMode.value) {
    batchMode.value = true
    selected.value = new Set([item.id])
    anchorId.value = item.id
    return
  }
  // 已在多选模式:从锚点行到长按行做区间选择(按当前视图内的显示顺序)
  const ids = visibleRows.value.map((row) => row.id)
  const from = ids.indexOf(anchorId.value ?? '')
  const to = ids.indexOf(item.id)
  if (from === -1 || to === -1) {
    // 锚点不在当前视图(如切换过分组筛选),退化为单选该行
    selected.value.add(item.id)
    anchorId.value = item.id
    return
  }
  const [start, end] = from <= to ? [from, to] : [to, from]
  for (let i = start; i <= end; i++) selected.value.add(ids[i])
}

function onItemToggle(item: TotpItem) {
  anchorId.value = item.id
  if (selected.value.has(item.id)) {
    selected.value.delete(item.id)
    if (selected.value.size === 0) batchMode.value = false
  } else {
    selected.value.add(item.id)
  }
}

const allVisibleSelected = computed(
  () =>
    visibleRows.value.length > 0 &&
    visibleRows.value.every((row) => selected.value.has(row.id)),
)

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    for (const row of visibleRows.value) selected.value.delete(row.id)
    if (selected.value.size === 0) batchMode.value = false
  } else {
    for (const row of visibleRows.value) selected.value.add(row.id)
  }
}

function exitBatch() {
  batchMode.value = false
  selected.value = new Set()
  anchorId.value = null
}

function onItemMenuAction(
  item: TotpItem,
  groupId: string | null,
  action: 'edit' | 'move' | 'delete',
) {
  if (action === 'delete') {
    confirmSingleDelete(item, groupId)
  } else if (action === 'move') {
    selected.value = new Set([item.id])
    moveVisible.value = true
  } else if (action === 'edit') {
    router.push({ path: '/edit', query: { id: item.id } })
  }
}

async function confirmSingleDelete(item: TotpItem, groupId: string | null) {
  try {
    await ElMessageBox.confirm(
      t('totp.deleteConfirm', { issuer: item.issuer, label: item.label }),
      t('common.delete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
    totpStore.removeItem(groupId ?? findGroupId(item.id), item.id)
  } catch {
    // cancelled
  }
}

function findGroupId(itemId: string): string | null {
  for (const group of totpStore.data.groups) {
    if (group.items.some((i) => i.id === itemId)) return group.id
  }
  return null
}

// ---- move to group ----
function openMove() {
  if (selected.value.size > 0) moveVisible.value = true
}

function onMoveClosed() {
  exitBatch()
}

const moveTargets = computed<{ id: string | null; name: string }[]>(() => {
  if (selected.value.size === 0) return []
  const refs = buildItemRefs(selected.value)
  if (refs.length === 0) return []
  const sourceGroups = new Set(refs.map((r) => r.groupId ?? '__ungrouped__'))
  const singleSource = sourceGroups.size === 1
  const src = (sourceGroups.values().next().value as string) ?? ''
  const targets: { id: string | null; name: string }[] = []
  if (!(singleSource && src === '__ungrouped__')) {
    targets.push({ id: null, name: t('group.ungrouped') })
  }
  for (const group of totpStore.data.groups) {
    if (singleSource && src === group.id) continue
    targets.push({ id: group.id, name: group.name })
  }
  return targets
})

function confirmMove(targetId: string | null) {
  const refs = buildItemRefs(selected.value)
  const toMove = refs.filter((r) => r.groupId !== targetId)
  if (toMove.length > 0) {
    totpStore.batchMove(toMove, targetId)
  }
  moveVisible.value = false
  exitBatch()
}

// ---- group delete ----
function openGroupDelete(group: TotpGroup) {
  groupDeleteTarget.value = group
  groupDeleteItems.value = false
  groupDeleteVisible.value = true
}

function confirmGroupDelete() {
  if (!groupDeleteTarget.value) return
  totpStore.removeGroup(groupDeleteTarget.value.id, groupDeleteItems.value)
  groupDeleteVisible.value = false
  groupDeleteTarget.value = null
}

// ---- batch delete ----
async function confirmBatchDelete() {
  const count = selected.value.size
  try {
    await ElMessageBox.confirm(
      t('totp.batchDeleteConfirm', { count }),
      t('common.delete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
    totpStore.batchRemove(buildItemRefs(selected.value))
    exitBatch()
  } catch {
    // cancelled
  }
}

// ---- drag end ----
function onGroupItemsDragEnd(group: TotpGroup) {
  totpStore.reorderItems(group.id, group.items.map((i) => i.id))
}

function onUngroupedDragEnd() {
  totpStore.reorderItems(null, totpStore.data.ungrouped.map((i) => i.id))
}

function persistGroupOrder() {
  totpStore.reorderGroups(totpStore.data.groups.map((g) => g.id))
}

// ---- add / rename group ----
async function promptAddGroup() {
  try {
    const { value } = await ElMessageBox.prompt('', t('group.addGroup'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputPlaceholder: t('group.renamePlaceholder'),
      inputValidator: (v: string) =>
        v.trim() ? true : t('group.renamePlaceholder'),
    })
    if (value && value.trim()) totpStore.addGroup(value.trim())
  } catch {
    // cancelled
  }
}

async function renameGroup(group: TotpGroup) {
  try {
    const { value } = await ElMessageBox.prompt('', t('group.rename'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValue: group.name,
      inputPlaceholder: t('group.renamePlaceholder'),
      inputValidator: (v: string) =>
        v.trim() ? true : t('group.renamePlaceholder'),
    })
    if (value && value.trim()) totpStore.renameGroup(group.id, value.trim())
  } catch {
    // cancelled
  }
}

function resetCorrupted() {
  void totpStore.resetCorrupted().then(() => {
    corruptedVisible.value = false
  })
}

onMounted(async () => {
  await totpStore.init()
  if (totpStore.corrupted) {
    corruptedVisible.value = true
  } else if (totpStore.showBackupNotice && itemCount.value > 0) {
    ElMessageBox.alert(t('totp.encryptionNotice'), '', {
      confirmButtonText: t('common.confirm'),
      closeOnClickModal: false,
    })
  }
})
</script>

<style scoped>
.home {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 4px 96px;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px 12px;
  background: var(--app-topbar-bg);
  backdrop-filter: blur(6px);
}

.app-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.search {
  flex: 1;
  min-width: 0;
}

.batch-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.spacer {
  flex: 1;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px 8px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 10px;
}

.group-select {
  width: min(240px, 62vw);
}

.list {
  padding: 4px 0;
}

.group-sort {
  display: flex;
  flex-direction: column;
}

.empty-state p {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 48px 16px;
  font-size: 14px;
}

.dialog-msg {
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  margin-bottom: 8px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-footer :deep(.el-button) {
  margin-left: 0;
}

.move-list {
  display: flex;
  flex-direction: column;
}

.move-target {
  padding: 12px 14px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--el-text-color-primary);
  font-size: 14px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.move-target:last-child {
  border-bottom: none;
}

.move-target:active {
  background: var(--el-color-primary-light-9);
}

.group-delete-msg {
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  margin-bottom: 16px;
}
</style>
