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

const { EVE_CLIENT_ID, EVE_CLIENT_SECRET, EVE_REFRESH_TOKEN } = process.env
const EVE_STRUCTURE_IDS = (process.env.EVE_STRUCTURE_IDS || '1053654548169,1053970513596,1034736246072,1035603743755')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean)

async function getAccessToken() {
  const basic = Buffer.from(`${EVE_CLIENT_ID}:${EVE_CLIENT_SECRET}`).toString('base64')
  const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${EVE_REFRESH_TOKEN}`,
  })
  const j = await res.json()
  if (!j.access_token) throw new Error(`SSO token refresh failed: ${JSON.stringify(j)}`)
  return j.access_token
}

async function fetchStructureOrders(accessToken, structureId) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Compatibility-Date': '2025-12-16' }
  const first = await fetch(`${ESI}/markets/structures/${structureId}/?datasource=tranquility&page=1`, { headers })
  if (!first.ok) throw new Error(`structure ${structureId}: ESI ${first.status}`)
  const pages = Number(first.headers.get('x-pages')) || 1
  const all = [...(await first.json())]
  if (pages > 1) {
    const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2)
    const results = await runPool(rest, 4, async (page) => {
      const r = await fetch(`${ESI}/markets/structures/${structureId}/?datasource=tranquility&page=${page}`, { headers })
      if (!r.ok) throw new Error(`structure ${structureId} page ${page}: ESI ${r.status}`)
      return r.json()
    })
    for (const d of results) all.push(...d)
  }
  console.log(`structure ${structureId}: ${pages} pages, ${all.length} orders`)
  return all
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
  const [jita, hwwfRegion] = await Promise.all([fetchRegionOrders(JITA_REGION), fetchRegionOrders(HWWF_REGION)])

  let hwwf = hwwfRegion.filter((o) => o.system_id === HWWF_SYSTEM)
  if (EVE_CLIENT_ID && EVE_CLIENT_SECRET && EVE_REFRESH_TOKEN) {
    try {
      const token = await getAccessToken()
      for (const id of EVE_STRUCTURE_IDS) {
        try {
          hwwf.push(...(await fetchStructureOrders(token, id)))
        } catch (e) {
          console.error(e.message)
        }
      }
      console.log(`4-HWWF orders total (region + structures): ${hwwf.length}`)
    } catch (e) {
      console.error(`SSO failed, fallback to region orders only: ${e.message}`)
    }
  }

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
    if (process.env.OUTPUT_FILE) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.OUTPUT_FILE, payload)
      console.log(`DRY_RUN: payload written to ${process.env.OUTPUT_FILE}`)
    } else {
      console.log('DRY_RUN: skipping KV write')
    }
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
