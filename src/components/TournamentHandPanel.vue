<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import KitIcon from "@/components/KitIcon.vue";
import {
  canAdvanceHandStreet,
  canPlayerCheck,
  canSettlePokerHand,
  handActionCount,
  handActionPot,
  handDistribution,
  handPot,
  handStreetPot,
  handStreets,
  isPlayerAllIn,
  isPlayerVisibleOnStreet,
  nextHandActionIndex,
  playerCashout,
  playerHandContribution,
  playerInvestment,
  playerNetBalance,
  playerStreetContribution,
  projectedStack,
  streetActionRequirements,
  tournamentChipsInPlay,
  tournamentPrizePool,
} from "@/domain/game";
import { calculateStandings, placePoints } from "@/domain/rating";
import { formatCountdown, formatKrasnoyarskDateTime } from "@/domain/time";
import type { HandStreet, PokerActionType, Tournament } from "@/domain/types";
import { usePokerStore } from "@/stores/poker";
const props = defineProps<{ tournament: Tournament }>();

const pokerStore = usePokerStore();

const message = ref("");

const hand = computed(() => pokerStore.getCurrentHand(props.tournament));
const distribution = computed(() =>
  hand.value ? handDistribution(hand.value) : null,
);

const playerWinsAllSelectableBanks = (playerId: string): boolean => {
  if ((distribution.value?.pots.length ?? 0) > 1) {
    const selectablePots = distribution.value?.pots.filter(
      (bank) =>
        bank.eligibleIds.length > 1 && bank.eligibleIds.includes(playerId),
    );
    return Boolean(
      selectablePots?.length &&
      selectablePots.every((bank) => bank.winnerIds.includes(playerId)),
    );
  }
  return hand.value?.players[playerId]?.takesPot ?? false;
};
const playerCanBeSelectedForBank = (playerId: string): boolean =>
  Boolean(
    distribution.value?.pots.some(
      (bank) =>
        bank.eligibleIds.length > 1 && bank.eligibleIds.includes(playerId),
    ),
  );

const banksAwaitingWinner = computed(
  () =>
    distribution.value?.pots.flatMap((bank, index) =>
      bank.winnerIds.length
        ? []
        : [index === 0 ? "Основной банк" : `Побочный банк ${index}`],
    ) ?? [],
);

const now = ref(Date.now());

let clockInterval: number | undefined;

onMounted(() => {
  clockInterval = window.setInterval(() => {
    now.value = Date.now();
  }, 500);
});
onUnmounted(() => {
  if (clockInterval != null) window.clearInterval(clockInterval);
});

const pot = computed(() => (hand.value ? handPot(hand.value) : 0));
const streetActionCount = computed(() => {
  const currentHand = hand.value;
  if (!currentHand) return 0;
  let count = handActionCount(currentHand, currentHand.street);
  for (const { playerId, amountOwed } of streetActionRequirements(
    props.tournament,
    currentHand,
    currentHand.street,
  )) {
    if (amountOwed === 0)
      count = Math.max(
        count,
        nextCheckActionIndex(playerId, currentHand.street) + 1,
      );
  }
  return count;
});
const streetActionIndexes = computed(() =>
  Array.from({ length: streetActionCount.value }, (_, index) => index),
);
const currentStreetLabel = computed(
  () =>
    handStreets.find((street) => street.id === hand.value?.street)?.label ?? "",
);

const cashFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const chipFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

