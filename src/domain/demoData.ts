import type { DemoState, BlindLevel, Tournament } from './types'

export const seasonLevels: BlindLevel[] = [
  { small: 25, big: 50, minutes: 45 },
  { small: 50, big: 100, minutes: 45 },
  { small: 0, big: 0, minutes: 10, break: true },
  { small: 75, big: 150, minutes: 30 },
  { small: 100, big: 200, minutes: 20 },
  { small: 150, big: 300, minutes: 20 },
  { small: 0, big: 0, minutes: 10, break: true },
  { small: 200, big: 400, minutes: 15 },
  { small: 300, big: 600, minutes: 15 },
  { small: 400, big: 800, minutes: 10 },
  { small: 600, big: 1200, minutes: 10 },
  { small: 800, big: 1600, minutes: 10 },
]

function makeTournament(id: string, number: number, date: string, participantIds: string[]): Tournament {
  return {
    id,
    title: number === 3 ? 'Игра 3 · Финал' : `Игра ${number}`,
    date,
    startTime: '18:00',
    status: 'upcoming',
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: '19:30',
    participantIds,
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
  }
}

export function createDemoState(): DemoState {
  const players = [
    'Алексей', 'Анна', 'Борис', 'Вика', 'Дмитрий',
    'Екатерина', 'Илья', 'Мария', 'Никита', 'Ольга',
  ].map((name, index) => ({ id: `player-${index + 1}`, name }))

  return {
    players,
    tournaments: [
      makeTournament('tournament-1', 1, '2026-11-27', players.slice(0, 8).map((player) => player.id)),
      makeTournament('tournament-2', 2, '2026-12-11', players.slice(0, 8).map((player) => player.id)),
      makeTournament('tournament-3', 3, '2026-12-25', players.slice(0, 10).map((player) => player.id)),
    ],
  }
}
