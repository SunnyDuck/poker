<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink class="brand" to="/">♠ <span>Friendly Poker</span></RouterLink>
      <div class="sidebar-label">Управление</div>
      <RouterLink class="sidebar-link" to="/admin">Турниры</RouterLink>
      <RouterLink class="sidebar-link" to="/">Открыть главную</RouterLink>
      <div class="sidebar-note">Сезон 1<br>Управление играми и результатами</div>
    </aside>
    <main class="admin-main">
      <GoogleSyncPanel />
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import GoogleSyncPanel from '@/components/GoogleSyncPanel.vue'
</script>
