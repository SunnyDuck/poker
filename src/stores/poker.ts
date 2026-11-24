import { reactive, ref, watch } from 'vue'
import { createDemoState } from '@/domain/demoData'
import type { DemoState, HandStreet, PokerActionType, Tournament } from '@/domain/types'
import { canPlayerCheck, createPokerHand, defaultBetActionCount, playerHandContribution, postBlinds, rolesForHand, settlePokerHand, streetActionRequirements } from '@/domain/game'
import { isBeforeKrasnoyarskCutoff } from '@/domain/time'
import {
  getGoogleAdminKey,
  isGoogleAdminKeyRemembered,
  isGoogleSheetsConfigured,
  readGoogleState,
  storeGoogleAdminKey,
  writeGoogleState,
} from '@/services/googleSheets'

const storageKey = 'friendly-poker-demo-v1'
const retainedHistoryKey = 'friendly-poker-history-awaiting-sync'
const pendingSaveKey = 'friendly-poker-pending-save'
const pollingIntervalMs = 30_000
const saveDelayMs = 500
const requiredGoogleApiVersion = 5
const outdatedGoogleScriptMessage = 'Обновите Code.gs и разверните новую версию Apps Script: текущая версия не сохраняет типы действий в истории раздач.'

export type GoogleSyncStatus = 'local' | 'connecting' | 'read-only' | 'connected' | 'saving' | 'error' | 'conflict'

export const googleSyncStatus = ref<GoogleSyncStatus>(isGoogleSheetsConfigured() ? 'connecting' : 'local')
export const googleSyncMessage = ref('')
export const googleAdminConnected = ref(isGoogleSheetsConfigured() && isGoogleAdminKeyRemembered() && Boolean(getGoogleAdminKey()))

let applyingRemoteUpdate = false
let remoteReady = false
let remoteRevision = 0
let remoteApiVersion = 0
let pendingLocalSave = false
let localChangeCount = 0
let saveTimer: number | undefined
let pollingTimer: number | undefined
let saveInProgress = false
let pollInProgress = false
let lastPollAt = 0
let lastWriteAttempt: { serialized: string; revision: number } | null = null

function markPendingSave(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(pendingSaveKey, '1')
    else localStorage.removeItem(pendingSaveKey)
  } catch { /* The current page still keeps pending changes in memory. */ }
}

function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DemoState>
  return Array.isArray(candidate.players) && Array.isArray(candidate.tournaments)
}

function normalizeState(value: DemoState): DemoState {
  for (const tournament of value.tournaments) {
    tournament.rebuyCost = tournament.buyIn
    tournament.initialDealerId ??= null
    tournament.rebuys ??= {}
    tournament.places ??= {}
    tournament.eliminatedInHand ??= {}
    tournament.stacks ??= {}
    tournament.hands ??= []
    tournament.gameInitialized ??= Object.keys(tournament.stacks).length > 0
    if (tournament.startedAt != null && Number.isFinite(tournament.startedAt)) {
      tournament.startedAt = Math.floor(tournament.startedAt / 1000) * 1000
    }
    tournament.hands.forEach((hand) => {
      hand.players ??= {}
      hand.street ??= 'preflop'
      hand.settled ??= false
      hand.roles ??= null
      for (const player of Object.values(hand.players)) {
        player.bets ??= { preflop: [], flop: [], turn: [], river: [] }
        player.actions ??= { preflop: [], flop: [], turn: [], river: [] }
        for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
          const savedBets = player.bets[street] as unknown
          const betValues = Array.isArray(savedBets) ? savedBets : [savedBets]
          player.bets[street] = Array.from({ length: Math.max(defaultBetActionCount, betValues.length) }, (_, index) => {
            const amount = Number(betValues[index] ?? 0)
            return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0
          })
          const savedActionTypes = Array.isArray(player.actions[street]) ? player.actions[street] : []
          player.actions[street] = Array.from({ length: Math.max(defaultBetActionCount, player.bets[street].length, savedActionTypes.length) }, (_, index) => {
            const action = savedActionTypes[index]
            return ['check', 'call', 'bet', 'raise', 'all-in', 'small-blind', 'big-blind'].includes(action ?? '') ? action as PokerActionType : null
          })
        }
        player.folded ??= false
        player.foldedOn ??= null
        if (!['preflop', 'flop', 'turn', 'river'].includes(player.foldedOn ?? '')) player.foldedOn = null
        player.takesPot ??= false
      }
    })
  }
  return value
}

