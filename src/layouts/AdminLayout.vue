<template>
  <div class="admin">
    <a class="admin__skip-link" href="#admin-main">Перейти к содержимому</a>
    <aside class="admin__sidebar">
      <RouterLink class="admin__brand" to="/"
        ><KitIcon name="rocket" :size="22" /><span
          >Galaxy Poker</span
        ></RouterLink
      >
      <div class="admin__sidebar-label">Управление</div>
      <RouterLink
        class="admin__sidebar-link"
        exact-active-class="admin__sidebar-link--active"
        :class="{
          'admin__sidebar-link--active':
            route.path === '/admin' ||
            route.path.startsWith('/admin/tournaments/'),
        }"
        to="/admin"
        ><KitIcon name="games" />Турниры</RouterLink
      >
      <RouterLink
        class="admin__sidebar-link"
        exact-active-class="admin__sidebar-link--active"
        to="/admin/participants"
        ><KitIcon name="people" />Участники</RouterLink
      >
      <RouterLink
        class="admin__sidebar-link"
        exact-active-class="admin__sidebar-link--active"
        to="/"
        ><KitIcon name="home" />Открыть главную</RouterLink
      >
      <div class="admin__sidebar-note">
        Сезон 1<br />Управление играми и результатами
      </div>
    </aside>
    <main
      id="admin-main"
      class="admin__main"
      tabindex="-1"
      aria-describedby="admin-keyboard-help"
      @keydown.capture="handleAdminKeydown"
    >
      <GoogleSyncPanel />
      <p id="admin-keyboard-help" class="admin__keyboard-help">
        Enter — следующее поле · Alt + стрелки — переход между полями
      </p>
      <section
        v-if="!canManage"
        class="admin__read-only-state"
        :aria-live="checkingAccess ? 'polite' : 'off'"
      >
        <div class="eyebrow">
          {{ checkingAccess ? "ПРОВЕРКА ДОСТУПА" : "ТОЛЬКО ПРОСМОТР" }}
        </div>
        <h1>
          {{
            checkingAccess ? "Проверяем доступ к записи" : "Настройки скрыты"
          }}
        </h1>
        <p v-if="checkingAccess">
          Подождите, пока Google Таблица подтвердит запись. Настройки откроются
          только после успешного ответа.
        </p>
        <p v-else>
          Для изменения турниров подключите ключ записи из Apps Script. До этого
          доступны только публичные страницы с расписанием, рейтингом и
          результатами.
        </p>
      </section>
      <RouterView v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useRoute } from "vue-router";

import GoogleSyncPanel from "@/components/GoogleSyncPanel.vue";
import KitIcon from "@/components/KitIcon.vue";
import { useAdminKeyboardNavigation } from "@/composables/useAdminKeyboardNavigation";
import { usePokerStore } from "@/stores/poker";
const pokerStore = usePokerStore();

const { handleAdminKeydown } = useAdminKeyboardNavigation();

const canManage = computed(
  () =>
    pokerStore.googleSyncStatus === "local" || pokerStore.googleAdminConnected,
);
const checkingAccess = computed(
  () =>
    !pokerStore.googleAdminConnected &&
    ["connecting", "saving"].includes(pokerStore.googleSyncStatus),
);

const route = useRoute();
</script>

<style scoped>
.admin__skip-link {
  position: absolute;
  z-index: 10;
  top: 8px;
  left: 8px;
  transform: translateY(-160%);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  background: var(--surface-default);
}

.admin__skip-link:focus {
  transform: translateY(0);
}

.admin__keyboard-help {
  margin: -12px 0 18px;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.admin__read-only-state {
  padding: 28px;
  background: var(--surface-default);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.admin__read-only-state h1 {
  margin: 7px 0;
  color: var(--text-primary);
  font:
    700 26px/1.2 Roboto,
    Arial,
    sans-serif;
}
.admin__read-only-state p {
  max-width: 620px;
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
</style>
