import assert from 'node:assert/strict'
import test from 'node:test'
import { createPokerHand, handActionPot, handPot, handStreetPot, isPlayerAllIn, isPlayerVisibleOnStreet, nextHandActionIndex, playerCashout, playerNetBalance, postBlinds, projectedStack, rolesForHand, settlePokerHand } from '../src/domain/game.ts'
import type { Tournament } from '../src/domain/types.ts'

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 'test',
    title: 'Test',
    date: '2026-11-23',
    startTime: '18:00',
    status: 'live',
    buyIn: 300,
    startingStack: 1500,
    rebuyCost: 300,
    maxRebuys: 1,
    rebuyUntil: '19:30',
    participantIds: ['a', 'b'],
    initialDealerId: 'a',
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
  }
}

test('rotates roles clockwise, skips eliminated seats, and handles heads-up play', () => {
  const seats = ['a', 'b', 'c', 'd']
  assert.deepEqual(rolesForHand(seats, seats, 'b', false), { dealer: 'b', smallBlind: 'c', bigBlind: 'd' })
  assert.deepEqual(rolesForHand(seats, ['a', 'b', 'd'], 'b', true), { dealer: 'd', smallBlind: 'a', bigBlind: 'b' })
  assert.deepEqual(rolesForHand(seats, ['a', 'd'], 'b', true), { dealer: 'd', smallBlind: 'd', bigBlind: 'a' })
  assert.deepEqual(rolesForHand(seats, ['a', 'd'], 'd', true), { dealer: 'a', smallBlind: 'a', bigBlind: 'd' })
  assert.equal(rolesForHand(seats, ['a'], 'a', true), null)
})

test('posts small and big blinds as the first preflop contributions, capped by each stack', () => {
  const hand = createPokerHand(1, ['a', 'b'], { dealer: 'a', smallBlind: 'a', bigBlind: 'b' })
  postBlinds(hand, { small: 25, big: 50, minutes: 20 }, { a: 10, b: 500 })

  assert.equal(hand.players.a!.bets.preflop[0], 10)
  assert.equal(hand.players.b!.bets.preflop[0], 50)
  assert.equal(handPot(hand), 60)
})

test('keeps a folded player visible on the folding street and hides them on later streets', () => {
  const hand = createPokerHand(1, ['a', 'b'])
  const player = hand.players.a!
  player.folded = true
  player.foldedOn = 'flop'

  assert.equal(isPlayerVisibleOnStreet(player, 'preflop'), true)
  assert.equal(isPlayerVisibleOnStreet(player, 'flop'), true)
  assert.equal(isPlayerVisibleOnStreet(player, 'turn'), false)
  assert.equal(isPlayerVisibleOnStreet(player, 'river'), false)
})

test('calculates a hand pot and projected stacks from all street contributions', () => {
  const game = tournament()
  const hand = createPokerHand(1, ['a', 'b'])
  hand.players.a!.bets.preflop[0] = 100
  hand.players.a!.bets.flop[0] = 30
  hand.players.a!.bets.flop[1] = 20
  hand.players.b!.bets.preflop[0] = 100
  hand.players.b!.bets.turn[0] = 25

  assert.equal(handPot(hand), 275)
  assert.equal(handStreetPot(hand, 'flop'), 50)
  assert.equal(handActionPot(hand, 'flop', 0), 30)
  assert.equal(handActionPot(hand, 'flop', 1), 20)
  assert.equal(projectedStack(game, hand, 'a'), 350)
  assert.equal(projectedStack(game, hand, 'b'), 375)
})

test('recognizes all-in when a player has contributed their full stack during the hand', () => {
  const game = tournament({ stacks: { a: 500, b: 500 } })
  const hand = createPokerHand(1, ['a', 'b'])
  hand.players.a!.bets.preflop[0] = 300
  hand.players.a!.bets.flop[0] = 200

  assert.equal(projectedStack(game, hand, 'a'), 0)
  assert.equal(isPlayerAllIn(game, hand, 'a'), true)
  assert.equal(isPlayerAllIn(game, hand, 'b'), false)
  hand.street = 'turn'
  assert.equal(isPlayerAllIn(game, hand, 'a'), true)
})

test('quick all-in uses the next action column after the last recorded contribution', () => {
  const hand = createPokerHand(1, ['a', 'b'])
  hand.players.a!.bets.preflop[0] = 25
  hand.players.b!.bets.preflop[0] = 50
  hand.players.b!.bets.preflop[1] = 100

  assert.equal(nextHandActionIndex(hand, 'preflop'), 2)
  assert.equal(nextHandActionIndex(hand, 'flop'), 0)
})

test('settles the pot into stacks and refuses to settle it twice', () => {
  const game = tournament()
  const hand = createPokerHand(1, ['a', 'b'])
  hand.players.a!.bets.preflop[0] = 100
  hand.players.b!.bets.preflop[0] = 100
  hand.players.b!.takesPot = true

  assert.equal(settlePokerHand(game, hand), true)
  assert.deepEqual(game.stacks, { a: 400, b: 600 })
  assert.equal(hand.settled, true)
  assert.equal(settlePokerHand(game, hand), false)
  assert.deepEqual(game.stacks, { a: 400, b: 600 })
})

test('splits an odd pot evenly and gives the remainder to the first checked winner', () => {
  const game = tournament({ stacks: { a: 1000, b: 1000 } })
  const hand = createPokerHand(1, ['a', 'b'])
  hand.players.a!.bets.river[0] = 30
  hand.players.a!.bets.river[1] = 21
  hand.players.b!.bets.river[0] = 50
  hand.players.a!.takesPot = true
  hand.players.b!.takesPot = true

  assert.equal(settlePokerHand(game, hand), true)
  assert.deepEqual(game.stacks, { a: 1000, b: 1000 })
})

test('rejects a pot without a winner or any contribution larger than a stack without partial changes', () => {
  const game = tournament()
  const noWinner = createPokerHand(1, ['a', 'b'])
  noWinner.players.a!.bets.preflop[0] = 100
  noWinner.players.b!.bets.preflop[0] = 100
  assert.equal(settlePokerHand(game, noWinner), false)
  assert.deepEqual(game.stacks, { a: 500, b: 500 })

  const overBet = createPokerHand(2, ['a', 'b'])
  overBet.players.a!.bets.preflop[0] = 600
  overBet.players.a!.takesPot = true
  assert.equal(settlePokerHand(game, overBet), false)
  assert.deepEqual(game.stacks, { a: 500, b: 500 })
})

test('calculates player payouts and balances proportionally to chips and contributions', () => {
  const game = tournament({
    participantIds: ['a', 'b'],
    rebuyCost: 100,
    rebuys: { a: 1 },
    stacks: { a: 3500, b: 1000 },
  })

  assert.equal(playerCashout(game, 'a'), 700)
  assert.equal(playerCashout(game, 'b'), 200)
  assert.equal(playerCashout(game, 'a') + playerCashout(game, 'b'), 900)
  assert.equal(playerNetBalance(game, 'a'), 100)
  assert.equal(playerNetBalance(game, 'b'), -100)
})
