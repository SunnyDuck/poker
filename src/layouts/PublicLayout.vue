<script setup lang="ts">
import KitIcon from '@/components/KitIcon.vue'

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="site-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/"><KitIcon name="rocket" :size="22" /><span>Galaxy Poker</span></RouterLink>
      <nav class="topnav" aria-label="Навигация по странице">
        <button @click="scrollTo('schedule')">Расписание</button>
        <button @click="scrollTo('rating')">Рейтинг</button>
        <button @click="scrollTo('statistics')">Статистика</button>
        <button @click="scrollTo('results')">Результаты</button>
      </nav>
      <RouterLink class="button button-quiet" to="/admin">Админка</RouterLink>
    </header>
    <RouterView />
    <footer class="footer"><span>Galaxy Poker · Сезон 1</span><span>Демо-версия</span></footer>
  </div>
</template>
