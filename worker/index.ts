export interface Env {
  PRICES: KVNamespace
  ASSETS: Fetcher
}

const KV_KEY = 'prices:latest'

export default {
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
