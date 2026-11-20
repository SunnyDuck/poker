<script setup lang="ts">
import { computed } from 'vue'
import { calculateStandings } from '@/domain/rating'
import { state } from '@/stores/poker'

const upcoming = computed(() => state.tournaments
  .filter((tournament) => tournament.status !== 'finished')
  .slice()
  .sort((a, b) => a.date.localeCompare(b.date))[0])
const standings = computed(() => calculateStandings(state))
const results = computed(() => state.tournaments.filter((tournament) => tournament.status === 'finished'))
const selectedNames = (ids: string[]) => ids.map((id) => state.players.find((player) => player.id === id)?.name).filter(Boolean)
const playerName = (id: string) => state.players.find((player) => player.id === id)?.name ?? 'Игрок'

function dateLabel(date: string, weekday = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', ...(weekday ? { weekday: 'long' } : {}),
  }).format(new Date(`${date}T12:00:00`))
}

function statusLabel(status: string) {
  return status === 'live' ? 'Идёт сейчас' : status === 'finished' ? 'Завершён' : 'Предстоит'
}
</script>

<template>
  <main>
    <section class="hero wrap">
      <div class="hero-copy">
        <div class="eyebrow">ТЕХАССКИЙ ХОЛДЕМ · СЕЗОН 1</div>
        <h1>Friendly Poker</h1>
        <p>Три турнира. Один чемпион.</p>
        <div class="hero-meta"><span>♧ {{ state.tournaments.length }} игры</span><span>♙ до 10 игроков</span><span>◷ по пятницам, 18:00</span></div>
      </div>
      <div class="next-card" v-if="upcoming">
        <div class="eyebrow">{{ upcoming.status === 'live' ? 'ТЕКУЩИЙ ТУРНИР' : 'СЛЕДУЮЩАЯ ИГРА' }}</div>
        <div class="next-date">{{ dateLabel(upcoming.date) }}</div>
        <div class="next-title">{{ upcoming.title }} <span>{{ upcoming.startTime }}</span></div>
        <div class="next-detail">Переговорная комната · {{ selectedNames(upcoming.participantIds).length }} участников</div>
        <RouterLink v-if="upcoming.status === 'live'" class="button button-gold" :to="`/screen/${upcoming.id}`">Открыть табло</RouterLink>
      </div>
    </section>

    <section id="schedule" class="section wrap">
      <div class="section-heading"><div><div class="eyebrow">КАЛЕНДАРЬ СЕЗОНА</div><h2>Расписание</h2></div><span class="muted">Пятница · начало в 18:00</span></div>
      <div class="schedule-list">
        <article v-for="tournament in state.tournaments" :key="tournament.id" class="schedule-row">
          <div class="schedule-day">{{ dateLabel(tournament.date).split(' ')[0] }}<small>{{ dateLabel(tournament.date).split(' ').slice(1).join(' ') }}</small></div>
          <div class="schedule-info"><strong>{{ tournament.title }}</strong><span>Переговорная комната · {{ tournament.startTime }}</span></div>
          <span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span>
          <RouterLink v-if="tournament.status === 'live'" class="text-link" :to="`/screen/${tournament.id}`">Табло</RouterLink>
        </article>
      </div>
    </section>

    <section id="rating" class="section wrap">
      <div class="section-heading"><div><div class="eyebrow">СПОРТИВНЫЙ ЗАЧЁТ</div><h2>Рейтинг сезона</h2></div><span class="muted">После каждой игры</span></div>
      <div v-if="standings.length" class="table-wrap">
        <table><thead><tr><th>Игрок</th><th>Очки</th><th>Игр</th><th>Побед</th></tr></thead>
          <tbody><tr v-for="standing in standings" :key="standing.player.id"><td>{{ standing.player.name }}</td><td class="score">{{ standing.points }}</td><td>{{ standing.events }}</td><td>{{ standing.wins }}</td></tr></tbody>
        </table>
      </div>
      <div v-else class="empty-state"><strong>Сезон ещё не начался</strong><span>Рейтинг появится после завершения первого турнира.</span></div>
      <p class="fine-print">Подсчёт очков в демо следует таблице из положения и может быть изменён.</p>
    </section>

    <section id="results" class="section wrap">
      <div class="section-heading"><div><div class="eyebrow">ИСТОРИЯ СЕЗОНА</div><h2>Результаты турниров</h2></div></div>
      <div v-if="results.length" class="result-grid">
        <article v-for="tournament in results" :key="tournament.id" class="result-card">
          <div class="result-card-head"><strong>{{ tournament.title }}</strong><span>{{ dateLabel(tournament.date) }}</span></div>
          <ol><li v-for="entry in Object.entries(tournament.places).sort((a, b) => a[1] - b[1])" :key="entry[0]">
            <span class="place">{{ entry[1] }}</span><span>{{ playerName(entry[0]) }}</span>
          </li></ol>
        </article>
      </div>
      <div v-else class="empty-state"><strong>Пока нет сыгранных турниров</strong><span>Здесь появятся результаты и места участников.</span></div>
    </section>
  </main>
</template>