function cloneState(value: DemoState): DemoState {
  return JSON.parse(JSON.stringify(value)) as DemoState
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function loadState(): DemoState {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (isDemoState(parsed)) return normalizeState(parsed)
    }
  } catch {
    // If browser storage is unavailable or malformed, use the demo seed.
  }
  return createDemoState()
}

export const state = reactive(loadState())

function persistLocalState(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // The page remains usable for this session if storage is disabled.
  }
}

function applyRemoteState(nextState: DemoState, revision: number): void {
  nextState = normalizeState(cloneState(nextState))
  applyingRemoteUpdate = true
  let changed = false
  try {
    changed = reconcileById(state.players, nextState.players) || changed
    changed = reconcileById(state.tournaments, nextState.tournaments) || changed
  } finally {
    applyingRemoteUpdate = false
  }
  remoteRevision = revision
  pendingLocalSave = false
  if (changed) persistLocalState()
}

function reconcileById<T extends { id: string }>(current: T[], incoming: T[]): boolean {
  const currentById = new Map(current.map((item) => [item.id, item]))
  let changed = false
  const reconciled = incoming.map((incomingItem) => {
    const currentItem = currentById.get(incomingItem.id)
    if (!currentItem) {
      changed = true
      return cloneValue(incomingItem)
    }

    const currentRecord = currentItem as Record<string, unknown>
    const incomingRecord = incomingItem as Record<string, unknown>
    for (const [key, value] of Object.entries(incomingRecord)) {
      if (stableSerialize(currentRecord[key]) !== stableSerialize(value)) {
        changed = true
        currentRecord[key] = cloneValue(value)
      }
    }
    return currentItem
  })

  const collectionChanged = current.length !== reconciled.length || current.some((item, index) => item !== reconciled[index])
  if (collectionChanged) {
    current.splice(0, current.length, ...reconciled)
  }
  return changed || collectionChanged
}

function scheduleCloudSave(): void {
  if (!remoteReady || !isGoogleSheetsConfigured()) return
  if (googleSyncStatus.value === 'conflict') return
  if (!getGoogleAdminKey()) {
    googleSyncStatus.value = 'read-only'
    googleSyncMessage.value = 'Для записи введите ключ администратора.'
    return
  }

  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  googleSyncStatus.value = 'saving'
  googleSyncMessage.value = 'Изменения сохраняются в Google Таблицу.'
  saveTimer = window.setTimeout(() => void saveCloudState(), saveDelayMs)
}

