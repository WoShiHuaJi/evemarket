<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMarketStore } from '../stores/market'
import rawLp from '../data/lp-offers.json'

interface LpCorp {
  id: number
  name: string
  nameZh: string
}
interface LpOffer {
  c: number
  t: number
  q: number
  lp: number
  isk: number
  req: [number, number][]
}
interface LpData {
  generatedAt: string
  corps: LpCorp[]
  types: Record<string, { name: string; nameZh: string }>
  offers: LpOffer[]
}

const lpData = rawLp as unknown as LpData
const store = useMarketStore()

const corpSearch = ref('')
const selectedCorp = ref<LpCorp | null>(null)
const rewardPrice = ref<'sell' | 'buy'>('sell')
const reqPrice = ref<'sell' | 'buy'>('sell')
const showCount = ref(200)

const matchedCorps = computed(() => {
  const q = corpSearch.value.trim().toLowerCase()
  if (!q) return []
  return lpData.corps
    .filter((c) => c.name.toLowerCase().includes(q) || c.nameZh.includes(corpSearch.value.trim()))
    .slice(0, 30)
})

const priceMap = computed(() => {
  const m = new Map<number, { sell: number | null; buy: number | null }>()
  for (const r of store.rows) m.set(r.type.id, { sell: r.jitaSell, buy: r.jitaBuy })
  return m
})

function typeName(id: number): string {
  const t = lpData.types[String(id)]
  return t ? t.nameZh || t.name : `#${id}`
}

interface LpRow {
  offer: LpOffer
  rewardValue: number | null
  reqCost: number | null
  profit: number | null
  iskPerLp: number | null
}

const rows = computed<LpRow[]>(() => {
  if (!selectedCorp.value) return []
  const pm = priceMap.value
  const list = lpData.offers.filter((o) => o.c === selectedCorp.value!.id)
  return list
    .map((offer) => {
      const rp = pm.get(offer.t)
      const rewardValue = rp ? (rewardPrice.value === 'sell' ? rp.sell : rp.buy) : null
      let reqCost: number | null = 0
      for (const [tid, qty] of offer.req) {
        const p = pm.get(tid)
        const v = p ? (reqPrice.value === 'sell' ? p.sell : p.buy) : null
        if (v === null || v === undefined) {
          reqCost = null
          break
        }
        reqCost += v * qty
      }
      const profit =
        rewardValue !== null && rewardValue !== undefined && reqCost !== null
          ? rewardValue * offer.q - offer.isk - reqCost
          : null
      const iskPerLp = profit !== null && offer.lp > 0 ? profit / offer.lp : null
      return { offer, rewardValue: rewardValue ?? null, reqCost, profit, iskPerLp }
    })
    .sort((a, b) => (b.iskPerLp ?? -Infinity) - (a.iskPerLp ?? -Infinity))
})

const visible = computed(() => rows.value.slice(0, showCount.value))

function selectCorp(c: LpCorp) {
  selectedCorp.value = c
  corpSearch.value = ''
  showCount.value = 200
}

function fmt(v: number | null): string {
  if (v === null) return '-'
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return v.toFixed(0)
}

function fmtInt(v: number | null): string {
  return v === null ? '-' : Math.round(v).toLocaleString()
}
</script>

