<template>
  <div class="add-edit">
    <div class="topbar">
      <el-button text circle @click="router.back()">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="title">{{ isEdit ? t('form.titleEdit') : t('form.titleAdd') }}</div>
    </div>

    <div v-if="notFound" class="notfound">
      <p>{{ t('form.itemNotFound') }}</p>
      <el-button type="primary" @click="router.push('/')">{{ t('common.back') }}</el-button>
    </div>

    <div v-else class="content">
      <div class="card">
        <div class="field">
          <label class="field-label">{{ t('form.issuer') }}</label>
          <el-input
            v-model="form.issuer"
            :placeholder="t('form.issuer')"
            :class="{ invalid: !!issuerError }"
          />
          <p v-if="issuerError" class="error-text">{{ issuerError }}</p>
        </div>

        <div class="field">
          <label class="field-label">{{ t('form.label') }}</label>
          <el-input v-model="form.label" :placeholder="t('form.label')" />
        </div>

        <div class="field">
          <label class="field-label">{{ t('form.secret') }}</label>
          <el-input
            :model-value="form.secret"
            :placeholder="t('form.secretPlaceholder')"
            :disabled="isEdit"
            :class="{ invalid: !!secretError }"
            class="secret-input"
            @update:model-value="onSecretUpdate"
          >
            <template v-if="isEdit" #prefix>
              <el-icon><Lock /></el-icon>
            </template>
          </el-input>
          <p v-if="isEdit" class="hint-text">{{ t('form.secretReadonly') }}</p>
          <p v-else-if="secretError" class="error-text">{{ secretError }}</p>
        </div>

        <div class="field">
          <label class="field-label">{{ t('form.group') }}</label>
          <el-select
            v-if="!isEdit"
            v-model="targetGroupId"
            class="group-select"
            :placeholder="t('form.ungrouped')"
          >
            <el-option :label="t('form.ungrouped')" value="" />
            <el-option
              v-for="group in totpStore.data.groups"
              :key="group.id"
              :label="group.name"
              :value="group.id"
            />
          </el-select>
          <el-input v-else :model-value="groupName" disabled />
        </div>

        <div class="advanced">
          <div class="advanced-toggle" @click="showAdvanced = !showAdvanced">
            <span>{{ t('form.advanced') }}</span>
            <el-icon class="chevron" :class="{ open: showAdvanced }"><ArrowDown /></el-icon>
          </div>
          <div v-if="showAdvanced" class="advanced-body">
            <el-select v-model="form.algorithm" class="adv-select">
              <el-option label="SHA1" value="SHA1" />
              <el-option label="SHA256" value="SHA256" />
              <el-option label="SHA512" value="SHA512" />
            </el-select>
            <el-select v-model="form.digits" class="adv-select">
              <el-option :label="`6 ${t('form.digits')}`" :value="6" />
              <el-option :label="`8 ${t('form.digits')}`" :value="8" />
            </el-select>
            <el-select v-model="form.period" class="adv-select">
              <el-option :label="`30 ${t('form.period')}`" :value="30" />
              <el-option :label="`60 ${t('form.period')}`" :value="60" />
            </el-select>
          </div>
        </div>
      </div>

      <div class="card preview">
        <div class="preview-title">{{ t('form.previewTitle') }}</div>
        <div v-if="previewItem" class="preview-body">
          <div class="preview-code">{{ previewCode }}</div>
          <CountdownBar :period="previewItem.period" />
          <p class="preview-desc">{{ t('form.previewDesc') }}</p>
        </div>
        <div v-else class="preview-empty">
          <el-icon :size="20"><Warning /></el-icon>
          <span>{{ previewHint }}</span>
        </div>
      </div>

      <el-button
        type="primary"
        size="large"
        class="save-btn"
        :disabled="!canSubmit"
        @click="onSave"
      >
        {{ t('common.save') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowLeft, Lock, Warning } from '@element-plus/icons-vue'
import { useTotpStore } from '@/stores/totp'
import { useClockStore } from '@/stores/clock'
import { compute, format, isValidBase32, normalizeSecret } from '@/services/totp'
import type { TotpItem } from '@/types'
import CountdownBar from '@/components/CountdownBar.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const totpStore = useTotpStore()
const clock = useClockStore()

function normalizeAlgorithm(value: string | null): TotpItem['algorithm'] {
  const upper = (value ?? '').toUpperCase()
  if (upper === 'SHA256' || upper === 'SHA-256') return 'SHA256'
  if (upper === 'SHA512' || upper === 'SHA-512') return 'SHA512'
  return 'SHA1'
}

const isEdit = ref(false)
const editId = ref('')
const notFound = ref(false)
const showAdvanced = ref(false)
const submitAttempted = ref(false)

const form = reactive<{
  issuer: string
  label: string
  secret: string
  algorithm: TotpItem['algorithm']
  digits: number
  period: number
}>({
  issuer: '',
  label: '',
  secret: '',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
})

const targetGroupId = ref('')

const isValidSecret = computed(() => isValidBase32(form.secret))

const secretError = computed(() => {
  if (!form.secret) return ''
  if (!/^[A-Z2-7]+$/.test(form.secret)) return t('form.secretInvalidChar')
  if (!isValidBase32(form.secret)) return t('form.secretInvalidLength')
  return ''
})

const issuerError = computed(() => {
  if (submitAttempted.value && !form.issuer.trim()) return t('form.issuerRequired')
  return ''
})

const isRequiredMissing = computed(() => {
  if (!form.issuer.trim()) return true
  if (!form.secret) return true
  return false
})

const canSubmit = computed(
  () => !isRequiredMissing.value && isValidSecret.value,
)

function onSecretUpdate(value: string) {
  form.secret = normalizeSecret(value)
}

const previewItem = computed<Pick<TotpItem, 'secret' | 'algorithm' | 'digits' | 'period'> | null>(() => {
  if (!isValidSecret.value) return null
  return {
    secret: form.secret,
    algorithm: form.algorithm,
    digits: form.digits,
    period: form.period,
  }
})

const previewCode = computed(() => {
  if (!previewItem.value) return ''
  try {
    return format(compute(previewItem.value as TotpItem, clock.timestamp))
  } catch {
    return ''
  }
})

const previewHint = computed(() => secretError.value || t('form.secretRequired'))

const groupName = computed(() => {
  if (!editId.value) return ''
  const group = totpStore.data.groups.find((g) =>
    g.items.some((i) => i.id === editId.value),
  )
  return group ? group.name : t('form.ungrouped')
})

onMounted(() => {
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  if (id) {
    isEdit.value = true
    editId.value = id
    const item = totpStore.findItem(id)
    if (!item) {
      notFound.value = true
      return
    }
    form.issuer = item.issuer
    form.label = item.label
    form.secret = item.secret
    form.algorithm = item.algorithm
    form.digits = item.digits
    form.period = item.period
    return
  }

  // 扫码添加预填
  const q = route.query
  form.issuer = typeof q.issuer === 'string' ? q.issuer : ''
  form.label = typeof q.label === 'string' ? q.label : ''
  if (typeof q.secret === 'string') form.secret = normalizeSecret(q.secret)
  form.algorithm = normalizeAlgorithm(typeof q.algorithm === 'string' ? q.algorithm : null)
  if (typeof q.digits === 'string') {
    const d = Number(q.digits)
    if (d === 6 || d === 8) form.digits = d
  }
  if (typeof q.period === 'string') {
    const p = Number(q.period)
    if (p === 30 || p === 60) form.period = p
  }
})

async function onSave() {
  if (!canSubmit.value) {
    submitAttempted.value = true
    const message = !form.issuer.trim()
      ? t('form.issuerRequired')
      : !form.secret
        ? t('form.secretRequired')
        : secretError.value
    if (message) ElMessage.warning(message)
    return
  }
  if (isEdit.value) {
    totpStore.updateItem(editId.value, {
      issuer: form.issuer.trim(),
      label: form.label.trim(),
      algorithm: form.algorithm,
      digits: form.digits,
      period: form.period,
    })
  } else {
    totpStore.addItem(targetGroupId.value === '' ? null : targetGroupId.value, {
      issuer: form.issuer.trim(),
      label: form.label.trim(),
      secret: form.secret,
      algorithm: form.algorithm,
      digits: form.digits,
      period: form.period,
    })
  }
  await totpStore.saveNow()
  ElMessage.success(t('form.saveSuccess'))
  router.push('/')
}
</script>

<style scoped>
.add-edit {
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 12px 32px;
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

.content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}

.field {
  margin-bottom: 16px;
}

.field-label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.error-text {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 4px;
}

.hint-text {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}

.invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #f56c6c inset;
}

.group-select,
.adv-select {
  width: 100%;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-size: 14px;
  color: #606266;
  padding: 4px 0;
}

.chevron {
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.preview-body {
  margin-top: 12px;
  text-align: center;
}

.preview-code {
  font-size: 32px;
  font-weight: 700;
  font-family: 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace;
  letter-spacing: 2px;
  color: #303133;
}

.preview-desc {
  color: #909399;
  font-size: 12px;
  margin-top: 8px;
}

.preview-empty {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
}

.save-btn {
  width: 100%;
  margin-left: 0;
}

.notfound {
  text-align: center;
  padding: 48px 16px;
  color: #606266;
}
.notfound p {
  margin-bottom: 16px;
}
</style>