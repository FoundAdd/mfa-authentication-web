<template>
  <div id="app-root">
    <el-config-provider :locale="elementLocale">
      <router-view />
      <UpdateDialog />
    </el-config-provider>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/settings'
import { useAppUpdateStore } from '@/stores/appUpdate'
import type { LocaleType } from '@/locales'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import ja from 'element-plus/es/locale/lang/ja'
import ko from 'element-plus/es/locale/lang/ko'
import de from 'element-plus/es/locale/lang/de'
import fr from 'element-plus/es/locale/lang/fr'
import it from 'element-plus/es/locale/lang/it'
import es from 'element-plus/es/locale/lang/es'
import ru from 'element-plus/es/locale/lang/ru'
import pt from 'element-plus/es/locale/lang/pt'
import nl from 'element-plus/es/locale/lang/nl'
import ar from 'element-plus/es/locale/lang/ar'
import UpdateDialog from '@/components/UpdateDialog.vue'

const { locale } = useI18n()
const settingStore = useSettingStore()
const appUpdateStore = useAppUpdateStore()

const elementLocales: Record<LocaleType, typeof en> = {
  'zh-CN': zhCn,
  'en': en,
  'ja': ja,
  'ko': ko,
  'de': de,
  'fr': fr,
  'it': it,
  'es': es,
  'ru': ru,
  'pt': pt,
  'nl': nl,
  'ar': ar,
}

const elementLocale = computed(() => {
  return elementLocales[locale.value as LocaleType] ?? en
})

onMounted(async () => {
  await settingStore.init()
  // 启动后延迟检查 App 更新(仅在原生环境且用户开启检测时执行)
  void appUpdateStore.autoCheck()
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
  background: var(--app-bg);
}
</style>