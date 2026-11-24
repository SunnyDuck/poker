import type { BlindLevel, HandPlayerState, HandRoles, HandStreet, PokerActionType, PokerHand, Tournament } from './types'

export const handStreets: { id: HandStreet; label: string }[] = [
  { id: 'preflop', label: 'Префлоп' },
  { id: 'flop', label: 'Флоп' },
  { id: 'turn', label: 'Тёрн' },
  { id: 'river', label: 'Ривер' },
]

export const defaultBetActionCount = 3

export function isPlayerVisibleOnStreet(player: HandPlayerState, street: HandStreet): boolean {
  if (!player.folded || !player.foldedOn) return true
  return handStreets.findIndex((item) => item.id === street) <= handStreets.findIndex((item) => item.id === player.foldedOn)
}

export function rolesForHand(seatIds: string[], activeIds: string[], dealerId: string | null, advance: boolean): HandRoles | null {
  if (activeIds.length < 2 || seatIds.length < 2) return null
  const active = new Set(activeIds)
  const dealerSeat = dealerId ? seatIds.indexOf(dealerId) : -1
  const start = dealerSeat < 0 ? 0 : dealerSeat + (advance ? 1 : 0)
  const ordered = Array.from({ length: seatIds.length }, (_, offset) => seatIds[(start + offset) % seatIds.length]!)
    .filter((id) => active.has(id))
  if (ordered.length < 2) return null
  return { dealer: ordered[0]!, smallBlind: ordered.length === 2 ? ordered[0]! : ordered[1]!, bigBlind: ordered.length === 2 ? ordered[1]! : ordered[2]! }
}

export function createPokerHand(number: number, playerIds: string[], roles: HandRoles | null = null): PokerHand {
  const players: Record<string, HandPlayerState> = {}
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
    }
  }
  return { number, street: 'preflop', players, settled: false, roles }
}

export function postBlinds(hand: PokerHand, level: BlindLevel, stacks: Record<string, number>): void {
  if (!hand.roles) return
  const smallBlindPlayer = hand.players[hand.roles.smallBlind]
  const bigBlindPlayer = hand.players[hand.roles.bigBlind]
  if (smallBlindPlayer) {
    smallBlindPlayer.bets.preflop[0] = Math.min(Math.max(0, Math.floor(level.small)), Math.max(0, stacks[hand.roles.smallBlind] ?? 0))
    if (smallBlindPlayer.bets.preflop[0] > 0) smallBlindPlayer.actions.preflop[0] = 'small-blind'
  }
  if (bigBlindPlayer) {
    bigBlindPlayer.bets.preflop[0] = Math.min(Math.max(0, Math.floor(level.big)), Math.max(0, stacks[hand.roles.bigBlind] ?? 0))
    if (bigBlindPlayer.bets.preflop[0] > 0) bigBlindPlayer.actions.preflop[0] = 'big-blind'
  }
}

export function playerHandContribution(player: HandPlayerState): number {
  return handStreets.reduce((sum, street) => sum + playerStreetContribution(player, street.id), 0)
}

export function playerStreetContribution(player: HandPlayerState, street: HandStreet): number {
  return (player.bets[street] ?? []).reduce((sum, amount) => sum + Math.max(0, Number(amount) || 0), 0)
}

export function handPot(hand: PokerHand): number {
  return Object.values(hand.players).reduce((sum, player) => sum + playerHandContribution(player), 0)
}

export function handStreetPot(hand: PokerHand, street: HandStreet): number {
  return Object.values(hand.players).reduce((sum, player) => sum + playerStreetContribution(player, street), 0)
}

export function handActionPot(hand: PokerHand, street: HandStreet, actionIndex: number): number {
  return Object.values(hand.players).reduce((sum, player) => sum + Math.max(0, Number(player.bets[street]?.[actionIndex]) || 0), 0)
}

export function handActionCount(hand: PokerHand, street: HandStreet): number {
  return Math.max(defaultBetActionCount, ...Object.values(hand.players).map((player) => player.bets[street]?.length ?? 0))
}

export function nextHandActionIndex(hand: PokerHand, street: HandStreet): number {
  let lastUsedIndex = -1
  for (let index = 0; index < handActionCount(hand, street); index += 1) {
    if (handActionPot(hand, street, index) > 0 || Object.values(hand.players).some((player) => player.actions?.[street]?.[index] != null)) lastUsedIndex = index
  }
  return lastUsedIndex + 1
}

