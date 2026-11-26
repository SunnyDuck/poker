import type {
  BlindLevel,
  HandPlayerState,
  HandRoles,
  HandStreet,
  PokerHand,
  Tournament,
} from "./types";

export const handStreets: { id: HandStreet; label: string }[] = [
  { id: "preflop", label: "Префлоп" },
  { id: "flop", label: "Флоп" },
  { id: "turn", label: "Тёрн" },
  { id: "river", label: "Ривер" },
];

export const defaultBetActionCount = 3;

export const isPlayerVisibleOnStreet = (
  player: HandPlayerState,
  street: HandStreet,
): boolean => {
  if (!player.folded || !player.foldedOn) return true;
  return (
    handStreets.findIndex((item) => item.id === street) <=
    handStreets.findIndex((item) => item.id === player.foldedOn)
  );
};

export const rolesForHand = (
  seatIds: string[],
  activeIds: string[],
  dealerId: string | null,
  advance: boolean,
): HandRoles | null => {
  if (activeIds.length < 2 || seatIds.length < 2) return null;
  const active = new Set(activeIds);
  const dealerSeat = dealerId ? seatIds.indexOf(dealerId) : -1;
  const start = dealerSeat < 0 ? 0 : dealerSeat + (advance ? 1 : 0);
  const ordered = Array.from(
    { length: seatIds.length },
    (_, offset) => seatIds[(start + offset) % seatIds.length]!,
  ).filter((id) => active.has(id));
  if (ordered.length < 2) return null;
  return {
    dealer: ordered[0]!,
    smallBlind: ordered.length === 2 ? ordered[0]! : ordered[1]!,
    bigBlind: ordered.length === 2 ? ordered[1]! : ordered[2]!,
  };
};

export const createPokerHand = (
  number: number,
  playerIds: string[],
  roles: HandRoles | null = null,
): PokerHand => {
  const players: Record<string, HandPlayerState> = {};
  for (const id of playerIds) {
    players[id] = {
      bets: {
        preflop: Array(defaultBetActionCount).fill(0),
        flop: Array(defaultBetActionCount).fill(0),
        turn: Array(defaultBetActionCount).fill(0),
        river: Array(defaultBetActionCount).fill(0),
      },
      actions: {
        preflop: Array(defaultBetActionCount).fill(null),
        flop: Array(defaultBetActionCount).fill(null),
        turn: Array(defaultBetActionCount).fill(null),
        river: Array(defaultBetActionCount).fill(null),
      },
      folded: false,
      foldedOn: null,
      takesPot: false,
    };
  }
  return {
    number,
    street: "preflop",
    players,
    settled: false,
    roles,
    startedAt: Date.now(),
    events: [],
  };
};

export const postBlinds = (
  hand: PokerHand,
  level: BlindLevel,
  stacks: Record<string, number>,
): void => {
  hand.bigBlind = level.big;
  if (!hand.roles) return;
  const smallBlindPlayer = hand.players[hand.roles.smallBlind];
  const bigBlindPlayer = hand.players[hand.roles.bigBlind];
  if (smallBlindPlayer) {
    smallBlindPlayer.bets.preflop[0] = Math.min(
      Math.max(0, Math.floor(level.small)),
      Math.max(0, stacks[hand.roles.smallBlind] ?? 0),
    );
    if (smallBlindPlayer.bets.preflop[0] > 0)
      smallBlindPlayer.actions.preflop[0] = "small-blind";
  }
  if (bigBlindPlayer) {
    bigBlindPlayer.bets.preflop[0] = Math.min(
      Math.max(0, Math.floor(level.big)),
      Math.max(0, stacks[hand.roles.bigBlind] ?? 0),
    );
    if (bigBlindPlayer.bets.preflop[0] > 0)
      bigBlindPlayer.actions.preflop[0] = "big-blind";
  }
};

export const playerHandContribution = (player: HandPlayerState): number => {
  return handStreets.reduce(
    (sum, street) => sum + playerStreetContribution(player, street.id),
    0,
  );
};

export const playerStreetContribution = (
  player: HandPlayerState,
  street: HandStreet,
): number => {
  return (player.bets[street] ?? []).reduce(
    (sum, amount) => sum + Math.max(0, Number(amount) || 0),
    0,
  );
};

export const handPot = (hand: PokerHand): number => {
  return Object.values(hand.players).reduce(
    (sum, player) => sum + playerHandContribution(player),
    0,
  );
};

export const handStreetPot = (hand: PokerHand, street: HandStreet): number => {
  return Object.values(hand.players).reduce(
    (sum, player) => sum + playerStreetContribution(player, street),
    0,
  );
};

