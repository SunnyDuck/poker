import { defineStore } from "pinia";

import { createPokerActions } from "@/stores/pokerActions";
import { createPokerSyncController } from "@/stores/pokerSync";

export type { InitialRole } from "@/stores/pokerActions";
export type { GoogleSyncStatus } from "@/stores/pokerSync";

export const usePokerStore = defineStore("poker", () => {
  const sync = createPokerSyncController();
  const actions = createPokerActions(sync.state);

  return {
    ...sync,
    ...actions,
  };
});
