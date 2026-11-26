<script setup lang="ts">
import add from "@/assets/galaxy-icons/add.svg";
import games from "@/assets/galaxy-icons/games.svg";
import home from "@/assets/galaxy-icons/home.svg";
import people from "@/assets/galaxy-icons/people.svg";
import rocket from "@/assets/galaxy-icons/rocket.svg";
import undo from "@/assets/galaxy-icons/undo.svg";

const props = withDefaults(
  defineProps<{
    name: "add" | "games" | "home" | "people" | "rocket" | "undo";
    size?: number;
  }>(),
  { size: 18 },
);

const icons = { add, games, home, people, rocket, undo };
</script>

<template>
  <img
    class="kit-icon"
    :src="icons[props.name]"
    alt=""
    aria-hidden="true"
    :width="props.size"
    :height="props.size"
  />
</template>

<style scoped>
.kit-icon {
  display: inline-block;
  flex: 0 0 auto;
  object-fit: contain;
  vertical-align: middle;
}
</style>
