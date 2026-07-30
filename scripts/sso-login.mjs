import http from 'node:http'
import { exec } from 'node:child_process'

const [clientId, clientSecret] = process.argv.slice(2)
if (!clientId || !clientSecret) {
  console.log('用法: node scripts/sso-login.mjs <CLIENT_ID> <CLIENT_SECRET>')
  process.exit(1)
}

const PORT = 8610
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const SCOPE = 'esi-markets.structure_markets.v1'
const STRUCTURES = [1053654548169, 1053970513596, 1034736246072, 1035603743755]

const authUrl =
  `https://login.eveonline.com/v2/oauth/authorize/?response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&client_id=${clientId}&scope=${encodeURIComponent(SCOPE)}&state=evemarket`

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

let handled = false
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204)
    return res.end()
  }
  if (url.pathname !== '/callback') {
    res.writeHead(302, { Location: authUrl })
    return res.end()
  }
  if (handled) {
    res.end('<h2>已处理，请勿重复刷新</h2>')
    return
  }
  handled = true
  const code = url.searchParams.get('code')
  if (!code) {
    res.end('授权失败：未收到 code')
    server.close()
    process.exit(1)
  }
  try {
    const tokenRes = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${code}`,
    })
    const rawText = await tokenRes.text()
    let tokens
    try {
      tokens = JSON.parse(rawText)
    } catch {
      throw new Error(`token endpoint returned non-JSON (${tokenRes.status}): ${rawText.slice(0, 300)}`)
    }
    if (!tokens.access_token) throw new Error(JSON.stringify(tokens))

    console.log('\n========== 把以下内容存入 GitHub Secrets ==========')
    console.log(`EVE_CLIENT_ID     = ${clientId}`)
    console.log(`EVE_CLIENT_SECRET = ${clientSecret}`)
    console.log(`EVE_REFRESH_TOKEN = ${tokens.refresh_token}`)
    console.log('===================================================\n')

    const verifyRes = await fetch('https://login.eveonline.com/oauth/verify', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const verifyText = await verifyRes.text()
    console.log(`verify status ${verifyRes.status}: ${verifyText.slice(0, 300)}`)
    const verify = JSON.parse(verifyText)
    console.log(`\n已授权角色: ${verify.CharacterName} (ID: ${verify.CharacterID})`)

    console.log('\n测试建筑订单读取权限...')
    for (const id of STRUCTURES) {
      try {
        const r = await fetch(`https://esi.evetech.net/latest/markets/structures/${id}/?datasource=tranquility&page=1`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        if (!r.ok) {
          console.log(`  ${id}: 无权限或不可读 (${r.status})`)
          continue
        }
        const orders = await r.json()
        const pages = r.headers.get('x-pages')
        const nameRes = await fetch(`https://esi.evetech.net/latest/universe/structures/${id}/?datasource=tranquility`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const name = nameRes.ok ? (await nameRes.json()).name : '?'
        console.log(`  ${id}: "${name}" 首页 ${orders.length} 条订单, 共 ${pages} 页  <-- 可读`)
      } catch (e) {
        console.log(`  ${id}: 错误 ${e.message}`)
      }
    }

    console.log('\n测试完成')
    res.end('<h2>授权成功！可以关闭本页面，回到终端查看 refresh token。</h2>')
  } catch (e) {
    console.error('换取 token 失败:', e)
    res.end('失败，请查看终端')
  } finally {
    setTimeout(() => process.exit(0), 500)
  }
})

server.listen(PORT, () => {
  console.log(`请在浏览器中打开（已尝试自动打开）:\n${authUrl}\n`)
  exec(`start "" "${authUrl}"`)
})
