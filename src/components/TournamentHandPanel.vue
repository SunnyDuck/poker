<script setup lang="ts">
import { computed, ref } from 'vue'
import { canAdvanceHandStreet, canPlayerCheck, classifyHandActions, handActionCount, handActionPot, handPot, handStreets, handStreetPot, isPlayerAllIn, isPlayerVisibleOnStreet, nextHandActionIndex, playerCashout, playerInvestment, playerNetBalance, playerHandContribution, playerStreetContribution, projectedStack, streetActionRequirements, tournamentPrizePool } from '@/domain/game'
import type { HandStreet, PokerActionType, Tournament } from '@/domain/types'
import {
  canPlayerRebuy,
  addHandBetActionColumn,
  confirmPlayerElimination,
  getCurrentHand,
  rebuyPlayer,
  setHandBet,
  setHandAction,
  setHandFolded,
  setHandStreet,
  setHandWinner,
  settleCurrentHand,
  startNextHand,
  state,
} from '@/stores/poker'

const props = defineProps<{ tournament: Tournament }>()
const message = ref('')
const hand = computed(() => getCurrentHand(props.tournament))
const pot = computed(() => hand.value ? handPot(hand.value) : 0)
const streetActionCount = computed(() => {
  const currentHand = hand.value
  if (!currentHand) return 0
  let count = handActionCount(currentHand, currentHand.street)
  for (const { playerId, amountOwed } of streetActionRequirements(props.tournament, currentHand, currentHand.street)) {
    if (amountOwed === 0) count = Math.max(count, nextCheckActionIndex(playerId, currentHand.street) + 1)
  }
  return count
})
const streetActionIndexes = computed(() => Array.from({ length: streetActionCount.value }, (_, index) => index))
const currentStreetLabel = computed(() => handStreets.find((street) => street.id === hand.value?.street)?.label ?? '')
const cashFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const chipFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nextStreet = computed(() => {
  const currentIndex = handStreets.findIndex((street) => street.id === hand.value?.street)
  return handStreets[currentIndex + 1]
})
const currentStreetRequirements = computed(() => hand.value
  ? streetActionRequirements(props.tournament, hand.value, hand.value.street)
  : [])
const canAdvanceStreet = computed(() => hand.value
  ? canAdvanceHandStreet(props.tournament, hand.value, hand.value.street)
  : false)
const streetTransitionHint = computed(() => {
  if (!hand.value || canAdvanceStreet.value) return ''
  const requirements = currentStreetRequirements.value.map(({ playerId, amountOwed }) => {
    const name = state.players.find((player) => player.id === playerId)?.name ?? 'Игрок'
    return amountOwed > 0
      ? `${name} — уравнять ещё ${chipFormat.format(amountOwed)} или сбросить карты`
      : `${name} — отметить чек или сбросить карты`
  })
  const nextStep = nextStreet.value ? `Переход на ${nextStreet.value.label} пока закрыт` : 'Раздачу пока нельзя завершить'
  return `${nextStep}: ${requirements.join('; ')}. Олл-ин игроки больше не обязаны уравнивать ставки.`
})
const participants = computed(() => props.tournament.participantIds.map((id) => ({
  id,
  name: state.players.find((player) => player.id === id)?.name ?? 'Удалённый участник',
})))
const handParticipants = computed(() => {
  const currentHand = hand.value
  if (!currentHand) return []
  return Object.entries(currentHand.players).map(([id, player]) => ({
    id,
    player,
    name: state.players.find((person) => person.id === id)?.name ?? 'Удалённый участник',
  })).filter(({ player }) => isPlayerVisibleOnStreet(player, currentHand.street))
})
const wagersWithinStacks = computed(() => hand.value
  ? Object.entries(hand.value.players).every(([id, player]) => playerHandContribution(player) <= (props.tournament.stacks[id] ?? 0))
  : false)
