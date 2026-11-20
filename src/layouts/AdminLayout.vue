<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink class="brand" to="/">♠ <span>Friendly Poker</span></RouterLink>
      <div class="sidebar-label">Управление</div>
      <RouterLink class="sidebar-link" to="/admin">Турниры</RouterLink>
      <RouterLink class="sidebar-link" to="/">Открыть главную</RouterLink>
      <div class="sidebar-note">Демо-режим<br>Данные этого браузера</div>
    </aside>
    <main class="admin-main"><RouterView /></main>
  </div>
</template>
