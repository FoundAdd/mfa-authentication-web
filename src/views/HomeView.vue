<template>
  <div class="home">
    <div class="topbar">
      <template v-if="batchMode">
        <span class="batch-title">{{ t('common.selected', { count: selected.size }) }}</span>
        <span class="spacer" />
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
        <el-select v-model="activeFilter" class="group-select">
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
          v-if="singleContainer"
          v-model="filteredItems"
          :disabled="batchMode"
          handle=".drag-handle"
          :animation="200"
          item-key="id"
        >
          <template #item="{ element }">
            <ItemRow
              :item="element"
              :batch-mode="batchMode"
              :selected="selected.has(element.id)"
              @toggle="onItemToggle(element)"
              @longpress="onItemLongPress(element)"
              @menu="(action) => onItemMenuAction(element, currentGroupId, action)"
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
// 列表分组筛选:'__all__'(全部) / '__ungrouped__'(未分组) / 分组 id
const activeFilter = ref<string>(ALL_FILTER)

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
  if (activeFilter.value === ALL_FILTER) return allRows.value
  if (activeFilter.value === UNGROUPED_FILTER) {
    return allRows.value.filter((row) => row.groupId === null)
  }
  return allRows.value.filter((row) => row.groupId === activeFilter.value)
})

// 仅在多分组共存的视图(全部/搜索)下展示分组名标注
const singleContainer = computed(
  () => !searchActive.value && activeFilter.value !== ALL_FILTER,
)

const filteredItems = computed<TotpItem[]>({
  get: () => visibleRows.value.map((row) => row.item),
  set: (items) => {
    if (activeFilter.value === UNGROUPED_FILTER) {
      totpStore.data.ungrouped = items
    } else if (activeFilter.value !== ALL_FILTER) {
      const group = totpStore.data.groups.find((g) => g.id === activeFilter.value)
      if (group) group.items = items
    }
  },
})

const activeGroup = computed<TotpGroup | null>(() => {
  if (activeFilter.value === ALL_FILTER || activeFilter.value === UNGROUPED_FILTER) {
    return null
  }
  return (
    totpStore.data.groups.find((g) => g.id === activeFilter.value) ?? null
  )
})

const currentGroupId = computed(() =>
  activeGroup.value ? activeGroup.value.id : null,
)

const groupIndex = computed(() =>
  totpStore.data.groups.findIndex((g) => g.id === activeFilter.value),
)
const canMoveUp = computed(() => groupIndex.value > 0)
const canMoveDown = computed(
  () =>
    groupIndex.value !== -1 &&
    groupIndex.value < totpStore.data.groups.length - 1,
)

// 当前筛选的分组被删除(或被导入覆盖)时回退到"全部",避免停留在失效筛选上
watch(
  () => totpStore.data.groups.map((g) => g.id),
  (ids) => {
    if (
      activeFilter.value !== ALL_FILTER &&
      activeFilter.value !== UNGROUPED_FILTER &&
      !ids.includes(activeFilter.value)
    ) {
      activeFilter.value = ALL_FILTER
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

function onItemLongPress(item: TotpItem) {
  if (batchMode.value) return
  batchMode.value = true
  selected.value.add(item.id)
}

function onItemToggle(item: TotpItem) {
  if (selected.value.has(item.id)) {
    selected.value.delete(item.id)
    if (selected.value.size === 0) batchMode.value = false
  } else {
    selected.value.add(item.id)
  }
}

function exitBatch() {
  batchMode.value = false
  selected.value = new Set()
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