const canSettle = computed(() => {
  if (!hand.value || !wagersWithinStacks.value) return false
  if (streetActionRequirements(props.tournament, hand.value, hand.value.street).length > 0) return false
  const winners = Object.values(hand.value.players).filter((player) => player.takesPot && !player.folded).length
  return pot.value === 0 || winners > 0
})
const totalCashIn = computed(() => participants.value.reduce((sum, player) => sum + playerInvestment(props.tournament, player.id), 0))
const displayedPrizePool = computed(() => tournamentPrizePool(props.tournament))
const handHistory = computed(() => props.tournament.hands.filter((item) => item.settled).slice().reverse().map((item) => ({
  number: item.number,
  pot: handPot(item),
  street: stageName(item.street),
  winners: Object.entries(item.players)
    .filter(([, player]) => player.takesPot && !player.folded)
    .map(([id]) => state.players.find((player) => player.id === id)?.name ?? 'Удалённый участник'),
})))
const actionLabels: Record<PokerActionType, string> = {
  check: 'Чек',
  call: 'Колл',
  bet: 'Ставка',
  raise: 'Рейз',
  'all-in': 'Олл-ин',
  'small-blind': 'МБ',
  'big-blind': 'ББ',
}

function currentStack(playerId: string): number {
  return hand.value ? projectedStack(props.tournament, hand.value, playerId) : (props.tournament.stacks[playerId] ?? 0)
}

function estimatedCashout(playerId: string): number {
  return playerCashout(props.tournament, playerId, currentStack(playerId))
}

function estimatedNetBalance(playerId: string): number {
  return playerNetBalance(props.tournament, playerId, currentStack(playerId))
}

function availableForAction(playerId: string, street: HandStreet, actionIndex: number): number {
  const player = hand.value?.players[playerId]
  if (!player) return 0
  const currentAction = player.bets[street]?.[actionIndex] ?? 0
  return Math.max(0, (props.tournament.stacks[playerId] ?? 0) - playerHandContribution(player) + currentAction)
}

function nextCheckActionIndex(playerId: string, street: HandStreet): number {
  const currentHand = hand.value
  const player = currentHand?.players[playerId]
  if (!currentHand || !player) return 0

  for (let index = 0; index < player.bets[street].length; index += 1) {
    if ((player.bets[street][index] ?? 0) === 0 && !player.actions[street][index]
      && canPlayerCheck(currentHand, playerId, street, index)) return index
  }
  return nextHandActionIndex(currentHand, street)
}

function onBetChange(playerId: string, street: HandStreet, actionIndex: number, event: Event) {
  const input = event.target as HTMLInputElement
  const previous = hand.value?.players[playerId]?.bets[street]?.[actionIndex] ?? 0
  const amount = input.value === '' ? 0 : Number(input.value)
  if (amount === 0 && hand.value && !canPlayerCheck(hand.value, playerId, street, actionIndex)) {
    input.value = String(previous)
    message.value = 'Чек недоступен: сначала нужно поддержать текущую ставку или сбросить карты.'
    return
  }
  if (!setHandBet(props.tournament, playerId, street, actionIndex, amount)) {
    input.value = String(previous)
    message.value = 'Сумма ставок игрока не может превышать его стек.'
    return
  }
  if (amount === 0) setHandAction(props.tournament, playerId, street, actionIndex, 'check')
  else if (hand.value) {
    if (isPlayerAllIn(props.tournament, hand.value, playerId)) setHandAction(props.tournament, playerId, street, actionIndex, 'all-in')
    else {
      if (hand.value.players[playerId]?.actions[street][actionIndex] === 'all-in') setHandAction(props.tournament, playerId, street, actionIndex, null)
      classifyHandActions(hand.value, street)
    }
  }
  message.value = ''
}

function onCheck(playerId: string, street: HandStreet, actionIndex: number) {
  const player = hand.value?.players[playerId]
  while (player && actionIndex >= player.bets[street].length) {
    if (!addHandBetActionColumn(props.tournament, street)) {
      message.value = 'Не удалось добавить столбец для записи чека.'
      return
    }
  }
  if (!setHandBet(props.tournament, playerId, street, actionIndex, 0) || !setHandAction(props.tournament, playerId, street, actionIndex, 'check')) {
    message.value = 'Не удалось записать чек для этой ячейки.'
    return
  }
  message.value = ''
}