const nextStreet = computed(() => {
  const currentIndex = handStreets.findIndex(
    (street) => street.id === hand.value?.street,
  );
  return handStreets[currentIndex + 1];
});
const currentStreetRequirements = computed(() =>
  hand.value
    ? streetActionRequirements(props.tournament, hand.value, hand.value.street)
    : [],
);
const canAdvanceStreet = computed(() =>
  hand.value
    ? canAdvanceHandStreet(props.tournament, hand.value, hand.value.street)
    : false,
);
const streetTransitionHint = computed(() => {
  if (!hand.value || canAdvanceStreet.value) return "";
  const requirements = currentStreetRequirements.value.map(
    ({ playerId, amountOwed }) => {
      const name =
        pokerStore.state.players.find((player) => player.id === playerId)
          ?.name ?? "Игрок";
      return amountOwed > 0
        ? `${name} — уравнять ещё ${chipFormat.format(amountOwed)} или сбросить карты`
        : `${name} — отметить чек или сбросить карты`;
    },
  );
  const nextStep = nextStreet.value
    ? `Переход на ${nextStreet.value.label} пока закрыт`
    : "Раздачу пока нельзя завершить";
  return `${nextStep}: ${requirements.join("; ")}. Олл-ин игроки больше не обязаны уравнивать ставки.`;
});
const participants = computed(() =>
  props.tournament.participantIds.map((id) => ({
    id,
    name:
      pokerStore.state.players.find((player) => player.id === id)?.name ??
      "Удалённый участник",
  })),
);
const handParticipants = computed(() => {
  const currentHand = hand.value;
  if (!currentHand) return [];
  return Object.entries(currentHand.players)
    .map(([id, player]) => ({
      id,
      player,
      name:
        pokerStore.state.players.find((person) => person.id === id)?.name ??
        "Удалённый участник",
    }))
    .filter(({ player }) =>
      isPlayerVisibleOnStreet(player, currentHand.street),
    );
});
const wagersWithinStacks = computed(() =>
  hand.value
    ? Object.entries(hand.value.players).every(
        ([id, player]) =>
          playerHandContribution(player) <= (props.tournament.stacks[id] ?? 0),
      )
    : false,
);
const canSettle = computed(() => {
  return Boolean(
    hand.value &&
    pokerStore.canCloseHand(props.tournament, hand.value) &&
    canSettlePokerHand(props.tournament, hand.value),
  );
});
const totalCashIn = computed(() =>
  participants.value.reduce(
    (sum, player) => sum + playerInvestment(props.tournament, player.id),
    0,
  ),
);
const displayedPrizePool = computed(() =>
  tournamentPrizePool(props.tournament),
);
const currentTournamentTable = computed(() => {
  const game = props.tournament;
  const lastAssignedPlace = game.participantIds.reduce((highest, id) => {
    const place = game.places[id];
    if (place == null) return highest;
    const handNumber = game.eliminatedInHand[id];
    const tiedPlayers = game.participantIds.filter(
      (otherId) =>
        game.places[otherId] === place &&
        game.eliminatedInHand[otherId] === handNumber,
    ).length;
    return Math.max(highest, place + tiedPlayers - 1);
  }, 0);
  const activePlayers = participants.value
    .filter(({ id }) => game.places[id] == null)
    .slice()
    .sort(
      (left, right) =>
        (game.stacks[right.id] ?? 0) - (game.stacks[left.id] ?? 0) ||
        game.participantIds.indexOf(left.id) -
          game.participantIds.indexOf(right.id),
    );
  const activePlaces = new Map(
    activePlayers.map(({ id }, index) => [id, lastAssignedPlace + index + 1]),
  );
  const seasonPoints = new Map(
    calculateStandings({
      ...pokerStore.state,
      tournaments: pokerStore.state.tournaments.filter(
        (tournament) => tournament.id !== game.id,
      ),
    }).map(({ player, points }) => [player.id, points]),
  );

  return participants.value
    .map((player) => {
      const place = game.places[player.id] ?? activePlaces.get(player.id) ?? 0;
      const tournamentPoints =
        placePoints(place) + Math.min(game.rebuys[player.id] ?? 0, 1);
      const stack = game.stacks[player.id] ?? 0;
      const payout = playerCashout(game, player.id, stack);

      return {
        ...player,
        place,
        stack,
        tournamentPoints,
        totalPoints: (seasonPoints.get(player.id) ?? 0) + tournamentPoints,
        payout,
        payoutShare: displayedPrizePool.value
          ? (payout / displayedPrizePool.value) * 100
          : 0,
      };
    })
    .sort((left, right) => left.place - right.place);
});
const currentDistributionTotals = computed(() =>
  currentTournamentTable.value.reduce(
    (totals, player) => ({
      payout: totals.payout + player.payout,
      payoutShare: totals.payoutShare + player.payoutShare,
    }),
    { payout: 0, payoutShare: 0 },
  ),
);
const handHistory = computed(() =>
  props.tournament.hands
    .filter((item) => item.settled)
    .slice()
    .reverse()
    .map((item) => ({
      number: item.number,
      pot: handPot(item),
      street: stageName(item.street),
      winners: Object.entries(item.players)
        .filter(([, player]) => player.takesPot && !player.folded)
        .map(
          ([id]) =>
            pokerStore.state.players.find((player) => player.id === id)?.name ??
            "Удалённый участник",
        ),
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      duration:
        item.startedAt != null && item.endedAt != null
          ? formatCountdown(Math.max(0, item.endedAt - item.startedAt) / 1000)
          : "—",
      events: item.events ?? [],
    })),
);

const actionLabels: Record<PokerActionType, string> = {
  check: "Чек",
  call: "Колл",
  bet: "Ставка",
  raise: "Рейз",
  "all-in": "Олл-ин",
  "small-blind": "МБ",
  "big-blind": "ББ",
};

const availableForAction = (
  playerId: string,
  street: HandStreet,
  actionIndex: number,
): number => {
  const player = hand.value?.players[playerId];
  if (!player) return 0;
  const currentAction = player.bets[street]?.[actionIndex] ?? 0;
  return Math.max(
    0,
    (props.tournament.stacks[playerId] ?? 0) -
      playerHandContribution(player) +
      currentAction,
  );
};

const nextCheckActionIndex = (playerId: string, street: HandStreet): number => {
  const currentHand = hand.value;
  const player = currentHand?.players[playerId];
  if (!currentHand || !player) return 0;

  for (let index = 0; index < player.bets[street].length; index += 1) {
    if (
      (player.bets[street][index] ?? 0) === 0 &&
      !player.actions[street][index] &&
      canPlayerCheck(currentHand, playerId, street, index)
    )
      return index;
  }
  return nextHandActionIndex(currentHand, street);
};

