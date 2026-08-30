import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import type { TotpData, TotpItem, TotpGroup } from '@/types'
import { createId } from '@/utils/uuid'
import * as storage from '@/services/storage'
import {
  hasShownBackupNotice,
  markBackupNoticeShown,
} from '@/services/backupNotice'

export type ItemRef = { groupId: string | null; itemId: string }

function emptyData(): TotpData {
  return { groups: [], ungrouped: [] }
}

export const useTotpStore = defineStore('totp', () => {
  const data = ref<TotpData>(emptyData())
  const searchQuery = ref('')
  const corrupted = ref(false)
  const showBackupNotice = ref(false)

  function locateItem(
    groupId: string | null,
    itemId: string,
  ): { list: TotpItem[]; index: number; item: TotpItem } | null {
    let list: TotpItem[] | null = null
    if (groupId) {
      const group = data.value.groups.find((g) => g.id === groupId)
      list = group ? group.items : null
    } else {
      list = data.value.ungrouped
    }
    if (!list) return null
    const index = list.findIndex((i) => i.id === itemId)
    if (index === -1) return null
    return { list, index, item: list[index] }
  }

  function findItem(itemId: string): TotpItem | null {
    for (const g of data.value.groups) {
      const item = g.items.find((i) => i.id === itemId)
      if (item) return item
    }
    return data.value.ungrouped.find((i) => i.id === itemId) ?? null
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  // init() 水合期间由存储加载的数据不需要立即回写
  let hydrating = false
  function schedulePersist() {
    if (hydrating) return
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      void storage.save(data.value)
    }, 150)
  }

  watch(data, schedulePersist, { deep: true })

  async function init() {
    corrupted.value = false
    showBackupNotice.value = false
    let loaded: TotpData
    try {
      loaded = await storage.load()
    } catch {
      if (await storage.hasStoredData()) {
        corrupted.value = true
        return
      }
      loaded = emptyData()
    }
    hydrating = true
    data.value = loaded
    await nextTick()
    hydrating = false
    const itemCount =
      loaded.ungrouped.length +
      loaded.groups.reduce((sum, g) => sum + g.items.length, 0)
    if (itemCount > 0 && !hasShownBackupNotice()) {
      markBackupNoticeShown()
      showBackupNotice.value = true
    }
  }

  async function saveNow() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    await storage.save(data.value)
  }

  async function resetCorrupted() {
    await storage.clearData()
    corrupted.value = false
    data.value = emptyData()
  }

  function setData(newData: TotpData) {
    data.value = newData
  }

  // ---- groups ----
  function addGroup(name: string): TotpGroup {
    const group: TotpGroup = {
      id: createId(),
      name,
      isExpanded: true,
      items: [],
    }
    data.value.groups.push(group)
    return group
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

  function renameGroup(groupId: string, name: string) {
    const group = data.value.groups.find((g) => g.id === groupId)
    if (group) group.name = name
  }

  function reorderGroups(groupIds: string[]) {
    const byId = new Map(data.value.groups.map((g) => [g.id, g]))
    data.value.groups = groupIds
      .map((id) => byId.get(id))
      .filter((g): g is TotpGroup => g !== undefined)
  }

  function moveGroup(groupId: string, direction: -1 | 1) {
    const idx = data.value.groups.findIndex((g) => g.id === groupId)
    const swap = idx + direction
    if (idx === -1 || swap < 0 || swap >= data.value.groups.length) return
    const groups = data.value.groups
    ;[groups[idx], groups[swap]] = [groups[swap], groups[idx]]
  }

  // ---- items ----
  function addItem(
    groupId: string | null,
    partial: Omit<TotpItem, 'id'>,
  ): TotpItem {
    const item: TotpItem = { id: createId(), ...partial }
    if (groupId) {
      const group = data.value.groups.find((g) => g.id === groupId)
      if (group) group.items.push(item)
      else data.value.ungrouped.push(item)
    } else {
      data.value.ungrouped.push(item)
    }
    return item
  }

  function removeItem(groupId: string | null, itemId: string) {
    const located = locateItem(groupId, itemId)
    if (located) located.list.splice(located.index, 1)
  }

  function batchRemove(selected: ItemRef[]) {
    for (const sel of selected) {
      removeItem(sel.groupId, sel.itemId)
    }
  }

  function reorderItems(groupId: string | null, itemIds: string[]) {
    const byId = new Map<string, TotpItem>()
    if (groupId) {
      const group = data.value.groups.find((g) => g.id === groupId)
      if (!group) return
      for (const i of group.items) byId.set(i.id, i)
      group.items = itemIds
        .map((id) => byId.get(id))
        .filter((i): i is TotpItem => i !== undefined)
    } else {
      for (const i of data.value.ungrouped) byId.set(i.id, i)
      data.value.ungrouped = itemIds
        .map((id) => byId.get(id))
        .filter((i): i is TotpItem => i !== undefined)
    }
  }

  function batchMove(selected: ItemRef[], targetGroupId: string | null) {
    const moved: TotpItem[] = []
    for (const sel of selected) {
      const located = locateItem(sel.groupId, sel.itemId)
      if (located) {
        located.list.splice(located.index, 1)
        moved.push(located.item)
      }
    }
    if (targetGroupId) {
      const group = data.value.groups.find((g) => g.id === targetGroupId)
      if (group) group.items.push(...moved)
      else data.value.ungrouped.push(...moved)
    } else {
      data.value.ungrouped.push(...moved)
    }
  }

  function updateItem(
    itemId: string,
    patch: Partial<Omit<TotpItem, 'id' | 'secret'>>,
  ) {
    const item = findItem(itemId)
    if (!item) return
    Object.assign(item, patch)
  }

  return {
    data,
    searchQuery,
    corrupted,
    showBackupNotice,
    init,
    saveNow,
    resetCorrupted,
    setData,
    addGroup,
    removeGroup,
    renameGroup,
    reorderGroups,
    moveGroup,
    addItem,
    removeItem,
    batchRemove,
    reorderItems,
    batchMove,
    findItem,
    updateItem,
  }
})