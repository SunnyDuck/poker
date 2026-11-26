import type { Tournament } from './types'
import { isValidDate, isValidTime } from './time'

export function tournamentSettingsErrors(tournament: Tournament): string[] {
  const errors: string[] = []
  if (!tournament.title?.trim() || tournament.title.length > 50) errors.push('Введите название турнира (до 50 символов).')
  if (!isValidDate(tournament.date)) errors.push('Укажите корректную дату турнира.')
  if (!isValidTime(tournament.startTime)) errors.push('Укажите время начала.')
  if (!Number.isSafeInteger(tournament.buyIn) || tournament.buyIn < 0) errors.push('Взнос должен быть целым неотрицательным числом.')
  if (!Number.isSafeInteger(tournament.startingStack) || tournament.startingStack < 1) errors.push('Стартовый стек должен быть положительным целым числом.')
  if (!Number.isInteger(tournament.maxRebuys) || tournament.maxRebuys < 0 || tournament.maxRebuys > 5) errors.push('Количество докупок должно быть целым числом от 0 до 5.')
  if (tournament.rebuyUntil !== '' && !isValidTime(tournament.rebuyUntil)) errors.push('Укажите корректное время окончания докупок или оставьте поле пустым.')
  if (!tournament.levels.length || tournament.levels.every((level) => level.break)) errors.push('Добавьте хотя бы один игровой уровень блайндов.')
  tournament.levels.forEach((level, index) => {
    if (!Number.isInteger(level.minutes) || level.minutes < 1 || level.minutes > 240) errors.push(`Этап ${index + 1}: длительность должна быть целым числом от 1 до 240 минут.`)
    if (!level.break && (!Number.isSafeInteger(level.small) || !Number.isSafeInteger(level.big) || level.small < 1 || level.big <= level.small)) errors.push(`Этап ${index + 1}: большой блайнд должен быть больше положительного малого блайнда.`)
  })
  if (tournament.participantIds.length < 2 || tournament.participantIds.length > 10 || new Set(tournament.participantIds).size !== tournament.participantIds.length) errors.push('Выберите от 2 до 10 разных участников.')
  if (!tournament.participantIds.includes(tournament.initialDealerId ?? '')) errors.push('Назначьте стартовую роль одному из участников.')
  return errors
}
