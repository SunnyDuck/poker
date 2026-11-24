<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { formatKrasnoyarskDateTime } from '@/domain/time'
import { rolesForHand } from '@/domain/game'
import TournamentHandPanel from '@/components/TournamentHandPanel.vue'
import { finishTournament, findTournament, getCurrentHand, googleSyncStatus, moveParticipant, nextLevel, pauseTimer, setInitialRole, startTimer, state, toggleParticipant } from '@/stores/poker'
import type { InitialRole } from '@/stores/poker'

const route = useRoute()
const tournament = computed(() => findTournament(String(route.params.id)))
const selectedCount = computed(() => tournament.value?.participantIds.length ?? 0)
const participantRows = computed(() => {
  const game = tournament.value
  if (!game) return state.players
  const selectedIds = new Set(game.participantIds)
  const selected = game.participantIds.map((id) => state.players.find((player) => player.id === id)).filter((player) => player != null)
  return [...selected, ...state.players.filter((player) => !selectedIds.has(player.id))]
})
const displayRoles = computed(() => {
  const game = tournament.value
  if (!game) return null
  const lastHand = game.hands.at(-1)
  return lastHand?.roles ?? (game.initialDealerId ? rolesForHand(game.participantIds, game.participantIds.filter((id) => game.places[id] == null), game.initialDealerId, false) : null)
})
const canChooseInitialRole = computed(() => {
  const game = tournament.value
  return Boolean(game && game.status === 'upcoming' && !game.gameInitialized && !game.hands.some((hand) => hand.roles))
})

function selectedRole(playerId: string): InitialRole | 'dealerSmallBlind' | '' {
  const roles = displayRoles.value
  if (!roles) return ''
  if (roles.dealer === playerId && roles.smallBlind === playerId) return 'dealerSmallBlind'
  if (roles.dealer === playerId) return 'dealer'
  if (roles.smallBlind === playerId) return 'smallBlind'
  if (roles.bigBlind === playerId) return 'bigBlind'
  return ''
}

function updateInitialRole(event: Event, playerId: string) {
  if (!tournament.value) return
  const value = (event.target as HTMLSelectElement).value
  setInitialRole(tournament.value, playerId, value ? value as InitialRole : null)
}

function participantPosition(playerId: string): string {
  const position = tournament.value?.participantIds.indexOf(playerId) ?? -1
  return position < 0 ? '' : `${position + 1}. `
}

function statusLabel(status: string) {
  return status === 'live' ? 'Идёт сейчас' : status === 'finished' ? 'Завершён' : 'Предстоит'
}
</script>

