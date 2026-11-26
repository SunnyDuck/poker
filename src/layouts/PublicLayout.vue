<script setup lang="ts">
import KitIcon from "@/components/KitIcon.vue";

const scrollTo = (id: string) => {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};
</script>

<template>
  <div class="site">
    <a class="site__skip-link" href="#main-content">Перейти к содержимому</a>
    <header class="site__topbar">
      <RouterLink class="site__brand" to="/"
        ><KitIcon name="rocket" :size="22" /><span
          >Galaxy Poker</span
        ></RouterLink
      >
      <nav class="site__nav" aria-label="Навигация по странице">
        <button @click="scrollTo('schedule')">Расписание</button>
        <button @click="scrollTo('rating')">Рейтинг</button>
        <button @click="scrollTo('statistics')">Статистика</button>
        <button @click="scrollTo('results')">Результаты</button>
      </nav>
      <RouterLink class="button button--quiet" to="/admin">Админка</RouterLink>
    </header>
    <RouterView />
    <footer class="site__footer">
      <span>Galaxy Poker · Сезон 1</span><span>Демо-версия</span>
    </footer>
  </div>
</template>

<style scoped>
.site__skip-link {
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

.site__skip-link:focus {
  transform: translateY(0);
}
</style>
