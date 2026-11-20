<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { currentSeconds, findTournament, state } from '@/stores/poker'

const route = useRoute()
const tournament = computed(() => findTournament(String(route.params.id)))
const now = ref(Date.now())
let interval: number | undefined
onMounted(() => { interval = window.setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { if (interval) window.clearInterval(interval) })

const currentLevel = computed(() => tournament.value?.levels[tournament.value.currentLevel])
const remainingSeconds = computed(() => {
  now.value
  return tournament.value ? currentSeconds(tournament.value) : 0
})
const countdown = computed(() => {
  const seconds = remainingSeconds.value
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, '0')
  const secondsPart = (seconds % 60).toString().padStart(2, '0')
  return `${minutesPart}:${secondsPart}`
})
const participantNames = computed(() => tournament.value?.participantIds
  .map((id) => state.players.find((player) => player.id === id)?.name)
  .filter((name): name is string => Boolean(name)) ?? [])
</script>

<template>
  <main v-if="tournament" class="screen-page">
    <header class="screen-top"><RouterLink class="screen-brand" to="/">♠ Friendly Poker</RouterLink><span>СЕЗОН 1</span></header>
    <section class="screen-main">
      <div class="eyebrow">{{ tournament.title.toUpperCase() }} · {{ tournament.status === 'live' ? 'ТУРНИР ИДЁТ' : tournament.status === 'finished' ? 'ТУРНИР ЗАВЕРШЁН' : 'СКОРО НАЧАЛО' }}</div>
      <h1 v-if="currentLevel?.break">Перерыв</h1>
      <h1 v-else>Уровень {{ tournament.currentLevel + 1 }}</h1>
      <div v-if="!currentLevel?.break" class="blind-values"><div><span>МАЛЫЙ БЛАЙНД</span><strong>{{ currentLevel?.small }}</strong></div><i></i><div><span>БОЛЬШОЙ БЛАЙНД</span><strong>{{ currentLevel?.big }}</strong></div></div>
      <div class="screen-timer">{{ countdown }}</div>
      <p class="screen-timer-caption">{{ tournament.timerStartedAt === null ? 'ТАЙМЕР НА ПАУЗЕ' : 'ДО СЛЕДУЮЩЕГО УРОВНЯ' }}</p>
      <div class="screen-stats"><div><strong>{{ participantNames.length }}</strong><span>участников</span></div><div><strong>{{ tournament.buyIn }} ₽</strong><span>вход</span></div><div><strong>{{ tournament.startingStack }}</strong><span>стартовый стек</span></div></div>
    </section>
    <section class="screen-roster"><div class="eyebrow">ЗА СТОЛОМ</div><div class="roster-chips"><span v-for="name in participantNames" :key="name">{{ name }}</span><span v-if="!participantNames.length" class="muted">Состав ещё не добавлен</span></div></section>
    <footer class="screen-footer"><span>{{ tournament.startTime }} · Переговорная комната</span><span>Следующий уровень: {{ tournament.levels[tournament.currentLevel + 1]?.small ?? '—' }} / {{ tournament.levels[tournament.currentLevel + 1]?.big ?? '—' }}</span></footer>
  </main>
  <main v-else class="empty-state screen-missing"><strong>Турнир не найден</strong><RouterLink to="/" class="text-link">На главную</RouterLink></main>
</template>
