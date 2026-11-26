<script setup lang="ts">
import { useRouter } from "vue-router";

import { formatTournamentDate } from "@/domain/time";
import { usePokerStore } from "@/stores/poker";
const pokerStore = usePokerStore();

const router = useRouter();

const addTournament = () => {
  const tournament = pokerStore.createTournament();
  router.push(`/admin/tournaments/${tournament.id}`);
};
const statusLabel = (status: string) => {
  return status === "live"
    ? "Идёт сейчас"
    : status === "finished"
      ? "Завершён"
      : "Предстоит";
};
const dateLabel = (date: string) => {
  return formatTournamentDate(date, false, true);
};
</script>

<template>
  <div class="admin__page-head">
    <div>
      <div class="eyebrow">СЕЗОН 1</div>
      <h1>Управление турнирами</h1>
      <p class="muted">
        {{
          pokerStore.googleSyncStatus === "local"
            ? "Изменения сохраняются в этом браузере."
            : "Изменения синхронизируются с Google Таблицей."
        }}
      </p>
    </div>
    <div class="admin__header-actions">
      <RouterLink class="button button--outline" to="/admin/participants"
        >Участники сезона</RouterLink
      >
      <button class="button button--dark" @click="addTournament">
        Новый турнир
      </button>
    </div>
  </div>
  <div v-if="pokerStore.googleSyncStatus === 'local'" class="notice">
    <strong>Локальный режим.</strong> Пока адрес Google Таблицы не настроен,
    изменения видны только в этом браузере.
  </div>
  <div class="admin__tournament-list">
    <article
      v-for="tournament in pokerStore.state.tournaments"
      :key="tournament.id"
      class="admin__tournament-card"
    >
      <div class="tournament-card-top">
        <span class="status" :class="`status--${tournament.status}`">{{
          statusLabel(tournament.status)
        }}</span><span class="muted">{{ dateLabel(tournament.date) }}</span>
      </div>
      <h2>{{ tournament.title }}</h2>
      <p>
        {{ tournament.participantIds.length }} участников · Вход
        {{ tournament.buyIn }} ₽ · Стек {{ tournament.startingStack }}
      </p>
      <div class="card-actions">
        <RouterLink
          class="button button--dark"
          :to="`/admin/tournaments/${tournament.id}`"
          >Настроить игру</RouterLink
        ><RouterLink
          class="button button--outline"
          :to="`/screen/${tournament.id}`"
          >Открыть табло</RouterLink
        >
      </div>
    </article>
  </div>
  <div class="admin__bottom">
    <span class="muted">Сброс возвращает исходные демонстрационные данные.</span
    ><button class="text-button danger-text" @click="pokerStore.resetDemo">
      Сбросить демо
    </button>
  </div>
</template>
