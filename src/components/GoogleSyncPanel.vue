<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  connectGoogleAdmin,
  disconnectGoogleAdmin,
  googleAdminConnected,
  googleSyncMessage,
  googleSyncStatus,
  useBrowserVersion,
  useGoogleTableVersion,
} from '@/stores/poker'
import {
  getGoogleAdminKey,
  isGoogleAdminKeyRemembered,
  isGoogleSheetsConfigured,
  setGoogleAdminKeyRemembered,
} from '@/services/googleSheets'

const adminKey = ref(getGoogleAdminKey())
const rememberAccess = ref(isGoogleAdminKeyRemembered())
const configured = isGoogleSheetsConfigured()
const busy = ref(false)
const error = ref('')

const statusLabel = computed(() => ({
  local: 'Локальный режим',
  connecting: 'Подключаем…',
  'read-only': 'Google · просмотр',
  connected: 'Google · запись включена',
  saving: 'Сохраняем…',
  error: 'Ошибка синхронизации',
  conflict: 'Нужна проверка данных',
}[googleSyncStatus.value]))

async function connect() {
  busy.value = true
  error.value = ''
  try {
    await connectGoogleAdmin(adminKey.value, rememberAccess.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось подключить Google Таблицу.'
  } finally {
    busy.value = false
  }
}

async function chooseTableVersion() {
  if (!window.confirm('Загрузить данные из таблицы? Несохранённые изменения в этом браузере будут заменены.')) return
  busy.value = true
  error.value = ''
  try {
    await useGoogleTableVersion()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить данные таблицы.'
  } finally {
    busy.value = false
  }
}

async function chooseBrowserVersion() {
  if (!window.confirm('Записать данные из этого браузера в таблицу? Текущие данные таблицы будут заменены.')) return
  busy.value = true
  error.value = ''
  try {
    await useBrowserVersion(adminKey.value, rememberAccess.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить данные браузера.'
  } finally {
    busy.value = false
  }
}

function disconnect() {
  disconnectGoogleAdmin()
  adminKey.value = ''
  rememberAccess.value = false
}

function updateRememberAccess() {
  setGoogleAdminKeyRemembered(rememberAccess.value)
}
</script>

<template>
  <section class="google-sync-panel" :class="`sync-${googleSyncStatus}`">
    <div class="sync-panel-heading">
      <div>
        <strong>Общие данные</strong>
        <span class="sync-status-label">{{ statusLabel }}</span>
      </div>
      <span class="sync-dot" aria-hidden="true"></span>
    </div>

    <template v-if="configured">
      <p class="sync-description">{{ googleSyncMessage }}</p>
      <form v-if="!googleAdminConnected" class="sync-key-form" @submit.prevent="connect">
        <label class="field">Ключ записи из Apps Script
          <input v-model="adminKey" type="password" autocomplete="current-password" placeholder="Вставьте ключ администратора">
        </label>
        <div class="sync-key-options">
          <label class="remember-access"><input v-model="rememberAccess" type="checkbox"> Запомнить доступ на этом компьютере</label>
          <button v-if="googleSyncStatus !== 'conflict'" class="button button-dark" :disabled="busy || !adminKey.trim()" type="submit">
            {{ busy ? 'Проверяю…' : 'Включить запись' }}
          </button>
        </div>
      </form>
      <div v-if="googleSyncStatus === 'conflict'" class="sync-key-options conflict-actions">
        <button class="button button-outline" type="button" :disabled="busy" @click="chooseTableVersion">Загрузить данные из таблицы</button>
        <button class="button button-outline" type="button" :disabled="busy || !adminKey.trim()" @click="chooseBrowserVersion">Сохранить данные браузера в таблицу</button>
      </div>
      <div v-if="googleAdminConnected && googleSyncStatus !== 'conflict'" class="sync-key-actions">
        <label class="field">Ключ администратора
          <input v-model="adminKey" type="password" autocomplete="current-password" readonly>
        </label>
        <label class="remember-access"><input v-model="rememberAccess" type="checkbox" @change="updateRememberAccess"> Запомнить доступ на этом компьютере</label>
        <button class="text-button" type="button" @click="disconnect">Отключить запись</button>
      </div>
      <p class="sync-security-note">При включении ключ сохранится в браузере этого компьютера. Google проверяет его при каждой записи.</p>
      <p v-if="error" class="sync-error" role="alert">{{ error }}</p>
    </template>
    <p v-else class="sync-description">Адрес Apps Script не задан. Пока приложение хранит данные в этом браузере.</p>
  </section>
</template>

<style scoped>
.google-sync-panel{background:var(--surface-default);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:24px}
.sync-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sync-panel-heading>div{display:flex;align-items:center;gap:10px}
.sync-panel-heading strong{font-size:13px;color:var(--green)}
.sync-status-label{font-size:11px;color:var(--muted)}
.sync-dot{width:8px;height:8px;border-radius:50%;background:#a3aaa5;flex:none}
.sync-connected .sync-dot{background:var(--green-500)}.sync-saving .sync-dot,.sync-connecting .sync-dot{background:var(--yellow-500)}.sync-error .sync-dot,.sync-conflict .sync-dot{background:var(--salmon-500)}
.sync-description{margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}
.sync-key-form{display:flex;align-items:end;gap:12px;margin-top:10px}
.sync-key-form .field,.sync-key-actions .field{flex:1;margin:0}
.sync-key-form .field input,.sync-key-actions .field input{height:34px;font-size:12px}
.sync-key-form .button{min-height:34px;white-space:nowrap}
.sync-key-options{display:flex;align-items:center;gap:12px}
.remember-access{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);white-space:nowrap}
.remember-access input{margin:0}
.sync-key-actions{display:flex;align-items:end;gap:12px;margin-top:10px}
.sync-key-actions .text-button{font-size:11px;white-space:nowrap}
.sync-security-note{margin:8px 0 0;font-size:10px;line-height:1.4;color:var(--muted)}
.sync-error{margin:8px 0 0;color:var(--salmon-500);font-size:11px}
.conflict-actions{margin-top:12px;flex-wrap:wrap}
@media(max-width:600px){.sync-key-form,.sync-key-actions,.sync-key-options{align-items:stretch;flex-direction:column}.sync-key-form .button{align-self:flex-start}.remember-access{white-space:normal}}
</style>
