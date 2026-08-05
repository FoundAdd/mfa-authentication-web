<template>
  <div id="app-root">
    <el-config-provider :locale="elementLocale">
      <router-view />
    </el-config-provider>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/settings'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'

const { locale } = useI18n()
const settingStore = useSettingStore()

const elementLocale = computed(() => {
  return locale.value === 'zh-CN' ? zhCn : en
})

onMounted(() => {
  settingStore.init()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
}

#app-root {
  min-height: 100vh;
  background: #f5f5f5;
}
</style>