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
      component: () => import('@/views/PlaceholderView.vue'),
      props: { entry: 'manual' },
    },
    {
      path: '/scan',
      name: 'scan',
      component: () => import('@/views/PlaceholderView.vue'),
      props: { entry: 'scan' },
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('@/views/PlaceholderView.vue'),
      props: { entry: 'import' },
    },
    {
      path: '/edit',
      name: 'edit',
      component: () => import('@/views/PlaceholderView.vue'),
      props: { entry: 'manual' },
    },
  ],
})

export default router