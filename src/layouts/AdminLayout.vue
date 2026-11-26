<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink class="brand" to="/"><KitIcon name="rocket" :size="22" /><span>Galaxy Poker</span></RouterLink>
      <div class="sidebar-label">Управление</div>
      <RouterLink class="sidebar-link" exact-active-class="sidebar-link-exact-active" :class="{ 'sidebar-link-exact-active': route.path === '/admin' || route.path.startsWith('/admin/tournaments/') }" to="/admin"><KitIcon name="games" />Турниры</RouterLink>
      <RouterLink class="sidebar-link" exact-active-class="sidebar-link-exact-active" to="/admin/participants"><KitIcon name="people" />Участники</RouterLink>
      <RouterLink class="sidebar-link" exact-active-class="sidebar-link-exact-active" to="/"><KitIcon name="home" />Открыть главную</RouterLink>
      <div class="sidebar-note">Сезон 1<br>Управление играми и результатами</div>
    </aside>
    <main class="admin-main">
      <GoogleSyncPanel />
      <section v-if="!canManage" class="read-only-state" :aria-live="checkingAccess ? 'polite' : 'off'">
        <div class="eyebrow">{{ checkingAccess ? 'ПРОВЕРКА ДОСТУПА' : 'ТОЛЬКО ПРОСМОТР' }}</div>
        <h1>{{ checkingAccess ? 'Проверяем доступ к записи' : 'Настройки скрыты' }}</h1>
        <p v-if="checkingAccess">Подождите, пока Google Таблица подтвердит запись. Настройки откроются только после успешного ответа.</p>
        <p v-else>Для изменения турниров подключите ключ записи из Apps Script. До этого доступны только публичные страницы с расписанием, рейтингом и результатами.</p>
      </section>
      <RouterView v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GoogleSyncPanel from '@/components/GoogleSyncPanel.vue'
import KitIcon from '@/components/KitIcon.vue'
import { googleAdminConnected, googleSyncStatus } from '@/stores/poker'

const canManage = computed(() => googleSyncStatus.value === 'local' || googleAdminConnected.value)
const checkingAccess = computed(() => !googleAdminConnected.value && ['connecting', 'saving'].includes(googleSyncStatus.value))
const route = useRoute()
</script>

<style scoped>
.read-only-state{padding:28px;background:var(--surface-default);border:1px solid var(--line);border-radius:12px}
.read-only-state h1{margin:7px 0;color:var(--text-primary);font:700 26px/1.2 Roboto,Arial,sans-serif}
.read-only-state p{max-width:620px;margin:0;color:var(--muted);font-size:13px;line-height:1.6}
</style>