export const handActionPot = (
  hand: PokerHand,
  street: HandStreet,
  actionIndex: number,
): number => {
  return Object.values(hand.players).reduce(
    (sum, player) =>
      sum + Math.max(0, Number(player.bets[street]?.[actionIndex]) || 0),
    0,
  );
};

export const handActionCount = (
  hand: PokerHand,
  street: HandStreet,
): number => {
  return Math.max(
    defaultBetActionCount,
    ...Object.values(hand.players).map(
      (player) => player.bets[street]?.length ?? 0,
    ),
  );
};

export const nextHandActionIndex = (
  hand: PokerHand,
  street: HandStreet,
): number => {
  let lastUsedIndex = -1;
  for (let index = 0; index < handActionCount(hand, street); index += 1) {
    if (
      handActionPot(hand, street, index) > 0 ||
      Object.values(hand.players).some(
        (player) => player.actions?.[street]?.[index] != null,
      )
    )
      lastUsedIndex = index;
  }
  return lastUsedIndex + 1;
};

export const canPlayerCheck = (
  hand: PokerHand,
  playerId: string,
  street: HandStreet,
  actionIndex: number,
): boolean => {
  const seatIds = Object.keys(hand.players);
  const player = hand.players[playerId];
  if (!player || !seatIds.length) return false;
  const firstToAct =
    street === "preflop"
      ? (hand.roles?.bigBlind ?? hand.roles?.dealer)
      : hand.roles?.dealer;
  const pivot = firstToAct ? seatIds.indexOf(firstToAct) : -1;
  const start = pivot < 0 ? 0 : (pivot + 1) % seatIds.length;
  const order = Array.from(
    { length: seatIds.length },
    (_, offset) => seatIds[(start + offset) % seatIds.length]!,
  );
  const ownBefore = (player.bets[street] ?? [])
    .slice(0, actionIndex)
    .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
  let highestBefore = Math.max(
    0,
    ...Object.values(hand.players).map((other) =>
      (other.bets[street] ?? [])
        .slice(0, actionIndex)
        .reduce((sum, amount) => sum + (Number(amount) || 0), 0),
    ),
  );
  if (street === "preflop") {
    highestBefore = Math.max(
      highestBefore,
      hand.bigBlind ??
        Number(hand.players[hand.roles?.bigBlind ?? ""]?.bets.preflop[0] ?? 0),
    );
  }
  const playerPosition = order.indexOf(playerId);
  for (const id of order.slice(0, playerPosition)) {
    const earlierPlayer = hand.players[id]!;
    const total =
      (earlierPlayer.bets[street] ?? [])
        .slice(0, actionIndex)
        .reduce((sum, amount) => sum + (Number(amount) || 0), 0) +
      (Number(earlierPlayer.bets[street]?.[actionIndex]) || 0);
    highestBefore = Math.max(highestBefore, total);
  }
  return ownBefore >= highestBefore;
};

/** Classify each recorded contribution by its position after the previous action. */
export const classifyHandActions = (
  hand: PokerHand,
  street: HandStreet,
): void => {
  const seatIds = Object.keys(hand.players);
  if (!seatIds.length) return;
  const firstToAct =
    street === "preflop"
      ? (hand.roles?.bigBlind ?? hand.roles?.dealer)
      : hand.roles?.dealer;
  const pivot = firstToAct ? seatIds.indexOf(firstToAct) : -1;
  const start = pivot < 0 ? 0 : (pivot + 1) % seatIds.length;
  const actionOrder = Array.from(
    { length: seatIds.length },
    (_, offset) => seatIds[(start + offset) % seatIds.length]!,
  );

  for (
    let actionIndex = 0;
    actionIndex < handActionCount(hand, street);
    actionIndex += 1
  ) {
    const ownBefore = new Map(
      actionOrder.map((id) => [
        id,
        (hand.players[id]!.bets[street] ?? [])
          .slice(0, actionIndex)
          .reduce((sum, amount) => sum + (Number(amount) || 0), 0),
      ]),
    );
    let highestBet = Math.max(0, ...ownBefore.values());
    if (street === "preflop") {
      highestBet = Math.max(
        highestBet,
        hand.bigBlind ??
          Number(
            hand.players[hand.roles?.bigBlind ?? ""]?.bets.preflop[0] ?? 0,
          ),
      );
    }

    for (const id of actionOrder) {
      const player = hand.players[id]!;
      const amount = Number(player.bets[street]?.[actionIndex] ?? 0);
      if (
        street === "preflop" &&
        actionIndex === 0 &&
        amount > 0 &&
        id === hand.roles?.smallBlind
      ) {
        player.actions[street][actionIndex] = "small-blind";
        continue;
      }
      if (
        street === "preflop" &&
        actionIndex === 0 &&
        amount > 0 &&
        id === hand.roles?.bigBlind
      ) {
        player.actions[street][actionIndex] = "big-blind";
        continue;
      }
      if (amount <= 0) {
        if (
          player.actions[street][actionIndex] !== "check" ||
          (ownBefore.get(id) ?? 0) < highestBet
        )
          player.actions[street][actionIndex] = null;
        continue;
      }
      if (player.actions[street][actionIndex] === "all-in") {
        highestBet = Math.max(highestBet, (ownBefore.get(id) ?? 0) + amount);
        continue;
      }
      const totalAfter = (ownBefore.get(id) ?? 0) + amount;
      player.actions[street][actionIndex] =
        totalAfter <= highestBet ? "call" : highestBet > 0 ? "raise" : "bet";
      highestBet = Math.max(highestBet, totalAfter);
    }
  }
};