function onAllIn(playerId: string) {
  const currentHand = hand.value
  const player = currentHand?.players[playerId]
  if (!currentHand || !player || player.folded || isPlayerAllIn(props.tournament, currentHand, playerId)) return

  const amount = projectedStack(props.tournament, currentHand, playerId)
  if (amount <= 0) return

  const street = currentHand.street
  const actionIndex = nextHandActionIndex(currentHand, street)
  while (actionIndex >= player.bets[street].length) {
    if (!addHandBetActionColumn(props.tournament, street)) {
      message.value = 'Не удалось добавить столбец действия для олл-ина.'
      return
    }
  }

  if (!setHandBet(props.tournament, playerId, street, actionIndex, amount)) {
    message.value = 'Не удалось выставить оставшийся стек.'
    return
  }
  classifyHandActions(currentHand, street)
  setHandAction(props.tournament, playerId, street, actionIndex, 'all-in')
  message.value = `${participants.value.find((entry) => entry.id === playerId)?.name ?? 'Игрок'} идёт олл-ин на ${chipFormat.format(amount)} фишек.`
}

function goToNextStreet() {
  if (nextStreet.value && !setHandStreet(props.tournament, nextStreet.value.id)) {
    message.value = streetTransitionHint.value || 'Сначала завершите действия всех игроков на этой улице.'
    return
  }
  message.value = ''
}

function requestHandStreet(street: HandStreet) {
  const currentHand = hand.value
  if (!currentHand) return
  const currentIndex = handStreets.findIndex((item) => item.id === currentHand.street)
  const targetIndex = handStreets.findIndex((item) => item.id === street)
  if (targetIndex > currentIndex) {
    for (const item of handStreets.slice(currentIndex, targetIndex)) {
      const requirements = streetActionRequirements(props.tournament, currentHand, item.id)
      if (requirements.length) {
        const blockers = requirements.map(({ playerId, amountOwed }) => {
          const name = state.players.find((player) => player.id === playerId)?.name ?? 'Игрок'
          return amountOwed > 0
            ? `${name} — уравнять ещё ${chipFormat.format(amountOwed)} или сбросить карты`
            : `${name} — отметить чек или сбросить карты`
        })
        message.value = `Переход на ${handStreets[targetIndex]?.label ?? 'следующую улицу'} пока закрыт. Завершите ${item.label}: ${blockers.join('; ')}.`
        return
      }
    }
  }
  setHandStreet(props.tournament, street)
  message.value = ''
}

function addActionColumn() {
  if (!hand.value || !addHandBetActionColumn(props.tournament, hand.value.street)) {
    message.value = 'Не удалось добавить столбец действия.'
    return
  }
  message.value = ''
}

function closeHand() {
  if (!settleCurrentHand(props.tournament)) {
    message.value = pot.value > 0
      ? 'Отметьте игрока, который забирает банк.'
      : 'Не удалось завершить раздачу.'
    return
  }
  message.value = 'Банк распределён, стеки обновлены.'
}

function openNextHand() {
  message.value = startNextHand(props.tournament)
    ? ''
    : 'Нужно не меньше двух игроков с фишками, чтобы начать раздачу.'
}

function onRebuy(playerId: string) {
  const player = participants.value.find((entry) => entry.id === playerId)
  if (!player || !window.confirm(`Добавить ${player.name} докупку за ${props.tournament.buyIn} ₽ и выдать ${props.tournament.startingStack} фишек?`)) return
  if (!rebuyPlayer(props.tournament, playerId)) message.value = 'Докупка сейчас недоступна.'
  else message.value = `${player.name} получил докупку.`
}

function onElimination(playerId: string) {
  const player = participants.value.find((entry) => entry.id === playerId)
  if (!player || !window.confirm(`Подтвердить вылет ${player.name}? Приложение автоматически определит место.`)) return
  if (!confirmPlayerElimination(props.tournament, playerId)) message.value = 'Вылет можно подтвердить после завершения текущей раздачи.'
  else message.value = props.tournament.status === 'finished' ? 'Турнир завершён, места распределены по порядку вылета.' : `${player.name} выбыл. Его место рассчитано автоматически.`
}