<template>
  <div class="lp-controls">
    <div class="corp-search">
      <input v-model="corpSearch" class="corp-input" placeholder="搜索NPC公司" />
      <div v-if="matchedCorps.length" class="corp-panel">
        <div v-for="c in matchedCorps" :key="c.id" class="corp-item" @click="selectCorp(c)">
          {{ c.nameZh || c.name }}<span class="en">{{ c.name }}</span>
        </div>
      </div>
    </div>
    <template v-if="selectedCorp">
      <span class="current-corp">{{ selectedCorp.nameZh || selectedCorp.name }}</span>
      <button class="clear" @click="selectedCorp = null">重选</button>
      <label>
        所换物品
        <select v-model="rewardPrice">
          <option value="sell">SELL价</option>
          <option value="buy">BUY价</option>
        </select>
      </label>
      <label>
        所需物品
        <select v-model="reqPrice">
          <option value="sell">SELL价</option>
          <option value="buy">BUY价</option>
        </select>
      </label>
      <span class="hint">价格为 Jita 4-4 实时价 · 未含交易税</span>
    </template>
  </div>

  <div class="table-wrap">
    <div v-if="!selectedCorp" class="empty">输入NPC公司名称搜索，例如：加达里海军 / Caldari Navy</div>
    <table v-else>
      <thead>
        <tr>
          <th>物品</th>
          <th class="num">数量</th>
          <th class="num">LP</th>
          <th class="num">ISK成本</th>
          <th>所需物品</th>
          <th class="num">物品价值</th>
          <th class="num">利润</th>
          <th class="num">每LP收益</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in visible" :key="i">
          <td class="name" :title="typeName(r.offer.t)">{{ typeName(r.offer.t) }}</td>
          <td class="num">{{ r.offer.q }}</td>
          <td class="num">{{ r.offer.lp.toLocaleString() }}</td>
          <td class="num">{{ fmt(r.offer.isk) }}</td>
          <td class="req">
            <span v-if="r.offer.req.length === 0">-</span>
            <span v-for="[tid, qty] in r.offer.req" :key="tid" class="req-item" :title="typeName(tid)">
              {{ qty }}x {{ typeName(tid) }}
            </span>
          </td>
          <td class="num">{{ fmt(r.rewardValue !== null ? r.rewardValue * r.offer.q : null) }}</td>
          <td class="num" :class="(r.profit ?? 0) > 0 ? 'pos' : (r.profit ?? 0) < 0 ? 'neg' : ''">{{ fmt(r.profit) }}</td>
          <td class="num isklp" :class="(r.iskPerLp ?? 0) > 0 ? 'pos' : (r.iskPerLp ?? 0) < 0 ? 'neg' : ''">
            {{ fmtInt(r.iskPerLp) }}
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="rows.length > showCount" class="more">
      <button @click="showCount += 200">显示更多（{{ rows.length - showCount }} 条未显示）</button>
    </div>
  </div>
</template>

<style scoped>
.lp-controls {
  padding: 8px 16px;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
  color: #aab4c4;
  flex-shrink: 0;
}
.corp-search {
  position: relative;
}
.corp-input {
  background: #1b1f27;
  border: 1px solid #2c3340;
  border-radius: 4px;
  color: #e8ecf3;
  padding: 4px 8px;
  width: 220px;
}
.corp-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  background: #1b1f27;
  border: 1px solid #3d4657;
  border-radius: 6px;
  max-height: 320px;
  overflow-y: auto;
  min-width: 280px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.corp-item {
  padding: 6px 12px;
  cursor: pointer;
}
.corp-item:hover {
  background: #232936;
}
.corp-item .en {
  color: #5d6a7d;
  font-size: 11px;
  margin-left: 8px;
}
.current-corp {
  color: #e8ecf3;
  font-weight: 600;
}
.clear {
  background: #232936;
  color: #aab4c4;
  border: 1px solid #2c3340;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
select {
  background: #1b1f27;
  border: 1px solid #2c3340;
  border-radius: 4px;
  color: #e8ecf3;
  padding: 4px 6px;
}
.hint {
  color: #5d6a7d;
  font-size: 12px;
}
.table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 16px 16px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 5px 8px;
  border-bottom: 1px solid #232936;
  text-align: left;
}
th {
  color: #7d8aa0;
  font-weight: 600;
  position: sticky;
  top: 0;
  background: #161a21;
  z-index: 2;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.req {
  max-width: 260px;
}
.req-item {
  display: inline-block;
  margin-right: 8px;
  color: #7d8aa0;
  font-size: 12px;
  white-space: nowrap;
}
.isklp {
  font-weight: 700;
}
.pos {
  color: #3ecf6e;
}
.neg {
  color: #ff6b6b;
}
.more,
.empty {
  padding: 16px;
  text-align: center;
  color: #7d8aa0;
}
.more button {
  background: #2c3340;
  color: #e8ecf3;
  border: 1px solid #3d4657;
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .lp-controls {
    padding: 6px 8px;
    gap: 8px;
    font-size: 12px;
  }
  .corp-input {
    width: 100%;
    font-size: 16px;
    padding: 8px;
  }
  .corp-search {
    width: 100%;
  }
  .table-wrap {
    padding: 0 8px 8px;
  }
  table {
    font-size: 12px;
    width: max-content;
    min-width: 100%;
  }
  th,
  td {
    padding: 6px 8px;
    white-space: nowrap;
  }
}
</style>