export const projectedStack = (
  tournament: Tournament,
  hand: PokerHand,
  playerId: string,
): number => {
  const currentStack = tournament.stacks[playerId] ?? 0;
  const player = hand.players[playerId];
  return currentStack - (player ? playerHandContribution(player) : 0);
};

export const isPlayerAllIn = (
  tournament: Tournament,
  hand: PokerHand,
  playerId: string,
): boolean => {
  const player = hand.players[playerId];
  return Boolean(
    player &&
    !player.folded &&
    playerHandContribution(player) > 0 &&
    projectedStack(tournament, hand, playerId) === 0,
  );
};

export interface StreetActionRequirement {
  playerId: string;
  amountOwed: number;
}

/** Return live players who still need to act or match the highest live contribution. */
export const streetActionRequirements = (
  tournament: Tournament,
  hand: PokerHand,
  street: HandStreet,
): StreetActionRequirement[] => {
  const contenders = Object.entries(hand.players).filter(
    ([, player]) => !player.folded,
  );
  if (contenders.length <= 1) return [];

  const canStillBet = contenders.filter(
    ([id]) => !isPlayerAllIn(tournament, hand, id),
  ).length;
  const highestContribution = Math.max(
    street === "preflop" && canStillBet > 1 ? (hand.bigBlind ?? 0) : 0,
    ...contenders.map(([, player]) => playerStreetContribution(player, street)),
  );
  return contenders.flatMap(([playerId, player]) => {
    if (isPlayerAllIn(tournament, hand, playerId)) return [];

    const hasVoluntaryAction =
      player.actions?.[street]?.some((action, index) => {
        if (
          action === "check" ||
          action === "call" ||
          action === "bet" ||
          action === "raise" ||
          action === "all-in"
        )
          return true;
        const isAutomaticBlind =
          street === "preflop" &&
          index === 0 &&
          (playerId === hand.roles?.smallBlind ||
            playerId === hand.roles?.bigBlind);
        return (
          !isAutomaticBlind && (Number(player.bets[street]?.[index]) || 0) > 0
        );
      }) ?? false;
    const contribution = playerStreetContribution(player, street);
    // Once everyone else is all-in, no check is required on a new street.
    if (canStillBet <= 1 && contribution >= highestContribution) return [];
    if (hasVoluntaryAction && contribution >= highestContribution) return [];
    return [
      { playerId, amountOwed: Math.max(0, highestContribution - contribution) },
    ];
  });
};

export const canAdvanceHandStreet = (
  tournament: Tournament,
  hand: PokerHand,
  street: HandStreet,
): boolean => {
  return streetActionRequirements(tournament, hand, street).length === 0;
};

export interface HandPot {
  id: string;
  amount: number;
  eligibleIds: string[];
  winnerIds: string[];
}

export interface HandDistribution {
  pots: HandPot[];
  awards: Record<string, number>;
  refunds: Record<string, number>;
  ready: boolean;
}

