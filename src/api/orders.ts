import { esiGet, runPool } from './esi'
import { FETCH_CONCURRENCY } from '../config'

export interface Order {
  duration: number
  is_buy_order: boolean
  issued: string
  location_id: number
  min_volume: number
  order_id: number
  price: number
  range: string
  system_id: number
  type_id: number
  volume_remain: number
  volume_total: number
}

export interface RegionOrdersResult {
  orders: Order[]
  expiresAt: number
  pages: number
  notModified: boolean
}

export async function fetchAllRegionOrders(
  regionId: number,
  onProgress?: (done: number, total: number) => void,
): Promise<RegionOrdersResult> {
  const base = `/markets/${regionId}/orders/?datasource=tranquility&order_type=all`
  const first = await esiGet<Order[]>(`${base}&page=1`)
  const totalPages = first.pages
  onProgress?.(1, totalPages)

  const all: Order[] = [...first.data]
  let expiresAt = first.expiresAt

  if (totalPages > 1) {
    const rest = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    let done = 1
    const results = await runPool(rest, FETCH_CONCURRENCY, async (page) => {
      const r = await esiGet<Order[]>(`${base}&page=${page}`)
      done++
      onProgress?.(done, totalPages)
      return r
    })
    for (const r of results) {
      all.push(...r.data)
      expiresAt = Math.min(expiresAt, r.expiresAt)
    }
  }

  return { orders: all, expiresAt, pages: totalPages, notModified: first.notModified }
}
