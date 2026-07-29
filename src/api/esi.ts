import { ESI_BASE, ESI_COMPAT_DATE } from '../config'

export interface EsiResponse<T> {
  data: T
  expiresAt: number
  etag: string | null
  notModified: boolean
  pages: number
  errorLimitRemain: number | null
}

interface CacheEntry {
  etag: string
  expiresAt: number
  data: unknown
}

const cache = new Map<string, CacheEntry>()
let errorLimitRemain: number | null = null
const listeners = new Set<() => void>()

export function onErrorLimitChange(fn: () => void) {
  listeners.add(fn)
}
export function getErrorLimitRemain() {
  return errorLimitRemain
}
function setErrorLimitRemain(v: number | null) {
  errorLimitRemain = v
  listeners.forEach((fn) => fn())
}

export async function esiGet<T>(path: string, retries = 4): Promise<EsiResponse<T>> {
  const cached = cache.get(path)
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { 'X-Compatibility-Date': ESI_COMPAT_DATE }
    if (cached?.etag) headers['If-None-Match'] = cached.etag

    let res: Response
    try {
      res = await fetch(`${ESI_BASE}${path}`, { headers })
    } catch (e) {
      if (attempt >= retries) throw e
      await sleep(1000 * 2 ** attempt)
      continue
    }

    const remain = res.headers.get('x-esi-error-limit-remain')
    if (remain) setErrorLimitRemain(Number(remain))

    if (res.status === 304 && cached) {
      const expiresAt = parseExpires(res) ?? Date.now() + 300_000
      cached.expiresAt = expiresAt
      return { data: cached.data as T, expiresAt, etag: cached.etag, notModified: true, pages: numHeader(res, 'x-pages') ?? 1, errorLimitRemain }
    }

    if (res.status === 420 || res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`ESI ${res.status}: ${path}`)
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
      continue
    }

    if (!res.ok) throw new Error(`ESI ${res.status}: ${path}`)

    const data = (await res.json()) as T
    const etag = res.headers.get('etag')
    const expiresAt = parseExpires(res) ?? Date.now() + 300_000
    if (etag) cache.set(path, { etag, expiresAt, data })
    return { data, expiresAt, etag, notModified: false, pages: numHeader(res, 'x-pages') ?? 1, errorLimitRemain }
  }
}

function parseExpires(res: Response): number | null {
  const v = res.headers.get('expires')
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function numHeader(res: Response, name: string): number | null {
  const v = res.headers.get(name)
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runPool<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}