/** Separate matched contributions into pots. A lone contribution is a refund, never a prize. */
export const handDistribution = (hand: PokerHand): HandDistribution => {
  const entries = Object.entries(hand.players);
  const contributions = new Map(
    entries.map(([id, player]) => [id, playerHandContribution(player)]),
  );
  const thresholds = [...new Set(contributions.values())]
    .filter((amount) => amount > 0)
    .sort((a, b) => a - b);
  const contenders = entries
    .filter(([, player]) => !player.folded)
    .map(([id]) => id);
  const awards: Record<string, number> = {};
  const refunds: Record<string, number> = {};
  const pots: HandPot[] = [];
  let previous = 0;
  let ready = contenders.length > 0;
  const seats = Object.keys(hand.players);
  const dealerIndex = seats.indexOf(hand.roles?.dealer ?? "");
  const awardOrder = [
    ...seats.slice(dealerIndex + 1),
    ...seats.slice(0, dealerIndex + 1),
  ];
  for (const threshold of thresholds) {
    const contributors = entries
      .filter(([id]) => contributions.get(id)! >= threshold)
      .map(([id]) => id);
    const amount = (threshold - previous) * contributors.length;
    previous = threshold;
    if (contributors.length === 1) {
      refunds[contributors[0]!] = (refunds[contributors[0]!] ?? 0) + amount;
      continue;
    }
    const eligibleIds =
      contenders.length === 1
        ? contenders
        : contributors.filter((id) => contenders.includes(id));
    const previousPot = pots.at(-1);
    if (
      previousPot &&
      previousPot.eligibleIds.join("|") === eligibleIds.join("|")
    ) {
      previousPot.amount += amount;
      previousPot.id = String(threshold);
    } else
      pots.push({ id: String(threshold), amount, eligibleIds, winnerIds: [] });
  }
  for (const pot of pots) {
    const { id, amount, eligibleIds } = pot;
    const selected =
      hand.potWinners?.[id] ??
      (pots.length === 1
        ? eligibleIds.filter((playerId) => hand.players[playerId]!.takesPot)
        : []);
    const winnerIds =
      eligibleIds.length === 1
        ? [...eligibleIds]
        : awardOrder.filter(
            (playerId) =>
              eligibleIds.includes(playerId) && selected.includes(playerId),
          );
    if (
      !winnerIds.length ||
      selected.some((playerId) => !eligibleIds.includes(playerId))
    )
      ready = false;
    pot.winnerIds = winnerIds;
    winnerIds.forEach((playerId, index) => {
      awards[playerId] =
        (awards[playerId] ?? 0) +
        Math.floor(amount / winnerIds.length) +
        (index < amount % winnerIds.length ? 1 : 0);
    });
  }
  return { pots, awards, refunds, ready };
};

export const canSettlePokerHand = (
  tournament: Tournament,
  hand: PokerHand,
): boolean => {
  if (hand.settled) return false;
  if (
    Object.entries(hand.players).some(
      ([id, player]) =>
        !Number.isSafeInteger(tournament.stacks[id]) ||
        (tournament.stacks[id] ?? -1) < 0 ||
        Object.values(player.bets)
          .flat()
          .some((amount) => !Number.isSafeInteger(amount) || amount < 0) ||
        playerHandContribution(player) > (tournament.stacks[id] ?? 0),
    )
  )
    return false;
  return handDistribution(hand).ready;
};

export const settlePokerHand = (
  tournament: Tournament,
  hand: PokerHand,
): boolean => {
  if (!canSettlePokerHand(tournament, hand)) return false;
  const { awards, refunds } = handDistribution(hand);
  for (const [id, player] of Object.entries(hand.players)) {
    tournament.stacks[id] =
      (tournament.stacks[id] ?? 0) -
      playerHandContribution(player) +
      (awards[id] ?? 0) +
      (refunds[id] ?? 0);
    player.takesPot = (awards[id] ?? 0) > 0;
  }
  hand.settlement = { awards, refunds };
  hand.settled = true;
  hand.endedAt = Date.now();
  return true;
};

export const playerInvestment = (
  tournament: Tournament,
  playerId: string,
): number => {
  const rebuyCount = Math.max(0, tournament.rebuys[playerId] ?? 0);
  return Math.max(0, tournament.buyIn) * (1 + rebuyCount);
};

export const tournamentPrizePool = (tournament: Tournament): number => {
  const buyIns =
    tournament.participantIds.length * Math.max(0, tournament.buyIn);
  const rebuys = Object.values(tournament.rebuys).reduce(
    (sum, count) => sum + Math.max(0, Number(count) || 0),
    0,
  );
  return buyIns + rebuys * Math.max(0, tournament.buyIn);
};

export const tournamentChipsInPlay = (tournament: Tournament): number => {
  const rebuys = Object.values(tournament.rebuys).reduce(
    (sum, count) => sum + Math.max(0, Number(count) || 0),
    0,
  );
  return (
    Math.max(0, tournament.startingStack) *
    (tournament.participantIds.length + rebuys)
  );
};

export const playerCashout = (
  tournament: Tournament,
  playerId: string,
  chips = tournament.stacks[playerId] ?? 0,
): number => {
  const totalChips = tournamentChipsInPlay(tournament);
  if (totalChips <= 0) return 0;
  return (Math.max(0, chips) / totalChips) * tournamentPrizePool(tournament);
};

export const playerNetBalance = (
  tournament: Tournament,
  playerId: string,
  chips?: number,
): number => {
  return (
    playerCashout(tournament, playerId, chips) -
    playerInvestment(tournament, playerId)
  );
};
