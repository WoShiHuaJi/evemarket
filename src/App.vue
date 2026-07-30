<script setup lang="ts">
import { onMounted } from 'vue'
import { useMarketStore } from './stores/market'
import StatusBar from './components/StatusBar.vue'
import MarketTable from './components/MarketTable.vue'

const store = useMarketStore()
onMounted(() => store.start())
</script>

<template>
  <div class="layout">
    <StatusBar />
    <MarketTable />
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