async function saveCloudState(): Promise<boolean> {
  if (saveInProgress) return false
  if (!pendingLocalSave) return true
  const adminKey = getGoogleAdminKey()
  if (!adminKey) {
    googleSyncStatus.value = 'read-only'
    return false
  }

  saveInProgress = true
  const snapshot = normalizeState(cloneState(state))
  const serializedSnapshot = stableSerialize(snapshot)
  const localVersionAtStart = localChangeCount
  const revisionAtStart = remoteRevision
  lastWriteAttempt = { serialized: serializedSnapshot, revision: revisionAtStart }
  googleSyncStatus.value = 'saving'
  googleSyncMessage.value = 'Сохраняю изменения в Google Таблицу…'

  try {
    if (remoteApiVersion < requiredGoogleApiVersion) throw new Error(outdatedGoogleScriptMessage)
    await writeGoogleState(snapshot, adminKey)
    const confirmed = await readGoogleState()
    if (confirmed.apiVersion < requiredGoogleApiVersion) throw new Error(outdatedGoogleScriptMessage)
    if (!confirmed.state) throw new Error('Google Таблица не вернула сохранённые данные после записи.')
    if (confirmed.revision <= revisionAtStart) {
      throw new Error('Google Таблица не приняла запись: номер версии не изменился. Проверьте ключ администратора и журнал выполнения Apps Script.')
    }
    if (stableSerialize(normalizeState(cloneState(confirmed.state))) !== serializedSnapshot) {
      throw new Error('Google Таблица записала данные, но при повторном чтении они отличаются. Проверьте формат данных в журнале выполнения Apps Script.')
    }

    remoteRevision = confirmed.revision
    pendingLocalSave = stableSerialize(normalizeState(cloneState(state))) !== serializedSnapshot
    markPendingSave(pendingLocalSave)
    lastWriteAttempt = null
    try { localStorage.removeItem(retainedHistoryKey) } catch { /* Local storage can be unavailable. */ }
    googleAdminConnected.value = true
    googleSyncStatus.value = pendingLocalSave ? 'saving' : 'connected'
    googleSyncMessage.value = pendingLocalSave
      ? 'Есть новые изменения; продолжаю синхронизацию.'
      : 'Google Таблица подключена, данные синхронизированы.'

    if (pendingLocalSave || localVersionAtStart !== localChangeCount) scheduleCloudSave()
    return true
  } catch (error) {
    googleSyncStatus.value = 'error'
    googleSyncMessage.value = error instanceof Error ? error.message : 'Не удалось записать данные в Google Таблицу.'
    return false
  } finally {
    saveInProgress = false
  }
}

async function pollCloudState(): Promise<void> {
  if (document.visibilityState === 'hidden' || !remoteReady || saveInProgress || pollInProgress) return

  pollInProgress = true
  lastPollAt = Date.now()
  try {
    const remote = await readGoogleState()
    remoteApiVersion = remote.apiVersion
    if (!remote.state || remote.revision <= remoteRevision) return

    if (pendingLocalSave) {
      const remoteSerialized = stableSerialize(normalizeState(cloneState(remote.state)))
      if (lastWriteAttempt && remote.revision > lastWriteAttempt.revision && remoteSerialized === lastWriteAttempt.serialized) {
        remoteRevision = remote.revision
        pendingLocalSave = stableSerialize(normalizeState(cloneState(state))) !== remoteSerialized
        markPendingSave(pendingLocalSave)
        lastWriteAttempt = null
        googleSyncStatus.value = getGoogleAdminKey() ? 'connected' : 'read-only'
        googleSyncMessage.value = 'Google Таблица подтвердила ранее отправленные данные.'
        if (pendingLocalSave) scheduleCloudSave()
        return
      }
      googleSyncStatus.value = 'conflict'
      googleSyncMessage.value = 'В таблице появились другие изменения. Локальные данные пока сохранены в этом браузере.'
      return
    }

    applyRemoteState(remote.state, remote.revision)
    googleSyncStatus.value = getGoogleAdminKey() ? 'connected' : 'read-only'
    googleSyncMessage.value = 'Получены новые данные из Google Таблицы.'
  } catch {
    googleSyncStatus.value = 'error'
    googleSyncMessage.value = 'Не удалось обновить данные из Google Таблицы; повторю попытку позже.'
  } finally {
    pollInProgress = false
  }
}

function startPolling(): void {
  if (pollingTimer !== undefined || !isGoogleSheetsConfigured()) return
  pollingTimer = window.setInterval(() => void pollCloudState(), pollingIntervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPollAt >= pollingIntervalMs) {
      void pollCloudState()
    }
  })
}

