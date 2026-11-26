<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { formatKrasnoyarskDateTime, formatTournamentDate } from '@/domain/time'
import { handPot, handStreets, isPlayerAllIn, playerStreetContribution, projectedStack, rolesForHand } from '@/domain/game'
import { currentSeconds, findTournament, getCurrentHand, state } from '@/stores/poker'
import KitIcon from '@/components/KitIcon.vue'
import pokerChip from '@/assets/poker/chips.svg'

const route = useRoute()
const tournament = computed(() => findTournament(String(route.params.id)))
const now = ref(Date.now())
const compactTable = ref(false)
let interval: number | undefined
function updateCompactTable() { compactTable.value = window.innerWidth <= 680 }
onMounted(() => {
  updateCompactTable()
  window.addEventListener('resize', updateCompactTable)
  interval = window.setInterval(() => { now.value = Date.now() }, 200)
})
onUnmounted(() => {
  if (interval) window.clearInterval(interval)
  window.removeEventListener('resize', updateCompactTable)
})

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
const expired = computed(() => tournament.value?.status === 'live' && tournament.value.gameInitialized && remainingSeconds.value === 0)
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
  const maximumStack = Math.max(1, ...currentTournament.participantIds.map((id) => {
    const player = currentHand.value?.players[id]
    return player && currentHand.value
      ? projectedStack(currentTournament, currentHand.value, id)
      : currentTournament.stacks[id] ?? 0
  }))
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
    const chipCount = stack > 0 ? Math.max(3, Math.min(12, Math.round(Math.sqrt(stack / maximumStack) * 12))) : 0
    const chipTowers = [0, 0, 0]
    for (let chip = 0; chip < chipCount; chip += 1) {
      const tower = chip % chipTowers.length
      chipTowers[tower] = (chipTowers[tower] ?? 0) + 1
    }
    const stackLabel = currentTournament.places[id] === 1
      ? `Победитель · ${numberFormat.format(stack)}`
      : currentTournament.places[id] != null
        ? `Место ${currentTournament.places[id]}`
        : currentTournament.gameInitialized
          ? numberFormat.format(stack)
          : 'Ожидает старта'
    const diagonal = Math.abs(Math.cos(radians)) > .5 && Math.abs(Math.sin(radians)) > .5
    const chipXRadius = compactTable.value ? 30 : !compactTable.value && diagonal && Math.sin(radians) < 0 ? 26 : 32
    const chipYRadius = compactTable.value
      ? 36
      : diagonal && Math.sin(radians) < 0 ? 20 : diagonal && Math.sin(radians) > 0 ? 27 : 29

    return {
      id,
      name: state.players.find((person) => person.id === id)?.name ?? 'Участник',
      stack,
      stackLabel,
      showChipUnit: currentTournament.gameInitialized && currentTournament.places[id] == null,
      chipCount,
      chipTowers,
      chipPosition: {
        left: `${50 + Math.cos(radians) * chipXRadius}%`,
        top: `${50 + Math.sin(radians) * chipYRadius}%`,
      },
      place: currentTournament.places[id],
      bet: player && currentHand.value ? playerStreetContribution(player, currentHand.value.street) : 0,
      roles,
      folded: player?.folded ?? false,
      allIn: currentHand.value ? isPlayerAllIn(currentTournament, currentHand.value, id) : false,
      position: {
        left: `${50 + Math.cos(radians) * 40}%`,
        top: `${50 + Math.sin(radians) * 38}%`,
      },
    }
  })
})
const tableSectors = computed(() => {
  const count = gameRoster.value.length
  if (count < 2) return []
  return Array.from({ length: count }, (_, index) => {
    const step = 360 / count
    const boundaryAngle = (step * (index + .5) - 90) * Math.PI / 180
    const labelAngle = (step * index - 90) * Math.PI / 180
    return {
      x: 50 + Math.cos(boundaryAngle) * 47,
      y: 50 + Math.sin(boundaryAngle) * 47,
      labelX: 50 + Math.cos(labelAngle + step * .4 * Math.PI / 180) * 35,
      labelY: 50 + Math.sin(labelAngle + step * .4 * Math.PI / 180) * 35,
      number: index + 1,
    }
  })
})
const activePlayers = computed(() => gameRoster.value.filter((player) => tournament.value?.status === 'finished' ? player.place === 1 : player.place == null).length)
const statusLabel = computed(() => {
  if (tournament.value?.status === 'live') return 'Идёт сейчас'
  if (tournament.value?.status === 'finished') return 'Завершён'
  return 'Скоро начало'
})
const tournamentDate = computed(() => tournament.value ? formatTournamentDate(tournament.value.date, false, true) : '')
</script>

