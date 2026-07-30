interface Env {
  PRICES: KVNamespace
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const payload = await context.env.PRICES.get('volumes:latest')
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
      'Cache-Control': 'public, max-age=300',
    },
  })
}
