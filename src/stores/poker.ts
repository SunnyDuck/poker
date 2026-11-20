import { reactive, watch } from 'vue'
import { createDemoState } from '@/domain/demoData'
import type { DemoState, Tournament } from '@/domain/types'

const storageKey = 'friendly-poker-demo-v1'
let applyingRemoteUpdate = false

function loadState(): DemoState {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return JSON.parse(saved) as DemoState
  } catch {
    // If browser storage is unavailable or malformed, use the demo seed.
  }
  return createDemoState()
}

export const state = reactive(loadState())

watch(state, (value) => {
  if (applyingRemoteUpdate) return
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // The page remains usable for this session if storage is disabled.
  }
}, { deep: true, flush: 'sync' })

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || !event.newValue) return
  try {
    applyingRemoteUpdate = true
    Object.assign(state, JSON.parse(event.newValue) as DemoState)
  } catch {
    // Ignore a malformed update from another tab.
  } finally {
    applyingRemoteUpdate = false
  }
})

export function findTournament(id: string): Tournament | undefined {
  return state.tournaments.find((tournament) => tournament.id === id)
}

export function createTournament(): Tournament {
  const number = state.tournaments.length + 1
  const tournament: Tournament = {
    id: `tournament-${Date.now()}`,
    title: `Игра ${number}`,
    date: '2026-12-25',
    startTime: '18:00',
    status: 'upcoming',
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: '19:30',
    participantIds: [],
    rebuys: {},
    places: {},
    levels: [{ small: 25, big: 50, minutes: 30 }],
    currentLevel: 0,
    secondsRemaining: 1800,
    timerStartedAt: null,
  }
  state.tournaments.push(tournament)
  return tournament
}

export function toggleParticipant(tournament: Tournament, playerId: string): void {
  if (tournament.participantIds.includes(playerId)) {
    tournament.participantIds = tournament.participantIds.filter((id) => id !== playerId)
    delete tournament.rebuys[playerId]
    delete tournament.places[playerId]
  } else {
    tournament.participantIds.push(playerId)
  }
}

export function resetDemo(): void {
  const fresh = createDemoState()
  state.players.splice(0, state.players.length, ...fresh.players)
  state.tournaments.splice(0, state.tournaments.length, ...fresh.tournaments)
}

export function currentSeconds(tournament: Tournament): number {
  if (tournament.timerStartedAt === null) return tournament.secondsRemaining
  const elapsed = Math.floor((Date.now() - tournament.timerStartedAt) / 1000)
  return Math.max(0, tournament.secondsRemaining - elapsed)
}

export function startTimer(tournament: Tournament): void {
  if (tournament.timerStartedAt !== null) return
  tournament.timerStartedAt = Date.now()
  tournament.status = 'live'
}

export function pauseTimer(tournament: Tournament): void {
  if (tournament.timerStartedAt === null) return
  tournament.secondsRemaining = currentSeconds(tournament)
  tournament.timerStartedAt = null
}

export function nextLevel(tournament: Tournament): void {
  pauseTimer(tournament)
  if (tournament.currentLevel >= tournament.levels.length - 1) return
  tournament.currentLevel += 1
  tournament.secondsRemaining = tournament.levels[tournament.currentLevel]!.minutes * 60
}

export function finishTournament(tournament: Tournament): void {
  tournament.status = 'finished'
  pauseTimer(tournament)
}
