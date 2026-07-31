<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMarketStore, type PriceRow } from '../stores/market'

const store = useMarketStore()

const columnDefs = [
  { key: 'jitaSell', label: 'Jita 卖价' },
  { key: 'jitaBuy', label: 'Jita 买价' },
  { key: 'hwwfSell', label: '4-HWWF 卖价' },
  { key: 'hwwfBuy', label: '4-HWWF 买价' },
  { key: 'vol7', label: '4H 7天销量' },
  { key: 'vol30', label: '4H 30天销量' },
  { key: 'jToHProfit', label: 'Jita到4H 利润' },
  { key: 'jToHPct', label: 'Jita到4H 利润率' },
  { key: 'hToJProfit', label: '4H到Jita 利润' },
  { key: 'hToJPct', label: '4H到Jita 利润率' },
] as const

type ColKey = (typeof columnDefs)[number]['key']

const defaultCols = Object.fromEntries(columnDefs.map((c) => [c.key, true])) as Record<ColKey, boolean>
const mobileDefaultCols: Record<ColKey, boolean> = {
  jitaSell: true,
  jitaBuy: true,
  hwwfSell: true,
  hwwfBuy: true,
  vol7: true,
  vol30: false,
  jToHProfit: false,
  jToHPct: false,
  hToJProfit: false,
  hToJPct: false,
}
const savedCols = (() => {
  try {
    const s = localStorage.getItem('evemarket-cols')
    if (s) return { ...defaultCols, ...JSON.parse(s) }
  } catch {
    // ignore
  }
  return window.innerWidth <= 768 ? { ...mobileDefaultCols } : defaultCols
})()
const visibleCols = reactive<Record<ColKey, boolean>>(savedCols)
watch(
  visibleCols,
  (v) => {
    try {
      localStorage.setItem('evemarket-cols', JSON.stringify(v))
    } catch {
      // ignore
    }
  },
  { deep: true },
)
const showColPicker = ref(false)

const search = ref('')

const direction = ref<'all' | 'jtoh' | 'htoj'>('all')
const minProfit = ref<number | null>(null)
const shippingCost = ref<number>(
  (() => {
    try {
      return Number(localStorage.getItem('evemarket-shipping-cost')) || 0
    } catch {
      return 0
    }
  })(),
)
watch(shippingCost, (v) => {
  try {
    localStorage.setItem('evemarket-shipping-cost', String(v))
  } catch {
    // ignore
  }
})
const sortKey = ref<'jToHProfit' | 'jToHPct' | 'hToJProfit' | 'hToJPct' | 'jitaSell' | 'vol7' | 'vol30'>('jToHProfit')
const sortDesc = ref(true)
const showCount = ref(300)

function setDirection(d: 'all' | 'jtoh' | 'htoj') {
  direction.value = d
  if (d === 'jtoh') {
    sortKey.value = 'jToHProfit'
    sortDesc.value = true
  } else if (d === 'htoj') {
    sortKey.value = 'hToJProfit'
    sortDesc.value = true
  }
}

const filtered = computed<PriceRow[]>(() => {
  const q = search.value.trim().toLowerCase()
  let list = store.rows
  const cost = shippingCost.value
  if (cost > 0) {
    list = list.map((r) => {
      const haul = r.type.volume * cost
      const jToHProfit = r.jToHProfit !== null ? r.jToHProfit - haul : null
      const hToJProfit = r.hToJProfit !== null ? r.hToJProfit - haul : null
      return {
        ...r,
        jToHProfit,
        jToHPct: jToHProfit !== null && r.jitaSell! > 0 ? (jToHProfit / r.jitaSell!) * 100 : null,
        hToJProfit,
        hToJPct: hToJProfit !== null && r.hwwfSell! > 0 ? (hToJProfit / r.hwwfSell!) * 100 : null,
      }
    })
  }
  if (q) {
    list = list.filter(
      (r) =>
        r.type.name.toLowerCase().includes(q) ||
        r.type.nameZh.includes(search.value.trim()) ||
        (store.typeGroupText.get(r.type.id)?.includes(q) ?? false),
    )
  }
  if (direction.value === 'jtoh') {
    list = list.filter((r) => (r.jToHProfit ?? -Infinity) > 0)
  } else if (direction.value === 'htoj') {
    list = list.filter((r) => (r.hToJProfit ?? -Infinity) > 0)
  }
  if (minProfit.value !== null && minProfit.value > 0) {
    const min = minProfit.value
    if (direction.value === 'jtoh') {
      list = list.filter((r) => (r.jToHProfit ?? -Infinity) >= min)
    } else if (direction.value === 'htoj') {
      list = list.filter((r) => (r.hToJProfit ?? -Infinity) >= min)
    } else {
      list = list.filter((r) => (r.jToHProfit ?? -Infinity) >= min || (r.hToJProfit ?? -Infinity) >= min)
    }
  }
  const key = sortKey.value
  const dir = sortDesc.value ? -1 : 1
  return [...list].sort((a, b) => {
    const av = a[key] ?? (sortDesc.value ? -Infinity : Infinity)
    const bv = b[key] ?? (sortDesc.value ? -Infinity : Infinity)
    return (av - bv) * dir
  })
})