function stageName(street: HandStreet): string {
  return handStreets.find((stage) => stage.id === street)?.label ?? street
}
</script>

<template>
  <section class="panel hand-tracking-panel">
    <div class="panel-heading">
      <div><div class="eyebrow">ЖУРНАЛ ИГРЫ</div><h2>Раздача № {{ hand?.number ?? (tournament.hands.at(-1)?.number ?? 0) + 1 }}</h2></div>
      <span class="count-pill">Банк {{ chipFormat.format(pot) }}</span>
    </div>

    <template v-if="hand">
      <div class="hand-street-navigation">
        <div class="hand-street-tabs" role="tablist" aria-label="Улица раздачи">
          <button v-for="(street, index) in handStreets" :key="street.id" type="button" role="tab" :aria-selected="hand.street === street.id" :class="{ 'is-active': hand.street === street.id }" @click="requestHandStreet(street.id)">
            {{ index + 1 }}. {{ street.label }}
          </button>
        </div>
        <button class="button button-outline street-switch-button" type="button" :disabled="!nextStreet || !canAdvanceStreet" @click="goToNextStreet">{{ nextStreet ? `Следующая улица: ${nextStreet.label} →` : 'Последняя улица' }}</button>
      </div>
      <p v-if="streetTransitionHint" class="fine-print street-transition-hint" role="status">{{ streetTransitionHint }}</p>

      <div class="hand-table-wrap">
        <table class="hand-table">
          <thead>
            <tr>
              <th>Игрок</th>
              <th v-for="actionIndex in streetActionIndexes" :key="actionIndex">Действие {{ actionIndex + 1 }}</th>
              <th>На улице</th>
              <th>В раздаче</th>
              <th>Стек</th>
              <th>Фолд</th>
              <th>Забирает</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in handParticipants" :key="entry.id">
              <th scope="row">{{ entry.name }} <span class="role-badges"><span v-if="hand.roles?.dealer === entry.id" class="role-badge">Д</span><span v-if="hand.roles?.smallBlind === entry.id" class="role-badge">МБ</span><span v-if="hand.roles?.bigBlind === entry.id" class="role-badge">ББ</span><span v-if="isPlayerAllIn(tournament, hand, entry.id)" class="all-in-badge">Олл-ин</span></span></th>
              <td v-for="actionIndex in streetActionIndexes" :key="actionIndex">
                <div class="hand-action-cell">
                  <input
                    class="hand-bet-input"
                    type="number"
                    min="0"
                    step="1"
                    :max="availableForAction(entry.id, hand.street, actionIndex)"
                    :aria-label="`${entry.name}, ${currentStreetLabel}, действие ${actionIndex + 1}`"
                    :value="entry.player.bets[hand.street][actionIndex] ?? 0"
                    :disabled="entry.player.folded || (isPlayerAllIn(tournament, hand, entry.id) && !(entry.player.bets[hand.street][actionIndex] ?? 0))"
                    @change="onBetChange(entry.id, hand.street, actionIndex, $event)"
                  >
                  <strong v-if="entry.player.actions[hand.street][actionIndex]" class="hand-action-label">{{ actionLabels[entry.player.actions[hand.street][actionIndex]!] }}</strong>
                  <button v-else-if="!entry.player.folded && !isPlayerAllIn(tournament, hand, entry.id) && currentStreetRequirements.some((requirement) => requirement.playerId === entry.id && requirement.amountOwed === 0) && nextCheckActionIndex(entry.id, hand.street) === actionIndex" class="text-button check-action" type="button" :aria-label="`Записать чек: ${entry.name}, ${currentStreetLabel}, действие ${actionIndex + 1}`" @click="onCheck(entry.id, hand.street, actionIndex)">Чек</button>
                </div>
              </td>
              <td>{{ chipFormat.format(playerStreetContribution(entry.player, hand.street)) }}</td>
              <td>{{ chipFormat.format(playerHandContribution(entry.player)) }}</td>
              <td>
                <strong>{{ chipFormat.format(projectedStack(tournament, hand, entry.id)) }}</strong>
                <button
                  v-if="!entry.player.folded && !isPlayerAllIn(tournament, hand, entry.id) && projectedStack(tournament, hand, entry.id) > 0"
                  class="text-button all-in-action"
                  type="button"
                  :aria-label="`Выставить олл-ин: ${entry.name}, ${chipFormat.format(projectedStack(tournament, hand, entry.id))} фишек`"
                  @click="onAllIn(entry.id)"
                >Олл-ин</button>
              </td>
              <td><input type="checkbox" :aria-label="`${entry.name} сбросил карты`" :checked="entry.player.folded" :disabled="isPlayerAllIn(tournament, hand, entry.id)" @change="setHandFolded(tournament, entry.id, ($event.target as HTMLInputElement).checked)"></td>
              <td><input type="checkbox" :aria-label="`${entry.name} забирает банк`" :checked="entry.player.takesPot" :disabled="entry.player.folded" @change="setHandWinner(tournament, entry.id, ($event.target as HTMLInputElement).checked)"></td>
            </tr>
            <tr class="hand-pot-row">
              <th scope="row">Всего внесено</th>
              <td v-for="actionIndex in streetActionIndexes" :key="actionIndex">{{ chipFormat.format(handActionPot(hand, hand.street, actionIndex)) }}</td>
              <td>{{ chipFormat.format(handStreetPot(hand, hand.street)) }}</td>
              <td>{{ chipFormat.format(pot) }}</td>
              <td colspan="3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="hand-actions">
        <p class="fine-print">{{ wagersWithinStacks ? `Блайнды подставляются автоматически. Для каждой улицы указывайте добавленные фишки по действиям: приложение подпишет равный взнос как колл, превышение как ставку или рейз; нулевое действие отмечайте кнопкой «Чек». Суммы автоматически складываются; несколько победителей делят общий банк поровну.` : 'Сумма ставок игрока превышает его стек.' }}</p>
        <div class="hand-action-buttons">
          <button class="button button-outline" type="button" @click="addActionColumn">＋ Столбец действия</button>
          <button class="button button-dark" type="button" :disabled="!canSettle" @click="closeHand">Завершить раздачу и начислить банк</button>
        </div>
      </div>
    </template>
    <div v-else class="next-hand-row">
      <p class="muted">{{ !tournament.initialDealerId && !tournament.hands.some((item) => item.roles) ? 'Выберите первого дилера в составе игры.' : tournament.hands.length ? 'Предыдущая раздача сохранена. Начните следующую, чтобы продолжить учёт.' : 'Турнир начат. Запустите первую раздачу.' }}</p>
      <button class="button button-dark" type="button" :disabled="tournament.status === 'finished' || (!tournament.initialDealerId && !tournament.hands.some((item) => item.roles)) || participants.filter(({ id }) => tournament.places[id] == null && (tournament.stacks[id] ?? 0) > 0).length < 2 || participants.some(({ id }) => tournament.places[id] == null && (tournament.stacks[id] ?? 0) === 0)" @click="openNextHand">＋ Начать раздачу</button>
    </div>

    <p v-if="message" class="participant-message" role="status">{{ message }}</p>
    <details v-if="handHistory.length" class="hand-history">
      <summary>История раздач · {{ handHistory.length }}</summary>
      <ol>
        <li v-for="item in handHistory" :key="item.number"><strong>№ {{ item.number }}</strong><span>{{ item.street }} · {{ chipFormat.format(item.pot) }} фишек</span><span>Забрали: {{ item.winners.join(', ') || 'банк не разыгран' }}</span></li>
      </ol>
    </details>
  </section>

  <section class="panel chip-balance-panel">
    <div class="panel-heading">
      <div><div class="eyebrow">АВТОМАТИЧЕСКИЙ РАСЧЁТ</div><h2>Стеки и баланс</h2></div>
      <span class="count-pill">Банк {{ cashFormat.format(displayedPrizePool) }} ₽</span>
    </div>
    <div class="hand-table-wrap">
      <table class="balance-table">
        <thead><tr><th>Игрок</th><th>Входы</th><th>Внесено</th><th>Фишки</th><th>К выплате</th><th>Баланс</th><th>Действие</th></tr></thead>
        <tbody>
          <tr v-for="player in participants" :key="player.id">
            <th scope="row">{{ player.name }}<small v-if="tournament.places[player.id] != null">Место {{ tournament.places[player.id] }}</small></th>
            <td>{{ 1 + (tournament.rebuys[player.id] ?? 0) }}</td>
            <td>{{ cashFormat.format(playerInvestment(tournament, player.id)) }} ₽</td>
            <td>{{ chipFormat.format(currentStack(player.id)) }}</td>
            <td>{{ cashFormat.format(estimatedCashout(player.id)) }} ₽</td>
            <td :class="estimatedNetBalance(player.id) >= 0 ? 'balance-positive' : 'balance-negative'">{{ estimatedNetBalance(player.id) > 0 ? '+' : '' }}{{ cashFormat.format(estimatedNetBalance(player.id)) }} ₽</td>
            <td class="player-game-action">
              <template v-if="tournament.gameInitialized && tournament.places[player.id] == null && (tournament.stacks[player.id] ?? 0) === 0">
                <span v-if="hand" class="muted">Ждём конца раздачи</span>
                <template v-else>
                  <button v-if="canPlayerRebuy(tournament, player.id)" class="text-button" type="button" @click="onRebuy(player.id)">＋ Докупка</button>
                  <button class="text-button danger-text" type="button" @click="onElimination(player.id)">Подтвердить вылет</button>
                </template>
              </template>
              <span v-else-if="tournament.places[player.id] != null" class="muted">Выбыл</span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
        <tfoot><tr><th>Итого</th><td>—</td><td>{{ cashFormat.format(totalCashIn) }} ₽</td><td colspan="4"></td></tr></tfoot>
      </table>
    </div>
    <p class="fine-print">Все игроки начинают с одинаковым взносом и стеком. Выплата считается пропорционально фишкам в стеке; незавершённый банк ещё не распределён. Вылет подтверждается после раздачи, место присваивается автоматически.</p>
  </section>
