<script setup lang="ts">
import { computed } from 'vue'
import { calculateStandings } from '@/domain/rating'
import { handPot, tournamentPrizePool } from '@/domain/game'
import { state } from '@/stores/poker'
import { formatTournamentDate } from '@/domain/time'
import KitIcon from '@/components/KitIcon.vue'

const numberFormat = new Intl.NumberFormat('ru-RU')
const moneyFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const upcoming = computed(() => state.tournaments
  .filter((tournament) => tournament.status !== 'finished')
  .slice()
  .sort((a, b) => a.date.localeCompare(b.date))[0])
const standings = computed(() => calculateStandings(state))
const completedTournaments = computed(() => state.tournaments.filter((tournament) => tournament.status === 'finished'))
const results = completedTournaments
const completedHands = computed(() => state.tournaments.flatMap((tournament) => tournament.hands.filter((hand) => hand.settled)))
const seasonStatistics = computed(() => [
  { label: 'Игроки сезона', value: numberFormat.format(state.players.length), detail: 'весь список участников' },
  { label: 'Завершено турниров', value: numberFormat.format(completedTournaments.value.length), detail: `из ${state.tournaments.length} в расписании` },
  { label: 'Завершено раздач', value: numberFormat.format(completedHands.value.length), detail: 'по истории сыгранных турниров' },
  { label: 'Призовой фонд', value: `${moneyFormat.format(completedTournaments.value.reduce((sum, tournament) => sum + tournamentPrizePool(tournament), 0))} ₽`, detail: 'в завершённых турнирах' },
])
const playerStatistics = computed(() => state.players.map((player) => {
  const playedTournaments = state.tournaments.filter((tournament) =>
    (tournament.gameInitialized || tournament.status === 'finished') && tournament.participantIds.includes(player.id),
  )
  const places = playedTournaments.map((tournament) => tournament.places[player.id]).filter((place): place is number => place != null)
  const hands = completedHands.value.filter((hand) => hand.players[player.id] != null)
  const wonHands = hands.filter((hand) => hand.players[player.id]?.takesPot && !hand.players[player.id]?.folded)
  const actions = hands.flatMap((hand) => Object.values(hand.players[player.id]?.actions ?? {}).flat())
  return {
    player,
    tournaments: playedTournaments.length,
    wins: playedTournaments.filter((tournament) => tournament.places[player.id] === 1).length,
    podiums: places.filter((place) => place <= 3).length,
    handsWon: wonHands.length,
    largestPot: wonHands.reduce((largest, hand) => Math.max(largest, hand.settlement?.awards[player.id]
      ?? handPot(hand) / Math.max(1, Object.values(hand.players).filter((entry) => entry.takesPot && !entry.folded).length)), 0),
    raises: actions.filter((action) => action === 'raise').length,
    calls: actions.filter((action) => action === 'call').length,
    checks: actions.filter((action) => action === 'check').length,
    folds: hands.filter((hand) => hand.players[player.id]?.folded).length,
    bestPlace: places.length ? Math.min(...places) : null,
  }
}).sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.handsWon - a.handsWon || a.player.name.localeCompare(b.player.name, 'ru')))
const selectedNames = (ids: string[]) => ids.map((id) => state.players.find((player) => player.id === id)?.name).filter(Boolean)
const playerName = (id: string) => state.players.find((player) => player.id === id)?.name ?? 'Игрок'

function dateLabel(date: string, weekday = false) {
  return formatTournamentDate(date, weekday)
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
        <h1>Galaxy Poker</h1>
        <p>Три турнира. Один чемпион. Блеф — по настроению.</p>
        <div class="hero-meta"><span><KitIcon name="games" /> {{ state.tournaments.length }} игры</span><span><KitIcon name="people" /> до 10 игроков</span><span>◷ по пятницам, 18:00</span></div>
      </div>
      <div class="next-card" v-if="upcoming">
        <div class="eyebrow">{{ upcoming.status === 'live' ? 'ТЕКУЩИЙ ТУРНИР' : 'СЛЕДУЮЩАЯ ИГРА' }}</div>
        <div class="next-date">{{ dateLabel(upcoming.date) }}</div>
        <div class="next-title">{{ upcoming.title }} <span>{{ upcoming.startTime }}</span></div>
        <div class="next-detail">Переговорная комната · {{ selectedNames(upcoming.participantIds).length }} участников</div>
        <div class="poker-chip-stack" aria-hidden="true"><span class="poker-chip poker-chip-lime">♠</span><span class="poker-chip poker-chip-yellow">♦</span></div>
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

    <section id="statistics" class="section wrap">
      <div class="section-heading"><div><div class="eyebrow">ЦИФРЫ СЕЗОНА</div><h2>Статистика</h2></div><span class="muted">Обновляется по сохранённым результатам</span></div>
      <div class="season-stat-grid">
        <article v-for="stat in seasonStatistics" :key="stat.label" class="season-stat-card">
          <span>{{ stat.label }}</span><strong>{{ stat.value }}</strong><small>{{ stat.detail }}</small>
        </article>
      </div>
      <div class="player-stat-heading"><div><div class="eyebrow">ИГРОКИ В ЦИФРАХ</div><h3>Статистика участников</h3></div><span class="muted">Показаны все {{ state.players.length }} игроков</span></div>
      <div v-if="playerStatistics.length" class="table-wrap player-stat-table">
        <table><thead><tr><th>Игрок</th><th>Турниров</th><th>Турнирных побед</th><th>Топ-3</th><th>Раздач выиграно</th><th>Крупнейший выигрыш, фишки</th><th>Рейзы</th><th>Коллы</th><th>Чеки</th><th>Фолды</th><th>Лучшее место</th></tr></thead>
          <tbody><tr v-for="stats in playerStatistics" :key="stats.player.id"><td>{{ stats.player.name }}</td><td>{{ stats.tournaments }}</td><td>{{ stats.wins }}</td><td>{{ stats.podiums }}</td><td>{{ stats.handsWon }}</td><td>{{ numberFormat.format(stats.largestPot) }}</td><td>{{ stats.raises }}</td><td>{{ stats.calls }}</td><td>{{ stats.checks }}</td><td>{{ stats.folds }}</td><td>{{ stats.bestPlace ?? '—' }}</td></tr></tbody>
        </table>
      </div>
      <div v-else class="empty-state"><strong>Список игроков пока пуст</strong><span>Добавьте участников в настройках.</span></div>
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

<style scoped>
.season-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.season-stat-card {
  display: grid;
  gap: 8px;
  min-height: 116px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}

.season-stat-card span,
.season-stat-card small {
  color: var(--muted);
  font-size: 12px;
}

.season-stat-card strong {
  color: var(--green);
  font: 700 28px/1.1 'Playfair Display', Georgia, serif;
}

.season-stat-card small {
  font-size: 10px;
}

.player-stat-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin: 30px 0 14px;
}

.player-stat-heading h3 {
  margin: 6px 0 0;
  color: var(--green);
  font: 700 22px/1.15 'Playfair Display', Georgia, serif;
}

.player-stat-table {
  overflow-x: auto;
}

.player-stat-table table {
  min-width: 1080px;
}

@media (max-width: 800px) {
  .season-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .season-stat-grid {
    gap: 8px;
  }

  .season-stat-card {
    min-height: 104px;
    padding: 13px;
  }

  .season-stat-card strong {
    font-size: 24px;
  }

  .player-stat-heading {
    align-items: start;
    flex-direction: column;
  }
}
</style>