export async function initializeGoogleSync(): Promise<void> {
  if (!isGoogleSheetsConfigured()) {
    googleSyncStatus.value = 'local'
    googleSyncMessage.value = 'Google Таблица ещё не настроена; данные хранятся в этом браузере.'
    return
  }

  googleSyncStatus.value = 'connecting'
  googleSyncMessage.value = 'Подключаю Google Таблицу…'
  const initialLocalVersion = localChangeCount

  try {
    const remote = await readGoogleState()
    lastPollAt = Date.now()
    remoteApiVersion = remote.apiVersion
    if (remoteApiVersion < requiredGoogleApiVersion) {
      // Older deployments cannot return hand history; do not replace a local journal with that incomplete snapshot.
      const localHasHistory = state.tournaments.some((tournament) => tournament.hands.length > 0)
      if (localHasHistory) {
        try { localStorage.setItem(retainedHistoryKey, '1') } catch { /* Keep the current in-memory journal. */ }
      }
      if (remote.state && !localHasHistory && localChangeCount === initialLocalVersion) applyRemoteState(remote.state, remote.revision)
      remoteReady = false
      googleAdminConnected.value = false
      googleSyncStatus.value = 'error'
      googleSyncMessage.value = outdatedGoogleScriptMessage
      return
    }
    remoteReady = true
    let hasPendingSave = false
    try { hasPendingSave = localStorage.getItem(pendingSaveKey) === '1' } catch { /* Storage can be unavailable. */ }
    if (hasPendingSave && remote.state) {
      const remoteSerialized = stableSerialize(normalizeState(cloneState(remote.state)))
      if (remoteSerialized === stableSerialize(normalizeState(cloneState(state)))) {
        markPendingSave(false)
      } else {
        remoteRevision = remote.revision
        pendingLocalSave = true
        googleAdminConnected.value = false
        googleSyncStatus.value = 'conflict'
        googleSyncMessage.value = 'В браузере есть несохранённые изменения. Выберите, какие данные сохранить.'
        startPolling()
        return
      }
    }
    let retainedHistory = false
    try { retainedHistory = localStorage.getItem(retainedHistoryKey) === '1' } catch { /* Storage can be unavailable. */ }
    if (retainedHistory && state.tournaments.some((tournament) => tournament.hands.length > 0)) {
      remoteRevision = remote.revision
      pendingLocalSave = true
      googleAdminConnected.value = false
      googleSyncStatus.value = 'conflict'
      googleSyncMessage.value = 'В браузере сохранена история, которую старая версия таблицы не поддерживала. Выберите, какую версию сохранить.'
      startPolling()
      return
    }
    if (remote.state) {
      if (localChangeCount === initialLocalVersion) {
        applyRemoteState(remote.state, remote.revision)
        if (getGoogleAdminKey()) {
          if (isGoogleAdminKeyRemembered()) {
            googleAdminConnected.value = true
            googleSyncStatus.value = 'connected'
            googleSyncMessage.value = 'Данные загружены. Сохранённый доступ к записи активен.'
          } else {
            pendingLocalSave = true
            const verified = await saveCloudState()
            if (!verified) {
              storeGoogleAdminKey('')
              googleAdminConnected.value = false
            }
          }
        } else {
          googleSyncStatus.value = 'read-only'
          googleSyncMessage.value = 'Данные загружены. Для изменений подключите ключ администратора.'
        }
      } else {
        pendingLocalSave = true
        googleSyncStatus.value = 'conflict'
        googleSyncMessage.value = 'Пока загружалась таблица, данные изменили локально. Подключите админ-ключ, чтобы сохранить их.'
      }
    } else {
      remoteRevision = remote.revision
      if (getGoogleAdminKey()) {
        pendingLocalSave = true
        scheduleCloudSave()
      } else {
        googleSyncStatus.value = 'read-only'
        googleSyncMessage.value = 'Таблица пока пуста. Подключите ключ администратора для первой записи.'
      }
    }
    startPolling()
  } catch (error) {
    remoteReady = false
    googleSyncStatus.value = 'error'
    googleSyncMessage.value = error instanceof Error ? error.message : 'Не удалось подключиться к Google Таблице.'
  }
}