</template>

<style scoped>
.hand-tracking-panel .hand-street-tabs button {
  min-height: 48px;
  padding: 11px 18px;
  font-size: 15px;
}

.hand-tracking-panel .street-switch-button {
  min-height: 52px;
  padding: 12px 18px;
  font-size: 15px;
}

.hand-tracking-panel .hand-table th,
.hand-tracking-panel .hand-table td {
  padding: 13px 12px;
}

.hand-tracking-panel .hand-table thead th {
  font-size: 12px;
}

.hand-tracking-panel .hand-action-cell {
  min-width: 100px;
  gap: 5px;
}

.hand-tracking-panel .hand-bet-input {
  width: 92px;
  height: 48px;
  padding-inline: 9px;
  font-size: 18px;
}

.hand-tracking-panel .hand-table input[type='checkbox'] {
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.hand-tracking-panel .check-action {
  min-width: 72px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #d8c894;
  border-radius: 6px;
  background: #f6f1df;
  color: #5d4a20;
  font-size: 13px;
  font-weight: 700;
}

.hand-tracking-panel .check-action:hover {
  background: #eee2b7;
}

.hand-tracking-panel .all-in-action {
  min-height: 36px;
  padding: 6px 12px;
  font-size: 12px;
}

.hand-tracking-panel .hand-action-buttons .button,
.hand-tracking-panel .next-hand-row .button {
  min-height: 52px;
  padding: 12px 18px;
  font-size: 14px;
}

.hand-tracking-panel .hand-action-buttons {
  gap: 10px;
}

.hand-tracking-panel .hand-history summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  font-size: 14px;
}

@media (max-width: 760px) {
  .hand-tracking-panel .hand-street-tabs button {
    min-height: 46px;
    padding-inline: 14px;
  }

  .hand-tracking-panel .street-switch-button {
    min-height: 50px;
  }

  .hand-tracking-panel .hand-action-buttons .button,
  .hand-tracking-panel .next-hand-row .button {
    min-height: 52px;
  }
}
</style>
