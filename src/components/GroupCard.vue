<template>
  <div class="group-card">
    <div
      class="group-header"
      :class="{ 'no-toggle': group.items.length === 0 }"
      @click="onHeaderClick"
    >
      <span class="drag-handle group-grip">
        <el-icon><Rank /></el-icon>
      </span>
      <el-icon class="chevron" :class="{ open: expanded }">
        <ArrowDown />
      </el-icon>
      <span class="group-name">{{ group.name }}</span>
      <span class="group-count">
        {{ t('group.count', { count: group.items.length }) }}
      </span>
      <el-dropdown
        class="group-more"
        trigger="click"
        @command="onMoreCommand"
      >
        <span class="more-btn" @click.stop>
          <el-icon><MoreFilled /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="rename">
              {{ t('group.rename') }}
            </el-dropdown-item>
            <el-dropdown-item command="delete" divided>
              {{ t('group.deleteGroup') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="expanded && group.items.length > 0" class="group-body">
      <draggable
        :list="group.items"
        :disabled="dragDisabled"
        handle=".drag-handle"
        item-key="id"
        @end="emit('itemDragEnd')"
      >
        <template #item="{ element }">
          <ItemRow
            :item="element"
            :batch-mode="!!batchMode"
            :selected="selectedIds.has(element.id)"
            @toggle="emit('itemToggle', element)"
            @longpress="emit('itemLongPress', element)"
            @menu="(action) => emit('itemMenu', element, action)"
          />
        </template>
      </draggable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import { ArrowDown, MoreFilled, Rank } from '@element-plus/icons-vue'
import type { TotpItem, TotpGroup } from '@/types'
import ItemRow from './ItemRow.vue'

const props = defineProps<{
  group: TotpGroup
  expanded: boolean
  batchMode?: boolean
  searchActive?: boolean
  selectedIds: Set<string>
}>()

const emit = defineEmits<{
  toggle: []
  rename: []
  'delete': []
  itemToggle: [item: TotpItem]
  itemLongPress: [item: TotpItem]
  itemMenu: [item: TotpItem, action: 'edit' | 'move' | 'delete']
  itemDragEnd: []
}>()

const { t } = useI18n()

const dragDisabled = computed(
  (): boolean => props.batchMode === true || props.searchActive === true,
)

function onHeaderClick() {
  if (props.searchActive) return
  if (props.group.items.length === 0) return
  emit('toggle')
}

function onMoreCommand(command: string) {
  if (command === 'rename') emit('rename')
  else if (command === 'delete') emit('delete')
}
</script>

<style scoped>
.group-card {
  background: #fff;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  cursor: pointer;
  background: #fff;
}

.group-grip {
  color: #c0c4cc;
  cursor: grab;
  display: flex;
  align-items: center;
}

.chevron {
  color: #909399;
  font-size: 14px;
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
}

.group-name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: 12px;
  color: #c0c4cc;
}

.more-btn {
  display: flex;
  align-items: center;
  color: #909399;
  cursor: pointer;
  padding: 4px;
}

.group-body {
  border-top: 1px solid #f5f5f5;
}
</style>