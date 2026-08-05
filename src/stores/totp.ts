import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TotpData, TotpItem, TotpGroup } from '@/types'

export const useTotpStore = defineStore('totp', () => {
  const data = ref<TotpData>({
    groups: [],
    ungrouped: [],
  })

  const searchQuery = ref('')

  function setData(newData: TotpData) {
    data.value = newData
  }

  function addItem(groupId: string | null, item: TotpItem) {
    if (groupId) {
      const group = data.value.groups.find((g) => g.id === groupId)
      if (group) {
        group.items.push(item)
      }
    } else {
      data.value.ungrouped.push(item)
    }
  }

  function removeItem(groupId: string | null, itemId: string) {
    if (groupId) {
      const group = data.value.groups.find((g) => g.id === groupId)
      if (group) {
        const idx = group.items.findIndex((i) => i.id === itemId)
        if (idx !== -1) group.items.splice(idx, 1)
      }
    } else {
      const idx = data.value.ungrouped.findIndex((i) => i.id === itemId)
      if (idx !== -1) data.value.ungrouped.splice(idx, 1)
    }
  }

  function addGroup(group: TotpGroup) {
    data.value.groups.push(group)
  }

  function removeGroup(groupId: string, deleteItems: boolean) {
    const idx = data.value.groups.findIndex((g) => g.id === groupId)
    if (idx === -1) return
    const group = data.value.groups[idx]
    if (!deleteItems) {
      data.value.ungrouped.push(...group.items)
    }
    data.value.groups.splice(idx, 1)
  }

  return {
    data,
    searchQuery,
    setData,
    addItem,
    removeItem,
    addGroup,
    removeGroup,
  }
})