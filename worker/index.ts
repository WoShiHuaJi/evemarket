export interface Env {
  PRICES: KVNamespace
  ASSETS: Fetcher
}

const KV_KEY = 'prices:latest'

async function kvJson(env: Env, key: string): Promise<Response> {
  const payload = await env.PRICES.get(key)
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/prices') return kvJson(env, KV_KEY)
    if (url.pathname === '/api/volumes') return kvJson(env, 'volumes:latest')
    return env.ASSETS.fetch(request)
  },
}
