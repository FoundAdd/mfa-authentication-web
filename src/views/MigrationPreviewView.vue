<template>
  <div class="migrate-view">
    <div class="topbar">
      <el-button text circle @click="router.back()">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="title">{{ t('migration.title') }}</div>
    </div>

    <div v-if="error" class="error">
      <p>{{ error }}</p>
      <el-button type="primary" @click="router.back()">{{ t('common.back') }}</el-button>
    </div>

    <template v-else>
      <p class="subtitle">{{ t('migration.subtitle', { count: accounts.length }) }}</p>

      <div class="sel-row">
        <el-checkbox :model-value="allSelected" @change="toggleAll">
          {{ t('migration.selectAll') }}
        </el-checkbox>
      </div>

      <div class="account-list">
        <div
          v-for="(account, index) in accounts"
          :key="index"
          class="account-item"
          :class="{ selected: selected.has(index) }"
          @click="toggle(index)"
        >
          <el-checkbox :model-value="selected.has(index)" @click.stop @change="toggle(index)" />
          <div class="account-info">
            <div class="issuer">{{ account.issuer || t('group.ungrouped') }}</div>
            <div class="label">{{ account.label }}</div>
          </div>
          <div class="meta">{{ account.algorithm }} · {{ account.digits }} 位 · {{ account.period }}s</div>
        </div>
      </div>

      <el-button
        type="primary"
        size="large"
        class="bar-btn"
        :disabled="selected.size === 0"
        @click="confirm"
      >
        {{ t('migration.importSelected', { count: selected.size }) }}
      </el-button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { useTotpStore } from '@/stores/totp'
import { parseGaMigration, GaMigrationError } from '@/services/ga-migration'
import { mergeData } from '@/services/backup'
import type { ParsedGaAccount } from '@/services/ga-migration'
import type { TotpData } from '@/types'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const totpStore = useTotpStore()

const accounts = ref<ParsedGaAccount[]>([])
const selected = ref<Set<number>>(new Set())
const error = ref('')

const allSelected = computed(
  () => accounts.value.length > 0 && selected.value.size === accounts.value.length,
)

function toggle(index: number) {
  if (selected.value.has(index)) {
    selected.value.delete(index)
  } else {
    selected.value.add(index)
  }
  selected.value = new Set(selected.value)
}

function toggleAll(value: boolean | string | number) {
  if (value) {
    selected.value = new Set(accounts.value.map((_, i) => i))
  } else {
    selected.value = new Set()
  }
}

function buildImportData(): TotpData {
  const chosen = [...selected.value]
    .sort((a, b) => a - b)
    .map((i) => accounts.value[i])
  return {
    groups: [],
    ungrouped: chosen.map((a) => ({
      id: '',
      issuer: a.issuer,
      label: a.label,
      secret: a.secret,
      algorithm: a.algorithm,
      digits: a.digits,
      period: a.period,
    })),
  }
}

async function confirm() {
  if (selected.value.size === 0) {
    ElMessage.warning(t('migration.noneSelected'))
    return
  }
  const { result, added, skipped } = mergeData(
    totpStore.data,
    buildImportData(),
  )
  totpStore.setData(result)
  await totpStore.saveNow()
  ElMessage.success(t('migration.success', { count: added }))
  router.push('/')
}

onMounted(() => {
  const data = typeof route.query.data === 'string' ? route.query.data : ''
  if (!data) {
    error.value = t('scan.unsupported')
    return
  }
  try {
    accounts.value = parseGaMigration(data)
  } catch (err) {
    if (err instanceof GaMigrationError) {
      error.value = t('scan.unsupported')
    } else {
      error.value = t('scan.unsupported')
    }
  }
})
</script>

<style scoped>
.migrate-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 12px 96px;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
}

.title {
  font-size: 17px;
  font-weight: 700;
  color: #303133;
}

.subtitle {
  font-size: 13px;
  color: #909399;
  margin: 8px 0 12px;
}

.sel-row {
  padding: 4px 2px 8px;
}

.account-list {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.account-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
}

.account-item:last-child {
  border-bottom: none;
}

.account-item.selected {
  background: #ecf5ff;
}

.account-info {
  flex: 1;
  min-width: 0;
}

.issuer {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.label {
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 12px;
  color: #b0b3b8;
  white-space: nowrap;
}

.bar-btn {
  width: 100%;
  margin-left: 0;
}

.error {
  text-align: center;
  color: #606266;
  padding: 48px 16px;
}

.error p {
  margin-bottom: 16px;
}
</style>