const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Spreadsheet,
  createContext,
} = require("./support/apps-script-harness.cjs");
const context = createContext();

test("round-trips hand action amounts, seat order, roles and zero-valued actions", () => {
  const spreadsheet = new Spreadsheet();
  const data = {
    title: "Турнир",
    id: "t1",
    date: "2026-11-24",
    startTime: "18:00",
    status: "live",
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: "19:30",
    currentLevel: 0,
    secondsRemaining: 1200,
    timerStartedAt: null,
    startedAt: null,
    participantIds: ["b", "a"],
    initialDealerId: "b",
    rebuys: { a: 0, b: 0 },
    places: {},
    eliminatedInHand: { a: 1 },
    gameInitialized: true,
    stacks: { a: 1400, b: 1600 },
    levels: [{ small: 25, big: 50, minutes: 20 }],
    hands: [
      {
        number: 1,
        street: "flop",
        settled: true,
        roles: { dealer: "b", smallBlind: "b", bigBlind: "a" },
        players: {
          b: {
            bets: {
              preflop: [100, 150, 0],
              flop: [0, 20, 0],
              turn: [0, 0, 0],
              river: [0, 0, 0],
            },
            folded: false,
            foldedOn: null,
            takesPot: true,
          },
          a: {
            bets: {
              preflop: [100, 0, 0],
              flop: [0, 0, 0],
              turn: [0, 0, 0],
              river: [0, 0, 0],
            },
            folded: true,
            foldedOn: "flop",
            takesPot: false,
          },
        },
      },
    ],
  };
  context.writeTournamentSheet_(spreadsheet, data, { a: "Анна", b: "Борис" });
  const tournamentSheet = spreadsheet
    .getSheets()
    .find((sheet) => sheet.getRange(3, 1, 1, 2).getValues()[0][1] === data.id);
  assert.ok(tournamentSheet);
  const restored = JSON.parse(
    JSON.stringify(context.readTournamentSheet_(tournamentSheet)),
  );
  assert.deepEqual(restored, data);
  assert.equal(tournamentSheet.getRange(18, 28).getValue(), "Д, МБ");
  assert.equal(tournamentSheet.getRange(18, 29).getValue(), "100 + 150 + 0");
  assert.equal(tournamentSheet.getRange(19, 33).getValue(), "flop");
  assert.equal(tournamentSheet.getRange(18, 20).getValue(), 250);
  assert.equal(tournamentSheet.getRange(19, 16).getValue(), 1);
});

test("reads older readable hand sheets with one total per street", () => {
  const spreadsheet = new Spreadsheet();
  const data = {
    title: "Старый турнир",
    id: "old",
    date: "2026-11-24",
    startTime: "18:00",
    status: "live",
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: "19:30",
    currentLevel: 0,
    secondsRemaining: 1200,
    timerStartedAt: null,
    startedAt: null,
    participantIds: ["a"],
    initialDealerId: "a",
    rebuys: {},
    places: {},
    eliminatedInHand: {},
    gameInitialized: true,
    stacks: { a: 1400 },
    levels: [],
    hands: [
      {
        number: 1,
        street: "flop",
        settled: false,
        roles: null,
        players: {
          a: {
            bets: { preflop: 100, flop: 0, turn: 0, river: 0 },
            folded: false,
            takesPot: false,
          },
        },
      },
    ],
  };
  context.writeTournamentSheet_(spreadsheet, data, { a: "Анна" });
  const sheet = spreadsheet.getSheetByName(data.title);
  assert.ok(sheet);
  for (const key of [...sheet.cells.keys()]) {
    const [, column] = key.split(":").map(Number);
    if (column >= 29) sheet.cells.delete(key);
  }
  const restored = JSON.parse(
    JSON.stringify(context.readTournamentSheet_(sheet)),
  );
  assert.equal(restored.hands[0].players.a.bets.preflop, 100);
  assert.equal(restored.hands[0].players.a.bets.flop, 0);
});

test("reads older player-state tables that do not have an elimination-hand column", () => {
  const spreadsheet = new Spreadsheet();
  const data = {
    title: "Старая таблица",
    id: "old-state",
    date: "2026-11-24",
    startTime: "18:00",
    status: "live",
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: "19:30",
    currentLevel: 0,
    secondsRemaining: 1200,
    timerStartedAt: null,
    startedAt: null,
    participantIds: ["a"],
    initialDealerId: "a",
    rebuys: { a: 0 },
    places: { a: 4 },
    eliminatedInHand: { a: 3 },
    gameInitialized: true,
    stacks: { a: 0 },
    levels: [],
    hands: [],
  };
  context.writeTournamentSheet_(spreadsheet, data, { a: "Анна" });
  const sheet = spreadsheet.getSheetByName(data.title);
  assert.ok(sheet);
  sheet.cells.delete("17:16");

  const restored = JSON.parse(
    JSON.stringify(context.readTournamentSheet_(sheet)),
  );
  assert.deepEqual(restored.places, { a: 4 });
  assert.deepEqual(restored.eliminatedInHand, {});
});

test("reads a Sheets time value as hours and minutes", () => {
  const spreadsheet = new Spreadsheet();
  assert.equal(
    context.parseSheetTime_(
      new Date("2020-01-01T18:05:00.000Z"),
      spreadsheet.sheet,
    ),
    "18:05",
  );
});
