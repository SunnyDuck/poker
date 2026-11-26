<script setup lang="ts">
import { computed, ref } from "vue";

import {
  getGoogleAdminKey,
  isGoogleAdminKeyRemembered,
  isGoogleSheetsConfigured,
  setGoogleAdminKeyRemembered,
} from "@/services/googleSheets";
import { usePokerStore } from "@/stores/poker";
const pokerStore = usePokerStore();

const adminKey = ref(getGoogleAdminKey());
const rememberAccess = ref(isGoogleAdminKeyRemembered());

const configured = isGoogleSheetsConfigured();

const busy = ref(false);
const error = ref("");

const statusLabel = computed(
  () =>
    ({
      local: "Локальный режим",
      connecting: "Подключаем…",
      "read-only": "Google · просмотр",
      connected: "Google · запись включена",
      saving: "Сохраняем…",
      error: "Ошибка синхронизации",
      conflict: "Нужна проверка данных",
    })[pokerStore.googleSyncStatus],
);

const connect = async () => {
  busy.value = true;
  error.value = "";
  try {
    await pokerStore.connectGoogleAdmin(adminKey.value, rememberAccess.value);
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "Не удалось подключить Google Таблицу.";
  } finally {
    busy.value = false;
  }
};

const chooseTableVersion = async () => {
  if (
    !window.confirm(
      "Загрузить данные из таблицы? Несохранённые изменения в этом браузере будут заменены.",
    )
  )
    return;
  busy.value = true;
  error.value = "";
  try {
    await pokerStore.useGoogleTableVersion();
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "Не удалось загрузить данные таблицы.";
  } finally {
    busy.value = false;
  }
};

const chooseBrowserVersion = async () => {
  if (
    !window.confirm(
      "Записать данные из этого браузера в таблицу? Текущие данные таблицы будут заменены.",
    )
  )
    return;
  busy.value = true;
  error.value = "";
  try {
    await pokerStore.useBrowserVersion(adminKey.value, rememberAccess.value);
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "Не удалось сохранить данные браузера.";
  } finally {
    busy.value = false;
  }
};

const disconnect = () => {
  pokerStore.disconnectGoogleAdmin();
  adminKey.value = "";
  rememberAccess.value = false;
};

const updateRememberAccess = () => {
  setGoogleAdminKeyRemembered(rememberAccess.value);
};
</script>

<template>
  <section
    class="google-sync-panel"
    :class="`google-sync-panel--${pokerStore.googleSyncStatus}`"
  >
    <div class="google-sync-panel__heading">
      <div>
        <strong>Общие данные</strong>
        <span
          class="google-sync-panel__status-label"
          role="status"
          aria-live="polite"
          >{{ statusLabel }}</span
        >
      </div>
      <span class="google-sync-panel__dot" aria-hidden="true"></span>
    </div>

    <template v-if="configured">
      <p class="google-sync-panel__description">
        {{ pokerStore.googleSyncMessage }}
      </p>
      <form
        v-if="!pokerStore.googleAdminConnected"
        class="google-sync-panel__key-form"
        :data-enter-submit="
          pokerStore.googleSyncStatus !== 'conflict' ? '' : null
        "
        @submit.prevent="connect"
      >
        <label class="field"
          >Ключ записи из Apps Script
          <input
            v-model="adminKey"
            type="password"
            autocomplete="current-password"
            placeholder="Вставьте ключ администратора"
          />
        </label>
        <div class="google-sync-panel__key-options">
          <label class="google-sync-panel__remember-access"
            ><input v-model="rememberAccess" type="checkbox" /> Запомнить доступ
            на этом компьютере</label
          >
          <button
            v-if="pokerStore.googleSyncStatus !== 'conflict'"
            class="button button--dark"
            :disabled="busy || !adminKey.trim()"
            type="submit"
          >
            {{ busy ? "Проверяю…" : "Включить запись" }}
          </button>
        </div>
      </form>
      <div
        v-if="pokerStore.googleSyncStatus === 'conflict'"
        class="google-sync-panel__key-options google-sync-panel__key-options--conflict"
      >
        <button
          class="button button--outline"
          type="button"
          :disabled="busy"
          @click="chooseTableVersion"
        >
          Загрузить данные из таблицы
        </button>
        <button
          class="button button--outline"
          type="button"
          :disabled="busy || !adminKey.trim()"
          @click="chooseBrowserVersion"
        >
          Сохранить данные браузера в таблицу
        </button>
      </div>
      <div
        v-if="
          pokerStore.googleAdminConnected &&
          pokerStore.googleSyncStatus !== 'conflict'
        "
        class="google-sync-panel__key-actions"
      >
        <label class="field"
          >Ключ администратора
          <input
            v-model="adminKey"
            type="password"
            autocomplete="current-password"
            readonly
          />
        </label>
        <label class="google-sync-panel__remember-access"
          ><input
            v-model="rememberAccess"
            type="checkbox"
            @change="updateRememberAccess"
          />
          Запомнить доступ на этом компьютере</label
        >
        <button class="text-button" type="button" @click="disconnect">
          Отключить запись
        </button>
      </div>
      <p class="google-sync-panel__security-note">
        При включении ключ сохранится в браузере этого компьютера. Google
        проверяет его при каждой записи.
      </p>
      <p v-if="error" class="google-sync-panel__error" role="alert">
        {{ error }}
      </p>
    </template>
    <p v-else class="google-sync-panel__description">
      Адрес Apps Script не задан. Пока приложение хранит данные в этом браузере.
    </p>
  </section>