<template>
  <main v-if="tournament" class="screen-page">
    <header class="screen-top">
      <RouterLink class="screen-brand" to="/"><KitIcon name="rocket" :size="22" />Galaxy Poker</RouterLink>
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
            <svg class="table-sector-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line v-for="(sector, index) in tableSectors" :key="index" x1="50" y1="50" :x2="sector.x" :y2="sector.y" />
              <g v-for="sector in tableSectors" :key="`number-${sector.number}`" class="table-sector-number">
                <circle :cx="sector.labelX" :cy="sector.labelY" r="3.8" />
                <text :x="sector.labelX" :y="sector.labelY">{{ sector.number }}</text>
              </g>
            </svg>
            <span class="felt-mark">♠</span>
            <span class="felt-caption">{{ currentHand ? handStreetLabel : 'МЕСТА ЗА СТОЛОМ' }}</span>
            <span
              v-for="player in gameRoster"
              :key="`chips-${player.id}`"
              class="table-chip-pile"
              :style="player.chipPosition"
              role="img"
              :aria-label="`Стопка ${player.name}: примерно ${player.chipCount} условных фишек, стек ${numberFormat.format(player.stack)}`"
              :title="`Стек ${numberFormat.format(player.stack)} · высота стопки условная`"
            >
              <span v-for="(tower, towerIndex) in player.chipTowers" :key="towerIndex" class="chip-tower" :class="`chip-tower-${towerIndex + 1}`">
                <img v-for="chip in tower" :key="chip" class="chip-image" :src="pokerChip" alt="" />
              </span>
            </span>
          </div>
          <article
            v-for="player in gameRoster"
            :key="player.id"
            class="screen-seat"
            :class="{ 'is-eliminated': player.place != null && player.place > 1, 'is-folded': player.folded, 'is-all-in': player.allIn }"
            :style="player.position"
          >
            <strong class="seat-name">{{ player.name }}</strong>
            <div v-if="player.roles.length" class="seat-roles" :aria-label="player.roles.join(', ')">
              <span v-for="role in player.roles" :key="role" :class="role === 'Дилер' ? 'role-dealer' : 'role-blind'">{{ role }}</span>
            </div>
            <div class="seat-stackline">
              <span class="seat-stack">{{ player.stackLabel }}<small v-if="player.showChipUnit" class="seat-stack-unit">фишек</small></span>
            </div>
            <span v-if="tournament.gameInitialized && player.place == null" class="seat-bet" :class="{ 'seat-bet-all-in': player.allIn, 'seat-bet-folded': player.folded }">
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

        <div class="screen-clock-card" :class="{ 'clock-expired': expired }">
          <div class="screen-clock-label">{{ tournament.status === 'finished' ? 'ТУРНИР ЗАВЕРШЁН' : expired ? 'ВРЕМЯ УРОВНЯ ИСТЕКЛО' : tournament.timerStartedAt === null ? 'ТАЙМЕР НА ПАУЗЕ' : 'ДО ОКОНЧАНИЯ УРОВНЯ' }}</div>
          <div class="screen-timer">{{ countdown }}</div>
          <p v-if="expired" class="screen-expired-hint" role="status">{{ nextLevel ? 'Смена уровня — вручную' : 'Последний уровень · завершение вручную' }}</p>
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
          <div><span>{{ tournament.status === 'finished' ? 'Победителей' : tournament.gameInitialized ? 'В игре' : 'Участников' }}</span><strong>{{ activePlayers }} / {{ gameRoster.length }}</strong></div>
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
.clock-expired{border-color:var(--orange-500);background:rgba(255,125,38,.14)}
.screen-expired-hint{font-size:12px;color:var(--yellow-500);margin:5px 0 0}
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
  color: #fff;
  background:
    radial-gradient(ellipse at 13% 8%, rgba(88, 186, 86, .16), transparent 35%),
    radial-gradient(ellipse at 92% 95%, rgba(255, 201, 38, .08), transparent 32%),
    #1f232e;
}

.screen-top,
.screen-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  color: rgba(255,255,255,.72);
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
  color: #ddee73;
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
  border: 1px solid rgba(221, 238, 115, .2);
  border-radius: 18px;
  background: linear-gradient(145deg, rgba(65, 72, 89, .92), rgba(37, 42, 55, .96));
  box-shadow: 0 14px 38px rgba(0, 0, 0, .2);
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
  color: #ddee73;
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
  color: #ffc926;
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
  overflow: hidden;
  position: absolute;
  z-index: 0;
  inset: 17% 14%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  border: 3px solid #ffc926;
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(255,255,255,.07) 0 1px, transparent 1.5px) 0 0 / 20px 20px,
    radial-gradient(ellipse at 50% 42%, #2f9d62 0%, #187349 48%, #0c583d 100%);
  box-shadow: inset 0 0 0 8px rgba(221, 238, 115, .12), inset 0 0 45px rgba(0, 0, 0, .24), 0 12px 32px rgba(0, 0, 0, .28);
}

