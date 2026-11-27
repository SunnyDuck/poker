import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createPinia } from "pinia";

const require = createRequire(import.meta.url);
const {
  Spreadsheet,
  createContext,
} = require("./support/apps-script-harness.cjs");

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function storedJson(storage, key) {
  const value = storage.getItem(key);
  assert.ok(value, `Expected localStorage to contain ${key}`);
  return JSON.parse(value);
}

function totalChips(tournament) {
  return Object.values(tournament.stacks).reduce(
    (total, stack) => total + stack,
    0,
  );
}

test("runs a seeded six-player tournament and restores every hand from local and Sheets storage", async () => {
  const localValues = new Map();
  const localStorage = {
    getItem: (key) => localValues.get(key) ?? null,
    setItem: (key, value) => localValues.set(key, String(value)),
    removeItem: (key) => localValues.delete(key),
  };
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  globalThis.window = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
  };

  const server = await createServer({
    configFile: false,
    clearScreen: false,
    logLevel: "silent",
    plugins: [],
    resolve: { alias: { "@": resolve(process.cwd(), "src") } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });

  try {
    const pokerModule = await server.ssrLoadModule("/src/stores/poker.ts");
    const store = pokerModule.usePokerStore(createPinia());
    const gameMath = await server.ssrLoadModule("/src/domain/game.ts");
    const rating = await server.ssrLoadModule("/src/domain/rating.ts");
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `test-player-${index + 1}`,
      name: `Игрок ${index + 1}`,
    }));
    const playerIds = players.map(({ id }) => id);
    store.state.players.splice(0, store.state.players.length, ...players);
    store.state.tournaments.splice(0, store.state.tournaments.length);

    const createdTournament = store.createTournament();
    const tournament = store.findTournament(createdTournament.id);
    assert.ok(tournament);
    Object.assign(tournament, {
      id: "six-player-simulation",
      title: "Тестовая партия на шесть игроков",
      date: "2026-11-24",
      startTime: "18:00",
      buyIn: 300,
      startingStack: 1200,
      rebuyCost: 300,
      maxRebuys: 1,
      rebuyUntil: "19:30",
      participantIds: [...playerIds],
      initialDealerId: null,
      rebuys: {},
      places: {},
      eliminatedInHand: {},
      gameInitialized: false,
      stacks: {},
      hands: [],
      levels: [{ small: 25, big: 50, minutes: 30 }],
      currentLevel: 0,
      secondsRemaining: 1800,
      timerStartedAt: null,
      startedAt: Date.parse("2026-11-24T11:00:00.000Z"),
    });

    const testNow = Date.parse("2026-11-24T12:00:00.000Z"); // 19:00 in Krasnoyarsk, before the rebuy cutoff.
    const random = seededRandom(0x5eed1234);
    const expectedInitialChips = players.length * tournament.startingStack;
    let expectedChips = expectedInitialChips;

    store.setInitialRole(tournament, playerIds[2], "smallBlind");
    assert.equal(tournament.initialDealerId, playerIds[1]);
    assert.deepEqual(
      gameMath.rolesForHand(
        playerIds,
        playerIds,
        tournament.initialDealerId,
        false,
      ),
      {
        dealer: playerIds[1],
        smallBlind: playerIds[2],
        bigBlind: playerIds[3],
      },
    );
    store.startTimer(tournament);
    assert.equal(tournament.status, "live");
    assert.equal(totalChips(tournament), expectedInitialChips);

    const bettingGateHand = gameMath.createPokerHand(1, [
      "gate-a",
      "gate-b",
      "gate-short",
    ]);
    bettingGateHand.street = "flop";
    bettingGateHand.players["gate-a"].bets.flop[0] = 350;
    bettingGateHand.players["gate-a"].actions.flop[0] = "bet";
    bettingGateHand.players["gate-short"].bets.flop[0] = 200;
    bettingGateHand.players["gate-short"].actions.flop[0] = "all-in";
    const bettingGateTournament = {
      ...tournament,
      stacks: { "gate-a": 1000, "gate-b": 1000, "gate-short": 200 },
      hands: [bettingGateHand],
    };
    assert.equal(
      store.setHandStreet(bettingGateTournament, "turn"),
      false,
      "an unmatched 350 bet must block the next street even when another player is all-in short",
    );
    assert.equal(bettingGateHand.street, "flop");
    bettingGateHand.players["gate-b"].folded = true;
    assert.equal(
      store.setHandStreet(bettingGateTournament, "turn"),
      true,
      "folding or being all-in removes a player from the call requirement",
    );

    const callGateHand = gameMath.createPokerHand(2, [
      "gate-a",
      "gate-b",
      "gate-short",
    ]);
    callGateHand.street = "flop";
    callGateHand.players["gate-a"].bets.flop[0] = 350;
    callGateHand.players["gate-a"].actions.flop[0] = "bet";
    callGateHand.players["gate-b"].bets.flop[0] = 350;
    callGateHand.players["gate-b"].actions.flop[0] = "call";
    callGateHand.players["gate-short"].bets.flop[0] = 200;
    callGateHand.players["gate-short"].actions.flop[0] = "all-in";
    assert.equal(
      store.setHandStreet(
        {
          ...tournament,
          stacks: { "gate-a": 1000, "gate-b": 1000, "gate-short": 200 },
          hands: [callGateHand],
        },
        "turn",
      ),
      true,
      "matched active bets may advance while a short all-in remains in the hand",
    );

    function playRandomHand() {
      assert.equal(store.startNextHand(tournament), true);
      const hand = store.getCurrentHand(tournament);
      assert.ok(hand);
      const activeIds = Object.keys(hand.players);
      assert.equal(
        store.startNextHand(tournament),
        false,
        "a second hand cannot start before the current one settles",
      );
      if (hand.number === 1) {
        assert.equal(
          hand.players[playerIds[2]].bets.preflop[0],
          25,
          "the small blind should be posted automatically",
        );
        assert.equal(
          hand.players[playerIds[3]].bets.preflop[0],
          50,
          "the big blind should be posted automatically",
        );
      }
      if (hand.number === 1) {
        assert.equal(gameMath.handActionCount(hand, "preflop"), 3);
        assert.equal(store.addHandBetActionColumn(tournament, "preflop"), true);
        assert.equal(gameMath.handActionCount(hand, "preflop"), 4);
        assert.equal(
          store.setHandBet(tournament, activeIds[0], "preflop", 3, 5),
          true,
        );
      }

      for (const street of ["preflop", "flop", "turn", "river"]) {
        // This seeded fixture writes all four streets directly; street-transition rules are covered above.
        hand.street = street;
        if (street === "flop" && activeIds.length > 2) {
          let foldedCount = 0;
          for (const playerId of activeIds) {
            if (random() < 0.25) {
              store.setHandFolded(tournament, playerId, true);
              foldedCount += 1;
            }
          }
          if (foldedCount === activeIds.length)
            store.setHandFolded(tournament, activeIds[0], false);
          if (foldedCount === 0)
            store.setHandFolded(tournament, activeIds.at(-1), true);
          store.setHandFolded(tournament, playerIds[0], false);
        }

        for (let actionIndex = 0; actionIndex < 3; actionIndex += 1) {
          for (const playerId of activeIds) {
            if (hand.players[playerId].folded) continue;
            if (
              street === "preflop" &&
              actionIndex === 0 &&
              [hand.roles.smallBlind, hand.roles.bigBlind].includes(playerId)
            )
              continue;
            const alreadyBet = gameMath.playerHandContribution(
              hand.players[playerId],
            );
            const available = Math.max(
              0,
              tournament.stacks[playerId] - alreadyBet,
            );
            const proposed =
              street === "preflop"
                ? 10 + Math.floor(random() * 21)
                : Math.floor(random() * 16);
            assert.equal(
              store.setHandBet(
                tournament,
                playerId,
                street,
                actionIndex,
                Math.min(available, proposed),
              ),
              true,
            );
          }
        }
      }

      const contenders = activeIds.filter(
        (playerId) => !hand.players[playerId].folded,
      );
      assert.ok(contenders.length > 0);
      const firstWinner = contenders.includes(playerIds[0])
        ? playerIds[0]
        : contenders[Math.floor(random() * contenders.length)];
      store.setHandWinner(tournament, firstWinner, true);
      if (contenders.length > 1 && random() < 0.2) {
        const secondWinner = contenders.find(
          (playerId) => playerId !== firstWinner,
        );
        store.setHandWinner(tournament, secondWinner, true);
      }
      const chipsBeforeSettlement = totalChips(tournament);
      for (const pot of gameMath.handDistribution(hand).pots) {
        if (!pot.winnerIds.length)
          store.setHandPotWinner(tournament, pot.id, pot.eligibleIds[0], true);
      }
      assert.equal(gameMath.settlePokerHand(tournament, hand), true);
      assert.equal(hand.settled, true);
      assert.equal(
        totalChips(tournament),
        chipsBeforeSettlement,
        "settling a hand must conserve chips",
      );
      assert.ok(
        Object.values(hand.players).some((player) => player.folded),
        "randomized hands should include at least one fold",
      );
      for (const player of Object.values(hand.players).filter(
        (item) => item.folded,
      )) {
        assert.equal(player.foldedOn, "flop", "fold street should be recorded");
        assert.equal(
          gameMath.isPlayerVisibleOnStreet(player, "flop"),
          true,
          "keep the player visible on the street they folded",
        );
        assert.equal(
          gameMath.isPlayerVisibleOnStreet(player, "turn"),
          false,
          "hide the player from the next and later streets",
        );
      }
      return hand;
    }

    function playKnockoutHand(loserId, winnerId) {
      assert.ok((tournament.stacks[loserId] ?? 0) > 0);
      assert.ok((tournament.stacks[winnerId] ?? 0) > 0);
      assert.equal(store.startNextHand(tournament), true);
      const hand = store.getCurrentHand(tournament);
      assert.ok(hand);
      hand.street = "preflop";
      assert.ok(
        tournament.stacks[winnerId] >= tournament.stacks[loserId],
        "the covering player must match the knockout stake",
      );
      const knockoutStake = tournament.stacks[loserId];
      for (const playerId of Object.keys(hand.players)) {
        if (![loserId, winnerId].includes(playerId)) {
          store.setHandFolded(tournament, playerId, true);
          continue;
        }
        const stack = tournament.stacks[playerId];
        const alreadyBet = gameMath.playerHandContribution(
          hand.players[playerId],
        );
        const available = Math.max(0, stack - alreadyBet);
        const amount =
          playerId === loserId
            ? available
            : Math.max(0, knockoutStake - alreadyBet);
        assert.equal(
          store.setHandBet(tournament, playerId, "preflop", 1, amount),
          true,
        );
      }
      store.setHandWinner(tournament, winnerId, true);
      const chipsBeforeSettlement = totalChips(tournament);
      assert.equal(gameMath.settlePokerHand(tournament, hand), true);
      assert.equal(totalChips(tournament), chipsBeforeSettlement);
      assert.equal(tournament.stacks[loserId], 0);
      assert.equal(
        store.startNextHand(tournament),
        false,
        "a zero-stack player must be rebought or confirmed out",
      );
      return hand;
    }

    const roleHistory = [];
    const randomHands = [playRandomHand(), playRandomHand()];
    roleHistory.push(...randomHands.map((hand) => hand.roles));

    const firstBust = playKnockoutHand(playerIds[5], playerIds[0]);
    roleHistory.push(firstBust.roles);
    assert.equal(store.canPlayerRebuy(tournament, playerIds[5], testNow), true);
    assert.equal(
      store.canPlayerRebuy(
        tournament,
        playerIds[5],
        Date.parse("2026-11-24T12:31:00.000Z"),
      ),
      false,
    );
    assert.equal(store.rebuyPlayer(tournament, playerIds[5], testNow), true);
    expectedChips += tournament.startingStack;
    assert.equal(tournament.rebuys[playerIds[5]], 1);
    assert.equal(tournament.stacks[playerIds[5]], tournament.startingStack);
    assert.equal(totalChips(tournament), expectedChips);

    const postRebuyHands = [playRandomHand(), playRandomHand()];
    roleHistory.push(...postRebuyHands.map((hand) => hand.roles));
    const secondBust = playKnockoutHand(playerIds[5], playerIds[0]);
    roleHistory.push(secondBust.roles);
    assert.equal(
      store.canPlayerRebuy(tournament, playerIds[5], testNow),
      false,
      "the rebuy limit is one",
    );
    assert.equal(store.rebuyPlayer(tournament, playerIds[5], testNow), false);
    assert.equal(
      store.confirmPlayerElimination(tournament, playerIds[5]),
      true,
    );
    assert.equal(tournament.places[playerIds[5]], 6);

    for (const [loserId, winnerId, expectedPlace] of [
      [playerIds[4], playerIds[0], 5],
      [playerIds[3], playerIds[0], 4],
      [playerIds[2], playerIds[0], 3],
      [playerIds[1], playerIds[0], 2],
    ]) {
      const hand = playKnockoutHand(loserId, winnerId);
      roleHistory.push(hand.roles);
      assert.equal(store.confirmPlayerElimination(tournament, loserId), true);
      assert.equal(tournament.places[loserId], expectedPlace);
    }

    assert.equal(tournament.status, "finished");
    assert.equal(tournament.places[playerIds[0]], 1);
    assert.equal(tournament.hands.length, 10);
    assert.equal(tournament.rebuys[playerIds[5]], 1);
    assert.equal(totalChips(tournament), expectedChips);
    assert.ok(tournament.hands.every((hand) => hand.settled && hand.roles));

    for (let index = 0; index < tournament.hands.length; index += 1) {
      const hand = tournament.hands[index];
      const activeIds = Object.keys(hand.players);
      const previousDealer =
        index === 0
          ? tournament.initialDealerId
          : tournament.hands[index - 1].roles.dealer;
      const expectedRoles = gameMath.rolesForHand(
        tournament.participantIds,
        activeIds,
        previousDealer,
        index > 0,
      );
      assert.deepEqual(
        hand.roles,
        expectedRoles,
        `hand ${hand.number} should rotate roles and skip eliminated seats`,
      );
      if (activeIds.length === 2) {
        assert.equal(
          hand.roles.dealer,
          hand.roles.smallBlind,
          "heads-up dealer is the small blind",
        );
        assert.notEqual(hand.roles.bigBlind, hand.roles.dealer);
      } else {
        assert.equal(
          new Set(Object.values(hand.roles)).size,
          3,
          `hand ${hand.number} should have three distinct roles`,
        );
      }
    }

    const prizePool = gameMath.tournamentPrizePool(tournament);
    const cashouts = playerIds.map((playerId) =>
      gameMath.playerCashout(tournament, playerId),
    );
    assert.ok(
      Math.abs(cashouts.reduce((sum, value) => sum + value, 0) - prizePool) <
        1e-8,
    );
    assert.ok(
      Math.abs(
        playerIds.reduce(
          (sum, playerId) =>
            sum + gameMath.playerNetBalance(tournament, playerId),
          0,
        ),
      ) < 1e-8,
    );

    const savedBrowserState = storedJson(
      localStorage,
      "friendly-poker-demo-v1",
    );
    const savedTournament = savedBrowserState.tournaments.find(
      ({ id }) => id === tournament.id,
    );
    assert.deepEqual(savedTournament, JSON.parse(JSON.stringify(tournament)));
    assert.equal(savedTournament.hands.length, 10);
    assert.ok(
      Array.isArray(savedTournament.hands[0].players[playerIds[0]].bets.river),
    );

    const sheets = new Spreadsheet();
    const scripts = createContext({
      spreadsheet: sheets,
      adminKey: "simulation-test-key",
    });
    const writeResponse = JSON.parse(
      scripts
        .doPost({
          parameter: {
            action: "write",
            adminKey: "simulation-test-key",
            payload: JSON.stringify(savedBrowserState),
          },
        })
        .getContent(),
    );
    assert.deepEqual(
      writeResponse,
      { ok: true, revision: 1 },
      "Apps Script write should accept the full state and increment its revision",
    );
    const readResponse = JSON.parse(
      scripts.doGet({ parameter: { action: "read" } }).getContent(),
    );
    assert.equal(readResponse.apiVersion, 6);
    assert.equal(readResponse.revision, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(readResponse.state)),
      savedBrowserState,
      "Google Sheets read should restore every player, hand and tournament field",
    );
    const handRowCount = tournament.hands.reduce(
      (total, hand) => total + Object.keys(hand.players).length,
      0,
    );
    const tournamentSheet = sheets.getSheetByName(tournament.title);
    assert.ok(tournamentSheet);
    assert.equal(
      tournamentSheet.getRange(18, 17, handRowCount, 17).getValues().length,
      handRowCount,
    );
    assert.ok(roleHistory.every(Boolean));

    const tieTournament = store.createTournament();
    Object.assign(tieTournament, {
      id: "simultaneous-elimination-test",
      status: "live",
      participantIds: ["tie-a", "tie-b", "tie-c", "tie-d"],
      rebuys: { "tie-a": 0, "tie-b": 0, "tie-c": 0, "tie-d": 0 },
      places: {},
      eliminatedInHand: {},
      gameInitialized: true,
      stacks: { "tie-a": 0, "tie-b": 0, "tie-c": 100, "tie-d": 100 },
      hands: [
        {
          number: 7,
          street: "river",
          players: {},
          settled: true,
          roles: null,
          startingStacks: {
            "tie-a": 100,
            "tie-b": 100,
            "tie-c": 200,
            "tie-d": 200,
          },
        },
      ],
    });
    assert.equal(store.confirmPlayerElimination(tieTournament, "tie-a"), true);
    assert.equal(store.confirmPlayerElimination(tieTournament, "tie-b"), true);
    assert.equal(tieTournament.places["tie-a"], 3);
    assert.equal(tieTournament.places["tie-b"], 3);
    assert.equal(rating.tournamentPoints(tieTournament, "tie-a"), 5);
    assert.equal(rating.tournamentPoints(tieTournament, "tie-b"), 5);
    assert.equal(rating.placePoints(3), 5);
    assert.equal(
      rating.tournamentPoints(tieTournament, "tie-b"),
      rating.placePoints(3),
    );
    assert.equal(
      Object.values(tieTournament.places).includes(4),
      false,
      "fourth place is skipped when two players tie for third",
    );

    if (process.env.WRITE_SIMULATION_HISTORY === "1") {
      const historyPath = resolve(
        process.cwd(),
        "tests/fixtures/six-player-tournament-history.json",
      );
      mkdirSync(resolve(process.cwd(), "tests/fixtures"), { recursive: true });
      writeFileSync(
        historyPath,
        `${JSON.stringify(
          {
            simulation: {
              title: "Детерминированная тестовая игра на шесть участников",
              seed: "0x5eed1234",
              handCount: tournament.hands.length,
              rebuy: {
                playerId: playerIds[5],
                count: tournament.rebuys[playerIds[5]],
              },
              prizePool,
              totalChips: totalChips(tournament),
              storageRoundTrip: [
                "localStorage",
                "Google Apps Script / Google Sheets mock",
              ],
            },
            players,
            tournament: JSON.parse(JSON.stringify(tournament)),
          },
          null,
          2,
        )}\n`,
      );
    }
  } finally {
    await server.close();
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.window;
  }
});
