import assert from "node:assert/strict";
import test from "node:test";
import {
  canPlayerCheck,
  createPokerHand,
  handActionPot,
  handDistribution,
  handPot,
  handStreetPot,
  isPlayerAllIn,
  isPlayerVisibleOnStreet,
  nextHandActionIndex,
  playerCashout,
  playerInvestment,
  playerNetBalance,
  postBlinds,
  projectedStack,
  rolesForHand,
  settlePokerHand,
  streetActionRequirements,
  tournamentPrizePool,
} from "../src/domain/game.ts";
import type { Tournament } from "../src/domain/types.ts";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "test",
    title: "Test",
    date: "2026-11-23",
    startTime: "18:00",
    status: "live",
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: "19:30",
    participantIds: ["a", "b"],
    initialDealerId: "a",
    rebuys: {},
    places: {},
    eliminatedInHand: {},
    gameInitialized: true,
    stacks: { a: 500, b: 500 },
    hands: [],
    levels: [],
    currentLevel: 0,
    secondsRemaining: 0,
    timerStartedAt: null,
    startedAt: Date.now(),
    ...overrides,
  };
}

test("rotates roles clockwise, skips eliminated seats, and handles heads-up play", () => {
  const seats = ["a", "b", "c", "d"];
  assert.deepEqual(rolesForHand(seats, seats, "b", false), {
    dealer: "b",
    smallBlind: "c",
    bigBlind: "d",
  });
  assert.deepEqual(rolesForHand(seats, ["a", "b", "d"], "b", true), {
    dealer: "d",
    smallBlind: "a",
    bigBlind: "b",
  });
  assert.deepEqual(rolesForHand(seats, ["a", "d"], "b", true), {
    dealer: "d",
    smallBlind: "d",
    bigBlind: "a",
  });
  assert.deepEqual(rolesForHand(seats, ["a", "d"], "d", true), {
    dealer: "a",
    smallBlind: "a",
    bigBlind: "d",
  });
  assert.equal(rolesForHand(seats, ["a"], "a", true), null);
});

test("posts small and big blinds as the first preflop contributions, capped by each stack", () => {
  const hand = createPokerHand(1, ["a", "b"], {
    dealer: "a",
    smallBlind: "a",
    bigBlind: "b",
  });
  postBlinds(hand, { small: 25, big: 50, minutes: 20 }, { a: 10, b: 500 });

  assert.equal(hand.players.a!.bets.preflop[0], 10);
  assert.equal(hand.players.b!.bets.preflop[0], 50);
  assert.equal(handPot(hand), 60);
});

test("keeps a folded player visible on the folding street and hides them on later streets", () => {
  const hand = createPokerHand(1, ["a", "b"]);
  const player = hand.players.a!;
  player.folded = true;
  player.foldedOn = "flop";

  assert.equal(isPlayerVisibleOnStreet(player, "preflop"), true);
  assert.equal(isPlayerVisibleOnStreet(player, "flop"), true);
  assert.equal(isPlayerVisibleOnStreet(player, "turn"), false);
  assert.equal(isPlayerVisibleOnStreet(player, "river"), false);
});

test("calculates a hand pot and projected stacks from all street contributions", () => {
  const game = tournament();
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.preflop[0] = 100;
  hand.players.a!.bets.flop[0] = 30;
  hand.players.a!.bets.flop[1] = 20;
  hand.players.b!.bets.preflop[0] = 100;
  hand.players.b!.bets.turn[0] = 25;

  assert.equal(handPot(hand), 275);
  assert.equal(handStreetPot(hand, "flop"), 50);
  assert.equal(handActionPot(hand, "flop", 0), 30);
  assert.equal(handActionPot(hand, "flop", 1), 20);
  assert.equal(projectedStack(game, hand, "a"), 350);
  assert.equal(projectedStack(game, hand, "b"), 375);
});

test("recognizes all-in when a player has contributed their full stack during the hand", () => {
  const game = tournament({ stacks: { a: 500, b: 500 } });
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.preflop[0] = 300;
  hand.players.a!.bets.flop[0] = 200;

  assert.equal(projectedStack(game, hand, "a"), 0);
  assert.equal(isPlayerAllIn(game, hand, "a"), true);
  assert.equal(isPlayerAllIn(game, hand, "b"), false);
  hand.street = "turn";
  assert.equal(isPlayerAllIn(game, hand, "a"), true);
});

test("quick all-in uses the next action column after the last recorded contribution", () => {
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.preflop[0] = 25;
  hand.players.b!.bets.preflop[0] = 50;
  hand.players.b!.bets.preflop[1] = 100;

  assert.equal(nextHandActionIndex(hand, "preflop"), 2);
  assert.equal(nextHandActionIndex(hand, "flop"), 0);
});

test("settles the pot into stacks and refuses to settle it twice", () => {
  const game = tournament();
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.preflop[0] = 100;
  hand.players.b!.bets.preflop[0] = 100;
  hand.players.b!.takesPot = true;

  assert.equal(settlePokerHand(game, hand), true);
  assert.deepEqual(game.stacks, { a: 400, b: 600 });
  assert.equal(hand.settled, true);
  assert.equal(settlePokerHand(game, hand), false);
  assert.deepEqual(game.stacks, { a: 400, b: 600 });
});