export async function connectGoogleAdmin(key: string, remember = false): Promise<void> {
  const normalizedKey = key.trim()
  if (!normalizedKey) throw new Error('Введите ключ администратора из Apps Script.')
  if (!isGoogleSheetsConfigured()) throw new Error('Сначала укажите URL развёрнутого Google Apps Script.')
  if (googleSyncStatus.value === 'conflict') throw new Error('Сначала выберите версию данных: из таблицы или из браузера.')

  storeGoogleAdminKey(normalizedKey, remember)
  googleAdminConnected.value = false
  googleSyncStatus.value = 'connecting'
  googleSyncMessage.value = 'Проверяю ключ администратора…'

  try {
    const remote = await readGoogleState()
    remoteApiVersion = remote.apiVersion
    if (remoteApiVersion < requiredGoogleApiVersion) throw new Error(outdatedGoogleScriptMessage)
    remoteReady = true
    if (pendingLocalSave && remote.state && remote.revision > remoteRevision) {
      const remoteSerialized = stableSerialize(normalizeState(cloneState(remote.state)))
      const currentSerialized = stableSerialize(normalizeState(cloneState(state)))
      if (remoteSerialized === currentSerialized || (lastWriteAttempt && remoteSerialized === lastWriteAttempt.serialized && remote.revision > lastWriteAttempt.revision)) {
        remoteRevision = remote.revision
      } else {
        googleSyncStatus.value = 'conflict'
        throw new Error('Данные таблицы и браузера различаются. Выберите, какую версию сохранить.')
      }
    }
    if (remote.state && !pendingLocalSave) {
      applyRemoteState(remote.state, remote.revision)
    } else if (!remote.state) {
      remoteRevision = remote.revision
      pendingLocalSave = true
    }

    // A same-state write verifies the key with Apps Script without exposing it to the public read endpoint.
    pendingLocalSave = true
    const saved = await saveCloudState()
    if (!saved) throw new Error(googleSyncMessage.value)
    startPolling()
  } catch (error) {
    storeGoogleAdminKey('')
    googleAdminConnected.value = false
    if (googleSyncStatus.value !== 'conflict') googleSyncStatus.value = 'error'
    googleSyncMessage.value = error instanceof Error ? error.message : 'Не удалось подключить админ-доступ.'
    throw error
  }
}

export async function useGoogleTableVersion(): Promise<void> {
  const remote = await readGoogleState()
  if (!remote.state) throw new Error('В Google Таблице нет сохранённых данных.')
  applyRemoteState(remote.state, remote.revision)
  remoteApiVersion = remote.apiVersion
  remoteReady = true
  markPendingSave(false)
  lastWriteAttempt = null
  try { localStorage.removeItem(retainedHistoryKey) } catch { /* Storage can be unavailable. */ }
  googleAdminConnected.value = false
  googleSyncStatus.value = 'read-only'
  googleSyncMessage.value = 'Загружены данные из Google Таблицы. Для записи подключите ключ администратора.'
  startPolling()
}

export async function useBrowserVersion(key: string, remember = false): Promise<void> {
  const normalizedKey = key.trim()
  if (!normalizedKey) throw new Error('Введите ключ администратора из Apps Script.')
  const remote = await readGoogleState()
  if (remote.apiVersion < requiredGoogleApiVersion) throw new Error(outdatedGoogleScriptMessage)
  remoteApiVersion = remote.apiVersion
  remoteRevision = remote.revision
  remoteReady = true
  pendingLocalSave = true
  markPendingSave(true)
  storeGoogleAdminKey(normalizedKey, remember)
  const saved = await saveCloudState()
  if (!saved) throw new Error(googleSyncMessage.value)
  startPolling()
}

export function disconnectGoogleAdmin(): void {
  storeGoogleAdminKey('')
  googleAdminConnected.value = false
  googleSyncStatus.value = remoteReady ? 'read-only' : 'local'
  googleSyncMessage.value = remoteReady
    ? 'Просмотр из Google Таблицы работает; запись отключена.'
    : 'Запись отключена.'
}

