<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMarketStore, type PriceRow } from '../stores/market'

const store = useMarketStore()

const activeCategory = ref<number>(0)
const search = ref('')
const onlyProfitable = ref(false)
const minProfit = ref<number | null>(null)
const sortKey = ref<'jToHProfit' | 'jToHPct' | 'hToJProfit' | 'hToJPct' | 'jitaSell'>('jToHProfit')
const sortDesc = ref(true)
const showCount = ref(300)

const filtered = computed<PriceRow[]>(() => {
  const q = search.value.trim().toLowerCase()
  let list = store.rows
  if (activeCategory.value) list = list.filter((r) => r.categoryId === activeCategory.value)
  if (q) list = list.filter((r) => r.type.name.toLowerCase().includes(q) || r.type.nameZh.includes(search.value.trim()))
  if (onlyProfitable.value) {
    list = list.filter((r) => (r.jToHProfit ?? -Infinity) > 0 || (r.hToJProfit ?? -Infinity) > 0)
  }
  if (minProfit.value !== null && minProfit.value > 0) {
    const min = minProfit.value
    list = list.filter((r) => (r.jToHProfit ?? -Infinity) >= min || (r.hToJProfit ?? -Infinity) >= min)
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

function profitClass(v: number | null): string {
  if (v === null) return ''
  return v > 0 ? 'pos' : v < 0 ? 'neg' : ''
}
</script>

<template>
  <div class="controls">
    <div class="tabs">
      <button :class="{ active: activeCategory === 0 }" @click="activeCategory = 0">全部</button>
      <button
        v-for="c in store.categories"
        :key="c.id"
        :class="{ active: activeCategory === c.id }"
        @click="activeCategory = c.id"
      >
        {{ c.nameZh || c.name }}
      </button>
    </div>
    <div class="filters">
      <input v-model="search" placeholder="搜索物品（中/英文）" />
      <label>
        <input type="checkbox" v-model="onlyProfitable" /> 仅显示有利可图
      </label>
      <label>
        最低利润
        <input
          type="number"
          class="min-profit"
          placeholder="ISK"
          @change="minProfit = ($event.target as HTMLInputElement).valueAsNumber || null"
        />
      </label>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>物品</th>
          <th class="num sortable" @click="toggleSort('jitaSell')">Jita 卖价</th>
          <th class="num">Jita 买价</th>
          <th class="num">4-HWWF 卖价</th>
          <th class="num">4-HWWF 买价</th>
          <th class="num sortable" @click="toggleSort('jToHProfit')">J→4H 利润</th>
          <th class="num sortable" @click="toggleSort('jToHPct')">J→4H %</th>
          <th class="num sortable" @click="toggleSort('hToJProfit')">4H→J 利润</th>
          <th class="num sortable" @click="toggleSort('hToJPct')">4H→J %</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in visible" :key="r.type.id">
          <td class="name">
            <div>{{ r.type.nameZh || r.type.name }}</div>
            <div class="en">{{ r.type.name }}</div>
          </td>
          <td class="num">{{ fmt(r.jitaSell) }}</td>
          <td class="num">{{ fmt(r.jitaBuy) }}</td>
          <td class="num">{{ fmt(r.hwwfSell) }}</td>
          <td class="num">{{ fmt(r.hwwfBuy) }}</td>
          <td class="num" :class="profitClass(r.jToHProfit)">{{ fmt(r.jToHProfit) }}</td>
          <td class="num" :class="profitClass(r.jToHProfit)">{{ fmtPct(r.jToHPct) }}</td>
          <td class="num" :class="profitClass(r.hToJProfit)">{{ fmt(r.hToJProfit) }}</td>
          <td class="num" :class="profitClass(r.hToJProfit)">{{ fmtPct(r.hToJPct) }}</td>
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
}
.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tabs button {
  background: #232936;
  color: #aab4c4;
  border: 1px solid #2c3340;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.tabs button.active {
  background: #3465a4;
  color: #fff;
  border-color: #3465a4;
}
.filters {
  display: flex;
  gap: 16px;
  align-items: center;
  font-size: 13px;
  color: #aab4c4;
  flex-wrap: wrap;
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
  width: 110px;
}
.table-wrap {
  padding: 0 16px 16px;
  overflow-x: auto;
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
</style>
