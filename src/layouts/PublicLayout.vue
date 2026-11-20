<script setup lang="ts">
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="site-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/">♠ <span>Friendly Poker</span></RouterLink>
      <nav class="topnav" aria-label="Навигация по странице">
        <button @click="scrollTo('schedule')">Расписание</button>
        <button @click="scrollTo('rating')">Рейтинг</button>
        <button @click="scrollTo('results')">Результаты</button>
      </nav>
      <RouterLink class="button button-quiet" to="/admin">Админка</RouterLink>
    </header>
    <RouterView />
    <footer class="footer"><span>Friendly Poker · Сезон 1</span><span>Демо-версия</span></footer>
  </div>
</template>
