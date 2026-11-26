import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { createPinia } from "pinia";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const {
  Spreadsheet,
  createContext,
} = require("./support/apps-script-harness.cjs");

test("tournament regressions and a full eight-player game", async (testContext) => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
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
    envDir: false,
    logLevel: "silent",
    plugins: [],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  const originalNow = Date.now;
  let now = Date.parse("2026-11-26T11:00:00.900Z");
  Date.now = () => now;
  try {
    const pokerModule = await server.ssrLoadModule("/src/stores/poker.ts");
    const s = pokerModule.usePokerStore(createPinia());
    const g = await server.ssrLoadModule("/src/domain/game.ts");
    const time = await server.ssrLoadModule("/src/domain/time.ts");
    const validation = await server.ssrLoadModule("/src/domain/validation.ts");
    const ids = s.state.players.slice(0, 8).map((player) => player.id);
    function makeGame(count = 8) {
      const created = s.createTournament();
      const t = s.findTournament(created.id);
      Object.assign(t, {
        title: "Regression game",
        date: "2026-11-26",
        startTime: "18:00",
        buyIn: 500,
        rebuyCost: 500,
        startingStack: 2000,
        maxRebuys: 1,
        rebuyUntil: "23:59",
        participantIds: ids.slice(0, count),
        initialDealerId: ids[0],
      });
      return t;
    }

    await testContext.test(
      "validates all settings before any start mutation, and safely formats old invalid dates",
      () => {
        for (const overrides of [
          { title: "" },
          { date: "" },
          { date: "2026-02-30" },
          { startTime: "25:00" },
          { startingStack: -10 },
          { startingStack: 1.5 },
          { startingStack: "" },
          { buyIn: -1 },
          { buyIn: NaN },
          { maxRebuys: 6 },
          { maxRebuys: 0.5 },
          { levels: [] },
          { levels: [{ small: 0, big: 0, minutes: 10, break: true }] },
          { levels: [{ small: 100, big: 50, minutes: 10 }] },
          { levels: [{ small: 25, big: 50, minutes: 0 }] },
        ]) {
          const t = makeGame();
          Object.assign(t, overrides);
          assert.ok(validation.tournamentSettingsErrors(t).length);
          assert.equal(s.startTimer(t), false);
          assert.equal(t.status, "upcoming");
          assert.equal(t.gameInitialized, false);
          assert.deepEqual(t.stacks, {});
        }
        assert.equal(time.formatTournamentDate(""), "Дата не задана");
        assert.equal(time.formatTournamentDate("2026-02-30"), "Дата не задана");
        const a = makeGame(),
          b = makeGame();
        assert.notEqual(a.id, b.id);
        assert.equal(a.levels.length, 12);
        a.levels[0].minutes = 1;
        assert.equal(b.levels[0].minutes, 45);
      },
    );

    await testContext.test(
      "keeps millisecond precision through pauses, reload and manual level switches",
      () => {
        const t = makeGame(2);
        t.levels = [
          { small: 25, big: 50, minutes: 1 },
          { small: 50, big: 100, minutes: 2 },
          { small: 75, big: 150, minutes: 3 },
        ];
        for (let i = 0; i < 10; i++) {
          assert.equal(s.startTimer(t), true);
          now += 200;
          s.pauseTimer(t);
          now += 800;
        }
        assert.equal(s.remainingMilliseconds(t), 58000);
        assert.equal(s.currentSeconds(t), 58);
        s.startTimer(t);
        now += 123;
        const reloaded = JSON.parse(JSON.stringify(t));
        assert.equal(s.remainingMilliseconds(reloaded), 57877);
        s.pauseTimer(reloaded);
        now += 10000;
        assert.equal(s.remainingMilliseconds(reloaded), 57877);
        s.startTimer(reloaded);
        now += 77;
        assert.equal(s.remainingMilliseconds(reloaded), 57800);
        assert.equal(s.nextLevel(reloaded), true);
        assert.equal(s.currentSeconds(reloaded), 120);
        assert.notEqual(reloaded.timerStartedAt, null);
        now += 1000;
        assert.equal(s.currentSeconds(reloaded), 119);
        s.pauseTimer(reloaded);
        assert.equal(s.nextLevel(reloaded), true);
        assert.equal(reloaded.timerStartedAt, null);
        assert.equal(s.currentSeconds(reloaded), 180);
        s.startTimer(reloaded);
        now += 300;
        const unchanged = JSON.stringify(reloaded);
        assert.equal(s.nextLevel(reloaded), false);
        assert.equal(JSON.stringify(reloaded), unchanged);
        now += 180000;
        assert.equal(s.currentSeconds(reloaded), 0);
        assert.equal(
          reloaded.currentLevel,
          2,
          "expiry never changes blinds automatically",
        );
      },
    );

    await testContext.test(
      "keeps a paused clock frozen and resets only the manually selected level",
      () => {
        const t = makeGame(2);
        t.levels = [
          { small: 25, big: 50, minutes: 1 },
          { small: 50, big: 100, minutes: 2 },
          { small: 75, big: 150, minutes: 3 },
        ];
        assert.equal(s.startTimer(t), true);
        now += 1234;
        assert.equal(s.remainingMilliseconds(t), 58766);

        s.pauseTimer(t);
        const pausedAt = s.remainingMilliseconds(t);
        now += 45000;
        assert.equal(s.remainingMilliseconds(t), pausedAt);
        assert.equal(s.nextLevel(t), true);
        assert.equal(
          t.timerStartedAt,
          null,
          "a paused tournament stays paused after a manual level change",
        );
        assert.equal(s.remainingMilliseconds(t), 120000);

        assert.equal(s.startTimer(t), true);
        now += 1;
        assert.equal(s.remainingMilliseconds(t), 119999);
        now += 120000;
        assert.equal(s.currentSeconds(t), 0);
        assert.equal(
          t.currentLevel,
          1,
          "an expired timer does not advance the level on its own",
        );
        assert.equal(s.nextLevel(t), true);
        assert.equal(t.currentLevel, 2);
        assert.equal(t.timerStartedAt, now);
        assert.equal(s.currentSeconds(t), 180);
      },
    );

    await testContext.test(
      "blocks deletion and roster edits after a game starts, including settled games",
      () => {
        const t = makeGame();
        assert.equal(s.startTimer(t), true);
        assert.equal(s.startNextHand(t), true);
        const before = JSON.stringify(t);
        assert.equal(s.removePlayerFromSeason(ids[1]), false);
        s.removeParticipantFromTournament(t, ids[1]);
        s.toggleParticipant(t, ids[1]);
        assert.equal(JSON.stringify(t), before);
        assert.equal(s.cancelCurrentHand(t), true);
        s.finishTournament(t);
        assert.equal(s.removePlayerFromSeason(ids[1]), false);
      },
    );

    await testContext.test(
      "blocks new hands on breaks and latches the blind for a hand already in play",
      () => {
        const t = makeGame();
        s.startTimer(t);
        s.startNextHand(t);
        const h = s.getCurrentHand(t);
        assert.equal(h.bigBlind, 50);
        s.nextLevel(t);
        assert.equal(h.bigBlind, 50);
        s.cancelCurrentHand(t);
        s.nextLevel(t);
        assert.equal(t.levels[t.currentLevel].break, true);
        assert.equal(s.startNextHand(t), false);
        s.nextLevel(t);
        assert.equal(s.startNextHand(t), true);
        assert.equal(s.getCurrentHand(t).bigBlind, 150);
      },
    );

    function knockout(t, loserId, winnerId = ids[0]) {
      assert.equal(s.startNextHand(t), true);
      const h = s.getCurrentHand(t);
      const stake = t.stacks[loserId];
      assert.ok(t.stacks[winnerId] >= stake);
      for (const id of Object.keys(h.players))
        if (![winnerId, loserId].includes(id))
          assert.equal(s.setHandFolded(t, id, true), true);
      for (const id of [loserId, winnerId]) {
        const delta = Math.max(
          0,
          stake - g.playerHandContribution(h.players[id]),
        );
        if (delta) assert.equal(s.setHandBet(t, id, "preflop", 1, delta), true);
      }
      s.setHandWinner(t, winnerId, true);
      assert.equal(
        s.settleCurrentHand(t),
        false,
        "multi-player showdown cannot settle on preflop",
      );
      assert.equal(s.setHandStreet(t, "river"), true);
      now += 45000;
      assert.equal(s.settleCurrentHand(t), true);
      assert.equal(t.stacks[loserId], 0);
      return h;
    }

    await testContext.test(
      "undoes bank settlement, rebuy, elimination and finish without rewinding a live clock",
      () => {
        const t = makeGame(2);
        s.startTimer(t);
        const initial = JSON.parse(JSON.stringify(t.stacks));
        knockout(t, ids[1]);
        assert.equal(s.rebuyPlayer(t, ids[1], now), true);
        assert.equal(s.undoLastOperation(t), true);
        assert.equal(t.stacks[ids[1]], 0);
        assert.equal(t.rebuys[ids[1]], 0);
        assert.equal(s.confirmPlayerElimination(t, ids[1]), true);
        assert.equal(t.status, "finished");
        const secondsAtFinish = t.secondsRemaining;
        now += 5000;
        assert.equal(s.undoLastOperation(t), true);
        assert.equal(t.status, "live");
        assert.deepEqual(t.places, {});
        assert.equal(s.currentSeconds(t), Math.ceil(secondsAtFinish));
        const timerStart = t.timerStartedAt;
        now += 1234;
        assert.equal(s.undoLastOperation(t), true);
        assert.deepEqual(t.stacks, initial);
        assert.equal(s.getCurrentHand(t).settled, false);
        assert.equal(t.timerStartedAt, timerStart);
        assert.equal(s.canUndoLastOperation(t), false);
        assert.equal(s.cancelCurrentHand(t), true);
        assert.deepEqual(t.stacks, initial);
        s.finishTournament(t);
        assert.equal(s.undoLastOperation(t), true);
        assert.deepEqual(t.places, {});
      },
    );

    await testContext.test(
      "round-trips fractional seconds, side-pot metadata, empty actions, events and undo checkpoints",
      () => {
        const t = makeGame(3);
        s.startTimer(t);
        now += 123;
        s.pauseTimer(t);
        s.startNextHand(t);
        const h = s.getCurrentHand(t);
        h.potWinners = { 100: [ids[0]], 500: [ids[1]] };
        h.events = Array.from({ length: 900 }, (_, i) => ({
          at: now + i,
          description: `Длинная запись события ${i} ` + "x".repeat(90),
        }));
        s.cancelCurrentHand(t);
        s.finishTournament(t);
        t.hands.push(h);
        // Persisting large metadata exercises more than one cell/chunk.
        const snapshot = JSON.parse(
          JSON.stringify({ players: s.state.players, tournaments: [t] }),
        );
        const scripts = createContext({
          spreadsheet: new Spreadsheet(),
          adminKey: "regression-only",
        });
        assert.equal(
          JSON.parse(
            scripts
              .doPost({
                parameter: {
                  action: "write",
                  adminKey: "regression-only",
                  payload: JSON.stringify(snapshot),
                },
              })
              .getContent(),
          ).ok,
          true,
        );
        const response = JSON.parse(
          scripts.doGet({ parameter: { action: "read" } }).getContent(),
        );
        assert.equal(response.apiVersion, 6);
        assert.deepEqual(response.state, snapshot);
      },
    );

    await testContext.test(
      "finishes a ten-hand eight-player tournament with a rebuy and manual blinds",
      () => {
        const t = makeGame();
        assert.equal(s.startTimer(t), true);
        const chips = () => Object.values(t.stacks).reduce((a, b) => a + b, 0);
        function warmup(winners) {
          assert.equal(s.startNextHand(t), true);
          const h = s.getCurrentHand(t),
            target = h.bigBlind;
          for (const id of ids) {
            const delta = target - g.playerHandContribution(h.players[id]);
            if (delta)
              assert.equal(s.setHandBet(t, id, "preflop", 1, delta), true);
            else
              assert.equal(s.setHandAction(t, id, "preflop", 1, "check"), true);
          }
          for (const street of ["flop", "turn", "river"]) {
            assert.equal(s.setHandStreet(t, street), true);
            for (const id of ids)
              assert.equal(s.setHandAction(t, id, street, 0, "check"), true);
          }
          for (const id of winners) s.setHandWinner(t, id, true);
          now += 45000;
          assert.equal(s.settleCurrentHand(t), true);
        }
        warmup([ids[0]]);
        s.nextLevel(t);
        warmup([ids[1], ids[2]]);
        knockout(t, ids[7]);
        assert.equal(s.rebuyPlayer(t, ids[7], now), true);
        assert.equal(chips(), 18000);
        s.nextLevel(t);
        assert.equal(s.startNextHand(t), false);
        s.nextLevel(t);
        for (const [offset, id] of [...ids.slice(1)].reverse().entries()) {
          knockout(t, id);
          assert.equal(s.confirmPlayerElimination(t, id), true);
          assert.equal(t.places[id], 8 - offset);
          assert.equal(chips(), 18000);
        }
        assert.equal(t.status, "finished");
        assert.equal(t.timerStartedAt, null);
        assert.equal(t.hands.length, 10);
        assert.equal(t.places[ids[0]], 1);
        assert.equal(t.stacks[ids[0]], 18000);
        assert.equal(
          t.hands.at(-1).roles.dealer,
          t.hands.at(-1).roles.smallBlind,
        );
        assert.equal(
          ids.reduce((sum, id) => sum + g.playerCashout(t, id), 0),
          4500,
        );
        assert.equal(
          ids.reduce((sum, id) => sum + g.playerNetBalance(t, id), 0),
          0,
        );
        const saved = JSON.parse(
          values.get("friendly-poker-demo-v1"),
        ).tournaments.find((item) => item.id === t.id);
        assert.deepEqual(saved, JSON.parse(JSON.stringify(t)));
        const scripts = createContext({
          spreadsheet: new Spreadsheet(),
          adminKey: "eight-player-only",
        });
        const snapshot = JSON.parse(
          JSON.stringify({ players: s.state.players, tournaments: [t] }),
        );
        assert.equal(
          JSON.parse(
            scripts
              .doPost({
                parameter: {
                  action: "write",
                  adminKey: "eight-player-only",
                  payload: JSON.stringify(snapshot),
                },
              })
              .getContent(),
          ).ok,
          true,
        );
        assert.deepEqual(
          JSON.parse(
            scripts.doGet({ parameter: { action: "read" } }).getContent(),
          ).state,
          snapshot,
        );
        if (process.env.WRITE_EIGHT_PLAYER_HISTORY === "1")
          writeFileSync(
            resolve("tests/fixtures/eight-player-tournament-history.json"),
            JSON.stringify(snapshot, null, 2) + "\n",
          );
      },
    );
  } finally {
    Date.now = originalNow;
    await server.close();
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.window;
  }
});
