<template>
  <div class="group-card" :class="{ readonly: headerReadonly }">
    <div class="group-header" @click="onHeaderClick">
      <span v-if="canReorder" class="group-grip">
        <el-icon><Rank /></el-icon>
      </span>
      <el-icon v-if="collapsible" class="chevron" :class="{ open: expanded }">
        <ArrowDown />
      </el-icon>
      <span class="group-name">{{ name }}</span>
      <span class="group-count">
        {{ t('group.count', { count: displayItems.length }) }}
      </span>
      <el-dropdown
        v-if="showMenu"
        class="group-more"
        trigger="click"
        @command="onMenuCommand"
      >
        <span class="more-btn" @click.stop>
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

    <div v-if="expanded && displayItems.length > 0" class="group-body">
      <draggable
        :list="displayItems"
        :disabled="dragDisabled"
        handle=".drag-handle"
        :animation="200"
        item-key="id"
        @end="emit('itemDragEnd')"
      >
        <template #item="{ element }">
          <ItemRow
            :item="element"
            :batch-mode="batchMode === true"
            :selected="selectedIds.has(element.id)"
            @toggle="emit('itemToggle', element)"
            @longpress="emit('itemLongPress', element)"
            @menu="(action) => emit('itemMenu', element, action)"
          />
        </template>
      </draggable>
    </div>
    <p v-else-if="expanded" class="group-empty">
      {{ t('totp.emptyGroup') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import { ArrowDown, MoreFilled, Rank } from '@element-plus/icons-vue'
import type { TotpItem } from '@/types'
import ItemRow from './ItemRow.vue'

const props = withDefaults(
  defineProps<{
    /** 卡片标题:普通分组传分组名,未分组传 t('group.ungrouped') */
    name: string
    items: TotpItem[]
    expanded: boolean
    /** 搜索态下展示的是过滤后的子集;此时拖拽已被禁用,替换列表安全 */
    displayItems?: TotpItem[]
    collapsible?: boolean
    showMenu?: boolean
    canReorder?: boolean
    canMoveUp?: boolean
    canMoveDown?: boolean
    batchMode?: boolean
    searchActive?: boolean
    selectedIds: Set<string>
  }>(),
  {
    displayItems: undefined,
    collapsible: true,
    showMenu: false,
    canReorder: false,
    canMoveUp: false,
    canMoveDown: false,
    batchMode: false,
    searchActive: false,
  },
)

const emit = defineEmits<{
  toggle: []
  rename: []
  delete: []
  up: []
  down: []
  itemToggle: [item: TotpItem]
  itemLongPress: [item: TotpItem]
  itemMenu: [item: TotpItem, action: 'edit' | 'move' | 'delete']
  itemDragEnd: []
}>()

const { t } = useI18n()

const displayItems = computed(() => props.displayItems ?? props.items)

const dragDisabled = computed(
  (): boolean => props.batchMode === true || props.searchActive === true,
)

// 多选/搜索态下头部不可折叠,避免可见行集合在区间选择中途变化
const headerReadonly = computed(
  (): boolean => props.batchMode === true || props.searchActive === true,
)

function onHeaderClick() {
  if (headerReadonly.value) return
  emit('toggle')
}

function onMenuCommand(command: string) {
  if (command === 'rename') emit('rename')
  else if (command === 'delete') emit('delete')
  else if (command === 'up') emit('up')
  else if (command === 'down') emit('down')
}
</script>

<style scoped>
.group-card {
  background: #fff;
  border-radius: 10px;
  margin-bottom: 12px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 实底主题蓝头部:与白色页面背景形成强对比,分组名醒目可辨 */
.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  background: #409eff;
  color: #fff;
}

.group-card:not(.readonly) .group-header {
  cursor: pointer;
}

.group-grip {
  color: rgba(255, 255, 255, 0.85);
  cursor: grab;
  display: flex;
  align-items: center;
}

.chevron {
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.chevron.open {
  transform: rotate(180deg);
}

.group-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  flex-shrink: 0;
  font-size: 11px;
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
  padding: 1px 9px;
  border-radius: 9px;
}

.more-btn {
  display: flex;
  align-items: center;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  padding: 4px;
}

.group-body {
  border-top: 1px solid #f5f5f5;
}

.group-empty {
  padding: 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
</style>