watch(state, () => {
  if (applyingRemoteUpdate) return
  persistLocalState()

  localChangeCount += 1
  pendingLocalSave = true
  markPendingSave(true)
  scheduleCloudSave()
}, { deep: true, flush: 'sync' })

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || !event.newValue) return
  try {
    const parsed: unknown = JSON.parse(event.newValue)
    if (!isDemoState(parsed)) return
    applyingRemoteUpdate = true
    const normalized = normalizeState(parsed)
    reconcileById(state.players, normalized.players)
    reconcileById(state.tournaments, normalized.tournaments)
  } catch {
    // Ignore malformed data from another tab.
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
    initialDealerId: null,
    rebuys: {},
    places: {},
    eliminatedInHand: {},
    gameInitialized: false,
    stacks: {},
    hands: [],
    levels: [{ small: 25, big: 50, minutes: 30 }],
    currentLevel: 0,
    secondsRemaining: 1800,
    timerStartedAt: null,
    startedAt: null,
  }
  state.tournaments.push(tournament)
  return tournament
}

export function toggleParticipant(tournament: Tournament, playerId: string): void {
  if (tournament.status !== 'upcoming' || tournament.gameInitialized) return
  if (tournament.participantIds.includes(playerId)) {
    removeParticipantFromTournament(tournament, playerId)
  } else if (tournament.participantIds.length < 10) {
    tournament.participantIds.push(playerId)
  }
}

export function removeParticipantFromTournament(tournament: Tournament, playerId: string): void {
  if (!tournament.participantIds.includes(playerId)) return

  tournament.participantIds = tournament.participantIds.filter((id) => id !== playerId)
  if (tournament.initialDealerId === playerId) tournament.initialDealerId = null
  delete tournament.rebuys[playerId]
  delete tournament.places[playerId]
  delete tournament.eliminatedInHand[playerId]
  delete tournament.stacks[playerId]
  for (const hand of tournament.hands) delete hand.players[playerId]
}

export function moveParticipant(tournament: Tournament, playerId: string, direction: -1 | 1): void {
  if (tournament.status !== 'upcoming' || tournament.gameInitialized) return
  const index = tournament.participantIds.indexOf(playerId)
  const next = index + direction
  if (index < 0 || next < 0 || next >= tournament.participantIds.length) return
  const otherId = tournament.participantIds[next]!
  tournament.participantIds[next] = playerId
  tournament.participantIds[index] = otherId
}

export type InitialRole = 'dealer' | 'smallBlind' | 'bigBlind'

export function setInitialRole(tournament: Tournament, playerId: string, role: InitialRole | null): void {
  if (tournament.status !== 'upcoming' || tournament.gameInitialized || tournament.hands.some((hand) => hand.roles)) return
  if (!role) {
    tournament.initialDealerId = null
    return
  }

  const activeSeats = tournament.participantIds.filter((id) => tournament.places[id] == null)
  const roleIndex = activeSeats.indexOf(playerId)
  if (roleIndex < 0 || activeSeats.length < 2) return

  const roleOffset = role === 'dealer' ? 0 : role === 'smallBlind' ? (activeSeats.length === 2 ? 0 : 1) : (activeSeats.length === 2 ? 1 : 2)
  const dealerIndex = (roleIndex - roleOffset + activeSeats.length) % activeSeats.length
  tournament.initialDealerId = activeSeats[dealerIndex]!
}

export function addPlayer(name: string): DemoState['players'][number] | undefined {
  const normalizedName = name.trim()
  if (!normalizedName) return undefined

  const player = {
    id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
  }
  state.players.push(player)
  return player
}

export function removePlayerFromSeason(playerId: string): void {
  const playerIndex = state.players.findIndex((player) => player.id === playerId)
  if (playerIndex < 0) return

  state.players.splice(playerIndex, 1)
  for (const tournament of state.tournaments) {
    removeParticipantFromTournament(tournament, playerId)
  }
}