<template>
  <div v-if="tournament" class="admin-page-head">
    <div><div class="eyebrow"><RouterLink to="/admin">ТУРНИРЫ</RouterLink> / НАСТРОЙКА</div><h1>{{ tournament.title }}</h1><p class="muted">Параметры сохраняются автоматически.</p></div>
    <RouterLink class="button button-outline" :to="`/screen/${tournament.id}`" target="_blank">Открыть табло</RouterLink>
  </div>
  <div v-if="tournament" class="manage-grid" :class="{ 'game-in-progress': tournament.gameInitialized }">
    <section v-if="!tournament.gameInitialized && tournament.status === 'upcoming'" class="panel">
      <div class="panel-heading"><div><div class="eyebrow">ОСНОВНОЕ</div><h2>Настройки игры</h2></div><span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span></div>
      <label class="field">Название турнира<input v-model="tournament.title" maxlength="50" :disabled="tournament.gameInitialized"></label>
      <div class="field-row"><label class="field">Дата<input v-model="tournament.date" type="date" :disabled="tournament.gameInitialized"></label><label class="field">Плановое начало<input v-model="tournament.startTime" type="time" :disabled="tournament.gameInitialized"></label></div>
      <p class="fine-print">Фактический старт (Красноярск): {{ formatKrasnoyarskDateTime(tournament.startedAt) }}</p>
      <div class="field-row"><label class="field">Единый взнос, ₽<input v-model.number="tournament.buyIn" type="number" min="0" :disabled="tournament.gameInitialized"></label><label class="field">Стартовый стек для всех<input v-model.number="tournament.startingStack" type="number" min="1" :disabled="tournament.gameInitialized"></label></div>
      <div class="field-row"><label class="field">Докупок на игрока<input v-model.number="tournament.maxRebuys" type="number" min="0" max="5" :disabled="tournament.gameInitialized"></label><div class="field"><span>Цена докупки</span><strong>По единому взносу: {{ tournament.buyIn }} ₽</strong></div></div>
      <label class="field">Докупка до (Красноярск)<input v-model="tournament.rebuyUntil" type="time" :disabled="tournament.gameInitialized"></label>
    </section>

    <section v-if="!tournament.gameInitialized" class="panel">
      <div class="panel-heading"><div><div class="eyebrow">УЧАСТНИКИ</div><h2>Состав игры</h2></div><span class="count-pill">{{ selectedCount }} / 10</span></div>
      <p class="fine-print">{{ tournament.gameInitialized ? 'Состав и порядок мест зафиксированы; показаны роли последней раздачи.' : 'Выберите участников, расставьте их по часовой стрелке и укажите роль для первой раздачи рядом с именем. Остальные роли определятся автоматически.' }}</p>
      <div v-if="!tournament.gameInitialized && tournament.status === 'upcoming'" class="participant-list">
        <div v-for="player in participantRows" :key="player.id" class="tournament-participant-row">
          <label class="tournament-participant-check">
            <input class="participant-select" type="checkbox" :checked="tournament.participantIds.includes(player.id)" :disabled="!tournament.participantIds.includes(player.id) && selectedCount >= 10" @change="toggleParticipant(tournament, player.id)">
            <span class="tournament-participant-name">{{ participantPosition(player.id) }}{{ player.name }}</span>
          </label>
          <div class="participant-tools">
            <select class="role-select" :aria-label="`Роль ${player.name} в первой раздаче`" :value="selectedRole(player.id)" :disabled="!tournament.participantIds.includes(player.id) || !canChooseInitialRole || tournament.places[player.id] != null" @change="updateInitialRole($event, player.id)">
              <option value="">Выбрать роль</option>
              <option value="dealer">Дилер</option>
              <option value="smallBlind">Малый блайнд</option>
              <option value="bigBlind">Большой блайнд</option>
              <option v-if="selectedCount === 2" value="dealerSmallBlind" disabled>Дилер и малый блайнд</option>
            </select>
            <span v-if="tournament.participantIds.includes(player.id)" class="participant-move-controls">
              <button class="text-button" type="button" :disabled="tournament.participantIds.indexOf(player.id) === 0" :aria-label="`Переместить ${player.name} выше`" @click="moveParticipant(tournament, player.id, -1)">↑</button>
              <button class="text-button" type="button" :disabled="tournament.participantIds.indexOf(player.id) === selectedCount - 1" :aria-label="`Переместить ${player.name} ниже`" @click="moveParticipant(tournament, player.id, 1)">↓</button>
            </span>
          </div>
        </div>
      </div>
      <p class="fine-print">Д — дилер, МБ — малый блайнд, ББ — большой блайнд. При двух игроках дилер ставит малый блайнд. Добавить или изменить участников можно в <RouterLink to="/admin/participants">настройках участников</RouterLink>.</p>
    </section>

    <section class="panel game-management-panel">
      <div class="game-management-controls">
        <div class="eyebrow">ХОД ТУРНИРА</div><h2>Управление игрой</h2>
        <div class="control-status"><span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span><span>Уровень {{ tournament.currentLevel + 1 }}</span></div>
        <div class="control-actions">
          <button v-if="tournament.timerStartedAt === null && tournament.status !== 'finished'" class="button button-dark" :disabled="tournament.participantIds.length < 2 || (!tournament.gameInitialized && !tournament.initialDealerId)" @click="startTimer(tournament)">{{ tournament.status === 'live' ? 'Продолжить таймер' : 'Начать турнир' }}</button>
          <button v-else-if="tournament.status !== 'finished'" class="button button-outline" @click="pauseTimer(tournament)">Пауза</button>
          <button class="button button-outline" :disabled="tournament.status === 'finished'" @click="nextLevel(tournament)">Следующий уровень</button>
          <button v-if="tournament.status !== 'finished'" class="button button-danger" :disabled="!tournament.gameInitialized || Boolean(getCurrentHand(tournament))" @click="finishTournament(tournament)">Завершить турнир</button>
        </div>
        <p v-if="!tournament.gameInitialized && !tournament.initialDealerId" class="fine-print">Чтобы начать турнир, назначьте стартовую роль одному из участников.</p>
        <p class="fine-print">Таймер и текущий уровень отображаются на табло. {{ googleSyncStatus === 'local' ? 'В локальном режиме синхронизация работает только между вкладками этого браузера.' : 'При подключённой Google Таблице данные обновляются на других устройствах примерно раз в 30 секунд.' }}</p>
      </div>
      <div class="blind-levels-section">
        <div class="panel-heading"><div><div class="eyebrow">СТРУКТУРА</div><h2>Уровни блайндов</h2></div></div>
        <div class="blind-list">
          <div v-for="(level, index) in tournament.levels" :key="index" class="blind-row">
            <span>{{ level.break ? 'Перерыв' : `Уровень ${index + 1}` }}</span>
            <strong v-if="!level.break">{{ level.small }} / {{ level.big }}</strong><strong v-else>—</strong>
            <span>{{ level.minutes }} мин</span>
          </div>
        </div>
        <p class="fine-print">Список взят из положения сезона; редактирование структуры добавим отдельно.</p>
      </div>
    </section>

    <TournamentHandPanel v-if="tournament.gameInitialized" :tournament="tournament" />
  </div>
  <div v-else class="empty-state"><strong>Турнир не найден</strong><RouterLink to="/admin" class="text-link">Вернуться к турнирам</RouterLink></div>
</template>
