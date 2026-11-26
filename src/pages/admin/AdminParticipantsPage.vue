<script setup lang="ts">
import { ref } from 'vue'
import { addPlayer, playerHasHistory, removePlayerFromSeason, state } from '@/stores/poker'
import KitIcon from '@/components/KitIcon.vue'

const newPlayerName = ref('')
const message = ref('')

function addParticipant() {
  const name = newPlayerName.value.trim()
  if (!name) {
    message.value = 'Введите имя участника.'
    return
  }

  if (state.players.some((player) => player.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    message.value = 'Участник с таким именем уже есть в списке.'
    return
  }

  addPlayer(name)
  newPlayerName.value = ''
  message.value = `${name} добавлен в список сезона.`
}

function renameParticipant(playerId: string, event: Event) {
  const input = event.target as HTMLInputElement
  const player = state.players.find((item) => item.id === playerId)
  if (!player) return

  const name = input.value.trim()
  if (!name) {
    input.value = player.name
    message.value = 'Имя участника не может быть пустым.'
    return
  }

  const duplicate = state.players.some((item) => item.id !== playerId && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
  if (duplicate) {
    input.value = player.name
    message.value = 'Участник с таким именем уже есть в списке.'
    return
  }

  player.name = name
  message.value = ''
}

function deleteParticipant(playerId: string) {
  const player = state.players.find((item) => item.id === playerId)
  if (!player) return

  if (playerHasHistory(playerId)) {
    message.value = 'Нельзя удалить участника начатой игры: его ставки и результаты должны сохраниться.'
    return
  }
  const confirmed = window.confirm(`Удалить ${player.name} из списка сезона и составов предстоящих турниров?`)
  if (!confirmed) return

  message.value = removePlayerFromSeason(playerId) ? `${player.name} удалён из списка сезона.` : 'Участник уже задействован в начатой игре. Удаление отменено.'
}
</script>

<template>
  <div class="admin-page-head">
    <div>
      <div class="eyebrow"><RouterLink to="/admin">ТУРНИРЫ</RouterLink> / УЧАСТНИКИ</div>
      <h1>Участники сезона</h1>
      <p class="muted">Добавляйте и редактируйте список, из которого собираются составы турниров.</p>
    </div>
    <RouterLink class="button button-outline" to="/admin">К турнирам</RouterLink>
  </div>

  <section class="panel participant-settings-panel">
    <div class="panel-heading">
      <div><div class="eyebrow">ОБЩИЙ СПИСОК</div><h2>Список участников</h2></div>
      <span class="count-pill">{{ state.players.length }}</span>
    </div>

    <form class="add-participant-form" @submit.prevent="addParticipant">
      <label class="field" for="new-participant-name">Добавить участника</label>
      <div class="add-participant-controls">
        <input id="new-participant-name" v-model="newPlayerName" maxlength="40" placeholder="Имя участника">
        <button class="button button-dark" type="submit">Добавить</button>
      </div>
    </form>

    <p v-if="message" class="participant-message" role="status">{{ message }}</p>

    <div v-if="state.players.length" class="season-participant-list">
      <div v-for="player in state.players" :key="player.id" class="season-participant-row">
        <label class="field participant-edit-field">
          <span class="sr-only">Имя участника</span>
          <input :value="player.name" :aria-label="`Имя участника ${player.name}`" maxlength="40" @change="renameParticipant(player.id, $event)">
        </label>
        <button class="remove-player-button" type="button" :disabled="playerHasHistory(player.id)" :title="playerHasHistory(player.id) ? 'Участник начатой или завершённой игры: удаление недоступно' : ''" @click="deleteParticipant(player.id)">Удалить</button>
      </div>
    </div>
    <div v-else class="empty-state participant-empty-state">
      <strong>Список пока пуст</strong>
      <span>Добавьте участников, чтобы выбирать их в турнирах.</span>
    </div>

    <p class="fine-print">Удалять можно только участников, которые ещё не играли. Составы начатых игр и история защищены. Чтобы исключить игрока из предстоящей игры, снимите отметку в составе этого турнира.</p>
  </section>
</template>
