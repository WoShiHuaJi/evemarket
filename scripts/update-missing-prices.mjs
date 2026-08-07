import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ESI = 'https://esi.evetech.net/latest'
const ESI_HEADERS = { 'X-Compatibility-Date': '2025-12-16' }
const JITA_REGION = 10000002
const JITA_STATION = 60003760
const CONCURRENCY = 8

const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, DRY_RUN } = process.env
if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID) {
  console.error('missing env: CF_API_TOKEN / CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID')
  process.exit(1)
}

const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values`
const cfHeaders = { Authorization: `Bearer ${CF_API_TOKEN}` }

const kvRes = await fetch(`${kvBase}/${encodeURIComponent('prices:latest')}`, { headers: cfHeaders })
if (!kvRes.ok) throw new Error(`KV read failed: ${kvRes.status}`)
const payload = await kvRes.json()
const rows = payload.rows

const lpData = JSON.parse(readFileSync(join(ROOT, 'src/data/lp-offers.json'), 'utf8'))
const lpTypeIds = new Set()
for (const o of lpData.offers) {
  lpTypeIds.add(o.t)
  for (const [tid] of o.req) lpTypeIds.add(tid)
}

const missing = [...lpTypeIds].filter((id) => {
  const r = rows[String(id)]
  return !r || (r[0] === 0 && r[1] === 0)
})
console.log(`LP types: ${lpTypeIds.size}, missing Jita prices: ${missing.length}`)

if (missing.length === 0) {
  console.log('nothing to do')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchTypeOrders(typeId, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(
        `${ESI}/markets/${JITA_REGION}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`,
        { headers: ESI_HEADERS },
      )
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        if (attempt >= retries) return null
        await sleep(1000 * 2 ** attempt)
        continue
      }
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (attempt >= retries) return null
      await sleep(1000 * 2 ** attempt)
    }
  }
}

let idx = 0
let filled = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < missing.length) {
      const id = missing[idx++]
      const orders = await fetchTypeOrders(id)
      if (!orders) continue
      let sell = 0
      let buy = 0
      for (const o of orders) {
        if (o.location_id !== JITA_STATION) continue
        if (o.is_buy_order) {
          if (o.price > buy) buy = o.price
        } else if (sell === 0 || o.price < sell) {
          sell = o.price
        }
      }
      if (sell > 0 || buy > 0) {
        const r = (rows[String(id)] ??= [0, 0, 0, 0])
        if (r[0] === 0 && sell > 0) r[0] = sell
        if (r[1] === 0 && buy > 0) r[1] = buy
        filled++
      }
    }
  }),
)
console.log(`filled ${filled} types`)

if (filled === 0) process.exit(0)

payload.updatedAt = Date.now()
const body = JSON.stringify(payload)
if (DRY_RUN) {
  console.log(`DRY_RUN: would write ${(body.length / 1024).toFixed(0)} KB`)
  process.exit(0)
}
const putRes = await fetch(`${kvBase}/${encodeURIComponent('prices:latest')}`, {
  method: 'PUT',
  headers: { ...cfHeaders, 'Content-Type': 'application/json' },
  body,
})
const j = await putRes.json()
if (!j.success) throw new Error(`KV write failed: ${JSON.stringify(j.errors)}`)
console.log('KV updated successfully')
