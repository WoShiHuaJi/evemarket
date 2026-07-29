const ESI = 'https://esi.evetech.net/latest'
const ESI_HEADERS = { 'X-Compatibility-Date': '2025-12-16' }
const CONCURRENCY = 12

const JITA_REGION = 10000002
const JITA_STATION = 60003760
const HWWF_REGION = 10000003
const HWWF_SYSTEM = 30000240

const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, DRY_RUN } = process.env
if (!DRY_RUN && (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID)) {
  console.error('missing env: CF_API_TOKEN / CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID')
  process.exit(1)
}

async function esiJson(path, retries = 4) {
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
    return { data: await res.json(), pages }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runPool(items, size, fn) {
  const out = new Array(items.length)
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

async function fetchRegionOrders(regionId) {
  const base = `/markets/${regionId}/orders/?datasource=tranquility&order_type=all`
  const first = await esiJson(`${base}&page=1`)
  const all = [...first.data]
  if (first.pages > 1) {
    const rest = Array.from({ length: first.pages - 1 }, (_, i) => i + 2)
    const results = await runPool(rest, CONCURRENCY, (page) => esiJson(`${base}&page=${page}`))
    for (const r of results) all.push(...r.data)
  }
  console.log(`region ${regionId}: ${first.pages} pages, ${all.length} orders`)
  return all
}

async function main() {
  const [jita, hwwf] = await Promise.all([fetchRegionOrders(JITA_REGION), fetchRegionOrders(HWWF_REGION)])

  const rows = {}
  const touch = (id) => (rows[id] ??= [0, 0, 0, 0])
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

  const payload = JSON.stringify({ updatedAt: Date.now(), rows })
  console.log(`aggregated ${Object.keys(rows).length} types, payload ${(payload.length / 1024).toFixed(0)} KB`)

  if (DRY_RUN) {
    console.log('DRY_RUN: skipping KV write')
    return
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent('prices:latest')}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: payload,
  })
  const j = await res.json()
  if (!j.success) throw new Error(`KV write failed: ${JSON.stringify(j.errors)}`)
  console.log('KV updated successfully')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
