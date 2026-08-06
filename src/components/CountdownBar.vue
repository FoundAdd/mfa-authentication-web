<template>
  <el-progress
    class="countdown"
    :percentage="percentage"
    :stroke-width="3"
    :show-text="false"
    :color="dangerColor"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useClockStore } from '@/stores/clock'

const props = defineProps<{ period: number }>()

const DANGER_COLOR = '#f56c6c'
const NORMAL_COLOR = '#67c23a'

const clock = useClockStore()
const remaining = computed(() => clock.remainingFor(props.period))
const percentage = computed(() =>
  Math.round((remaining.value / props.period) * 100),
)
const dangerColor = computed(() =>
  remaining.value <= 5 ? DANGER_COLOR : NORMAL_COLOR,
)
</script>

<style scoped>
.countdown {
  width: 100%;
}
</style>