test("returns unmatched chips before splitting the matched pot", () => {
  const game = tournament({ stacks: { a: 1000, b: 1000 } });
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.river[0] = 30;
  hand.players.a!.bets.river[1] = 21;
  hand.players.b!.bets.river[0] = 50;
  hand.players.a!.takesPot = true;
  hand.players.b!.takesPot = true;

  assert.equal(settlePokerHand(game, hand), true);
  assert.deepEqual(game.stacks, { a: 1000, b: 1000 });
});

test("awards separate main and side pots and rejects missing side-pot winners atomically", () => {
  const game = tournament({
    participantIds: ["a", "b", "c"],
    stacks: { a: 100, b: 500, c: 500 },
  });
  const hand = createPokerHand(1, game.participantIds);
  for (const id of game.participantIds)
    hand.players[id]!.bets.preflop[0] = game.stacks[id]!;
  hand.players.a!.takesPot = true;
  assert.equal(settlePokerHand(game, hand), false);
  assert.deepEqual(game.stacks, { a: 100, b: 500, c: 500 });
  hand.potWinners = { "100": ["a"], "500": ["b"] };
  assert.equal(settlePokerHand(game, hand), true);
  assert.deepEqual(game.stacks, { a: 300, b: 800, c: 0 });
  assert.deepEqual(hand.settlement, {
    awards: { a: 300, b: 800 },
    refunds: {},
  });
});

test("refunds an uncalled bet even when the shorter player wins the showdown", () => {
  const game = tournament({ stacks: { a: 100, b: 500 } });
  const hand = createPokerHand(1, ["a", "b"]);
  hand.players.a!.bets.preflop[0] = 100;
  hand.players.b!.bets.preflop[0] = 500;
  hand.players.a!.takesPot = true;
  assert.equal(settlePokerHand(game, hand), true);
  assert.deepEqual(game.stacks, { a: 200, b: 400 });
  assert.equal(hand.players.b!.takesPot, false, "a refund is not a hand win");
});

test("dead contributions do not force redundant pots and odd chips start left of the dealer", () => {
  const game = tournament({
    participantIds: ["a", "b", "c", "d"],
    stacks: { a: 500, b: 500, c: 500, d: 500 },
  });
  const hand = createPokerHand(1, game.participantIds, {
    dealer: "a",
    smallBlind: "b",
    bigBlind: "c",
  });
  for (const id of ["a", "b"]) {
    hand.players[id]!.bets.river[0] = 50;
    hand.players[id]!.takesPot = true;
  }
  hand.players.c!.bets.river[0] = 25;
  hand.players.c!.folded = true;
  hand.players.d!.bets.river[0] = 10;
  hand.players.d!.folded = true;
  assert.equal(handDistribution(hand).pots.length, 1);
  assert.equal(settlePokerHand(game, hand), true);
  assert.equal(game.stacks.a, 517);
  assert.equal(game.stacks.b, 518);
});

test("short big blind does not reduce a full call, but a sole covering player need not overcall", () => {
  const game = tournament({
    participantIds: ["a", "b", "c"],
    stacks: { a: 1000, b: 1000, c: 10 },
  });
  const hand = createPokerHand(1, game.participantIds, {
    dealer: "a",
    smallBlind: "b",
    bigBlind: "c",
  });
  postBlinds(hand, { small: 25, big: 50, minutes: 30 }, game.stacks);
  hand.players.a!.bets.preflop[0] = 25;
  hand.players.a!.actions.preflop[0] = "call";
  hand.players.b!.actions.preflop[1] = "check";
  assert.deepEqual(
    streetActionRequirements(game, hand, "preflop").map(
      ({ amountOwed }) => amountOwed,
    ),
    [25, 25],
  );
  assert.equal(canPlayerCheck(hand, "b", "preflop", 1), false);
  hand.players.a!.folded = true;
  assert.deepEqual(streetActionRequirements(game, hand, "preflop"), []);
});

test("rejects a pot without a winner or any contribution larger than a stack without partial changes", () => {
  const game = tournament();
  const noWinner = createPokerHand(1, ["a", "b"]);
  noWinner.players.a!.bets.preflop[0] = 100;
  noWinner.players.b!.bets.preflop[0] = 100;
  assert.equal(settlePokerHand(game, noWinner), false);
  assert.deepEqual(game.stacks, { a: 500, b: 500 });

  const overBet = createPokerHand(2, ["a", "b"]);
  overBet.players.a!.bets.preflop[0] = 600;
  overBet.players.a!.takesPot = true;
  assert.equal(settlePokerHand(game, overBet), false);
  assert.deepEqual(game.stacks, { a: 500, b: 500 });
});

test("calculates player payouts and balances proportionally to chips and contributions", () => {
  const game = tournament({
    participantIds: ["a", "b"],
    rebuyCost: 100,
    rebuys: { a: 1 },
    stacks: { a: 3500, b: 1000 },
  });

  assert.equal(playerInvestment(game, "a"), 400);
  assert.equal(playerInvestment(game, "b"), 300);
  assert.equal(tournamentPrizePool(game), 700);
  assert.equal(
    playerCashout(game, "a") + playerCashout(game, "b"),
    tournamentPrizePool(game),
  );
  assert.ok(Math.abs(playerNetBalance(game, "a") - 144.4444444444) < 1e-8);
  assert.ok(Math.abs(playerNetBalance(game, "b") + 144.4444444444) < 1e-8);
});
