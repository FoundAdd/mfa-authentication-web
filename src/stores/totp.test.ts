import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import localforage from 'localforage'
import { useTotpStore } from '@/stores/totp'
import type { TotpItem } from '@/types'

function item(issuer: string, label: string, secret: string): Omit<TotpItem, 'id'> {
  return {
    issuer,
    label,
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }
}

beforeEach(async () => {
  await localforage.clear()
  localStorage.removeItem('_dk')
  localStorage.removeItem('_backup_reminded')
  setActivePinia(createPinia())
})

describe('group delete semantics', () => {
  it('moves group items to ungrouped when deleteItems is false', () => {
    const store = useTotpStore()
    const group = store.addGroup('Work')
    store.addItem(group.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.addItem(group.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))

    store.removeGroup(group.id, false)

    expect(store.data.groups).toHaveLength(0)
    expect(store.data.ungrouped).toHaveLength(2)
    expect(store.data.ungrouped.map((i) => i.issuer)).toEqual(['GitHub', 'Google'])
  })

  it('deletes group items when deleteItems is true', () => {
    const store = useTotpStore()
    const group = store.addGroup('Work')
    store.addItem(group.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))

    store.removeGroup(group.id, true)

    expect(store.data.groups).toHaveLength(0)
    expect(store.data.ungrouped).toHaveLength(0)
  })
})

describe('batch move', () => {
  it('moves selected items to a target group', () => {
    const store = useTotpStore()
    const g1 = store.addGroup('A')
    const g2 = store.addGroup('B')
    const a = store.addItem(g1.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    const b = store.addItem(g1.id, item('Google', 'b', 'KRSXG5CTMVRXEZLU'))
    const c = store.addItem(null, item('Apple', 'c', 'MFRGGZDFMZTWQ2LK'))

    store.batchMove(
      [
        { groupId: g1.id, itemId: a.id },
        { groupId: g1.id, itemId: b.id },
      ],
      g2.id,
    )

    expect(store.data.groups.find((g) => g.id === g1.id)?.items).toHaveLength(0)
    expect(store.data.groups.find((g) => g.id === g2.id)?.items).toEqual([a, b])
    expect(store.data.ungrouped).toEqual([c])
  })

  it('moves selected items to ungrouped when target is null', () => {
    const store = useTotpStore()
    const g1 = store.addGroup('A')
    const a = store.addItem(g1.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))

    store.batchMove([{ groupId: g1.id, itemId: a.id }], null)

    expect(store.data.groups.find((g) => g.id === g1.id)?.items).toHaveLength(0)
    expect(store.data.ungrouped).toEqual([a])
  })
})

describe('corruption detection', () => {
  it('flags corrupted when device key is cleared', async () => {
    const store = useTotpStore()
    const group = store.addGroup('Work')
    store.addItem(group.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    await store.saveNow()

    localStorage.removeItem('_dk')
    await store.init()

    expect(store.corrupted).toBe(true)
  })

  it('resetCorrupted clears data and corruption flag', async () => {
    const store = useTotpStore()
    const group = store.addGroup('Work')
    store.addItem(group.id, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    await store.saveNow()

    localStorage.removeItem('_dk')
    await store.init()
    expect(store.corrupted).toBe(true)

    await store.resetCorrupted()
    expect(store.corrupted).toBe(false)
    expect(store.data.groups).toHaveLength(0)
    expect(store.data.ungrouped).toHaveLength(0)
    expect(await localforage.getItem('totp_data')).toBeNull()
  })
})

describe('item CRUD', () => {
  it('adds item to ungrouped when groupId is null', () => {
    const store = useTotpStore()
    store.addItem(null, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    expect(store.data.ungrouped).toHaveLength(1)
  })

  it('updateItem does not change secret', () => {
    const store = useTotpStore()
    const a = store.addItem(null, item('GitHub', 'a', 'JBSWY3DPEHPK3PXP'))
    store.updateItem(a.id, { label: 'new-label', issuer: 'New' })
    const updated = store.data.ungrouped[0]
    expect(updated.label).toBe('new-label')
    expect(updated.issuer).toBe('New')
    expect(updated.secret).toBe('JBSWY3DPEHPK3PXP')
  })
})