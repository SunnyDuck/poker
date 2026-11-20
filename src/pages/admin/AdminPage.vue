<script setup lang="ts">
import { useRouter } from 'vue-router'
import { createTournament, resetDemo, state } from '@/stores/poker'

const router = useRouter()
function addTournament() {
  const tournament = createTournament()
  router.push(`/admin/tournaments/${tournament.id}`)
}
function statusLabel(status: string) {
  return status === 'live' ? 'Идёт сейчас' : status === 'finished' ? 'Завершён' : 'Предстоит'
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}
</script>

<template>
  <div class="admin-page-head">
    <div><div class="eyebrow">ДЕМО-РЕЖИМ</div><h1>Управление турнирами</h1><p class="muted">Изменения сохраняются в браузере и видны в соседних вкладках.</p></div>
    <button class="button button-dark" @click="addTournament">＋ Новый турнир</button>
  </div>
  <div class="notice"><strong>Тестовые данные.</strong> Пока Google Таблицы не подключены, каждый браузер хранит свою копию турнира.</div>
  <div class="admin-tournament-list">
    <article v-for="tournament in state.tournaments" :key="tournament.id" class="admin-tournament-card">
      <div class="tournament-card-top"><span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span><span class="muted">{{ dateLabel(tournament.date) }}</span></div>
      <h2>{{ tournament.title }}</h2>
      <p>{{ tournament.participantIds.length }} участников · Вход {{ tournament.buyIn }} ₽ · Стек {{ tournament.startingStack }}</p>
      <div class="card-actions"><RouterLink class="button button-dark" :to="`/admin/tournaments/${tournament.id}`">Настроить игру</RouterLink><RouterLink class="button button-outline" :to="`/screen/${tournament.id}`">Открыть табло</RouterLink></div>
    </article>
  </div>
  <div class="admin-bottom"><span class="muted">Сброс возвращает исходные демонстрационные данные.</span><button class="text-button danger-text" @click="resetDemo">Сбросить демо</button></div>
</template>
