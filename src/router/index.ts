import { createRouter, createWebHashHistory } from "vue-router";

import AdminLayout from "@/layouts/AdminLayout.vue";
import PublicLayout from "@/layouts/PublicLayout.vue";
import AdminPage from "@/pages/admin/AdminPage.vue";
import AdminParticipantsPage from "@/pages/admin/AdminParticipantsPage.vue";
import AdminTournamentPage from "@/pages/admin/AdminTournamentPage.vue";
import HomePage from "@/pages/HomePage.vue";
import TournamentScreenPage from "@/pages/TournamentScreenPage.vue";

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      component: PublicLayout,
      children: [{ path: "", component: HomePage }],
    },
    {
      path: "/admin",
      component: AdminLayout,
      children: [
        { path: "", component: AdminPage },
        { path: "participants", component: AdminParticipantsPage },
        { path: "tournaments/:id", component: AdminTournamentPage },
      ],
    },
    { path: "/screen/:id", component: TournamentScreenPage },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior(to) {
    return to.hash ? { el: to.hash, behavior: "smooth" } : { top: 0 };
  },
});
