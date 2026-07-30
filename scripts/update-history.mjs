import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ESI = 'https://esi.evetech.net/latest'
const ESI_HEADERS = { 'X-Compatibility-Date': '2025-12-16' }
const REGION = 10000003
const CONCURRENCY = 8

const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, DRY_RUN, OUTPUT_FILE, LIMIT } = process.env
if (!DRY_RUN && (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID)) {
  console.error('missing env: CF_API_TOKEN / CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID')
  process.exit(1)
}

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/market-types.json'), 'utf8'))
let typeIds = data.types.map((t) => t.id)
if (LIMIT) typeIds = typeIds.slice(0, Number(LIMIT))
console.log(`fetching history for ${typeIds.length} types...`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHistory(typeId, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${ESI}/markets/${REGION}/history/?datasource=tranquility&type_id=${typeId}`, {
        headers: ESI_HEADERS,
      })
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        if (attempt >= retries) return null
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
        continue
      }
      if (res.status === 404) return []
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (attempt >= retries) return null
      await sleep(1000 * 2 ** attempt)
    }
  }
}

let idx = 0
let failed = 0
const vol = {}
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < typeIds.length) {
      const id = typeIds[idx++]
      const history = await fetchHistory(id)
      if (history === null) {
        failed++
        continue
      }
      const sorted = [...history].sort((a, b) => (a.date < b.date ? 1 : -1))
      const v7 = sorted.slice(0, 7).reduce((s, e) => s + e.volume, 0)
      const v30 = sorted.slice(0, 30).reduce((s, e) => s + e.volume, 0)
      if (v7 > 0 || v30 > 0) vol[id] = [v7, v30]
      if (idx % 500 === 0) console.log(`  ${idx}/${typeIds.length}`)
    }
  }),
)

const payload = JSON.stringify({ updatedAt: Date.now(), vol })
console.log(`done: ${Object.keys(vol).length} types with volume, ${failed} failed, payload ${(payload.length / 1024).toFixed(0)} KB`)

if (DRY_RUN) {
  if (OUTPUT_FILE) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(OUTPUT_FILE, payload)
    console.log(`DRY_RUN: written to ${OUTPUT_FILE}`)
  } else {
    console.log('DRY_RUN: skipping KV write')
  }
  process.exit(0)
}

const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent('volumes:latest')}`
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: payload,
})
const j = await res.json()
if (!j.success) {
  console.error(`KV write failed: ${JSON.stringify(j.errors)}`)
  process.exit(1)
}
console.log('KV updated successfully')
