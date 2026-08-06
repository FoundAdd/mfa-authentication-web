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
      <el-button text type="primary" @click="router.push('/add')">
        <el-icon><Plus /></el-icon>
        <span>{{ t('guide.manual') }}</span>
      </el-button>
      <el-button text @click="promptAddGroup">
        <el-icon><FolderAdd /></el-icon>
        <span>{{ t('group.addGroup') }}</span>
      </el-button>
    </div>

    <EmptyGuide v-if="isEmpty && !searchActive" />

    <div v-else-if="!searchActive || hasVisibleResults" class="list">
      <div v-if="visibleUngrouped.length > 0" class="ungrouped-section">
        <div class="section-label">{{ t('group.ungrouped') }}</div>
        <div class="group-body">
          <draggable
            v-model="ungroupedList"
            :disabled="dragActive"
            handle=".drag-handle"
            :animation="200"
            item-key="id"
            @end="onUngroupedDragEnd"
          >
            <template #item="{ element }">
              <ItemRow
                :item="element"
                :batch-mode="batchMode"
                :selected="selected.has(element.id)"
                @toggle="onItemToggle(element)"
                @longpress="onItemLongPress(element)"
                @menu="(action) => onItemMenuAction(element, null, action)"
              />
            </template>
          </draggable>
        </div>
      </div>

      <draggable
        v-model="groupList"
        :disabled="dragActive"
        handle=".group-grip"
        :animation="200"
        item-key="group.id"
        class="group-sort"
        @end="persistGroupOrder"
      >
        <template #item="{ element }">
          <GroupCard
            :group="element.group"
            :expanded="element.expanded"
            :batch-mode="batchMode"
            :search-active="searchActive"
            :selected-ids="selected"
            @toggle="toggleGroup(element.group)"
            @rename="renameGroup(element.group)"
            @delete="openGroupDelete(element.group)"
            @item-toggle="onItemToggle"
            @item-long-press="onItemLongPress"
            @item-menu="(item, action) => onItemMenuAction(item, element.group.id, action)"
            @item-drag-end="onItemDragEnd(element.group.id)"
          />
        </template>
      </draggable>
    </div>

    <div v-else class="empty-state">
      <p>{{ t('empty.noMatch', { query: searchQuery }) }}</p>
    </div>

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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import draggable from 'vuedraggable'
import { FolderAdd, Plus, Search, Setting } from '@element-plus/icons-vue'
import { useTotpStore, type ItemRef } from '@/stores/totp'
import type { TotpGroup, TotpItem } from '@/types'
import GroupCard from '@/components/GroupCard.vue'
import ItemRow from '@/components/ItemRow.vue'
import EmptyGuide from '@/components/EmptyGuide.vue'
import BatchBar from '@/components/BatchBar.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import ResponsiveDialog from '@/components/ResponsiveDialog.vue'

const router = useRouter()
const { t } = useI18n()
const totpStore = useTotpStore()

const batchMode = ref(false)
const selected = ref<Set<string>>(new Set())
const settingsVisible = ref(false)

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
const isEmpty = computed(() => itemCount.value === 0)
const dragActive = computed(() => batchMode.value || searchActive.value)

function itemMatches(item: TotpItem): boolean {
  const q = searchQuery.value
  if (!q) return true
  return (
    item.issuer.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
  )
}

interface VisibleGroupEntry {
  group: TotpGroup
  expanded: boolean
}

const visibleGroups = computed<VisibleGroupEntry[]>(() => {
  const q = searchQuery.value
  const result: VisibleGroupEntry[] = []
  for (const group of totpStore.data.groups) {
    if (!q) {
      result.push({ group, expanded: group.isExpanded })
      continue
    }
    const groupMatch = group.name.toLowerCase().includes(q)
    let hasVisibleItems = false
    if (groupMatch) {
      hasVisibleItems = true
    } else {
      hasVisibleItems = group.items.some(itemMatches)
    }
    if (hasVisibleItems) {
      result.push({ group, expanded: true })
    }
  }
  return result
})

const groupList = computed<VisibleGroupEntry[]>({
  get: () => visibleGroups.value,
  set: (entries) => {
    totpStore.reorderGroups(entries.map((e) => e.group.id))
  },
})

const visibleUngrouped = computed<TotpItem[]>(() => {
  if (!searchActive.value) return totpStore.data.ungrouped
  return totpStore.data.ungrouped.filter(itemMatches)
})

const ungroupedList = computed<TotpItem[]>({
  get: () => visibleUngrouped.value,
  set: (value) => {
    if (!searchActive.value) {
      totpStore.data.ungrouped = value
    }
  },
})

const hasVisibleResults = computed(
  () => visibleGroups.value.length > 0 || visibleUngrouped.value.length > 0,
)

function toggleGroup(group: TotpGroup) {
  if (searchActive.value) return
  if (group.items.length === 0) return
  group.isExpanded = !group.isExpanded
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

// ---- drag end ----
function onItemDragEnd(groupId: string) {
  const group = totpStore.data.groups.find((g) => g.id === groupId)
  if (group) totpStore.reorderItems(groupId, group.items.map((i) => i.id))
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
  padding: 12px 12px;
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
  gap: 4px;
  padding: 4px 8px 8px;
}

.list {
  padding: 4px 0;
}

.group-sort {
  display: flex;
  flex-direction: column;
}

.ungrouped-section {
  margin-bottom: 8px;
}

.section-label {
  padding: 8px 14px 4px;
  font-size: 13px;
  color: #909399;
}

.group-body {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
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