const commitBetChange = (
  playerId: string,
  street: HandStreet,
  actionIndex: number,
  input: HTMLInputElement,
): boolean => {
  const previous =
    hand.value?.players[playerId]?.bets[street]?.[actionIndex] ?? 0;
  const untouchedZero = input.value === "" && previous === 0;
  if (untouchedZero) {
    input.value = "0";
    message.value = "";
    return true;
  }
  const amount = input.value === "" ? 0 : Number(input.value);
  if (
    amount === 0 &&
    hand.value &&
    !canPlayerCheck(hand.value, playerId, street, actionIndex)
  ) {
    input.value = String(previous);
    message.value =
      "Чек недоступен: сначала нужно поддержать текущую ставку или сбросить карты.";
    return false;
  }
  if (
    !pokerStore.setHandBet(
      props.tournament,
      playerId,
      street,
      actionIndex,
      amount,
    )
  ) {
    input.value = String(previous);
    message.value = "Сумма ставок игрока не может превышать его стек.";
    return false;
  }
  if (amount === 0)
    pokerStore.setHandAction(
      props.tournament,
      playerId,
      street,
      actionIndex,
      "check",
    );
  message.value = "";
  return true;
};

const clearZeroOnFocus = (event: FocusEvent) => {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement && input.value === "0")
    input.value = "";
};

const restoreEmptyZeroOnBlur = (event: FocusEvent) => {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement && input.value === "")
    input.value = "0";
};

const onBetChange = (
  playerId: string,
  street: HandStreet,
  actionIndex: number,
  event: Event,
): boolean => {
  return commitBetChange(
    playerId,
    street,
    actionIndex,
    event.target as HTMLInputElement,
  );
};

const focusNextPlayerAction = async (
  playerId: string,
  actionIndex: number,
  event: KeyboardEvent,
): Promise<void> => {
  event.preventDefault();
  const input = event.currentTarget;
  const currentHand = hand.value;
  if (!(input instanceof HTMLInputElement) || !currentHand) return;

  const street = currentHand.street;
  if (!commitBetChange(playerId, street, actionIndex, input)) return;
  await nextTick();

  const currentPlayerIndex = handParticipants.value.findIndex(
    (entry) => entry.id === playerId,
  );
  if (currentPlayerIndex < 0) return;

  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "[data-hand-player-id][data-hand-action-index]",
    ),
  );

  const orderedPlayers = [
    ...handParticipants.value.slice(currentPlayerIndex + 1),
    ...handParticipants.value.slice(0, currentPlayerIndex),
  ];
  for (const entry of orderedPlayers) {
    const playerIndex = handParticipants.value.findIndex(
      (participant) => participant.id === entry.id,
    );
    const firstActionIndex = playerIndex < currentPlayerIndex ? 0 : actionIndex;
    for (
      let nextActionIndex = firstActionIndex;
      nextActionIndex < streetActionCount.value;
      nextActionIndex += 1
    ) {
      const candidate = inputs.find(
        (item) =>
          item.dataset.handPlayerId === entry.id &&
          Number(item.dataset.handActionIndex) === nextActionIndex,
      );
      if (
        !candidate ||
        candidate.disabled ||
        candidate.readOnly ||
        (entry.player.bets[street][nextActionIndex] ?? 0) > 0 ||
        entry.player.actions[street][nextActionIndex]
      ) {
        continue;
      }

      candidate.focus();
      return;
    }
  }
};

const onCheck = (playerId: string, street: HandStreet, actionIndex: number) => {
  const player = hand.value?.players[playerId];
  while (player && actionIndex >= player.bets[street].length) {
    if (!pokerStore.addHandBetActionColumn(props.tournament, street)) {
      message.value = "Не удалось добавить столбец для записи чека.";
      return;
    }
  }
  if (
    !pokerStore.setHandBet(
      props.tournament,
      playerId,
      street,
      actionIndex,
      0,
    ) ||
    !pokerStore.setHandAction(
      props.tournament,
      playerId,
      street,
      actionIndex,
      "check",
    )
  ) {
    message.value = "Не удалось записать чек для этой ячейки.";
    return;
  }
  message.value = "";
};

const onAllIn = (playerId: string) => {
  const currentHand = hand.value;
  const player = currentHand?.players[playerId];
  if (!currentHand || !player || player.folded) return;

  const street = currentHand.street;
  const existingAllInIndex = player.actions[street].findIndex(
    (action) => action === "all-in",
  );
  if (existingAllInIndex >= 0) {
    if (
      !pokerStore.setHandBet(
        props.tournament,
        playerId,
        street,
        existingAllInIndex,
        0,
      )
    ) {
      message.value = "Не удалось отменить олл-ин.";
      return;
    }
    message.value = `Олл-ин игрока ${participants.value.find((entry) => entry.id === playerId)?.name ?? "Игрок"} отменён.`;
    return;
  }
  if (isPlayerAllIn(props.tournament, currentHand, playerId)) {
    message.value =
      "Олл-ин выставлен на предыдущей улице. Перейдите на неё, чтобы отменить действие.";
    return;
  }

  const amount = projectedStack(props.tournament, currentHand, playerId);
  if (amount <= 0) return;

  const emptyActionIndex = player.bets[street].findIndex(
    (bet, index) => bet === 0 && !player.actions[street][index],
  );
  const actionIndex =
    emptyActionIndex < 0 ? player.bets[street].length : emptyActionIndex;
  while (actionIndex >= player.bets[street].length) {
    if (!pokerStore.addHandBetActionColumn(props.tournament, street)) {
      message.value = "Не удалось добавить столбец действия для олл-ина.";
      return;
    }
  }

  if (
    !pokerStore.setHandBet(
      props.tournament,
      playerId,
      street,
      actionIndex,
      amount,
    )
  ) {
    message.value = "Не удалось выставить оставшийся стек.";
    return;
  }
  pokerStore.setHandAction(
    props.tournament,
    playerId,
    street,
    actionIndex,
    "all-in",
  );
  message.value = `${participants.value.find((entry) => entry.id === playerId)?.name ?? "Игрок"} идёт олл-ин на ${chipFormat.format(amount)} фишек.`;
};