</template>

<style scoped>
.google-sync-panel {
  background: var(--surface-default);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 24px;
}
.google-sync-panel__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.google-sync-panel__heading > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.google-sync-panel__heading strong {
  font-size: 13px;
  color: var(--green);
}
.google-sync-panel__status-label {
  font-size: 11px;
  color: var(--muted);
}
.google-sync-panel__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a3aaa5;
  flex: none;
}
.google-sync-panel--connected .google-sync-panel__dot {
  background: var(--green-500);
}
.google-sync-panel--saving .google-sync-panel__dot,
.google-sync-panel--connecting .google-sync-panel__dot {
  background: var(--yellow-500);
}
.google-sync-panel--error .google-sync-panel__dot,
.google-sync-panel--conflict .google-sync-panel__dot {
  background: var(--salmon-500);
}
.google-sync-panel__description {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
}
.google-sync-panel__key-form {
  display: flex;
  align-items: end;
  gap: 12px;
  margin-top: 10px;
}
.google-sync-panel__key-form .field,
.google-sync-panel__key-actions .field {
  flex: 1;
  margin: 0;
}
.google-sync-panel__key-form .field input,
.google-sync-panel__key-actions .field input {
  height: 34px;
  font-size: 12px;
}
.google-sync-panel__key-form .button {
  min-height: 34px;
  white-space: nowrap;
}
.google-sync-panel__key-options {
  display: flex;
  align-items: center;
  gap: 12px;
}
.google-sync-panel__remember-access {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.google-sync-panel__remember-access input {
  margin: 0;
}
.google-sync-panel__key-actions {
  display: flex;
  align-items: end;
  gap: 12px;
  margin-top: 10px;
}
.google-sync-panel__key-actions .text-button {
  font-size: 11px;
  white-space: nowrap;
}
.google-sync-panel__security-note {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--muted);
}
.google-sync-panel__error {
  margin: 8px 0 0;
  color: var(--salmon-500);
  font-size: 11px;
}
.google-sync-panel__key-options--conflict {
  margin-top: 12px;
  flex-wrap: wrap;
}
@media (max-width: 600px) {
  .google-sync-panel__key-form,
  .google-sync-panel__key-actions,
  .google-sync-panel__key-options {
    align-items: stretch;
    flex-direction: column;
  }
  .google-sync-panel__key-form .button {
    align-self: flex-start;
  }
  .google-sync-panel__remember-access {
    white-space: normal;
  }
}
</style>