const visible = computed(() => filtered.value.slice(0, showCount.value))

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = key
    sortDesc.value = true
  }
}

function fmt(v: number | null): string {
  if (v === null) return '-'
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return v.toFixed(2)
}

function fmtPct(v: number | null): string {
  return v === null ? '-' : v.toFixed(1) + '%'
}

function fmtVol(v: number | null): string {
  if (v === null) return '-'
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

function profitClass(v: number | null): string {
  if (v === null) return ''
  return v > 0 ? 'pos' : v < 0 ? 'neg' : ''
}
</script>

<template>
  <div class="controls">
    <div class="filters">
      <div class="dir-group">
        <button :class="{ active: direction === 'all' }" @click="setDirection('all')">全部</button>
        <button :class="{ active: direction === 'jtoh' }" @click="setDirection('jtoh')">Jita→4H</button>
        <button :class="{ active: direction === 'htoj' }" @click="setDirection('htoj')">4H→Jita</button>
      </div>
      <input v-model="search" class="search-input" placeholder="搜索物品/分类" />
      <label>
        最低利润
        <input
          type="number"
          class="min-profit"
          placeholder="ISK"
          @change="minProfit = ($event.target as HTMLInputElement).valueAsNumber || null"
        />
      </label>
      <label>
        运输成本/m³
        <input
          type="number"
          class="shipping-cost"
          placeholder="ISK"
          :value="shippingCost || ''"
          @change="shippingCost = ($event.target as HTMLInputElement).valueAsNumber || 0"
        />
      </label>
      <div class="col-picker">
        <button @click="showColPicker = !showColPicker">显示列 ▾</button>
        <div v-if="showColPicker" class="col-panel">
          <label v-for="c in columnDefs" :key="c.key">
            <input type="checkbox" v-model="visibleCols[c.key]" /> {{ c.label }}
          </label>
        </div>
      </div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>物品</th>
          <th v-if="visibleCols.jitaSell" class="num sortable" @click="toggleSort('jitaSell')">Jita 卖价</th>
          <th v-if="visibleCols.jitaBuy" class="num">Jita 买价</th>
          <th v-if="visibleCols.hwwfSell" class="num">4-HWWF 卖价</th>
          <th v-if="visibleCols.hwwfBuy" class="num">4-HWWF 买价</th>
          <th v-if="visibleCols.vol7" class="num sortable" @click="toggleSort('vol7')">4H 7天销量</th>
          <th v-if="visibleCols.vol30" class="num sortable" @click="toggleSort('vol30')">4H 30天销量</th>
          <template v-if="direction !== 'htoj'">
            <th v-if="visibleCols.jToHProfit" class="num sortable" @click="toggleSort('jToHProfit')">Jita到4H 利润</th>
            <th v-if="visibleCols.jToHPct" class="num sortable" @click="toggleSort('jToHPct')">Jita到4H 利润率</th>
          </template>
          <template v-if="direction !== 'jtoh'">
            <th v-if="visibleCols.hToJProfit" class="num sortable" @click="toggleSort('hToJProfit')">4H到Jita 利润</th>
            <th v-if="visibleCols.hToJPct" class="num sortable" @click="toggleSort('hToJPct')">4H到Jita 利润率</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.type.id">
          <td class="name" :title="(r.type.nameZh || r.type.name) + '\n' + r.type.name">
            <div>{{ r.type.nameZh || r.type.name }}</div>
            <div class="en">{{ r.type.name }}</div>
          </td>
          <td v-if="visibleCols.jitaSell" class="num">{{ fmt(r.jitaSell) }}</td>
          <td v-if="visibleCols.jitaBuy" class="num">{{ fmt(r.jitaBuy) }}</td>
          <td v-if="visibleCols.hwwfSell" class="num">{{ fmt(r.hwwfSell) }}</td>
          <td v-if="visibleCols.hwwfBuy" class="num">{{ fmt(r.hwwfBuy) }}</td>
          <td v-if="visibleCols.vol7" class="num">{{ fmtVol(r.vol7) }}</td>
          <td v-if="visibleCols.vol30" class="num">{{ fmtVol(r.vol30) }}</td>
          <template v-if="direction !== 'htoj'">
            <td v-if="visibleCols.jToHProfit" class="num" :class="profitClass(r.jToHProfit)">{{ fmt(r.jToHProfit) }}</td>
            <td v-if="visibleCols.jToHPct" class="num" :class="profitClass(r.jToHProfit)">{{ fmtPct(r.jToHPct) }}</td>
          </template>
          <template v-if="direction !== 'jtoh'">
            <td v-if="visibleCols.hToJProfit" class="num" :class="profitClass(r.hToJProfit)">{{ fmt(r.hToJProfit) }}</td>
            <td v-if="visibleCols.hToJPct" class="num" :class="profitClass(r.hToJProfit)">{{ fmtPct(r.hToJPct) }}</td>
          </template>
        </tr>
      </tbody>
    </table>
    <div v-if="filtered.length > showCount" class="more">
      <button @click="showCount += 300">显示更多（{{ filtered.length - showCount }} 条未显示）</button>
    </div>
    <div v-if="!store.refreshing && visible.length === 0" class="empty">无匹配数据</div>
  </div>
</template>

<style scoped>
.controls {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.filters {
  display: flex;
  gap: 16px;
  align-items: center;
  font-size: 13px;
  color: #aab4c4;
  flex-wrap: wrap;
}
.dir-group {
  display: flex;
  gap: 6px;
}
.dir-group button {
  background: #232936;
  color: #aab4c4;
  border: 1px solid #2c3340;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.dir-group button.active {
  background: #3465a4;
  color: #fff;
  border-color: #3465a4;
}
input[type='text'],
input:not([type]),
input[type='number'] {
  background: #1b1f27;
  border: 1px solid #2c3340;
  border-radius: 4px;
  color: #e8ecf3;
  padding: 4px 8px;
}
.min-profit {
  width: 55px;
}
.shipping-cost {
  width: 55px;
}
.search-input {
  width: 140px;
}
.col-picker {
  position: relative;
}
.col-picker > button {
  background: #232936;
  color: #aab4c4;
  border: 1px solid #2c3340;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.col-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  background: #1b1f27;
  border: 1px solid #3d4657;
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.col-panel label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
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
  table-layout: fixed;
}
th:first-child,
td:first-child {
  width: 200px;
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
th.sortable {
  cursor: pointer;
  user-select: none;
}
th.sortable:hover {
  color: #e8ecf3;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.name div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name .en {
  color: #5d6a7d;
  font-size: 11px;
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
  .controls {
    padding: 6px 8px;
    gap: 6px;
  }
  .dir-group {
    width: 100%;
  }
  .dir-group button {
    flex: 1;
    padding: 10px 4px;
    font-size: 13px;
    white-space: nowrap;
  }
  .filters {
    gap: 8px;
    font-size: 12px;
    align-items: stretch;
  }
  .filters input:not([type]),
  .filters input[type='text'],
  .filters input[type='number'] {
    font-size: 16px;
    padding: 8px;
  }
  .col-picker > button {
    padding: 10px 16px;
    font-size: 14px;
  }
  .col-panel {
    left: auto;
    right: 0;
    font-size: 14px;
    gap: 10px;
    padding: 12px 16px;
  }
  .table-wrap {
    padding: 0 8px 8px;
  }
  table {
    font-size: 12px;
    table-layout: auto;
    width: max-content;
    min-width: 100%;
  }
  th,
  td {
    padding: 6px 8px;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    width: auto;
    max-width: 140px;
  }
  .name .en {
    display: none;
  }
}
</style>
