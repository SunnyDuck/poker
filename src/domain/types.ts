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
export type HandStreet = 'preflop' | 'flop' | 'turn' | 'river'
export type PokerActionType = 'check' | 'call' | 'bet' | 'raise' | 'all-in' | 'small-blind' | 'big-blind'

export interface HandRoles {
  dealer: string
  smallBlind: string
  bigBlind: string
}

export interface HandPlayerState {
  /** Incremental amounts contributed by the player on each action of each street. */
  bets: Record<HandStreet, number[]>
  /** Recorded or inferred action for each contribution column. Null is an untouched cell. */
  actions: Record<HandStreet, (PokerActionType | null)[]>
  folded: boolean
  foldedOn: HandStreet | null
  takesPot: boolean
}

export interface PokerHand {
  number: number
  street: HandStreet
  players: Record<string, HandPlayerState>
  settled: boolean
  roles: HandRoles | null
}

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
  initialDealerId: string | null
  rebuys: Record<string, number>
  places: Record<string, number>
  eliminatedInHand: Record<string, number>
  gameInitialized: boolean
  stacks: Record<string, number>
  hands: PokerHand[]
  levels: BlindLevel[]
  currentLevel: number
  secondsRemaining: number
  timerStartedAt: number | null
  startedAt: number | null
}

export interface DemoState {
  players: Player[]
  tournaments: Tournament[]
}
