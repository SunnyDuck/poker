<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { formatKrasnoyarskDateTime } from '@/domain/time'
import { handPot, handStreets, isPlayerAllIn, playerStreetContribution, projectedStack, rolesForHand } from '@/domain/game'
import { currentSeconds, findTournament, getCurrentHand, state } from '@/stores/poker'

const route = useRoute()
const tournament = computed(() => findTournament(String(route.params.id)))
const now = ref(Date.now())
let interval: number | undefined
onMounted(() => { interval = window.setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { if (interval) window.clearInterval(interval) })

const currentLevel = computed(() => tournament.value?.levels[tournament.value.currentLevel])
const nextLevel = computed(() => tournament.value?.levels[tournament.value.currentLevel + 1])
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
const numberFormat = new Intl.NumberFormat('ru-RU')
const currentHand = computed(() => tournament.value ? getCurrentHand(tournament.value) : undefined)
const lastHand = computed(() => tournament.value?.hands.at(-1))
const initialRoles = computed(() => {
  const currentTournament = tournament.value
  if (!currentTournament?.initialDealerId) return null
  const activeIds = currentTournament.participantIds.filter((id) => currentTournament.places[id] == null)
  return rolesForHand(currentTournament.participantIds, activeIds, currentTournament.initialDealerId, false)
})
const displayedRoles = computed(() => currentHand.value?.roles ?? lastHand.value?.roles ?? initialRoles.value)
const handStreetLabel = computed(() => handStreets.find((street) => street.id === currentHand.value?.street)?.label ?? '')
const handPotValue = computed(() => currentHand.value ? handPot(currentHand.value) : 0)
const gameRoster = computed(() => {
  const currentTournament = tournament.value
  if (!currentTournament) return []

  const count = currentTournament.participantIds.length
  return currentTournament.participantIds.map((id, index) => {
    const player = currentHand.value?.players[id]
    const angle = (360 / Math.max(count, 1)) * index - 90
    const radians = angle * Math.PI / 180
    const roles = [
      displayedRoles.value?.dealer === id ? 'Дилер' : '',
      displayedRoles.value?.smallBlind === id ? 'МБ' : '',
      displayedRoles.value?.bigBlind === id ? 'ББ' : '',
    ].filter(Boolean)
    const stack = currentHand.value
      ? projectedStack(currentTournament, currentHand.value, id)
      : currentTournament.stacks[id] ?? 0

    return {
      id,
      name: state.players.find((person) => person.id === id)?.name ?? 'Участник',
      stack,
      place: currentTournament.places[id],
      bet: player && currentHand.value ? playerStreetContribution(player, currentHand.value.street) : 0,
      roles,
      folded: player?.folded ?? false,
      allIn: currentHand.value ? isPlayerAllIn(currentTournament, currentHand.value, id) : false,
      position: {
        left: `${50 + Math.cos(radians) * 43}%`,
        top: `${50 + Math.sin(radians) * 42}%`,
      },
    }
  })
})
const activePlayers = computed(() => gameRoster.value.filter((player) => player.place == null).length)
const statusLabel = computed(() => {
  if (tournament.value?.status === 'live') return 'Идёт сейчас'
  if (tournament.value?.status === 'finished') return 'Завершён'
  return 'Скоро начало'
})
const tournamentDate = computed(() => tournament.value
  ? new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Krasnoyarsk',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${tournament.value.date}T12:00:00`))
  : '')
</script>

<template>
  <main v-if="tournament" class="screen-page">
    <header class="screen-top">
      <RouterLink class="screen-brand" to="/">♠ Friendly Poker</RouterLink>
      <span class="screen-season">СЕЗОН 1</span>
    </header>

    <div class="screen-dashboard">
      <section class="screen-table-panel" aria-label="Состав игроков за покерным столом">
        <div class="screen-table-heading">
          <div>
            <div class="eyebrow">{{ tournament.title.toUpperCase() }}</div>
            <h1>{{ currentHand ? `Раздача № ${currentHand.number}` : 'Игроки за столом' }}</h1>
          </div>
          <div v-if="currentHand" class="table-pot">
            <span>БАНК</span>
            <strong>{{ numberFormat.format(handPotValue) }}</strong>
          </div>
        </div>

        <div class="poker-table" :class="{ 'poker-table-empty': !gameRoster.length }">
          <div class="poker-table-felt" aria-hidden="true">
            <span class="felt-mark">♠</span>
            <span class="felt-caption">{{ currentHand ? handStreetLabel : 'МЕСТА ЗА СТОЛОМ' }}</span>
          </div>
          <article
            v-for="player in gameRoster"
            :key="player.id"
            class="screen-seat"
            :class="{ 'is-eliminated': player.place != null, 'is-folded': player.folded, 'is-all-in': player.allIn }"
            :style="player.position"
          >
            <strong class="seat-name">{{ player.name }}</strong>
            <div v-if="player.roles.length" class="seat-roles" :aria-label="player.roles.join(', ')">
              <span v-for="role in player.roles" :key="role">{{ role }}</span>
            </div>
            <span class="seat-stack">{{ player.place != null ? `Место ${player.place}` : tournament.gameInitialized ? `${numberFormat.format(player.stack)} фишек` : 'Ожидает старта' }}</span>
            <span v-if="tournament.gameInitialized && player.place == null" class="seat-bet">
              <small>{{ player.folded ? 'ФОЛД' : player.allIn ? 'ОЛЛ-ИН' : 'СТАВКА УЛИЦЫ' }}</small>
              <b>{{ numberFormat.format(player.bet) }}</b>
            </span>
          </article>
          <div v-if="!gameRoster.length" class="table-empty">Состав турнира ещё не добавлен</div>
        </div>

        <div class="screen-table-legend">
          <span><b>Дилер</b> — кнопка дилера</span>
          <span><b>МБ</b> — малый блайнд</span>
          <span><b>ББ</b> — большой блайнд</span>
          <span class="legend-bet">Ставка — сумма на текущей улице</span>
        </div>
      </section>

      <aside class="screen-info-panel" aria-label="Уровень блайндов и время турнира">
        <div class="screen-info-heading">
          <div class="eyebrow">{{ tournament.title.toUpperCase() }}</div>
          <span class="screen-status" :class="`status-${tournament.status}`">{{ statusLabel }}</span>
        </div>

        <div class="screen-level-title">
          <span>{{ currentLevel?.break ? 'ПЕРЕРЫВ' : 'ТЕКУЩИЙ УРОВЕНЬ' }}</span>
          <strong v-if="!currentLevel?.break">{{ tournament.currentLevel + 1 }}</strong>
        </div>
        <div v-if="!currentLevel?.break" class="screen-blinds">
          <div><span>МАЛЫЙ БЛАЙНД</span><strong>{{ numberFormat.format(currentLevel?.small ?? 0) }}</strong></div>
          <i aria-hidden="true"></i>
          <div><span>БОЛЬШОЙ БЛАЙНД</span><strong>{{ numberFormat.format(currentLevel?.big ?? 0) }}</strong></div>
        </div>

        <div class="screen-clock-card">
          <div class="screen-clock-label">{{ tournament.timerStartedAt === null ? 'ТАЙМЕР НА ПАУЗЕ' : 'ДО СЛЕДУЮЩЕГО УРОВНЯ' }}</div>
          <div class="screen-timer">{{ countdown }}</div>
        </div>

        <div class="screen-next-level">
          <span>{{ nextLevel?.break ? 'ДАЛЕЕ · ПЕРЕРЫВ' : 'СЛЕДУЮЩИЙ УРОВЕНЬ' }}</span>
          <strong v-if="nextLevel && !nextLevel.break">{{ numberFormat.format(nextLevel.small) }} / {{ numberFormat.format(nextLevel.big) }}</strong>
          <strong v-else-if="!nextLevel">Последний уровень</strong>
          <small v-if="currentLevel?.minutes">Длительность уровня: {{ currentLevel.minutes }} мин.</small>
        </div>

        <div class="screen-game-details">
          <div class="detail-hand">
            <span>{{ currentHand ? `РАЗДАЧА № ${currentHand.number}` : lastHand ? `ПОСЛЕДНЯЯ РАЗДАЧА № ${lastHand.number}` : 'РАЗДАЧИ' }}</span>
            <strong>{{ currentHand ? handStreetLabel : lastHand ? 'Завершена' : 'Ещё не начаты' }}</strong>
          </div>
          <div class="detail-pot"><span>Банк</span><strong>{{ numberFormat.format(handPotValue) }}</strong></div>
        </div>

        <div class="screen-tournament-details">
          <div><span>{{ tournament.gameInitialized ? 'В игре' : 'Участников' }}</span><strong>{{ activePlayers }} / {{ gameRoster.length }}</strong></div>
          <div><span>Взнос</span><strong>{{ numberFormat.format(tournament.buyIn) }} ₽</strong></div>
          <div><span>Стартовый стек</span><strong>{{ numberFormat.format(tournament.startingStack) }}</strong></div>
        </div>

        <footer class="screen-footer">
          <span>{{ tournament.startedAt == null ? `Плановый старт ${tournament.startTime}` : `Старт ${formatKrasnoyarskDateTime(tournament.startedAt)} · Красноярск` }}</span>
          <span>{{ tournamentDate }} · Красноярск</span>
        </footer>
      </aside>
    </div>
  </main>
  <main v-else class="empty-state screen-missing"><strong>Турнир не найден</strong><RouterLink to="/" class="text-link">На главную</RouterLink></main>
</template>

<style scoped>
.screen-page {
  width: 100%;
  height: 100vh;
  height: 100svh;
  min-height: 0;
  overflow: hidden;
  padding: clamp(12px, 2.3vh, 24px) clamp(14px, 2.7vw, 42px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: clamp(10px, 1.8vh, 18px);
  color: #f5f6f3;
  background: #102b22;
}

.screen-top,
.screen-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  color: #bac8bf;
}

.screen-top {
  min-height: 28px;
  font-size: 13px;
  letter-spacing: .09em;
}

.screen-brand {
  color: white;
  font-size: 19px;
  letter-spacing: -.03em;
}

.screen-season {
  color: #c7a960;
}

.screen-dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, .78fr);
  gap: clamp(12px, 2vw, 28px);
  min-height: 0;
}

