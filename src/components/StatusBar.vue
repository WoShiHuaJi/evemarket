<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMarketStore } from '../stores/market'

const store = useMarketStore()
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => (tick = setInterval(() => (now.value = Date.now()), 1000)))
onUnmounted(() => tick && clearInterval(tick))

const countdown = computed(() => {
  if (store.source === 'server') return '--'
  if (!store.nextRefreshAt) return '--'
  const s = Math.max(0, Math.round((store.nextRefreshAt - now.value) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const lastUpdated = computed(() =>
  store.lastUpdatedAt ? new Date(store.lastUpdatedAt).toLocaleTimeString() : '--',
)

const progressText = computed(() => {
  if (!store.refreshing) return ''
  const [jd, jt] = store.progress.jita
  const [hd, ht] = store.progress.hwwf
  return `Jita ${jd}/${jt} 页 · 4-HWWF ${hd}/${ht} 页`
})
</script>

<template>
  <div class="status-bar">
    <span class="brand">EVE 倒货助手</span>
    <span :class="store.source === 'server' ? 'src-server' : 'src-local'">
      {{ store.source === 'server' ? '云端数据' : '本地直连' }}
    </span>
    <span>上次更新: {{ lastUpdated }}</span>
    <span v-if="store.refreshing" class="refreshing">刷新中 {{ progressText }}</span>
    <span v-else-if="store.source === 'local'">下次刷新: {{ countdown }}</span>
    <span v-if="store.source === 'local' && store.errorLimitRemain !== null">ESI 错误余量: {{ store.errorLimitRemain }}</span>
    <span v-if="store.error" class="error">错误: {{ store.error }}</span>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #1b1f27;
  border-bottom: 1px solid #2c3340;
  font-size: 13px;
  color: #aab4c4;
  flex-wrap: wrap;
}
.brand {
  font-weight: 700;
  color: #e8ecf3;
}
.refreshing {
  color: #4da3ff;
}
.src-server {
  color: #3ecf6e;
}
.src-local {
  color: #e0a54a;
}
.error {
  color: #ff6b6b;
}
</style>
