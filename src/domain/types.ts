export interface Player {
  id: string
  name: string
}

export interface BlindLevel {
  small: number
  big: number
  minutes: number
  break?: boolean
}

export type TournamentStatus = 'upcoming' | 'live' | 'finished'

export interface Tournament {
  id: string
  title: string
  date: string
  startTime: string
  status: TournamentStatus
  buyIn: number
  startingStack: number
  rebuyCost: number
  maxRebuys: number
  rebuyUntil: string
  participantIds: string[]
  rebuys: Record<string, number>
  places: Record<string, number>
  levels: BlindLevel[]
  currentLevel: number
  secondsRemaining: number
  timerStartedAt: number | null
}

export interface DemoState {
  players: Player[]
  tournaments: Tournament[]
}