.screen-table-panel,
.screen-info-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 18px;
  background: rgba(3, 18, 13, .28);
}

.screen-table-panel {
  display: flex;
  flex-direction: column;
  padding: clamp(16px, 2vw, 30px);
}

.screen-table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.screen-table-heading .eyebrow,
.screen-info-heading .eyebrow {
  color: #c7a960;
  font-size: 12px;
}

.screen-table-heading h1 {
  margin: 5px 0 0;
  color: #fff;
  font: 700 clamp(24px, 2.3vw, 36px)/1.1 'Playfair Display', Georgia, serif;
}

.table-pot {
  display: grid;
  gap: 2px;
  text-align: right;
}

.table-pot span,
.screen-level-title span,
.screen-blinds span,
.screen-next-level > span,
.detail-hand > span {
  color: #aebeb4;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .12em;
}

.table-pot strong {
  color: #ebc86e;
  font-size: clamp(24px, 2.8vw, 38px);
  font-variant-numeric: tabular-nums;
}

.poker-table {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  margin: 8px 0 4px;
}

.poker-table-felt {
  position: absolute;
  inset: 17% 14%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  border: 2px solid rgba(213, 170, 84, .72);
  border-radius: 50%;
  background: radial-gradient(ellipse at center, #1b5942 0%, #154532 65%, #103728 100%);
  box-shadow: inset 0 0 0 7px rgba(213, 170, 84, .08), 0 12px 32px rgba(0, 0, 0, .2);
}

.felt-mark {
  color: rgba(237, 211, 145, .25);
  font-size: clamp(58px, 8vw, 120px);
  line-height: .9;
}

.felt-caption {
  color: rgba(244, 231, 196, .75);
  font-size: clamp(12px, 1.15vw, 16px);
  font-weight: 700;
  letter-spacing: .16em;
  text-align: center;
}

.screen-seat {
  position: absolute;
  z-index: 1;
  width: clamp(118px, 14vw, 180px);
  min-height: 92px;
  padding: 9px 10px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(220, 190, 116, .44);
  border-radius: 9px;
  background: #172e25;
  box-shadow: 0 5px 14px rgba(0, 0, 0, .25);
  text-align: center;
}

.screen-seat.is-eliminated {
  opacity: .48;
  filter: grayscale(.65);
}

.screen-seat.is-folded {
  border-color: rgba(174, 190, 180, .35);
  opacity: .72;
}

.screen-seat.is-all-in {
  border-color: #d86b61;
  box-shadow: 0 0 0 2px rgba(216, 107, 97, .22), 0 5px 14px rgba(0, 0, 0, .25);
}

.seat-name {
  max-width: 100%;
  overflow: hidden;
  color: #fff;
  font-size: clamp(14px, 1.25vw, 18px);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-roles {
  display: flex;
  justify-content: center;
  gap: 3px;
}

.seat-roles span {
  padding: 2px 5px;
  border-radius: 4px;
  background: #d4b967;
  color: #2a2110;
  font-size: 10px;
  font-weight: 800;
}

.seat-stack {
  max-width: 100%;
  overflow: hidden;
  color: #b8c7bd;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-bet {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: #f1d07a;
  font-variant-numeric: tabular-nums;
}

.seat-bet small {
  color: #acbdb2;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .05em;
}

.seat-bet b {
  font-size: 17px;
}

.table-empty {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: #f2d487;
  font-size: 16px;
  text-align: center;
}

.screen-table-legend {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 5px 15px;
  color: #aebeb4;
  font-size: 11px;
}

.screen-table-legend b {
  color: #e4c875;
}

.legend-bet {
  color: #d1d9d3;
}

.screen-info-panel {
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.8vh, 20px);
  padding: clamp(18px, 2vw, 30px);
}

.screen-info-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.screen-status {
  padding: 6px 10px;
  border-radius: 99px;
  background: rgba(255, 255, 255, .09);
  color: #d7dfd9;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.screen-status.status-live {
  background: rgba(213, 170, 84, .18);
  color: #f0d586;
}

.screen-status.status-finished {
  background: rgba(255, 255, 255, .12);
}

.screen-level-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}

