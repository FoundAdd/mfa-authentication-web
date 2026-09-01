/// <reference types="vite/client" />

// App 内更新检测的 Release 仓库地址(CI 构建时注入)
interface ImportMetaEnv {
  readonly VITE_RELEASE_REPO_URL?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}