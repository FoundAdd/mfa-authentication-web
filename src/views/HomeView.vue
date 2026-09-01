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
        <el-dropdown
          v-if="activeGroup"
          trigger="click"
          @command="onGroupMenu"
        >
          <span class="filter-more">
            <el-icon><MoreFilled /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">
                {{ t('group.rename') }}
              </el-dropdown-item>
              <el-dropdown-item command="up" :disabled="!canMoveUp">
                {{ t('group.moveUp') }}
              </el-dropdown-item>
              <el-dropdown-item command="down" :disabled="!canMoveDown">
                {{ t('group.moveDown') }}
              </el-dropdown-item>
              <el-dropdown-item command="delete" divided>
                {{ t('group.deleteGroup') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div class="list">
        <draggable
          v-if="dragEnabled"
          v-model="filteredItems"
          :disabled="batchMode"
          handle=".drag-handle"
          :animation="200"
          item-key="id"
          :move="onDragMove"
        >
          <template #item="{ element }">
            <ItemRow
              :item="element"
              :group-tag="itemGroupTag(element)"
              :batch-mode="batchMode"
              :selected="selected.has(element.id)"
              @toggle="onItemToggle(element)"
              @longpress="onItemLongPress(element)"
              @menu="(action) => onItemMenuAction(element, itemGroupId(element), action)"
            />
          </template>
        </draggable>
        <template v-else>
          <ItemRow
            v-for="row in visibleRows"
            :key="row.item.id"
            :item="row.item"
            :group-tag="row.groupName"
            :batch-mode="batchMode"
            :selected="selected.has(row.item.id)"
            @toggle="onItemToggle(row.item)"
            @longpress="onItemLongPress(row.item)"
            @menu="(action) => onItemMenuAction(row.item, row.groupId, action)"
          />
        </template>
        <p v-if="!searchActive && visibleRows.length === 0" class="empty-hint">
          {{ t('totp.emptyGroup') }}
        </p>
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
  MoreFilled,
  Plus,
  Search,
  Setting,
} from '@element-plus/icons-vue'
import { useTotpStore, type ItemRef } from '@/stores/totp'
import type { TotpGroup, TotpItem } from '@/types'
import ItemRow from '@/components/ItemRow.vue'
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

interface RowEntry {
  item: TotpItem
  groupId: string | null
  groupName: string
}

// 扁平行列表:分组条目按分组顺序在前,未分组条目固定排在最后
const allRows = computed<RowEntry[]>(() => {
  const rows: RowEntry[] = []
  for (const group of totpStore.data.groups) {
    for (const item of group.items) {
      rows.push({ item, groupId: group.id, groupName: group.name })
    }
  }
  for (const item of totpStore.data.ungrouped) {
    rows.push({ item, groupId: null, groupName: t('group.ungrouped') })
  }
  return rows
})

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

const visibleRows = computed<RowEntry[]>(() => {
  const q = searchQuery.value
  if (q) {
    // 搜索跨分组进行,分组名命中时展示该分组全部条目
    return allRows.value.filter(
      (row) =>
        itemMatches(row.item) ||
        (row.groupId !== null && row.groupName.toLowerCase().includes(q)),
    )
  }
  if (activeFilters.value.includes(ALL_FILTER)) return allRows.value
  const picked = new Set(activeFilters.value)
  return allRows.value.filter((row) =>
    row.groupId === null
      ? picked.has(UNGROUPED_FILTER)
      : picked.has(row.groupId),
  )
})

// 恰好只选了一个分组/未分组(单一容器)时隐藏冗余的分组标注;
// 分组管理菜单同样仅在此视图下可用
const singleContainer = computed(
  () =>
    !searchActive.value &&
    activeFilters.value.length === 1 &&
    activeFilters.value[0] !== ALL_FILTER,
)

// 非搜索视图统一用可拖拽列表渲染(全部/复选并集/单一容器),
// 搜索结果跨分组展示命中项,不支持排序
const dragEnabled = computed(() => !searchActive.value)

// 条目 id → 所属分组 id(未分组为 null):为拖拽落点守卫与
// 行内菜单提供该条目的分组上下文
const containerIdByItemId = computed<Map<string, string | null>>(() => {
  const map = new Map<string, string | null>()
  for (const group of totpStore.data.groups) {
    for (const item of group.items) map.set(item.id, group.id)
  }
  for (const item of totpStore.data.ungrouped) map.set(item.id, null)
  return map
})

function itemGroupId(item: TotpItem): string | null {
  return containerIdByItemId.value.get(item.id) ?? null
}

function itemGroupTag(item: TotpItem): string | undefined {
  if (singleContainer.value) return undefined
  const groupId = containerIdByItemId.value.get(item.id)
  if (groupId === null) return t('group.ungrouped')
  return totpStore.data.groups.find((g) => g.id === groupId)?.name
}

// 平铺列表(分组条目在前、未分组最后)的拖拽结果映射回各容器:
// 每个容器按旧数组顺序保留被筛选隐藏的条目,可见槽位依新顺序回填,
// 使同容器重排在任意筛选视图下都精确生效
const filteredItems = computed<TotpItem[]>({
  get: () => visibleRows.value.map((row) => row.item),
  set: (items) => {
    if (!dragEnabled.value) return
    const ownerOf = containerIdByItemId.value
    const visibleIds = new Set(items.map((i) => i.id))
    const remap = (oldArr: TotpItem[], groupId: string | null) => {
      const newOrder = items.filter((i) => ownerOf.get(i.id) === groupId)
      let k = 0
      return oldArr.map((it) => (visibleIds.has(it.id) ? newOrder[k++] : it))
    }
    for (const group of totpStore.data.groups) {
      group.items = remap(group.items, group.id)
    }
    totpStore.data.ungrouped = remap(totpStore.data.ungrouped, null)
  },
})

// 拖拽仅限同一容器内重排:跨分组块的插入直接拒绝(Sortable 原地回弹),
// 分组间移动仍通过"移动到分组"菜单完成
interface DragMoveContext {
  draggedContext?: { element?: TotpItem }
  relatedContext?: { element?: TotpItem }
}

function onDragMove(evt: DragMoveContext): boolean {
  const dragged = evt.draggedContext?.element
  const related = evt.relatedContext?.element
  if (!dragged || !related) return true
  return (
    containerIdByItemId.value.get(dragged.id) ===
    containerIdByItemId.value.get(related.id)
  )
}

const activeGroup = computed<TotpGroup | null>(() => {
  if (activeFilters.value.length !== 1) return null
  const id = activeFilters.value[0]
  if (id === ALL_FILTER || id === UNGROUPED_FILTER) return null
  return (
    totpStore.data.groups.find((g) => g.id === id) ?? null
  )
})

const groupIndex = computed(() =>
  totpStore.data.groups.findIndex((g) => g.id === activeGroup.value?.id),
)
const canMoveUp = computed(() => groupIndex.value > 0)
const canMoveDown = computed(
  () =>
    groupIndex.value !== -1 &&
    groupIndex.value < totpStore.data.groups.length - 1,
)

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

// ---- group menu ----
function onGroupMenu(command: string) {
  const group = activeGroup.value
  if (!group) return
  if (command === 'rename') void renameGroup(group)
  else if (command === 'delete') openGroupDelete(group)
  else if (command === 'up') totpStore.moveGroup(group.id, -1)
  else if (command === 'down') totpStore.moveGroup(group.id, 1)
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
  const ids = visibleRows.value.map((row) => row.item.id)
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
    visibleRows.value.every((row) => selected.value.has(row.item.id)),
)

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    for (const row of visibleRows.value) selected.value.delete(row.item.id)
    if (selected.value.size === 0) batchMode.value = false
  } else {
    for (const row of visibleRows.value) selected.value.add(row.item.id)
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
  background: rgba(245, 245, 245, 0.95);
  backdrop-filter: blur(6px);
}

.app-name {
  font-size: 17px;
  font-weight: 700;
  color: #303133;
  white-space: nowrap;
}

.search {
  flex: 1;
  min-width: 0;
}

.batch-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
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

.filter-more {
  display: flex;
  align-items: center;
  color: #909399;
  cursor: pointer;
  padding: 6px;
}

.list {
  padding: 0;
}

.empty-hint {
  text-align: center;
  color: #909399;
  padding: 48px 16px;
  font-size: 14px;
}

.empty-state p {
  text-align: center;
  color: #909399;
  padding: 48px 16px;
  font-size: 14px;
}

.dialog-msg {
  font-size: 14px;
  color: #606266;
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
  color: #303133;
  font-size: 14px;
  border-bottom: 1px solid #f5f5f5;
}

.move-target:last-child {
  border-bottom: none;
}

.move-target:active {
  background: #ecf5ff;
}

.group-delete-msg {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  margin-bottom: 16px;
}
</style>
