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
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
</style>
