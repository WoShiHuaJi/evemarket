import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchAllRegionOrders, type Order } from '../api/orders'
import { getErrorLimitRemain, onErrorLimitChange } from '../api/esi'
import { ERROR_LIMIT_PAUSE_THRESHOLD, REFRESH_MIN_INTERVAL_MS } from '../config'
import rawData from '../data/market-types.json'

export interface TypeMeta {
  id: number
  name: string
  nameZh: string
  groupId: number
}

export interface PriceRow {
  type: TypeMeta
  categoryId: number
  jitaSell: number | null
  jitaBuy: number | null
  hwwfSell: number | null
  hwwfBuy: number | null
  vol7: number | null
  vol30: number | null
  jToHProfit: number | null
  jToHPct: number | null
  hToJProfit: number | null
  hToJPct: number | null
}

interface MarketData {
  generatedAt: string
  categories: { id: number; name: string; nameZh: string }[]
  groups: Record<string, { name: string; nameZh: string; rootId: number; parentId: number | null }>
  types: TypeMeta[]
  locations: {
    jita: { regionId: number; systemId: number; stationId: number; label: string }
    hwwf: { regionId: number; systemId: number; label: string }
  }
}

const data = rawData as unknown as MarketData
const groupRoot = new Map<number, number>()
for (const t of data.types) {
  const g = data.groups[String(t.groupId)]
  if (g) groupRoot.set(t.id, g.rootId)
}

