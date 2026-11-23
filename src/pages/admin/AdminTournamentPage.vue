<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { finishTournament, findTournament, googleSyncStatus, nextLevel, pauseTimer, startTimer, state, toggleParticipant } from '@/stores/poker'

const route = useRoute()
const tournament = computed(() => findTournament(String(route.params.id)))
const selectedCount = computed(() => tournament.value?.participantIds.length ?? 0)

function statusLabel(status: string) {
  return status === 'live' ? 'Идёт сейчас' : status === 'finished' ? 'Завершён' : 'Предстоит'
}
</script>

<template>
  <div v-if="tournament" class="admin-page-head">
    <div><div class="eyebrow"><RouterLink to="/admin">ТУРНИРЫ</RouterLink> / НАСТРОЙКА</div><h1>{{ tournament.title }}</h1><p class="muted">Параметры сохраняются автоматически.</p></div>
    <RouterLink class="button button-outline" :to="`/screen/${tournament.id}`" target="_blank">Открыть табло</RouterLink>
  </div>
  <div v-if="tournament" class="manage-grid">
    <section class="panel">
      <div class="panel-heading"><div><div class="eyebrow">ОСНОВНОЕ</div><h2>Настройки игры</h2></div><span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span></div>
      <label class="field">Название турнира<input v-model="tournament.title" maxlength="50"></label>
      <div class="field-row"><label class="field">Дата<input v-model="tournament.date" type="date"></label><label class="field">Начало<input v-model="tournament.startTime" type="time"></label></div>
      <div class="field-row"><label class="field">Взнос, ₽<input v-model.number="tournament.buyIn" type="number" min="0"></label><label class="field">Стартовый стек<input v-model.number="tournament.startingStack" type="number" min="1"></label></div>
      <div class="field-row"><label class="field">Стоимость докупки, ₽<input v-model.number="tournament.rebuyCost" type="number" min="0"></label><label class="field">Докупок на игрока<input v-model.number="tournament.maxRebuys" type="number" min="0" max="5"></label></div>
      <label class="field">Докупка до<input v-model="tournament.rebuyUntil" type="time"></label>
    </section>

    <section class="panel">
      <div class="panel-heading"><div><div class="eyebrow">УЧАСТНИКИ</div><h2>Состав игры</h2></div><span class="count-pill">{{ selectedCount }} / 10</span></div>
      <div class="participant-list">
        <div v-for="player in state.players" :key="player.id" class="participant-row">
          <label class="participant-check">
            <input type="checkbox" :checked="tournament.participantIds.includes(player.id)" :disabled="!tournament.participantIds.includes(player.id) && selectedCount >= 10" @change="toggleParticipant(tournament, player.id)">
            <span>{{ player.name }}</span>
          </label>
          <div v-if="tournament.participantIds.includes(player.id)" class="entrant-fields">
            <label>Докупки <input v-model.number="tournament.rebuys[player.id]" type="number" min="0" :max="tournament.maxRebuys"></label>
            <label>Место <input v-model.number="tournament.places[player.id]" type="number" min="1" max="10" placeholder="—"></label>
          </div>
        </div>
      </div>
      <p class="fine-print">В демо выбери участников, укажи число докупок и итоговые места для проверки рейтинга.</p>
    </section>

    <section class="panel">
      <div class="panel-heading"><div><div class="eyebrow">СТРУКТУРА</div><h2>Уровни блайндов</h2></div></div>
      <div class="blind-list">
        <div v-for="(level, index) in tournament.levels" :key="index" class="blind-row">
          <span>{{ level.break ? 'Перерыв' : `Уровень ${index + 1}` }}</span>
          <strong v-if="!level.break">{{ level.small }} / {{ level.big }}</strong><strong v-else>—</strong>
          <span>{{ level.minutes }} мин</span>
        </div>
      </div>
      <p class="fine-print">Список взят из положения сезона; редактирование структуры добавим отдельно.</p>
    </section>

    <section class="panel game-control-panel">
      <div class="eyebrow">ХОД ТУРНИРА</div><h2>Управление игрой</h2>
      <div class="control-status"><span class="status" :class="`status-${tournament.status}`">{{ statusLabel(tournament.status) }}</span><span>Уровень {{ tournament.currentLevel + 1 }}</span></div>
      <div class="control-actions">
        <button v-if="tournament.timerStartedAt === null && tournament.status !== 'finished'" class="button button-dark" @click="startTimer(tournament)">{{ tournament.status === 'live' ? 'Продолжить таймер' : 'Начать турнир' }}</button>
        <button v-else-if="tournament.status !== 'finished'" class="button button-outline" @click="pauseTimer(tournament)">Пауза</button>
        <button class="button button-outline" :disabled="tournament.status === 'finished'" @click="nextLevel(tournament)">Следующий уровень</button>
        <button v-if="tournament.status !== 'finished'" class="button button-danger" @click="finishTournament(tournament)">Завершить турнир</button>
      </div>
      <p class="fine-print">Таймер и текущий уровень отображаются на табло. {{ googleSyncStatus === 'local' ? 'В локальном режиме синхронизация работает только между вкладками этого браузера.' : 'При подключённой Google Таблице данные обновляются на других устройствах примерно раз в 5 секунд.' }}</p>
    </section>
  </div>
  <div v-else class="empty-state"><strong>Турнир не найден</strong><RouterLink to="/admin" class="text-link">Вернуться к турнирам</RouterLink></div>
</template>