export function getCurrentHand(tournament: Tournament) {
  const hand = tournament.hands.at(-1)
  return hand && !hand.settled ? hand : undefined
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
  if (tournament.status === 'finished' || tournament.participantIds.length < 2) return
  if (!tournament.gameInitialized && !tournament.participantIds.includes(tournament.initialDealerId ?? '')) return
  if (!tournament.gameInitialized) {
    tournament.stacks = {}
    tournament.rebuys = {}
    tournament.places = {}
    tournament.eliminatedInHand = {}
    tournament.hands = []
    for (const playerId of tournament.participantIds) {
      tournament.stacks[playerId] = tournament.startingStack
      tournament.rebuys[playerId] = 0
    }
    tournament.gameInitialized = true
  }
  if (tournament.timerStartedAt !== null) return
  const startedAt = Math.floor(Date.now() / 1000) * 1000
  if (tournament.startedAt == null) tournament.startedAt = startedAt
  tournament.timerStartedAt = startedAt
  tournament.status = 'live'
}

export function startNextHand(tournament: Tournament): boolean {
  if (tournament.status !== 'live' || !tournament.gameInitialized || getCurrentHand(tournament)) return false
  const unresolvedElimination = tournament.participantIds.some((id) =>
    tournament.places[id] == null && (tournament.stacks[id] ?? 0) === 0,
  )
  if (unresolvedElimination) return false
  const activeIds = tournament.participantIds.filter((id) => tournament.places[id] == null && (tournament.stacks[id] ?? 0) > 0)
  if (activeIds.length < 2) return false
  const previous = tournament.hands.at(-1)
  const previousDealer = previous?.roles?.dealer ?? tournament.initialDealerId
  if (!previousDealer) return false
  const roles = rolesForHand(tournament.participantIds, activeIds, previousDealer, Boolean(previous?.roles))
  const hand = createPokerHand((previous?.number ?? 0) + 1, activeIds, roles)
  const blindLevel = tournament.levels
    .slice(0, tournament.currentLevel + 1)
    .reverse()
    .find((level) => !level.break && (level.small > 0 || level.big > 0))
  if (blindLevel) postBlinds(hand, blindLevel, tournament.stacks)
  tournament.hands.push(hand)
  return true
}

export function setHandStreet(tournament: Tournament, street: HandStreet): boolean {
  const hand = getCurrentHand(tournament)
  if (!hand) return false

  const streets: HandStreet[] = ['preflop', 'flop', 'turn', 'river']
  const currentIndex = streets.indexOf(hand.street)
  const targetIndex = streets.indexOf(street)
  if (targetIndex < 0) return false
  if (targetIndex > currentIndex) {
    for (const currentStreet of streets.slice(currentIndex, targetIndex)) {
      if (streetActionRequirements(tournament, hand, currentStreet).length > 0) return false
    }
  }
  hand.street = street
  return true
}

export function setHandBet(tournament: Tournament, playerId: string, street: HandStreet, actionIndex: number, amount: number): boolean {
  const hand = getCurrentHand(tournament)
  const player = hand?.players[playerId]
  if (!hand || !player || player.folded || !Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= player.bets[street].length || !Number.isFinite(amount)) return false

  const normalizedAmount = Math.max(0, Math.floor(amount))
  const previousAmount = player.bets[street][actionIndex] ?? 0
  const contributionWithoutAction = playerHandContribution(player) - previousAmount
  if (contributionWithoutAction + normalizedAmount > (tournament.stacks[playerId] ?? 0)) return false

  player.bets[street][actionIndex] = normalizedAmount
  return true
}

export function setHandAction(tournament: Tournament, playerId: string, street: HandStreet, actionIndex: number, action: PokerActionType | null): boolean {
  const hand = getCurrentHand(tournament)
  const player = hand?.players[playerId]
  if (!hand || !player || player.folded || !Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= player.bets[street].length) return false
  if (action === 'check' && ((player.bets[street][actionIndex] ?? 0) > 0 || !canPlayerCheck(hand, playerId, street, actionIndex))) return false
  const automaticBlind = street === 'preflop' && actionIndex === 0 && (
    playerId === hand.roles?.smallBlind || playerId === hand.roles?.bigBlind
  )
  if (automaticBlind && action !== player.actions[street][actionIndex]) return false
  player.actions[street][actionIndex] = action
  return true
}