export const useMarketStore = defineStore('market', () => {
  const categories = data.categories
  const locations = data.locations

  const jitaOrders = ref<Order[]>([])
  const hwwfOrders = ref<Order[]>([])
  const serverRows = ref<PriceRow[] | null>(null)
  const serverVolumes = ref<Record<string, [number, number]> | null>(null)
  const source = ref<'server' | 'local'>('local')
  const refreshing = ref(false)
  const progress = ref<{ jita: [number, number]; hwwf: [number, number] }>({ jita: [0, 0], hwwf: [0, 0] })
  const lastUpdatedAt = ref<number | null>(null)
  const nextRefreshAt = ref<number | null>(null)
  const error = ref<string | null>(null)
  const errorLimitRemain = ref<number | null>(getErrorLimitRemain())
  onErrorLimitChange(() => (errorLimitRemain.value = getErrorLimitRemain()))

  let timer: ReturnType<typeof setTimeout> | null = null
  let serverTimer: ReturnType<typeof setTimeout> | null = null
  let pendingExpiresAt = Date.now()

  function applyServerPayload(payload: { updatedAt: number; rows: Record<string, [number, number, number, number]> }) {
    const z = (v: number) => (v === 0 ? null : v)
    const volumes = serverVolumes.value
    serverRows.value = data.types.map((t) => {
      const r = payload.rows[String(t.id)]
      const v = volumes?.[String(t.id)]
      const js = r ? z(r[0]) : null
      const jb = r ? z(r[1]) : null
      const hs = r ? z(r[2]) : null
      const hb = r ? z(r[3]) : null
      const jToHProfit = js !== null && hs !== null ? hs - js : null
      const hToJProfit = hs !== null && jb !== null ? jb - hs : null
      return {
        type: t,
        categoryId: groupRoot.get(t.id) ?? 0,
        jitaSell: js,
        jitaBuy: jb,
        hwwfSell: hs,
        hwwfBuy: hb,
        vol7: v ? v[0] : null,
        vol30: v ? v[1] : null,
        jToHProfit,
        jToHPct: jToHProfit !== null && js! > 0 ? (jToHProfit / js!) * 100 : null,
        hToJProfit,
        hToJPct: hToJProfit !== null && hs! > 0 ? (hToJProfit / hs!) * 100 : null,
      }
    })
    lastUpdatedAt.value = payload.updatedAt
  }

  let cachedPricesPayload: { updatedAt: number; rows: Record<string, [number, number, number, number]> } | null = null

  async function fetchServerPrices(): Promise<boolean> {
    try {
      const res = await fetch('/api/prices')
      if (!res.ok) return false
      const payload = await res.json()
      if (!payload || typeof payload.updatedAt !== 'number' || !payload.rows) return false
      cachedPricesPayload = payload
      applyServerPayload(payload)
      return true
    } catch {
      return false
    }
  }

  async function fetchServerVolumes(): Promise<void> {
    try {
      const res = await fetch('/api/volumes')
      if (!res.ok) return
      const payload = await res.json()
      if (!payload || !payload.vol) return
      serverVolumes.value = payload.vol
      if (cachedPricesPayload) applyServerPayload(cachedPricesPayload)
    } catch {
      // 销量数据缺失不影响主流程
    }
  }

  function scheduleServerPoll() {
    if (serverTimer) clearTimeout(serverTimer)
    serverTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') {
        const ok = await fetchServerPrices()
        if (!ok) {
          source.value = 'local'
          serverRows.value = null
          refresh()
          return
        }
      }
      scheduleServerPoll()
    }, 60_000)
  }

  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    error.value = null
    try {
      const [jita, hwwf] = await Promise.all([
        fetchAllRegionOrders(locations.jita.regionId, (d, t) => (progress.value.jita = [d, t])),
        fetchAllRegionOrders(locations.hwwf.regionId, (d, t) => (progress.value.hwwf = [d, t])),
      ])
      jitaOrders.value = jita.orders
      hwwfOrders.value = hwwf.orders
      lastUpdatedAt.value = Date.now()
      pendingExpiresAt = Math.min(jita.expiresAt, hwwf.expiresAt)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      pendingExpiresAt = Date.now() + 60_000
    } finally {
      refreshing.value = false
      scheduleNext()
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer)
    let delay = Math.max(pendingExpiresAt - Date.now(), REFRESH_MIN_INTERVAL_MS)
    if (errorLimitRemain.value !== null && errorLimitRemain.value < ERROR_LIMIT_PAUSE_THRESHOLD) {
      delay = Math.max(delay, 60_000)
    }
    nextRefreshAt.value = Date.now() + delay
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible') refresh()
      else scheduleNext()
    }, delay)
  }

  async function start() {
    document.addEventListener('visibilitychange', onVisibility)
    if (await fetchServerPrices()) {
      source.value = 'server'
      fetchServerVolumes()
      scheduleServerPoll()
    } else {
      refresh()
    }
  }

  function manualRefresh() {
    if (source.value === 'server') {
      fetchServerPrices()
      fetchServerVolumes()
    } else {
      refresh()
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && !refreshing.value) {
      if (source.value === 'server') {
        fetchServerPrices()
        scheduleServerPoll()
        return
      }
      if (Date.now() >= pendingExpiresAt) {
        if (timer) clearTimeout(timer)
        refresh()
      } else {
        scheduleNext()
      }
    }
  }

  const rows = computed<PriceRow[]>(() => {
    if (serverRows.value) return serverRows.value
    const jitaByType = new Map<number, { sell: number | null; buy: number | null }>()
    const stationId = locations.jita.stationId
    for (const o of jitaOrders.value) {
      if (o.location_id !== stationId) continue
      let e = jitaByType.get(o.type_id)
      if (!e) {
        e = { sell: null, buy: null }
        jitaByType.set(o.type_id, e)
      }
      if (o.is_buy_order) {
        if (e.buy === null || o.price > e.buy) e.buy = o.price
      } else if (e.sell === null || o.price < e.sell) {
        e.sell = o.price
      }
    }

    const hwwfSystemId = locations.hwwf.systemId
    const hwwfByType = new Map<number, { sell: number | null; buy: number | null }>()
    for (const o of hwwfOrders.value) {
      if (o.system_id !== hwwfSystemId) continue
      let e = hwwfByType.get(o.type_id)
      if (!e) {
        e = { sell: null, buy: null }
        hwwfByType.set(o.type_id, e)
      }
      if (o.is_buy_order) {
        if (e.buy === null || o.price > e.buy) e.buy = o.price
      } else if (e.sell === null || o.price < e.sell) {
        e.sell = o.price
      }
    }

    return data.types.map((t) => {
      const j = jitaByType.get(t.id) ?? { sell: null, buy: null }
      const h = hwwfByType.get(t.id) ?? { sell: null, buy: null }
      const jToHProfit = j.sell !== null && h.sell !== null ? h.sell - j.sell : null
      const hToJProfit = h.sell !== null && j.buy !== null ? j.buy - h.sell : null
      return {
        type: t,
        categoryId: groupRoot.get(t.id) ?? 0,
        jitaSell: j.sell,
        jitaBuy: j.buy,
        hwwfSell: h.sell,
        hwwfBuy: h.buy,
        vol7: null,
        vol30: null,
        jToHProfit,
        jToHPct: jToHProfit !== null && j.sell! > 0 ? (jToHProfit / j.sell!) * 100 : null,
        hToJProfit,
        hToJPct: hToJProfit !== null && h.sell! > 0 ? (hToJProfit / h.sell!) * 100 : null,
      }
    })
  })

  return {
    categories,
    locations,
    rows,
    source,
    refreshing,
    progress,
    lastUpdatedAt,
    nextRefreshAt,
    error,
    errorLimitRemain,
    refresh,
    manualRefresh,
    start,
  }
})
