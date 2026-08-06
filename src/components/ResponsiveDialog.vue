<template>
  <el-drawer
    v-if="isMobile"
    v-model="visible"
    direction="btt"
    :size="drawerSize"
    :title="title"
    :append-to-body="true"
    @closed="emit('closed')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-drawer>
  <el-dialog
    v-else
    v-model="visible"
    :title="title"
    :width="width"
    :append-to-body="true"
    @closed="emit('closed')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBreakpoints } from '@vueuse/core'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    width?: string
    drawerSize?: string | number
  }>(),
  {
    title: '',
    width: '420px',
    drawerSize: 'auto',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  closed: []
}>()

const breakpoints = useBreakpoints({ mobile: 768 })
const isMobile = breakpoints.smaller('mobile')

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
</script>