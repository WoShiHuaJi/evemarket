import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://esi.evetech.net/latest'
const CONCURRENCY = 12

const CATEGORIES = [
  'Ships',
  'Ship Equipment',
  'Manufacture & Research',
  'Implants & Boosters',
  'Ammunition & Charges',
  'Ship and Module Modifications',
  'Structures',
  'Drones',
]

async function get(path, retries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'X-Compatibility-Date': '2025-12-16' },
      })
      if (res.status === 420 || res.status >= 500) {
        if (i >= retries) throw new Error(`${path} -> ${res.status}`)
        await sleep(1000 * 2 ** i)
        continue
      }
      if (!res.ok) throw new Error(`${path} -> ${res.status}`)
      return await res.json()
    } catch (e) {
      if (i >= retries) throw e
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
  const out = new Array(items.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (idx < items.length) {
        const i = idx++
        out[i] = await fn(items[i], i)
        if (i > 0 && i % 500 === 0) console.log(`  ${label} ${i}/${items.length}`)
      }
    }),
  )
  return out
}

async function main() {
  console.log('1/5 fetching all market group details (en)...')
  const rawList = await get('/markets/groups/?datasource=tranquility')
  const idList = rawList.map((g) => (typeof g === 'number' ? g : g.market_group_id))
  const enGroups = await pool(idList, CONCURRENCY, (id) => get(`/markets/groups/${id}/?datasource=tranquility`), 'groups-en')

  console.log('2/5 fetching group zh names...')
  const zhGroups = await pool(idList, CONCURRENCY, (id) => get(`/markets/groups/${id}/?language=zh&datasource=tranquility`), 'groups-zh')
  const zhName = new Map(zhGroups.map((g) => [g.market_group_id, g.name]))

  const byId = new Map(enGroups.map((g) => [g.market_group_id, g]))
  const roots = enGroups.filter((g) => !g.parent_group_id && CATEGORIES.includes(g.name))
  if (roots.length !== CATEGORIES.length) {
    throw new Error(`root categories mismatch: found ${roots.map((r) => r.name).join(', ')}`)
  }

  const groupSet = new Map()
  const walk = (g, rootId) => {
    groupSet.set(g.market_group_id, {
      id: g.market_group_id,
      name: g.name,
      nameZh: zhName.get(g.market_group_id) ?? '',
      rootId,
      parentId: g.parent_group_id ?? null,
    })
    enGroups.filter((c) => c.parent_group_id === g.market_group_id).forEach((c) => walk(c, rootId))
  }
  roots.forEach((r) => walk(r, r.market_group_id))
  console.log(`  ${groupSet.size} groups under ${roots.length} categories`)

  const typeToGroup = new Map()
  for (const g of roots.flatMap((r) => [...groupSet.keys()].map((id) => byId.get(id)))) {
    for (const t of g.types ?? []) typeToGroup.set(t, g.market_group_id)
  }
  const typeIds = [...typeToGroup.keys()]
  console.log(`  ${typeIds.length} types`)

  console.log('3/5 fetching en type names (bulk)...')
  const enNames = new Map()
  for (let i = 0; i < typeIds.length; i += 1000) {
    const res = await post('/universe/names/?datasource=tranquility', typeIds.slice(i, i + 1000))
    for (const r of res) enNames.set(r.id, r.name)
  }

  console.log('4/5 fetching zh type names + volumes (this takes a few minutes)...')
  const zhNames = new Map()
  const volumes = new Map()
  await pool(typeIds, CONCURRENCY, async (id) => {
    const d = await get(`/universe/types/${id}/?language=zh&datasource=tranquility`)
    zhNames.set(id, d.name)
    volumes.set(id, d.packaged_volume ?? d.volume ?? 0)
  }, 'types-zh')

  console.log('5/5 resolving systems...')
  const idsRes = await post('/universe/ids/?datasource=tranquility', ['4-HWWF', 'Jita'])
  const hwwf = idsRes.systems?.find((s) => s.name === '4-HWWF')
  const jita = idsRes.systems?.find((s) => s.name === 'Jita')
  if (!hwwf || !jita) throw new Error('system resolution failed')

  const categories = roots.map((r) => ({
    id: r.market_group_id,
    name: r.name,
    nameZh: zhName.get(r.market_group_id) ?? '',
  }))

  const data = {
    generatedAt: new Date().toISOString(),
    categories,
    groups: Object.fromEntries([...groupSet.values()].map((g) => [g.id, { name: g.name, nameZh: g.nameZh, rootId: g.rootId, parentId: g.parentId }])),
    types: typeIds.map((id) => ({
      id,
      name: enNames.get(id) ?? '',
      nameZh: zhNames.get(id) ?? '',
      groupId: typeToGroup.get(id),
      volume: volumes.get(id) ?? 0,
    })),
    locations: {
      jita: { regionId: 10000002, systemId: jita.id, stationId: 60003760, label: 'Jita 4-4 CNAP' },
      hwwf: { regionId: 10000003, systemId: hwwf.id, label: '4-HWWF' },
    },
  }

  mkdirSync(join(ROOT, 'src/data'), { recursive: true })
  const out = join(ROOT, 'src/data/market-types.json')
  writeFileSync(out, JSON.stringify(data))
  console.log(`done -> ${out} (${(JSON.stringify(data).length / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
