import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/add',
      name: 'add',
      component: () => import('@/views/AddEditView.vue'),
    },
    {
      path: '/edit',
      name: 'edit',
      component: () => import('@/views/AddEditView.vue'),
    },
    {
      path: '/scan',
      name: 'scan',
      component: () => import('@/views/ScanView.vue'),
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('@/views/PlaceholderView.vue'),
      props: { entry: 'import' },
    },
  ],
})

export default router