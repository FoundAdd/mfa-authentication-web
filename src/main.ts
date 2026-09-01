import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// Element Plus 暗色变量集:在 html.dark 下自动翻转所有 --el-* 语义变量
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import { i18n } from './locales'
import { registerSW } from './utils/sw'
import { registerBackHandler } from './services/backHandler'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.use(i18n)
app.mount('#app')

registerSW()
registerBackHandler()