<template>
  <div
    class="item-row"
    :class="{ selected, batch: batchMode }"
    @pointerdown="onPressStart"
    @pointerup="onPressEnd"
    @pointercancel="onPressEnd"
    @pointerleave="onPressEnd"
    @click="onRowClick"
    @contextmenu.prevent
  >
    <span v-if="!batchMode" class="drag-handle item-grip">
      <el-icon><Rank /></el-icon>
    </span>

    <span v-if="batchMode" class="select-badge" :class="{ checked: selected }">
      <el-icon v-if="selected"><Check /></el-icon>
    </span>

    <AvatarIcon :issuer="item.issuer" :size="40" />

    <div class="meta">
      <div class="issuer">
        <span class="issuer-text">{{ item.issuer || t('migration.unknownIssuer') }}</span>
      </div>
      <div v-if="item.label" class="label">{{ item.label }}</div>
    </div>

    <div class="code-area" @click.stop="onCodeClick">
      <span class="code">{{ formatted }}</span>
      <CountdownBar :period="item.period" />
    </div>

    <el-dropdown
      v-if="!batchMode"
      class="more"
      trigger="click"
      @command="onCommand"
    >
      <span class="more-btn" @click.stop>
        <el-icon><MoreFilled /></el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="edit">
            {{ t('common.edit') }}
          </el-dropdown-item>
          <el-dropdown-item command="move">
            {{ t('group.moveToGroup') }}
          </el-dropdown-item>
          <el-dropdown-item command="delete" divided>
            {{ t('common.delete') }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Check, MoreFilled, Rank } from '@element-plus/icons-vue'
import type { TotpItem } from '@/types'
import { useClockStore } from '@/stores/clock'
import { compute, format } from '@/services/totp'
import { copyText } from '@/utils/copy'
import AvatarIcon from './AvatarIcon.vue'
import CountdownBar from './CountdownBar.vue'

const props = defineProps<{
  item: TotpItem
  batchMode: boolean
  selected: boolean
}>()

const emit = defineEmits<{
  toggle: []
  longpress: []
  menu: [action: 'edit' | 'move' | 'delete']
}>()

const { t } = useI18n()
const clock = useClockStore()

const copyValue = computed(() => compute(props.item, clock.timestamp))
const formatted = computed(() => format(copyValue.value))

let pressTimer: ReturnType<typeof setTimeout> | null = null
const LONG_PRESS_MS = 500
let suppressClick = false

function onPressStart(e: PointerEvent) {
  // 拖动把手是纯拖拽入口:拖拽手势常超过长按阈值,若按下把手也启动
  // 长按计时,会在拖拽中途触发多选(禁用拖拽并移除把手),导致排序失效
  if ((e.target as Element | null)?.closest('.drag-handle')) return
  // 批量模式下长按用于区间选择,同样需要监听
  if (pressTimer) return
  pressTimer = setTimeout(() => {
    pressTimer = null
    suppressClick = true
    emit('longpress')
  }, LONG_PRESS_MS)
}

function onPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onRowClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (props.batchMode) {
    emit('toggle')
  }
}

async function onCodeClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (props.batchMode) {
    emit('toggle')
    return
  }
  const ok = await copyText(copyValue.value)
  if (ok) {
    ElMessage.success(t('totp.copySuccess'))
  } else {
    ElMessage.warning(t('totp.copyFailed'))
  }
}

function onCommand(action: 'edit' | 'move' | 'delete') {
  emit('menu', action)
}
</script>

<style scoped>
.item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  user-select: none;
  touch-action: manipulation;
}

.item-row.selected {
  background: #ecf5ff;
}

.item-grip {
  color: #c0c4cc;
  cursor: grab;
  display: flex;
  align-items: center;
  /* 把手仅用于拖拽:阻止触屏把该手势判定为页面滚动(会派发
     pointercancel 中断拖拽),列表滚动从行体其余区域进行 */
  touch-action: none;
}

.select-badge {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #c0c4cc;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
}

.select-badge.checked {
  background: #409eff;
  border-color: #409eff;
}

.meta {
  flex: 1;
  min-width: 0;
}

.issuer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  min-width: 0;
}

.issuer-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-area {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 96px;
  cursor: pointer;
}

.code {
  font-size: 24px;
  font-weight: 700;
  font-family: 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace;
  letter-spacing: 1px;
  color: #303133;
}

.more {
  display: flex;
  align-items: center;
}

.more-btn {
  display: flex;
  align-items: center;
  color: #909399;
  cursor: pointer;
  padding: 4px;
}
</style>