.table-sector-lines {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.table-sector-lines line {
  stroke: rgba(255, 255, 255, .24);
  stroke-width: .32;
  vector-effect: non-scaling-stroke;
}

.table-sector-number circle {
  fill:#0c583d;
  stroke:#ffc926;
  stroke-width:.55;
  vector-effect:non-scaling-stroke;
}

.table-sector-number text {
  fill:#fff;
  stroke:#0c583d;
  stroke-width:.8px;
  paint-order:stroke;
  font-size:4.5px;
  font-weight:800;
  text-anchor:middle;
  dominant-baseline:central;
}

.felt-mark {
  position: relative;
  z-index: 1;
  top:-18px;
  color: rgba(255, 201, 38, .34);
  font-size: clamp(44px, 6vw, 74px);
  line-height: .9;
}

.felt-caption {
  position: relative;
  z-index: 1;
  top:-18px;
  color: rgba(255, 255, 255, .72);
  font-size: clamp(12px, 1.15vw, 16px);
  font-weight: 700;
  letter-spacing: .16em;
  text-align: center;
}

.screen-seat {
  position: absolute;
  z-index: 2;
  width: clamp(118px, 14vw, 180px);
  min-height: 112px;
  padding: 10px 11px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 201, 38, .68);
  border-radius: 11px;
  background: linear-gradient(145deg, rgba(31, 35, 46, .98), rgba(25, 28, 36, .98));
  box-shadow: 0 8px 20px rgba(0, 0, 0, .44), inset 0 1px 0 rgba(255,255,255,.12);
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
  border-color: #ff7866;
  box-shadow: 0 0 0 2px rgba(255, 120, 102, .22), 0 5px 14px rgba(0, 0, 0, .25);
}

.seat-name {
  max-width: 100%;
  overflow: hidden;
  color: #fff;
  font-size: clamp(17px, 1.45vw, 21px);
  font-weight: 700;
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
  padding: 3px 7px;
  border-radius: 4px;
  background: #ddee73;
  color: #191c24;
  font-size: 12px;
  font-weight: 800;
}

.seat-roles .role-dealer { background:var(--yellow-500); }
.seat-roles .role-blind { background:var(--lime-500); }

.seat-stackline {
  display:flex;
  width:100%;
  min-width:0;
  align-items:center;
  justify-content:center;
  gap:6px;
}

.seat-stack {
  display:flex;
  align-items:baseline;
  gap:3px;
  max-width: 100%;
  overflow: hidden;
  color: rgba(255,255,255,.86);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-stack-unit { color:var(--text-muted); font-size:11px; font-weight:500; }

.table-chip-pile {
  position:absolute;
  z-index:1;
  display:flex;
  align-items:flex-end;
  gap:3px;
  transform:translate(-50%,-50%);
  filter:drop-shadow(0 3px 2px rgba(0,0,0,.42));
}

.chip-tower {
  display:flex;
  flex-direction:column-reverse;
  align-items:center;
}

.chip-image {
  display:block;
  flex:0 0 auto;
  width:28px;
  height:28px;
  margin-top:-19px;
  object-fit:contain;
  transform:perspective(90px) rotateX(62deg);
  transform-origin:center center;
  filter:brightness(0) saturate(100%) invert(71%) sepia(53%) saturate(590%) hue-rotate(65deg) brightness(95%) contrast(90%);
}

.chip-tower-1 .chip-image { filter:brightness(0) saturate(100%) invert(71%) sepia(53%) saturate(590%) hue-rotate(65deg) brightness(95%) contrast(90%); }
.chip-tower-2 .chip-image { filter:brightness(0) saturate(100%) invert(81%) sepia(79%) saturate(850%) hue-rotate(351deg) brightness(104%) contrast(101%); }
.chip-tower-3 .chip-image { filter:brightness(0) saturate(100%) invert(66%) sepia(48%) saturate(1700%) hue-rotate(318deg) brightness(99%) contrast(94%); }

.seat-bet {
  display: flex;
  align-items: baseline;
  gap: 5px;
  width:100%;
  justify-content:space-between;
  padding-top:4px;
  border-top:1px solid rgba(255,255,255,.12);
  color: #ffc926;
  font-variant-numeric: tabular-nums;
}

.seat-bet-all-in { color:var(--salmon-500); }
.seat-bet-folded { color:var(--text-muted); }

.seat-bet small {
  color: #acbdb2;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
}

.seat-bet b {
  font-size: 19px;
}

.table-empty {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: #ffc926;
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
  color: #ffc926;
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
  color: rgba(255,255,255,.82);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.screen-status.status-live {
  background: rgba(255, 201, 38, .14);
  color: #ffc926;
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
  color: #ffc926;
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
  border: 1px solid rgba(221, 238, 115, .32);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(221, 238, 115, .1), rgba(37, 42, 55, .78));
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
  color: #ddee73;
  font-size: clamp(60px, 7.8vw, 104px);
  font-weight: 500;
  letter-spacing: .02em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 24px rgba(221, 238, 115, .18);
}

.clock-expired .screen-timer { color: #ff7d26; text-shadow: 0 0 24px rgba(255,125,38,.22); }

.screen-next-level {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 4px 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .12);
}

.screen-next-level strong {
  color: #ffc926;
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
  color: #ffc926;
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
  background: #353c4d;
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
    font-size: 13px;
  }

  .seat-stack {
    font-size: 12px;
  }

  .seat-stackline { gap:2px; }
  .seat-stack-unit { display:none; }
  .table-chip-pile { gap:2px; transform:translate(-50%,-50%) scale(.52); }
  .chip-image { width:22px; height:22px; margin-top:-15px; }

  .seat-bet small {
    font-size: 8px;
  }

  .seat-bet b {
    font-size: 12px;
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
