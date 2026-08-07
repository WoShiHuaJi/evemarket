<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMarketStore } from './stores/market'
import StatusBar from './components/StatusBar.vue'
import MarketTable from './components/MarketTable.vue'
import LPView from './components/LPView.vue'

const store = useMarketStore()
onMounted(() => store.start())

const view = ref<'market' | 'lp'>('market')
</script>

<template>
  <div class="layout">
    <StatusBar />
    <div class="view-tabs">
      <button :class="{ active: view === 'market' }" @click="view = 'market'">价格对比</button>
      <button :class="{ active: view === 'lp' }" @click="view = 'lp'">LP比例查询</button>
    </div>
    <MarketTable v-if="view === 'market'" />
    <LPView v-else />
  </div>
  <div class="rotate-tip">
    <div class="rotate-tip-icon">⟳</div>
    <div>请旋转手机，横屏使用体验更佳</div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.view-tabs {
  display: flex;
  gap: 6px;
  padding: 6px 16px 0;
  flex-shrink: 0;
}
.view-tabs button {
  background: #232936;
  color: #aab4c4;
  border: 1px solid #2c3340;
  border-radius: 4px 4px 0 0;
  border-bottom: none;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
}
.view-tabs button.active {
  background: #3465a4;
  color: #fff;
  border-color: #3465a4;
}
@media (max-width: 768px) {
  .view-tabs {
    padding: 4px 8px 0;
  }
  .view-tabs button {
    flex: 1;
    padding: 10px 4px;
    font-size: 14px;
  }
}
.rotate-tip {
  display: none;
}
@media (max-width: 768px) and (orientation: portrait) {
  .rotate-tip {
    display: flex;
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #161a21;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: #aab4c4;
    font-size: 16px;
  }
  .rotate-tip-icon {
    font-size: 48px;
    animation: spin 2s ease-in-out infinite;
  }
}
@keyframes spin {
  0%,
  20% {
    transform: rotate(0deg);
  }
  80%,
  100% {
    transform: rotate(90deg);
  }
}
</style>