const goToNextStreet = () => {
  if (
    nextStreet.value &&
    !pokerStore.setHandStreet(props.tournament, nextStreet.value.id)
  ) {
    message.value =
      streetTransitionHint.value ||
      "Сначала завершите действия всех игроков на этой улице.";
    return;
  }
  message.value = "";
};

const requestHandStreet = (street: HandStreet) => {
  const currentHand = hand.value;
  if (!currentHand) return;
  const currentIndex = handStreets.findIndex(
    (item) => item.id === currentHand.street,
  );
  const targetIndex = handStreets.findIndex((item) => item.id === street);
  if (targetIndex > currentIndex) {
    for (const item of handStreets.slice(currentIndex, targetIndex)) {
      const requirements = streetActionRequirements(
        props.tournament,
        currentHand,
        item.id,
      );
      if (requirements.length) {
        const blockers = requirements.map(({ playerId, amountOwed }) => {
          const name =
            pokerStore.state.players.find((player) => player.id === playerId)
              ?.name ?? "Игрок";
          return amountOwed > 0
            ? `${name} — уравнять ещё ${chipFormat.format(amountOwed)} или сбросить карты`
            : `${name} — отметить чек или сбросить карты`;
        });
        message.value = `Переход на ${handStreets[targetIndex]?.label ?? "следующую улицу"} пока закрыт. Завершите ${item.label}: ${blockers.join("; ")}.`;
        return;
      }
    }
  }
  pokerStore.setHandStreet(props.tournament, street);
  message.value = "";
};

const addActionColumn = () => {
  if (
    !hand.value ||
    !pokerStore.addHandBetActionColumn(props.tournament, hand.value.street)
  ) {
    message.value = "Не удалось добавить столбец действия.";
    return;
  }
  message.value = "";
};

const closeHand = () => {
  if (!canSettle.value || !distribution.value) return;
  const payouts = Object.entries(distribution.value.awards)
    .map(([id, amount]) => `${playerName(id)}: ${chipFormat.format(amount)}`)
    .join(", ");
  if (
    !window.confirm(
      `Начислить банк раздачи №${hand.value?.number}? ${payouts || "Нет призовых выплат"}. Неуравнённые ставки будут возвращены.`,
    )
  )
    return;
  if (!pokerStore.settleCurrentHand(props.tournament)) {
    message.value =
      pot.value > 0
        ? "Отметьте игрока, который забирает банк."
        : "Не удалось завершить раздачу.";
    return;
  }
  message.value = "Банк распределён, стеки обновлены.";
};

const openNextHand = () => {
  message.value = pokerStore.startNextHand(props.tournament)
    ? ""
    : props.tournament.levels[props.tournament.currentLevel]?.break
      ? "Сейчас перерыв. Сначала переключите уровень вручную."
      : "Проверьте стеки и подтвердите вылеты игроков перед новой раздачей.";
};

const playerName = (playerId: string): string => {
  return (
    participants.value.find((entry) => entry.id === playerId)?.name ?? "Игрок"
  );
};

const onFold = (playerId: string, event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!pokerStore.setHandFolded(props.tournament, playerId, input.checked)) {
    input.checked = hand.value?.players[playerId]?.folded ?? false;
    message.value = "В раздаче должен остаться хотя бы один игрок.";
  }
};

const undoOperation = () => {
  const checkpoint = props.tournament.operationHistory?.at(-1);
  if (
    !checkpoint ||
    !window.confirm(
      `Отменить действие «${checkpoint.label}»? Стеки и места будут восстановлены.`,
    )
  )
    return;
  message.value = pokerStore.undoLastOperation(props.tournament)
    ? "Действие отменено."
    : "Сначала отмените текущую незавершённую раздачу.";
};

const cancelHand = () => {
  if (
    !window.confirm(
      "Отменить текущую раздачу? Внесённые в неё ставки не будут списаны со стеков. Записи этой раздачи будут удалены.",
    )
  )
    return;
  message.value = pokerStore.cancelCurrentHand(props.tournament)
    ? "Раздача отменена."
    : "Нет незавершённой раздачи.";
};

const onRebuy = (playerId: string) => {
  const player = participants.value.find((entry) => entry.id === playerId);
  if (
    !player ||
    !window.confirm(
      `Добавить ${player.name} докупку за ${props.tournament.buyIn} ₽ и выдать ${props.tournament.startingStack} фишек?`,
    )
  )
    return;
  if (!pokerStore.rebuyPlayer(props.tournament, playerId))
    message.value = "Докупка сейчас недоступна.";
  else message.value = `${player.name} получил докупку.`;
};