.screen-level-title strong {
  color: #fff;
  font: 700 32px/1 'Playfair Display', Georgia, serif;
}

.screen-blinds {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.screen-blinds div {
  display: grid;
  gap: 5px;
}

.screen-blinds strong {
  color: #ebc86e;
  font-size: clamp(38px, 4.6vw, 68px);
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.screen-blinds i {
  width: 1px;
  height: 58px;
  background: rgba(255, 255, 255, .22);
}

.screen-clock-card {
  padding: clamp(10px, 1.6vh, 16px);
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 12px;
  background: rgba(0, 0, 0, .14);
  text-align: center;
}

.screen-clock-label {
  color: #aebeb4;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .13em;
}

.screen-timer {
  margin-top: 2px;
  color: #fff;
  font-size: clamp(60px, 7.8vw, 104px);
  font-weight: 500;
  letter-spacing: .02em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.screen-next-level {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 4px 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}

.screen-next-level strong {
  color: #f0d586;
  font-size: 19px;
  font-variant-numeric: tabular-nums;
}

.screen-next-level small {
  grid-column: 1 / -1;
  color: #9fb0a5;
  font-size: 12px;
}

.screen-game-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.detail-hand {
  display: grid;
  gap: 3px;
}

.detail-hand strong,
.detail-pot strong {
  color: #fff;
  font-size: 17px;
}

.detail-pot {
  display: grid;
  gap: 3px;
  text-align: right;
}

.detail-pot span {
  color: #aebeb4;
  font-size: 12px;
}

.screen-tournament-details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, .12);
}

.screen-tournament-details div {
  display: grid;
  gap: 4px;
}

.screen-tournament-details span {
  color: #aebeb4;
  font-size: 11px;
}

.screen-tournament-details strong {
  color: #f2d487;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.screen-footer {
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, .12);
  color: #9fb0a5;
  font-size: 11px;
}

