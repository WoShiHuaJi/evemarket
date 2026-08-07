import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://esi.evetech.net/latest'
const CONCURRENCY = 8

const zhNamesPath = join(ROOT, 'src/data/corp-names-zh.json')
const zhNames = existsSync(zhNamesPath) ? JSON.parse(readFileSync(zhNamesPath, 'utf8')) : {}

async function get(path, retries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'X-Compatibility-Date': '2025-12-16' },
      })
      if (res.status === 404) return null
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        if (i >= retries) return null
        await sleep(1000 * 2 ** i)
        continue
      }
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (i >= retries) return null
      await sleep(1000 * 2 ** i)
    }
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Compatibility-Date': '2025-12-16' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`)
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pool(items, size, fn, label) {
  let idx = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (idx < items.length) {
        const i = idx++
        await fn(items[i], i)
        if (i > 0 && i % 200 === 0) console.log(`  ${label} ${i}/${items.length}`)
      }
    }),
  )
}

async function main() {
  console.log('1/4 fetching NPC corporations...')
  const corpIds = await get('/corporations/npccorps/?datasource=tranquility')
  console.log(`  ${corpIds.length} corps`)

  console.log('2/4 fetching corp names...')
  const corps = []
  await pool(corpIds, CONCURRENCY, async (id) => {
    const en = await get(`/corporations/${id}/?datasource=tranquility`)
    if (en?.name) corps.push({ id, name: en.name, nameZh: zhNames[String(id)] ?? en.name })
  }, 'corps')

  console.log('3/4 fetching LP store offers...')
  const offers = []
  const typeIdSet = new Set()
  await pool(corpIds, CONCURRENCY, async (id) => {
    const data = await get(`/loyalty/stores/${id}/offers/?datasource=tranquility`)
    if (!Array.isArray(data) || data.length === 0) return
    for (const o of data) {
      typeIdSet.add(o.type_id)
      const req = (o.required_items ?? []).map((r) => {
        typeIdSet.add(r.type_id)
        return [r.type_id, r.quantity]
      })
      offers.push({ c: id, t: o.type_id, q: o.quantity, lp: o.lp_cost, isk: o.isk_cost, req })
    }
  }, 'offers')
  console.log(`  ${offers.length} offers, ${typeIdSet.size} item types`)

  console.log('4/4 fetching item names...')
  const typeIds = [...typeIdSet]
  const enNames = new Map()
  for (let i = 0; i < typeIds.length; i += 1000) {
    const res = await post('/universe/names/?datasource=tranquility', typeIds.slice(i, i + 1000))
    for (const r of res) enNames.set(r.id, r.name)
  }
  const types = {}
  await pool(typeIds, CONCURRENCY, async (id) => {
    const zh = await get(`/universe/types/${id}/?language=zh&datasource=tranquility`)
    types[id] = { name: enNames.get(id) ?? '', nameZh: zh?.name ?? '' }
  }, 'names')

  const out = {
    generatedAt: new Date().toISOString(),
    corps: corps.filter((c) => offers.some((o) => o.c === c.id)),
    types,
    offers,
  }
  mkdirSync(join(ROOT, 'src/data'), { recursive: true })
  const file = join(ROOT, 'src/data/lp-offers.json')
  writeFileSync(file, JSON.stringify(out))
  console.log(`done -> ${file} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB), ${out.corps.length} corps with LP stores`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
