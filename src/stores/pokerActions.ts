import { createDemoState, seasonLevels } from "@/domain/demoData";
import {
  canPlayerCheck,
  classifyHandActions,
  createPokerHand,
  handDistribution,
  playerHandContribution,
  postBlinds,
  projectedStack,
  rolesForHand,
  settlePokerHand,
  streetActionRequirements,
} from "@/domain/game";
import { isBeforeKrasnoyarskCutoff, krasnoyarskToday } from "@/domain/time";
import type {
  DemoState,
  HandStreet,
  PokerActionType,
  PokerHand,
  Tournament,
  TournamentCheckpoint,
} from "@/domain/types";
import { tournamentSettingsErrors } from "@/domain/validation";

export type InitialRole = "dealer" | "smallBlind" | "bigBlind";

export const createPokerActions = (state: DemoState) => {
  const cloneValue = <T>(value: T): T => {
    return JSON.parse(JSON.stringify(value)) as T;
  };

  const findTournament = (id: string): Tournament | undefined => {
    return state.tournaments.find((tournament) => tournament.id === id);
  };

  const createTournament = (): Tournament => {
    const number = state.tournaments.length + 1;
    const tournament: Tournament = {
      id: `tournament-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `Игра ${number}`,
      date: krasnoyarskToday(),
      startTime: "18:00",
      status: "upcoming",
      buyIn: 300,
      startingStack: 1500,
      rebuyCost: 300,
      maxRebuys: 1,
      rebuyUntil: "19:30",
      participantIds: [],
      initialDealerId: null,
      rebuys: {},
      places: {},
      eliminatedInHand: {},
      gameInitialized: false,
      stacks: {},
      hands: [],
      levels: seasonLevels.map((level) => ({ ...level })),
      currentLevel: 0,
      secondsRemaining: seasonLevels[0]!.minutes * 60,
      timerStartedAt: null,
      startedAt: null,
    };
    state.tournaments.push(tournament);
    return tournament;
  };

  const toggleParticipant = (
    tournament: Tournament,
    playerId: string,
  ): void => {
    if (tournament.status !== "upcoming" || tournament.gameInitialized) return;
    if (tournament.participantIds.includes(playerId)) {
      removeParticipantFromTournament(tournament, playerId);
    } else if (tournament.participantIds.length < 10) {
      tournament.participantIds.push(playerId);
    }
  };

  const removeParticipantFromTournament = (
    tournament: Tournament,
    playerId: string,
  ): void => {
    if (
      tournament.gameInitialized ||
      tournament.status !== "upcoming" ||
      tournament.hands.length
    )
      return;
    if (!tournament.participantIds.includes(playerId)) return;

    tournament.participantIds = tournament.participantIds.filter(
      (id) => id !== playerId,
    );
    if (tournament.initialDealerId === playerId)
      tournament.initialDealerId = null;
    delete tournament.rebuys[playerId];
    delete tournament.places[playerId];
    delete tournament.eliminatedInHand[playerId];
    delete tournament.stacks[playerId];
    for (const hand of tournament.hands) delete hand.players[playerId];
  };

  const moveParticipant = (
    tournament: Tournament,
    playerId: string,
    direction: -1 | 1,
  ): void => {
    if (tournament.status !== "upcoming" || tournament.gameInitialized) return;
    const index = tournament.participantIds.indexOf(playerId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= tournament.participantIds.length)
      return;
    const otherId = tournament.participantIds[next]!;
    tournament.participantIds[next] = playerId;
    tournament.participantIds[index] = otherId;
  };

  const setInitialRole = (
    tournament: Tournament,
    playerId: string,
    role: InitialRole | null,
  ): void => {
    if (
      tournament.status !== "upcoming" ||
      tournament.gameInitialized ||
      tournament.hands.some((hand) => hand.roles)
    )
      return;
    if (!role) {
      tournament.initialDealerId = null;
      return;
    }

    const activeSeats = tournament.participantIds.filter(
      (id) => tournament.places[id] == null,
    );
    const roleIndex = activeSeats.indexOf(playerId);
    if (roleIndex < 0 || activeSeats.length < 2) return;

    const roleOffset =
      role === "dealer"
        ? 0
        : role === "smallBlind"
          ? activeSeats.length === 2
            ? 0
            : 1
          : activeSeats.length === 2
            ? 1
            : 2;
    const dealerIndex =
      (roleIndex - roleOffset + activeSeats.length) % activeSeats.length;
    tournament.initialDealerId = activeSeats[dealerIndex]!;
  };

  const addPlayer = (
    name: string,
  ): DemoState["players"][number] | undefined => {
    const normalizedName = name.trim();
    if (!normalizedName) return undefined;

    const player = {
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
    };
    state.players.push(player);
    return player;
  };

  const playerHasHistory = (playerId: string): boolean => {
    return state.tournaments.some(
      (tournament) =>
        tournament.participantIds.includes(playerId) &&
        (tournament.gameInitialized ||
          tournament.status !== "upcoming" ||
          tournament.hands.length > 0),
    );
  };

  const removePlayerFromSeason = (playerId: string): boolean => {
    if (playerHasHistory(playerId)) return false;
    const playerIndex = state.players.findIndex(
      (player) => player.id === playerId,
    );
    if (playerIndex < 0) return false;

    state.players.splice(playerIndex, 1);
    for (const tournament of state.tournaments) {
      removeParticipantFromTournament(tournament, playerId);
    }
    return true;
  };

  const getCurrentHand = (tournament: Tournament) => {
    const hand = tournament.hands.at(-1);
    return hand && !hand.settled ? hand : undefined;
  };

  const resetDemo = (): void => {
    const fresh = createDemoState();
    state.players.splice(0, state.players.length, ...fresh.players);
    state.tournaments.splice(0, state.tournaments.length, ...fresh.tournaments);
  };

  const remainingMilliseconds = (
    tournament: Tournament,
    now = Date.now(),
  ): number => {
    const remaining = Number.isFinite(tournament.secondsRemaining)
      ? Math.max(0, Math.round(tournament.secondsRemaining * 1000))
      : 0;
    const elapsed =
      tournament.timerStartedAt === null
        ? 0
        : Math.max(0, now - tournament.timerStartedAt);
    return Math.max(0, remaining - elapsed);
  };

  const currentSeconds = (tournament: Tournament, now = Date.now()): number => {
    return Math.ceil(remainingMilliseconds(tournament, now) / 1000);
  };

  const startTimer = (tournament: Tournament): boolean => {
    if (
      tournament.status === "finished" ||
      tournament.participantIds.length < 2
    )
      return false;
    if (
      !tournament.gameInitialized &&
      (tournamentSettingsErrors(tournament).length > 0 ||
        tournament.participantIds.some(
          (id) => !state.players.some((player) => player.id === id),
        ))
    )
      return false;
    if (!tournament.gameInitialized) {
      tournament.stacks = {};
      tournament.rebuys = {};
      tournament.places = {};
      tournament.eliminatedInHand = {};
      tournament.hands = [];
      tournament.operationHistory = [];
      tournament.currentLevel = 0;
      tournament.secondsRemaining = tournament.levels[0]!.minutes * 60;
      for (const playerId of tournament.participantIds) {
        tournament.stacks[playerId] = tournament.startingStack;
        tournament.rebuys[playerId] = 0;
      }
      tournament.gameInitialized = true;
    }
    if (tournament.timerStartedAt !== null) return true;
    if (remainingMilliseconds(tournament) === 0) return false;
    const startedAt = Date.now();
    if (tournament.startedAt == null) tournament.startedAt = startedAt;
    tournament.timerStartedAt = startedAt;
    tournament.status = "live";
    return true;
  };

  const startNextHand = (tournament: Tournament): boolean => {
    if (
      tournament.status !== "live" ||
      !tournament.gameInitialized ||
      getCurrentHand(tournament) ||
      tournament.levels[tournament.currentLevel]?.break
    )
      return false;
    const unresolvedElimination = tournament.participantIds.some(
      (id) =>
        tournament.places[id] == null && (tournament.stacks[id] ?? 0) === 0,
    );
    if (unresolvedElimination) return false;
    const activeIds = tournament.participantIds.filter(
      (id) => tournament.places[id] == null && (tournament.stacks[id] ?? 0) > 0,
    );
    if (activeIds.length < 2) return false;
    const previous = tournament.hands.at(-1);
    const previousDealer =
      previous?.roles?.dealer ?? tournament.initialDealerId;
    if (!previousDealer) return false;
    const roles = rolesForHand(
      tournament.participantIds,
      activeIds,
      previousDealer,
      Boolean(previous?.roles),
    );
    const hand = createPokerHand((previous?.number ?? 0) + 1, activeIds, roles);
    const blindLevel = tournament.levels
      .slice(0, tournament.currentLevel + 1)
      .reverse()
      .find((level) => !level.break && (level.small > 0 || level.big > 0));
    if (blindLevel) postBlinds(hand, blindLevel, tournament.stacks);
    tournament.hands.push(hand);
    return true;
  };

  const setHandStreet = (
    tournament: Tournament,
    street: HandStreet,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    if (!hand) return false;

    const streets: HandStreet[] = ["preflop", "flop", "turn", "river"];
    const currentIndex = streets.indexOf(hand.street);
    const targetIndex = streets.indexOf(street);
    if (targetIndex < 0) return false;
    if (targetIndex > currentIndex) {
      for (const currentStreet of streets.slice(currentIndex, targetIndex)) {
        if (
          streetActionRequirements(tournament, hand, currentStreet).length > 0
        )
          return false;
      }
    }
    if (hand.street !== street)
      recordHandEvent(hand, `Открыта улица: ${street}`);
    hand.street = street;
    return true;
  };

  const setHandBet = (
    tournament: Tournament,
    playerId: string,
    street: HandStreet,
    actionIndex: number,
    amount: number,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    const player = hand?.players[playerId];
    if (
      !hand ||
      !player ||
      player.folded ||
      !Number.isInteger(actionIndex) ||
      actionIndex < 0 ||
      actionIndex >= player.bets[street].length ||
      !Number.isFinite(amount)
    )
      return false;

    if (street !== hand.street || !Number.isSafeInteger(amount) || amount < 0)
      return false;
    const normalizedAmount = amount;
    const previousAmount = player.bets[street][actionIndex] ?? 0;
    if (
      street === "preflop" &&
      actionIndex === 0 &&
      [hand.roles?.smallBlind, hand.roles?.bigBlind].includes(playerId) &&
      normalizedAmount !== previousAmount
    )
      return false;
    const contributionWithoutAction =
      playerHandContribution(player) - previousAmount;
    if (
      contributionWithoutAction + normalizedAmount >
      (tournament.stacks[playerId] ?? 0)
    )
      return false;

    player.bets[street][actionIndex] = normalizedAmount;
    if (previousAmount !== normalizedAmount) {
      delete hand.potWinners;
      classifyHandActions(hand, street);
      if (
        projectedStack(tournament, hand, playerId) === 0 &&
        normalizedAmount > 0
      )
        player.actions[street][actionIndex] = "all-in";
      else if (player.actions[street][actionIndex] === "all-in") {
        player.actions[street][actionIndex] = null;
        classifyHandActions(hand, street);
      }
      recordHandEvent(
        hand,
        `${playerName(playerId)}: ${street}, действие ${actionIndex + 1}, добавлено ${normalizedAmount} (было ${previousAmount})`,
      );
    }
    return true;
  };

  const setHandAction = (
    tournament: Tournament,
    playerId: string,
    street: HandStreet,
    actionIndex: number,
    action: PokerActionType | null,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    const player = hand?.players[playerId];
    if (
      !hand ||
      !player ||
      player.folded ||
      !Number.isInteger(actionIndex) ||
      actionIndex < 0 ||
      actionIndex >= player.bets[street].length
    )
      return false;
    if (
      action === "check" &&
      ((player.bets[street][actionIndex] ?? 0) > 0 ||
        !canPlayerCheck(hand, playerId, street, actionIndex))
    )
      return false;
    const automaticBlind =
      street === "preflop" &&
      actionIndex === 0 &&
      (playerId === hand.roles?.smallBlind ||
        playerId === hand.roles?.bigBlind);
    if (automaticBlind && action !== player.actions[street][actionIndex])
      return false;
    if (player.actions[street][actionIndex] !== action && action === "check")
      recordHandEvent(
        hand,
        `${playerName(playerId)}: чек, ${street}, действие ${actionIndex + 1}`,
      );
    player.actions[street][actionIndex] = action;
    return true;
  };

  const addHandBetActionColumn = (
    tournament: Tournament,
    street: HandStreet,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    if (!hand || hand.settled) return false;
    for (const player of Object.values(hand.players)) {
      player.bets[street].push(0);
      player.actions[street].push(null);
    }
    return true;
  };

  const setHandFolded = (
    tournament: Tournament,
    playerId: string,
    folded: boolean,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    const player = hand?.players[playerId];
    if (!hand || !player) return false;
    if (
      folded &&
      !Object.entries(hand.players).some(
        ([id, other]) => id !== playerId && !other.folded,
      )
    )
      return false;

    player.folded = folded;
    player.foldedOn = folded ? hand.street : null;
    delete hand.potWinners;
    recordHandEvent(
      hand,
      `${playerName(playerId)}: ${folded ? "фолд" : "отмена фолда"}, ${hand.street}`,
    );
    if (folded) {
      player.takesPot = false;
      const currentStreetIndex = ["preflop", "flop", "turn", "river"].indexOf(
        hand.street,
      );
      for (const street of ["preflop", "flop", "turn", "river"].slice(
        currentStreetIndex + 1,
      ) as HandStreet[]) {
        player.bets[street].fill(0);
        player.actions[street].fill(null);
      }
    }
    return true;
  };

  const setHandWinner = (
    tournament: Tournament,
    playerId: string,
    takesPot: boolean,
  ): void => {
    const hand = getCurrentHand(tournament);
    const player = hand?.players[playerId];
    if (!hand || !player || player.folded) return;
    player.takesPot = takesPot;
    delete hand.potWinners;
  };

  const setHandPotWinner = (
    tournament: Tournament,
    potId: string,
    playerId: string,
    selected: boolean,
  ): boolean => {
    const hand = getCurrentHand(tournament);
    if (!hand) return false;
    const pot = handDistribution(hand).pots.find((item) => item.id === potId);
    if (!pot || !pot.eligibleIds.includes(playerId)) return false;
    hand.potWinners ??= {};
    const winners = new Set(hand.potWinners[potId] ?? pot.winnerIds);
    if (selected) winners.add(playerId);
    else winners.delete(playerId);
    hand.potWinners[potId] = [...winners];
    recordHandEvent(
      hand,
      `${playerName(playerId)}: ${selected ? "выбран" : "снят"} победителем банка ${pot.amount}`,
    );
    return true;
  };

  const settleCurrentHand = (tournament: Tournament): boolean => {
    const hand = getCurrentHand(tournament);
    if (!hand || !canCloseHand(tournament, hand)) return false;
    const checkpoint = makeCheckpoint(
      tournament,
      "settlement",
      `Начисление банка раздачи №${hand.number}`,
    );
    if (!settlePokerHand(tournament, hand)) return false;
    pushCheckpoint(tournament, checkpoint);
    return true;
  };

  const canCloseHand = (tournament: Tournament, hand: PokerHand): boolean => {
    if (
      hand.settled ||
      streetActionRequirements(tournament, hand, hand.street).length > 0
    )
      return false;
    const contenders = Object.values(hand.players).filter(
      (player) => !player.folded,
    ).length;
    return contenders === 1 || (contenders > 1 && hand.street === "river");
  };

  const canPlayerRebuy = (
    tournament: Tournament,
    playerId: string,
    now = Date.now(),
  ): boolean => {
    if (!tournament.participantIds.includes(playerId)) return false;
    if (
      tournament.status !== "live" ||
      !tournament.gameInitialized ||
      getCurrentHand(tournament)
    )
      return false;
    if (
      tournament.places[playerId] != null ||
      (tournament.stacks[playerId] ?? 0) > 0
    )
      return false;
    if ((tournament.rebuys[playerId] ?? 0) >= tournament.maxRebuys)
      return false;
    return isBeforeKrasnoyarskCutoff(
      tournament.startedAt,
      tournament.rebuyUntil,
      now,
    );
  };

  const rebuyPlayer = (
    tournament: Tournament,
    playerId: string,
    now = Date.now(),
  ): boolean => {
    if (!canPlayerRebuy(tournament, playerId, now)) return false;
    pushCheckpoint(
      tournament,
      makeCheckpoint(tournament, "rebuy", `Докупка: ${playerName(playerId)}`),
    );
    tournament.stacks[playerId] = tournament.startingStack;
    tournament.rebuys[playerId] = (tournament.rebuys[playerId] ?? 0) + 1;
    return true;
  };

  const confirmPlayerElimination = (
    tournament: Tournament,
    playerId: string,
  ): boolean => {
    if (
      tournament.status !== "live" ||
      !tournament.gameInitialized ||
      getCurrentHand(tournament)
    )
      return false;
    if (
      (tournament.stacks[playerId] ?? 0) !== 0 ||
      tournament.places[playerId] != null
    )
      return false;

    const alive = tournament.participantIds.filter(
      (id) => tournament.places[id] == null,
    );
    if (alive.length < 2 || !alive.includes(playerId)) return false;
    const handNumber = tournament.hands.at(-1)?.number ?? 0;
    pushCheckpoint(
      tournament,
      makeCheckpoint(
        tournament,
        "elimination",
        `Вылет: ${playerName(playerId)}`,
      ),
    );
    const simultaneousPlayerId = tournament.participantIds.find(
      (id) =>
        id !== playerId &&
        tournament.eliminatedInHand[id] === handNumber &&
        tournament.places[id] != null,
    );
    tournament.places[playerId] = simultaneousPlayerId
      ? tournament.places[simultaneousPlayerId]!
      : alive.length;
    tournament.eliminatedInHand[playerId] = handNumber;

    const survivors = alive.filter((id) => id !== playerId);
    if (survivors.length === 1) {
      tournament.places[survivors[0]!] = 1;
      finishTournament(tournament, false);
    }
    return true;
  };

  const pauseTimer = (tournament: Tournament): void => {
    if (tournament.timerStartedAt === null) return;
    tournament.secondsRemaining = remainingMilliseconds(tournament) / 1000;
    tournament.timerStartedAt = null;
  };

  const nextLevel = (tournament: Tournament): boolean => {
    if (
      tournament.status !== "live" ||
      !tournament.gameInitialized ||
      tournament.currentLevel >= tournament.levels.length - 1
    )
      return false;
    const next = tournament.levels[tournament.currentLevel + 1]!;
    if (!Number.isInteger(next.minutes) || next.minutes <= 0) return false;
    const wasRunning = tournament.timerStartedAt !== null;
    tournament.currentLevel += 1;
    tournament.secondsRemaining = next.minutes * 60;
    tournament.timerStartedAt = wasRunning ? Date.now() : null;
    return true;
  };

  const finishTournament = (
    tournament: Tournament,
    saveCheckpoint = true,
  ): void => {
    if (
      !tournament.gameInitialized ||
      tournament.status === "finished" ||
      getCurrentHand(tournament)
    )
      return;
    if (saveCheckpoint)
      pushCheckpoint(
        tournament,
        makeCheckpoint(tournament, "finish", "Завершение турнира"),
      );
    const remaining = tournament.participantIds
      .filter((id) => tournament.places[id] == null)
      .sort(
        (left, right) =>
          (tournament.stacks[right] ?? 0) - (tournament.stacks[left] ?? 0),
      );
    let place = 1;
    for (let index = 0; index < remaining.length; index += 1) {
      const playerId = remaining[index]!;
      const previousId = remaining[index - 1];
      if (
        previousId &&
        tournament.stacks[previousId] === tournament.stacks[playerId]
      ) {
        tournament.places[playerId] = tournament.places[previousId]!;
      } else {
        tournament.places[playerId] = place;
      }
      place = index + 2;
    }
    tournament.status = "finished";
    pauseTimer(tournament);
  };

  const playerName = (id: string): string => {
    return state.players.find((player) => player.id === id)?.name ?? id;
  };

  const recordHandEvent = (hand: PokerHand, description: string): void => {
    hand.events ??= [];
    hand.events.push({ at: Date.now(), description });
  };

  const makeCheckpoint = (
    tournament: Tournament,
    kind: TournamentCheckpoint["kind"],
    label: string,
  ): TournamentCheckpoint => {
    return cloneValue({
      kind,
      label,
      at: Date.now(),
      handNumber: tournament.hands.at(-1)?.number ?? 0,
      status: tournament.status,
      stacks: tournament.stacks,
      rebuys: tournament.rebuys,
      places: tournament.places,
      eliminatedInHand: tournament.eliminatedInHand,
      secondsRemaining: remainingMilliseconds(tournament) / 1000,
      wasRunning: tournament.timerStartedAt !== null,
    });
  };

  const pushCheckpoint = (
    tournament: Tournament,
    checkpoint: TournamentCheckpoint,
  ): void => {
    tournament.operationHistory ??= [];
    tournament.operationHistory.push(checkpoint);
    tournament.operationHistory = tournament.operationHistory.slice(-20);
  };

  const canUndoLastOperation = (tournament: Tournament): boolean => {
    const checkpoint = tournament.operationHistory?.at(-1);
    return Boolean(
      checkpoint &&
      !getCurrentHand(tournament) &&
      checkpoint.handNumber === (tournament.hands.at(-1)?.number ?? 0),
    );
  };

  const undoLastOperation = (tournament: Tournament): boolean => {
    if (!canUndoLastOperation(tournament)) return false;
    const checkpoint = tournament.operationHistory!.pop()!;
    const wasFinished = tournament.status === "finished";
    for (const key of [
      "stacks",
      "rebuys",
      "places",
      "eliminatedInHand",
    ] as const)
      tournament[key] = cloneValue(checkpoint[key]);
    tournament.status = checkpoint.status;
    if (wasFinished) {
      tournament.secondsRemaining = checkpoint.secondsRemaining;
      tournament.timerStartedAt = checkpoint.wasRunning ? Date.now() : null;
    }
    if (checkpoint.kind === "settlement") {
      const hand = tournament.hands.at(-1)!;
      hand.settled = false;
      delete hand.settlement;
      delete hand.endedAt;
      recordHandEvent(hand, "Начисление банка отменено");
    }
    return true;
  };

  const cancelCurrentHand = (tournament: Tournament): boolean => {
    if (!getCurrentHand(tournament)) return false;
    tournament.hands.pop();
    return true;
  };

  return {
    findTournament,
    createTournament,
    toggleParticipant,
    removeParticipantFromTournament,
    moveParticipant,
    setInitialRole,
    addPlayer,
    playerHasHistory,
    removePlayerFromSeason,
    getCurrentHand,
    resetDemo,
    remainingMilliseconds,
    currentSeconds,
    startTimer,
    startNextHand,
    setHandStreet,
    setHandBet,
    setHandAction,
    addHandBetActionColumn,
    setHandFolded,
    setHandWinner,
    setHandPotWinner,
    settleCurrentHand,
    canCloseHand,
    canPlayerRebuy,
    rebuyPlayer,
    confirmPlayerElimination,
    pauseTimer,
    nextLevel,
    finishTournament,
    canUndoLastOperation,
    undoLastOperation,
    cancelCurrentHand,
  };
};