.screen-missing {
  min-height: 100vh;
  background: #f5f6f3;
}

@media (max-width: 900px) {
  .screen-dashboard {
    grid-template-columns: minmax(0, 1.4fr) minmax(260px, .9fr);
  }

  .screen-seat {
    width: clamp(108px, 14vw, 132px);
    min-height: 82px;
    padding-inline: 7px;
  }

  .screen-table-legend {
    column-gap: 9px;
    font-size: 10px;
  }
}

@media (max-width: 680px) {
  .screen-page {
    padding: 10px;
    gap: 8px;
  }

  .screen-dashboard {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .screen-table-panel {
    padding: 10px;
  }

  .screen-table-heading .eyebrow,
  .screen-info-heading .eyebrow {
    font-size: 9px;
  }

  .screen-table-heading h1 {
    font-size: 18px;
  }

  .poker-table-felt {
    inset: 18% 12%;
  }

  .screen-seat {
    width: clamp(76px, 23vw, 102px);
    min-height: 55px;
    padding: 5px 4px;
  }

  .seat-name {
    font-size: 10px;
  }

  .seat-stack {
    font-size: 8px;
  }

  .seat-bet small {
    font-size: 6px;
  }

  .seat-bet b {
    font-size: 10px;
  }

  .screen-table-legend {
    gap: 3px 8px;
    font-size: 7px;
  }

  .screen-info-panel {
    display: grid;
    grid-template-columns: 1fr 1.1fr;
    gap: 7px 10px;
    padding: 9px 11px;
  }

  .screen-info-heading,
  .screen-level-title,
  .screen-next-level,
  .screen-game-details,
  .screen-tournament-details,
  .screen-footer {
    min-width: 0;
  }

  .screen-info-heading {
    grid-column: 1 / -1;
  }

  .screen-level-title {
    border: 0;
    padding: 0;
  }

  .screen-clock-card {
    grid-row: span 2;
    align-self: center;
    padding: 8px;
  }

  .screen-timer {
    font-size: clamp(38px, 12vw, 54px);
  }

  .screen-next-level {
    grid-template-columns: 1fr;
    padding: 0;
    border: 0;
  }

  .screen-next-level strong {
    font-size: 12px;
  }

  .screen-next-level small {
    display: none;
  }

  .screen-blinds {
    grid-column: 1;
    grid-row: 3;
  }

  .screen-blinds strong {
    font-size: 24px;
  }

  .screen-blinds span,
  .screen-clock-label,
  .screen-next-level > span {
    font-size: 7px;
  }

  .screen-blinds i {
    height: 28px;
  }

  .screen-game-details {
    grid-column: 1 / -1;
    padding-top: 5px;
    border-top: 1px solid rgba(255, 255, 255, .12);
  }

  .screen-tournament-details {
    display: none;
  }

  .screen-footer {
    grid-column: 1 / -1;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, .12);
  }
}

@media (max-width: 380px) {
  .screen-seat {
    width: 72px;
    min-height: 50px;
  }

  .seat-roles span {
    padding-inline: 3px;
    font-size: 7px;
  }

  .screen-table-legend {
    display: none;
  }
}
</style>
