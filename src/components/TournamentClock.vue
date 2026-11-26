<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { currentSeconds } from '@/stores/poker'
import { formatCountdown } from '@/domain/time'
import type { Tournament } from '@/domain/types'

const props = defineProps<{ tournament: Tournament }>()
const now = ref(Date.now())
let interval: number | undefined
onMounted(() => { interval = window.setInterval(() => { now.value = Date.now() }, 200) })
onUnmounted(() => { if (interval != null) window.clearInterval(interval) })
const seconds = computed(() => { now.value; return currentSeconds(props.tournament) })
const expired = computed(() => props.tournament.gameInitialized && props.tournament.status === 'live' && seconds.value === 0)
const label = computed(() => props.tournament.status === 'finished' ? 'Турнир завершён'
  : expired.value ? 'Время уровня истекло'
    : props.tournament.timerStartedAt === null ? 'Таймер на паузе' : 'До окончания уровня')
</script>

<template>
  <div class="tournament-clock" :class="{ 'clock-expired': expired }">
    <span>{{ label }}</span>
    <strong>{{ formatCountdown(seconds) }}</strong>
    <p v-if="expired" role="status">{{ tournament.currentLevel < tournament.levels.length - 1 ? 'Переключите уровень вручную, когда закончится текущая раздача.' : 'Последний уровень. Турнир продолжается до ручного завершения.' }}</p>
  </div>
</template>

<style scoped>
.tournament-clock{margin:12px 0;padding:12px 16px;border:1px solid var(--line);border-radius:8px;display:grid;gap:4px}
.tournament-clock>span{font-size:12px;color:var(--muted)}
.tournament-clock>strong{font-size:32px;line-height:1.2;font-variant-numeric:tabular-nums}
.tournament-clock p{margin:4px 0 0;font-size:13px}
.clock-expired{background:#fff1dc;border-color:#bb7c21}
</style>