export function addHandBetActionColumn(tournament: Tournament, street: HandStreet): boolean {
  const hand = getCurrentHand(tournament)
  if (!hand || hand.settled) return false
  for (const player of Object.values(hand.players)) {
    player.bets[street].push(0)
    player.actions[street].push(null)
  }
  return true
}

export function setHandFolded(tournament: Tournament, playerId: string, folded: boolean): void {
  const hand = getCurrentHand(tournament)
  const player = hand?.players[playerId]
  if (!hand || !player) return

  player.folded = folded
  player.foldedOn = folded ? hand.street : null
  if (folded) {
    player.takesPot = false
    const currentStreetIndex = ['preflop', 'flop', 'turn', 'river'].indexOf(hand.street)
    for (const street of ['preflop', 'flop', 'turn', 'river'].slice(currentStreetIndex + 1) as HandStreet[]) {
      player.bets[street].fill(0)
      player.actions[street].fill(null)
    }
  }
}

export function setHandWinner(tournament: Tournament, playerId: string, takesPot: boolean): void {
  const hand = getCurrentHand(tournament)
  const player = hand?.players[playerId]
  if (!hand || !player || player.folded) return
  player.takesPot = takesPot
}

export function settleCurrentHand(tournament: Tournament): boolean {
  const hand = getCurrentHand(tournament)
  if (!hand || streetActionRequirements(tournament, hand, hand.street).length > 0) return false
  return settlePokerHand(tournament, hand)
}

export function canPlayerRebuy(tournament: Tournament, playerId: string, now = Date.now()): boolean {
  if (tournament.status !== 'live' || !tournament.gameInitialized || getCurrentHand(tournament)) return false
  if (tournament.places[playerId] != null || (tournament.stacks[playerId] ?? 0) > 0) return false
  if ((tournament.rebuys[playerId] ?? 0) >= tournament.maxRebuys) return false
  return isBeforeKrasnoyarskCutoff(tournament.startedAt, tournament.rebuyUntil, now)
}

export function rebuyPlayer(tournament: Tournament, playerId: string, now = Date.now()): boolean {
  if (!canPlayerRebuy(tournament, playerId, now)) return false
  tournament.stacks[playerId] = tournament.startingStack
  tournament.rebuys[playerId] = (tournament.rebuys[playerId] ?? 0) + 1
  return true
}

export function confirmPlayerElimination(tournament: Tournament, playerId: string): boolean {
  if (tournament.status !== 'live' || !tournament.gameInitialized || getCurrentHand(tournament)) return false
  if ((tournament.stacks[playerId] ?? 0) !== 0 || tournament.places[playerId] != null) return false

  const alive = tournament.participantIds.filter((id) => tournament.places[id] == null)
  if (alive.length < 2 || !alive.includes(playerId)) return false
  const handNumber = tournament.hands.at(-1)?.number ?? 0
  const simultaneousPlayerId = tournament.participantIds.find((id) =>
    id !== playerId && tournament.eliminatedInHand[id] === handNumber && tournament.places[id] != null,
  )
  tournament.places[playerId] = simultaneousPlayerId ? tournament.places[simultaneousPlayerId]! : alive.length
  tournament.eliminatedInHand[playerId] = handNumber

  const survivors = alive.filter((id) => id !== playerId)
  if (survivors.length === 1) {
    tournament.places[survivors[0]!] = 1
    finishTournament(tournament)
  }
  return true
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
  if (!tournament.gameInitialized || tournament.status === 'finished' || getCurrentHand(tournament)) return
  const remaining = tournament.participantIds
    .filter((id) => tournament.places[id] == null)
    .sort((left, right) => (tournament.stacks[right] ?? 0) - (tournament.stacks[left] ?? 0))
  let place = 1
  for (let index = 0; index < remaining.length; index += 1) {
    const playerId = remaining[index]!
    const previousId = remaining[index - 1]
    if (previousId && tournament.stacks[previousId] === tournament.stacks[playerId]) {
      tournament.places[playerId] = tournament.places[previousId]!
    } else {
      tournament.places[playerId] = place
    }
    place = index + 2
  }
  tournament.status = 'finished'
  pauseTimer(tournament)
}
