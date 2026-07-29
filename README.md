# EVE 倒货助手

EVE Online 市场倒卖利润监控：对比 Jita 4-4 与 4-HWWF 的物价，覆盖舰船、装备、制造研究、植入体增效剂、军火弹药、改装件、建筑、无人机八大类共 8500+ 种商品。

## 本地开发

```powershell
npm install
npm run dev
```

本地开发时前端直接连接 ESI（页面右上角显示"本地直连"）。

## 部署到 Cloudflare（打开即有数据）

架构：Cron 每 5 分钟在服务端抓取 ESI → 聚合结果写入 KV → 前端打开时一次请求读取。

### 首次部署

```powershell
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV 命名空间，把输出中的 id 填入 wrangler.toml 的 REPLACE_WITH_YOUR_KV_NAMESPACE_ID
npx wrangler kv namespace create PRICES

# 3. 构建并部署
npm run deploy
```

部署后访问 `https://evemarket.<你的子域>.workers.dev`，页面显示"云端数据"即表示 KV 链路生效。

### 更新商品清单（SDE 版本更新后）

```powershell
npm run generate
```

## 工作原理

- `worker/index.ts`：Cloudflare Worker，`scheduled` 处理器抓取两个星域全量订单（Jita 约 400 页、静寂谷约 3 页），按空间站/星系过滤聚合出最优买卖价写入 KV；`/api/prices` 读取 KV 返回
- `src/stores/market.ts`：前端优先请求 `/api/prices`（每分钟轮询），不可用时回退到浏览器直连 ESI（按 ESI 5 分钟缓存精确调度，ETag 省流量）
- `scripts/generate-data.mjs`：构建期生成八大类商品清单 `src/data/market-types.json`

## 注意

- Cloudflare 免费版 Worker 单次 CPU 限制 10ms，Cron 全量解析约 40MB JSON 可能超限；如遇 1102 错误，可升级 Workers Paid（$5/月）或改用"本地直连"模式部署纯静态站点
- ESI 订单数据有 5 分钟服务端缓存，刷新更快没有额外收益