export function canPlayerCheck(hand: PokerHand, playerId: string, street: HandStreet, actionIndex: number): boolean {
  const seatIds = Object.keys(hand.players)
  const player = hand.players[playerId]
  if (!player || !seatIds.length) return false
  const firstToAct = street === 'preflop' ? (hand.roles?.bigBlind ?? hand.roles?.dealer) : hand.roles?.dealer
  const pivot = firstToAct ? seatIds.indexOf(firstToAct) : -1
  const start = pivot < 0 ? 0 : (pivot + 1) % seatIds.length
  const order = Array.from({ length: seatIds.length }, (_, offset) => seatIds[(start + offset) % seatIds.length]!)
  const ownBefore = (player.bets[street] ?? []).slice(0, actionIndex).reduce((sum, amount) => sum + (Number(amount) || 0), 0)
  let highestBefore = Math.max(0, ...Object.values(hand.players).map((other) =>
    (other.bets[street] ?? []).slice(0, actionIndex).reduce((sum, amount) => sum + (Number(amount) || 0), 0),
  ))
  if (street === 'preflop' && actionIndex === 0) {
    highestBefore = Math.max(highestBefore, Number(hand.players[hand.roles?.bigBlind ?? '']?.bets.preflop[0] ?? 0))
  }
  const playerPosition = order.indexOf(playerId)
  for (const id of order.slice(0, playerPosition)) {
    const earlierPlayer = hand.players[id]!
    const total = (earlierPlayer.bets[street] ?? []).slice(0, actionIndex).reduce((sum, amount) => sum + (Number(amount) || 0), 0)
      + (Number(earlierPlayer.bets[street]?.[actionIndex]) || 0)
    highestBefore = Math.max(highestBefore, total)
  }
  return ownBefore >= highestBefore
}

/** Classify each recorded contribution by its position after the previous action. */
export function classifyHandActions(hand: PokerHand, street: HandStreet): void {
  const seatIds = Object.keys(hand.players)
  if (!seatIds.length) return
  const firstToAct = street === 'preflop' ? (hand.roles?.bigBlind ?? hand.roles?.dealer) : hand.roles?.dealer
  const pivot = firstToAct ? seatIds.indexOf(firstToAct) : -1
  const start = pivot < 0 ? 0 : (pivot + 1) % seatIds.length
  const actionOrder = Array.from({ length: seatIds.length }, (_, offset) => seatIds[(start + offset) % seatIds.length]!)

  for (let actionIndex = 0; actionIndex < handActionCount(hand, street); actionIndex += 1) {
    const ownBefore = new Map(actionOrder.map((id) => [id, (hand.players[id]!.bets[street] ?? [])
      .slice(0, actionIndex).reduce((sum, amount) => sum + (Number(amount) || 0), 0)]))
    let highestBet = Math.max(0, ...ownBefore.values())
    if (street === 'preflop' && actionIndex === 0) {
      highestBet = Math.max(highestBet, Number(hand.players[hand.roles?.bigBlind ?? '']?.bets.preflop[0] ?? 0))
    }

    for (const id of actionOrder) {
      const player = hand.players[id]!
      const amount = Number(player.bets[street]?.[actionIndex] ?? 0)
      if (street === 'preflop' && actionIndex === 0 && amount > 0 && id === hand.roles?.smallBlind) {
        player.actions[street][actionIndex] = 'small-blind'
        continue
      }
      if (street === 'preflop' && actionIndex === 0 && amount > 0 && id === hand.roles?.bigBlind) {
        player.actions[street][actionIndex] = 'big-blind'
        continue
      }
      if (amount <= 0) {
        if (player.actions[street][actionIndex] !== 'check' || (ownBefore.get(id) ?? 0) < highestBet) player.actions[street][actionIndex] = null
        continue
      }
      if (player.actions[street][actionIndex] === 'all-in') {
        highestBet = Math.max(highestBet, (ownBefore.get(id) ?? 0) + amount)
        continue
      }
      const totalAfter = (ownBefore.get(id) ?? 0) + amount
      player.actions[street][actionIndex] = totalAfter <= highestBet ? 'call' : highestBet > 0 ? 'raise' : 'bet'
      highestBet = Math.max(highestBet, totalAfter)
    }
  }
}

