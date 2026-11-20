import type { DemoState, Player, Tournament } from './types'

export interface Standing {
  player: Player
  points: number
  events: number
  wins: number
}

// Черновая таблица очков скопирована из текущего положения сезона.
export function placePoints(place: number): number {
  if (place === 1) return 10
  if (place === 2) return 7
  if (place === 3) return 5
  if (place === 4) return 3
  if (place === 5 || place === 6) return 2
  return place >= 7 ? 1 : 0
}

export function tournamentPoints(tournament: Tournament, playerId: string): number {
  if (!tournament.participantIds.includes(playerId)) return 0
  const place = tournament.places[playerId]
  const finishPoints = place ? placePoints(place) : 0
  const rebuyPoints = Math.min(tournament.rebuys[playerId] ?? 0, 1)
  return finishPoints + rebuyPoints
}

export function calculateStandings(state: DemoState): Standing[] {
  return state.players
    .map((player) => {
      const completed = state.tournaments.filter(
        (tournament) => tournament.status === 'finished' && tournament.participantIds.includes(player.id),
      )
      return {
        player,
        points: completed.reduce((sum, tournament) => sum + tournamentPoints(tournament, player.id), 0),
        events: completed.length,
        wins: completed.filter((tournament) => tournament.places[player.id] === 1).length,
      }
    })
    .filter((standing) => standing.events > 0)
    .sort((a, b) => b.points - a.points)
}
