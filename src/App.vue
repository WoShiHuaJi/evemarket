<script setup lang="ts">
import { onMounted } from 'vue'
import { useMarketStore } from './stores/market'
import StatusBar from './components/StatusBar.vue'
import MarketTable from './components/MarketTable.vue'

const store = useMarketStore()
onMounted(() => store.start())
</script>

<template>
  <StatusBar />
  <MarketTable />
</template>