export function projectedStack(tournament: Tournament, hand: PokerHand, playerId: string): number {
  const currentStack = tournament.stacks[playerId] ?? 0
  const player = hand.players[playerId]
  return currentStack - (player ? playerHandContribution(player) : 0)
}

export function isPlayerAllIn(tournament: Tournament, hand: PokerHand, playerId: string): boolean {
  const player = hand.players[playerId]
  return Boolean(player && !player.folded && playerHandContribution(player) > 0 && projectedStack(tournament, hand, playerId) === 0)
}

export interface StreetActionRequirement {
  playerId: string
  amountOwed: number
}

/** Return live players who still need to act or match the highest live contribution. */
export function streetActionRequirements(tournament: Tournament, hand: PokerHand, street: HandStreet): StreetActionRequirement[] {
  const contenders = Object.entries(hand.players).filter(([, player]) => !player.folded)
  if (contenders.length <= 1) return []

  const highestContribution = Math.max(0, ...contenders.map(([, player]) => playerStreetContribution(player, street)))
  return contenders.flatMap(([playerId, player]) => {
    if (isPlayerAllIn(tournament, hand, playerId)) return []

    const hasVoluntaryAction = player.actions?.[street]?.some((action, index) => {
      if (action === 'check' || action === 'call' || action === 'bet' || action === 'raise' || action === 'all-in') return true
      const isAutomaticBlind = street === 'preflop' && index === 0
        && (playerId === hand.roles?.smallBlind || playerId === hand.roles?.bigBlind)
      return !isAutomaticBlind && (Number(player.bets[street]?.[index]) || 0) > 0
    }) ?? false
    const contribution = playerStreetContribution(player, street)
    if (hasVoluntaryAction && contribution >= highestContribution) return []
    return [{ playerId, amountOwed: Math.max(0, highestContribution - contribution) }]
  })
}

export function canAdvanceHandStreet(tournament: Tournament, hand: PokerHand, street: HandStreet): boolean {
  return streetActionRequirements(tournament, hand, street).length === 0
}

export function settlePokerHand(tournament: Tournament, hand: PokerHand): boolean {
  if (hand.settled) return false
  const pot = handPot(hand)
  const winners = Object.entries(hand.players)
    .filter(([, player]) => player.takesPot && !player.folded)
    .map(([playerId]) => playerId)
  if (pot > 0 && winners.length === 0) return false
  if (Object.entries(hand.players).some(([playerId, player]) => playerHandContribution(player) > (tournament.stacks[playerId] ?? 0))) return false

  for (const [playerId, player] of Object.entries(hand.players)) {
    tournament.stacks[playerId] = (tournament.stacks[playerId] ?? 0) - playerHandContribution(player)
  }

  if (winners.length) {
    const share = Math.floor(pot / winners.length)
    const remainder = pot % winners.length
    winners.forEach((playerId, index) => {
      tournament.stacks[playerId] = (tournament.stacks[playerId] ?? 0) + share + (index < remainder ? 1 : 0)
    })
  }
  hand.settled = true
  return true
}

export function playerInvestment(tournament: Tournament, playerId: string): number {
  const rebuyCount = Math.max(0, tournament.rebuys[playerId] ?? 0)
  return Math.max(0, tournament.buyIn) * (1 + rebuyCount)
}

export function tournamentPrizePool(tournament: Tournament): number {
  const buyIns = tournament.participantIds.length * Math.max(0, tournament.buyIn)
  const rebuys = Object.values(tournament.rebuys).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0)
  return buyIns + rebuys * Math.max(0, tournament.buyIn)
}

export function tournamentChipsInPlay(tournament: Tournament): number {
  const rebuys = Object.values(tournament.rebuys).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0)
  return Math.max(0, tournament.startingStack) * (tournament.participantIds.length + rebuys)
}

export function playerCashout(tournament: Tournament, playerId: string, chips = tournament.stacks[playerId] ?? 0): number {
  const totalChips = tournamentChipsInPlay(tournament)
  if (totalChips <= 0) return 0
  return (Math.max(0, chips) / totalChips) * tournamentPrizePool(tournament)
}

export function playerNetBalance(tournament: Tournament, playerId: string, chips?: number): number {
  return playerCashout(tournament, playerId, chips) - playerInvestment(tournament, playerId)
}
