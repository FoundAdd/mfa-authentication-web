<template>
  <div
    class="avatar"
    :style="{
      backgroundColor: bg,
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.45)}px`,
    }"
  >
    {{ initial }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { avatarColor, avatarInitial } from '@/utils/avatar'

const props = withDefaults(defineProps<{ issuer: string; size?: number }>(), {
  size: 40,
})

const bg = computed(() => avatarColor(props.issuer))
const initial = computed(() => avatarInitial(props.issuer))
</script>

<style scoped>
.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  border-radius: 50%;
  flex-shrink: 0;
  user-select: none;
}
</style>