const onElimination = (playerId: string) => {
  const player = participants.value.find((entry) => entry.id === playerId);
  if (
    !player ||
    !window.confirm(
      `Подтвердить вылет ${player.name}? При одновременном вылете место определяется по стеку до начала раздачи.`,
    )
  )
    return;
  if (!pokerStore.confirmPlayerElimination(props.tournament, playerId))
    message.value = "Вылет можно подтвердить после завершения текущей раздачи.";
  else
    message.value =
      props.tournament.status === "finished"
        ? "Турнир завершён, места распределены по порядку вылета."
        : `${player.name} выбыл. Его место рассчитано автоматически.`;
};

const stageName = (street: HandStreet): string => {
  return handStreets.find((stage) => stage.id === street)?.label ?? street;
};
</script>

<template>
  <section class="panel hand-tracking-panel">
    <div class="panel-heading">
      <div>
        <div class="eyebrow">ЖУРНАЛ ИГРЫ</div>
        <h2>
          Раздача №
          {{ hand?.number ?? (tournament.hands.at(-1)?.number ?? 0) + 1 }}
        </h2>
      </div>
      <span class="count-pill">Банк {{ chipFormat.format(pot) }}</span>
    </div>

    <template v-if="hand">
      <div class="hand-street-navigation">
        <div class="hand-street-tabs" role="tablist" aria-label="Улица раздачи">
          <button
            v-for="(street, index) in handStreets"
            :key="street.id"
            type="button"
            role="tab"
            class="hand-street-tabs__tab"
            :aria-selected="hand.street === street.id"
            :class="{
              'hand-street-tabs__tab--active': hand.street === street.id,
            }"
            @click="requestHandStreet(street.id)"
          >
            {{ index + 1 }}. {{ street.label }}
          </button>
        </div>
        <button
          class="button button--outline street-switch-button"
          type="button"
          :disabled="!nextStreet || !canAdvanceStreet"
          @click="goToNextStreet"
        >
          {{
            nextStreet
              ? `Следующая улица: ${nextStreet.label} →`
              : "Последняя улица"
          }}
        </button>
      </div>
      <p
        v-if="streetTransitionHint"
        class="fine-print street-transition-hint"
        role="status"
      >
        {{ streetTransitionHint }}
      </p>

      <div class="hand-table-wrap">
        <table class="hand-table">
          <thead>
            <tr>
              <th>Игрок</th>
              <th v-for="actionIndex in streetActionIndexes" :key="actionIndex">
                Действие {{ actionIndex + 1 }}
              </th>
              <th>На улице</th>
              <th>В раздаче</th>
              <th>Стек</th>
              <th>Фолд</th>
              <th>Забирает</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in handParticipants" :key="entry.id">
              <th scope="row">
                {{ entry.name }}
                <span class="role-badges"
                  ><span
                    v-if="hand.roles?.dealer === entry.id"
                    class="role-badge"
                    >Д</span
                  ><span
                    v-if="hand.roles?.smallBlind === entry.id"
                    class="role-badge"
                    >МБ</span
                  ><span
                    v-if="hand.roles?.bigBlind === entry.id"
                    class="role-badge"
                    >ББ</span
                  ><span
                    v-if="isPlayerAllIn(tournament, hand, entry.id)"
                    class="all-in-badge"
                    >Олл-ин</span
                  ></span
                >
              </th>
              <td v-for="actionIndex in streetActionIndexes" :key="actionIndex">
                <div class="hand-action-cell">
                  <input
                    class="hand-bet-input"
                    type="number"
                    data-enter-player-action
                    :data-hand-player-id="entry.id"
                    :data-hand-action-index="actionIndex"
                    min="0"
                    step="1"
                    :max="
                      availableForAction(entry.id, hand.street, actionIndex)
                    "
                    :aria-label="`${entry.name}, ${currentStreetLabel}, действие ${actionIndex + 1}`"
                    :value="entry.player.bets[hand.street][actionIndex] ?? 0"
                    :readonly="
                      hand.street === 'preflop' &&
                      actionIndex === 0 &&
                      [hand.roles?.smallBlind, hand.roles?.bigBlind].includes(
                        entry.id,
                      )
                    "
                    :disabled="
                      entry.player.folded ||
                      (isPlayerAllIn(tournament, hand, entry.id) &&
                        !(entry.player.bets[hand.street][actionIndex] ?? 0))
                    "
                    @focus="clearZeroOnFocus"
                    @blur="restoreEmptyZeroOnBlur"
                    @change="
                      onBetChange(entry.id, hand.street, actionIndex, $event)
                    "
                    @keydown.enter="
                      focusNextPlayerAction(entry.id, actionIndex, $event)
                    "
                  />
                  <strong
                    v-if="entry.player.actions[hand.street][actionIndex]"
                    class="hand-action-label"
                    >{{
                      actionLabels[
                        entry.player.actions[hand.street][actionIndex]!
                      ]
                    }}</strong
                  >
                  <button
                    v-else-if="
                      !entry.player.folded &&
                      !isPlayerAllIn(tournament, hand, entry.id) &&
                      currentStreetRequirements.some(
                        (requirement) =>
                          requirement.playerId === entry.id &&
                          requirement.amountOwed === 0,
                      ) &&
                      nextCheckActionIndex(entry.id, hand.street) ===
                        actionIndex
                    "
                    class="text-button check-action"
                    type="button"
                    :aria-label="`Записать чек: ${entry.name}, ${currentStreetLabel}, действие ${actionIndex + 1}`"
                    @click="onCheck(entry.id, hand.street, actionIndex)"
                  >
                    Чек
                  </button>
                </div>
              </td>
              <td>
                {{
                  chipFormat.format(
                    playerStreetContribution(entry.player, hand.street),
                  )
                }}
              </td>
              <td>
                {{ chipFormat.format(playerHandContribution(entry.player)) }}
              </td>
              <td>
                <strong>{{
                  chipFormat.format(projectedStack(tournament, hand, entry.id))
                }}</strong>
                <button
                  v-if="
                    !entry.player.folded &&
                    (entry.player.actions[hand.street].includes('all-in') ||
                      (!isPlayerAllIn(tournament, hand, entry.id) &&
                        projectedStack(tournament, hand, entry.id) > 0))
                  "
                  class="text-button all-in-action"
                  type="button"
                  :aria-label="
                    entry.player.actions[hand.street].includes('all-in')
                      ? `Отменить олл-ин: ${entry.name}`
                      : `Выставить олл-ин: ${entry.name}, ${chipFormat.format(projectedStack(tournament, hand, entry.id))} фишек`
                  "
                  @click="onAllIn(entry.id)"
                >
                  {{
                    entry.player.actions[hand.street].includes("all-in")
                      ? "Отменить олл-ин"
                      : "Олл-ин"
                  }}
                </button>
              </td>
              <td>
                <input
                  type="checkbox"
                  :aria-label="`${entry.name} сбросил карты`"
                  :checked="entry.player.folded"
                  :disabled="isPlayerAllIn(tournament, hand, entry.id)"
                  @change="onFold(entry.id, $event)"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  :aria-label="`${entry.name} забирает банк`"
                  :disabled="
                    entry.player.folded ||
                    ((distribution?.pots.length ?? 0) > 1 &&
                      !playerCanBeSelectedForBank(entry.id))
                  "
                  :title="
                    (distribution?.pots.length ?? 0) > 1
                      ? 'Отметить победителем во всех доступных банках; уточнить выбор можно ниже'
                      : ''
                  "
                  :checked="playerWinsAllSelectableBanks(entry.id)"
                  @change="
                    pokerStore.setHandWinner(
                      tournament,
                      entry.id,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
              </td>
            </tr>
            <tr class="hand-pot-row">
              <th scope="row">Всего внесено</th>
              <td v-for="actionIndex in streetActionIndexes" :key="actionIndex">
                {{
                  chipFormat.format(
                    handActionPot(hand, hand.street, actionIndex),
                  )
                }}
              </td>
              <td>{{ chipFormat.format(handStreetPot(hand, hand.street)) }}</td>
              <td>{{ chipFormat.format(pot) }}</td>
              <td colspan="3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="distribution" class="pot-distribution">
        <p
          v-if="banksAwaitingWinner.length"
          class="fine-print pot-winner-hint"
          role="status"
        >
          Чтобы завершить раздачу, выберите победителей:
          {{ banksAwaitingWinner.join(", ") }}. Кнопка начисления банка станет
          доступна, когда победители будут выбраны во всех банках.
        </p>
        <p v-if="distribution.pots.length > 1" class="fine-print">
          Чекбокс «Забирает» отмечает игрока победителем во всех банках, где он
          может выиграть. Ниже можно выбрать победителя отдельно для каждого
          банка.
        </p>
        <div v-if="distribution.pots.length > 1" class="side-pot-list">
          <fieldset v-for="(bank, index) in distribution.pots" :key="bank.id">
            <legend>
              {{ index === 0 ? "Основной банк" : `Побочный банк ${index}` }} ·
              {{ chipFormat.format(bank.amount) }} фишек
            </legend>
            <label v-for="id in bank.eligibleIds" :key="id"
              ><input
                type="checkbox"
                :aria-label="`Банк ${index + 1}: ${playerName(id)}`"
                :checked="bank.winnerIds.includes(id)"
                :disabled="bank.eligibleIds.length === 1"
                @change="
                  pokerStore.setHandPotWinner(
                    tournament,
                    bank.id,
                    id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />{{ playerName(id) }}</label
            >
          </fieldset>
        </div>
        <p
          v-for="(amount, id) in distribution.refunds"
          :key="id"
          class="fine-print"
        >
          Возврат неуравнённой ставки: {{ playerName(String(id)) }} ·
          {{ chipFormat.format(amount) }} фишек.
        </p>
        <p
          v-if="
            hand.street !== 'river' &&
            Object.values(hand.players).filter((player) => !player.folded)
              .length > 1
          "
          class="fine-print"
        >
          Для начисления банка завершите раздачу до ривера и выберите
          победителей. При олл-ине остальные улицы можно пройти без ставок.
        </p>
      </div>
      <div class="hand-actions">
        <p class="fine-print">
          {{
            wagersWithinStacks
              ? `Записывайте добавленные фишки, а не итоговую ставку. Действия в столбце идут по порядку мест; после рейза вернувшийся колл записывайте в следующем столбце. Несколько победителей делят выбранный банк. Нечётная фишка достаётся первому победителю слева от дилера.`
              : "Сумма ставок игрока превышает его стек."
          }}
        </p>
        <div class="hand-action-buttons">
          <button
            class="button button--outline"
            type="button"
            @click="addActionColumn"
          >
            ＋ Столбец действия
          </button>
          <button
            class="button button--dark"
            type="button"
            :disabled="!canSettle"
            @click="closeHand"
          >
            Завершить раздачу и начислить банк
          </button>
          <button
            class="text-button danger-text"
            type="button"
            @click="cancelHand"
          >
            Отменить текущую раздачу
          </button>
        </div>
      </div>
    </template>
    <div v-else class="next-hand-row">
      <p class="muted">
        {{
          !tournament.initialDealerId &&
          !tournament.hands.some((item) => item.roles)
            ? "Выберите первого дилера в составе игры."
            : tournament.hands.length
              ? "Предыдущая раздача сохранена. Начните следующую, чтобы продолжить учёт."
              : "Турнир начат. Запустите первую раздачу."
        }}
      </p>
      <button
        class="button button--dark"
        type="button"
        :disabled="
          tournament.status === 'finished' ||
          tournament.levels[tournament.currentLevel]?.break ||
          (!tournament.initialDealerId &&
            !tournament.hands.some((item) => item.roles)) ||
          participants.filter(
            ({ id }) =>
              tournament.places[id] == null && (tournament.stacks[id] ?? 0) > 0,
          ).length < 2 ||
          participants.some(
            ({ id }) =>
              tournament.places[id] == null &&
              (tournament.stacks[id] ?? 0) === 0,
          )
        "
        @click="openNextHand"
      >
        ＋ Начать раздачу
      </button>
    </div>

    <p v-if="message" class="participant-message" role="status">
      {{ message }}
    </p>
    <p
      v-if="tournament.levels[tournament.currentLevel]?.break && !hand"
      class="fine-print"
      role="status"
    >
      Перерыв: новые раздачи доступны после ручного перехода к игровому уровню.
    </p>
    <div v-if="tournament.operationHistory?.length" class="undo-operation">
      <button
        class="button button--outline"
        :disabled="!pokerStore.canUndoLastOperation(tournament)"
        @click="undoOperation"
      >
        <KitIcon name="undo" />Отменить:
        {{ tournament.operationHistory.at(-1)?.label }}
      </button>
      <p v-if="hand" class="fine-print">
        Чтобы отменить предыдущее начисление или вылет, сначала отмените текущую
        раздачу.
      </p>
    </div>
    <details v-if="hand?.events?.length">
      <summary>Записи текущей раздачи</summary>
      <ol>
        <li v-for="(event, index) in hand.events" :key="index">
          {{ formatKrasnoyarskDateTime(event.at) }} · {{ event.description }}
        </li>
      </ol>
    </details>
    <details v-if="handHistory.length" class="hand-history">
      <summary>История раздач · {{ handHistory.length }}</summary>
      <ol>
        <li v-for="item in handHistory" :key="item.number">
          <strong>№ {{ item.number }}</strong
          ><span
            >{{ item.street }} · {{ chipFormat.format(item.pot) }} фишек</span
          ><span
            >Забрали: {{ item.winners.join(", ") || "банк не разыгран" }}</span
          ><span
            >{{ formatKrasnoyarskDateTime(item.startedAt) }} →
            {{ formatKrasnoyarskDateTime(item.endedAt) }} · Длительность
            {{ item.duration }}</span
          >
          <details v-if="item.events.length">
            <summary>Действия по времени</summary>
            <ol>
              <li v-for="(event, index) in item.events" :key="index">
                {{ formatKrasnoyarskDateTime(event.at) }} ·
                {{ event.description }}
              </li>
            </ol>
          </details>
        </li>
      </ol>
    </details>
  </section>

  <section class="panel chip-balance-panel">
    <div class="panel-heading">
      <div>
        <div class="eyebrow">АВТОМАТИЧЕСКИЙ РАСЧЁТ</div>
        <h2>Стеки и баланс</h2>
      </div>
      <span class="count-pill"
        >Банк {{ cashFormat.format(displayedPrizePool) }} ₽</span
      >
    </div>
    <div class="hand-table-wrap">
      <table class="balance-table">
        <thead>
          <tr>
            <th>Игрок</th>
            <th>Место</th>
            <th>Входы</th>
            <th>Внесено</th>
            <th>Фишки</th>
            <th>Очки турнира</th>
            <th>Всего очков</th>
            <th>К выплате</th>
            <th>Доля банка</th>
            <th>Баланс</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="player in currentTournamentTable" :key="player.id">
            <th scope="row">
              {{ player.name
              }}<small v-if="tournament.places[player.id] != null"
                >Место {{ tournament.places[player.id] }}</small
              >
            </th>
            <td>{{ player.place || "—" }}</td>
            <td>{{ 1 + (tournament.rebuys[player.id] ?? 0) }}</td>
            <td>
              {{ cashFormat.format(playerInvestment(tournament, player.id)) }} ₽
            </td>
            <td>{{ chipFormat.format(player.stack) }}</td>
            <td>{{ player.tournamentPoints }}</td>
            <td>{{ player.totalPoints }}</td>
            <td>{{ cashFormat.format(player.payout) }} ₽</td>
            <td>{{ player.payoutShare.toFixed(1) }}%</td>
            <td
              :class="
                playerNetBalance(tournament, player.id, player.stack) >= 0
                  ? 'balance-positive'
                  : 'balance-negative'
              "
            >
              {{
                playerNetBalance(tournament, player.id, player.stack) > 0
                  ? "+"
                  : ""
              }}{{
                cashFormat.format(
                  playerNetBalance(tournament, player.id, player.stack),
                )
              }}
              ₽
            </td>
            <td class="player-game-action">
              <template
                v-if="
                  tournament.gameInitialized &&
                  tournament.places[player.id] == null &&
                  (tournament.stacks[player.id] ?? 0) === 0
                "
              >
                <span v-if="hand" class="muted">Ждём конца раздачи</span>
                <template v-else>
                  <button
                    v-if="pokerStore.canPlayerRebuy(tournament, player.id, now)"
                    class="text-button"
                    type="button"
                    @click="onRebuy(player.id)"
                  >
                    ＋ Докупка
                  </button>
                  <button
                    class="text-button danger-text"
                    type="button"
                    @click="onElimination(player.id)"
                  >
                    Подтвердить вылет
                  </button>
                </template>
              </template>
              <span
                v-else-if="tournament.places[player.id] != null"
                class="muted"
                >{{
                  tournament.places[player.id] === 1 ? "Победитель" : "Выбыл"
                }}</span
              >
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th>Итого</th>
            <td>—</td>
            <td>—</td>
            <td>{{ cashFormat.format(totalCashIn) }} ₽</td>
            <td>{{ chipFormat.format(tournamentChipsInPlay(tournament)) }}</td>
            <td>—</td>
            <td>—</td>
            <td>{{ cashFormat.format(currentDistributionTotals.payout) }} ₽</td>
            <td>{{ currentDistributionTotals.payoutShare.toFixed(1) }}%</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="fine-print">
      Место и очки в текущем турнире предварительные, пока игра не завершена.
      Выплата считается по последним зафиксированным стекам; банк текущей
      раздачи распределится после её завершения. Вылет подтверждается после
      раздачи.
    </p>
  </section>
</template>

<style scoped>
.side-pot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0;
}
.side-pot-list fieldset {
  border: 1px solid var(--line);
  padding: 12px;
  border-radius: 6px;
  min-width: 230px;
}
.side-pot-list label {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 6px 0;
}
.undo-operation {
  margin: 14px 0;
}
.hand-tracking-panel .hand-street-tabs__tab {
  min-height: 48px;
  padding: 11px 18px;
  font-size: 15px;
}

.hand-tracking-panel .street-switch-button {
  min-height: 52px;
  padding: 12px 18px;
  font-size: 15px;
}

.hand-tracking-panel .hand-table th,
.hand-tracking-panel .hand-table td {
  padding: 13px 12px;
}

.hand-tracking-panel .hand-table thead th {
  font-size: 12px;
}

.hand-tracking-panel .hand-action-cell {
  min-width: 100px;
  gap: 5px;
}

.hand-tracking-panel .hand-bet-input {
  width: 92px;
  height: 48px;
  padding-inline: 9px;
  font-size: 18px;
}

.hand-tracking-panel .hand-table input[type="checkbox"] {
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.hand-tracking-panel .check-action {
  min-width: 72px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid rgba(88, 186, 86, 0.55);
  border-radius: 6px;
  background: rgba(88, 186, 86, 0.14);
  color: #a5e8a0;
  font-size: 13px;
  font-weight: 700;
}

.hand-tracking-panel .check-action:hover {
  background: rgba(88, 186, 86, 0.24);
  color: #fff;
}

.hand-tracking-panel .all-in-action {
  min-height: 36px;
  padding: 6px 12px;
  border-color: rgba(255, 120, 102, 0.62);
  background: rgba(255, 120, 102, 0.12);
  color: #ff9b8d;
  font-size: 12px;
}

.hand-tracking-panel .all-in-action:hover {
  border-color: #ff7866;
  background: rgba(255, 120, 102, 0.22);
  color: #fff;
}

.hand-tracking-panel .hand-action-buttons .button,
.hand-tracking-panel .next-hand-row .button {
  min-height: 52px;
  padding: 12px 18px;
  font-size: 14px;
}

.hand-tracking-panel .hand-action-buttons {
  gap: 10px;
}

.hand-tracking-panel .hand-history summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  font-size: 14px;
}

@media (max-width: 760px) {
  .hand-tracking-panel .hand-street-tabs__tab {
    min-height: 46px;
    padding-inline: 14px;
  }

  .hand-tracking-panel .street-switch-button {
    min-height: 50px;
  }

  .hand-tracking-panel .hand-action-buttons .button,
  .hand-tracking-panel .next-hand-row .button {
    min-height: 52px;
  }
}
</style>
