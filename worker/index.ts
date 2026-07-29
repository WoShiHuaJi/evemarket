export interface Env {
  PRICES: KVNamespace
  ASSETS: Fetcher
}

const ESI = 'https://esi.evetech.net/latest'
const ESI_HEADERS = { 'X-Compatibility-Date': '2025-12-16' }
const CONCURRENCY = 12

const JITA_REGION = 10000002
const JITA_STATION = 60003760
const HWWF_REGION = 10000003
const HWWF_SYSTEM = 30000240

const KV_KEY = 'prices:latest'

interface Order {
  is_buy_order: boolean
  location_id: number
  system_id: number
  type_id: number
  price: number
}

async function esiJson<T>(path: string, retries = 4): Promise<{ data: T; pages: number }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ESI}${path}`, { headers: ESI_HEADERS })
    if (res.status === 420 || res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`ESI ${res.status}: ${path}`)
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
      continue
    }
    if (!res.ok) throw new Error(`ESI ${res.status}: ${path}`)
    const pages = Number(res.headers.get('x-pages')) || 1
    return { data: (await res.json()) as T, pages }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function fetchRegionOrders(regionId: number): Promise<Order[]> {
  const base = `/markets/${regionId}/orders/?datasource=tranquility&order_type=all`
  const first = await esiJson<Order[]>(`${base}&page=1`)
  const all = [...first.data]
  if (first.pages > 1) {
    const rest = Array.from({ length: first.pages - 1 }, (_, i) => i + 2)
    const results = await runPool(rest, CONCURRENCY, (page) => esiJson<Order[]>(`${base}&page=${page}`))
    for (const r of results) all.push(...r.data)
  }
  return all
}

async function aggregate(): Promise<string> {
  const [jita, hwwf] = await Promise.all([fetchRegionOrders(JITA_REGION), fetchRegionOrders(HWWF_REGION)])

  const rows: Record<number, [number, number, number, number]> = {}
  const touch = (id: number) => (rows[id] ??= [0, 0, 0, 0])

  for (const o of jita) {
    if (o.location_id !== JITA_STATION) continue
    const r = touch(o.type_id)
    if (o.is_buy_order) {
      if (o.price > r[1]) r[1] = o.price
    } else if (r[0] === 0 || o.price < r[0]) {
      r[0] = o.price
    }
  }
  for (const o of hwwf) {
    if (o.system_id !== HWWF_SYSTEM) continue
    const r = touch(o.type_id)
    if (o.is_buy_order) {
      if (o.price > r[3]) r[3] = o.price
    } else if (r[2] === 0 || o.price < r[2]) {
      r[2] = o.price
    }
  }

  return JSON.stringify({ updatedAt: Date.now(), rows })
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      aggregate().then((payload) => env.PRICES.put(KV_KEY, payload)),
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/prices') {
      const payload = await env.PRICES.get(KV_KEY)
      if (!payload) {
        return new Response(JSON.stringify({ error: 'no data yet' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }
      return new Response(payload, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30',
        },
      })
    }
    return env.ASSETS.fetch(request)
  },
}
