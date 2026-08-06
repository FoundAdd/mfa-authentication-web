<template>
  <div class="placeholder">
    <div class="placeholder-card">
      <el-icon :size="40"><Tools /></el-icon>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <el-button type="primary" @click="router.push('/')">{{ t('common.back') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Tools } from '@element-plus/icons-vue'

const props = defineProps<{ entry: 'manual' | 'scan' | 'import' }>()
const router = useRouter()
const { t } = useI18n()

const title = computed(() => {
  if (props.entry === 'scan') return t('guide.scan')
  if (props.entry === 'manual') return t('guide.manual')
  return t('guide.import')
})

const description = computed(() => t('placeholder.comingSoon'))
</script>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 24px;
}
.placeholder-card {
  text-align: center;
  color: #606266;
}
.placeholder-card h2 {
  margin: 16px 0 8px;
  color: #303133;
}
</style>