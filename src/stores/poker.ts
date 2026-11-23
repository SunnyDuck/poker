import { reactive, ref, watch } from 'vue'
import { createDemoState } from '@/domain/demoData'
import type { DemoState, Tournament } from '@/domain/types'
import {
  getGoogleAdminKey,
  isGoogleSheetsConfigured,
  readGoogleState,
  storeGoogleAdminKey,
  writeGoogleState,
} from '@/services/googleSheets'

const storageKey = 'friendly-poker-demo-v1'
const pollingIntervalMs = 5_000
const saveDelayMs = 500

export type GoogleSyncStatus = 'local' | 'connecting' | 'read-only' | 'connected' | 'saving' | 'error' | 'conflict'

export const googleSyncStatus = ref<GoogleSyncStatus>('local')
export const googleSyncMessage = ref('')
export const googleAdminConnected = ref(false)

let applyingRemoteUpdate = false
let remoteReady = false
let remoteRevision = 0
let pendingLocalSave = false
let localChangeCount = 0
let saveTimer: number | undefined
let pollingTimer: number | undefined
let saveInProgress = false

function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DemoState>
  return Array.isArray(candidate.players) && Array.isArray(candidate.tournaments)
}

function cloneState(value: DemoState): DemoState {
  return JSON.parse(JSON.stringify(value)) as DemoState
}

function loadState(): DemoState {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (isDemoState(parsed)) return parsed
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
  applyingRemoteUpdate = true
  state.players.splice(0, state.players.length, ...nextState.players)
  state.tournaments.splice(0, state.tournaments.length, ...nextState.tournaments)
  applyingRemoteUpdate = false
  remoteRevision = revision
  pendingLocalSave = false
  persistLocalState()
}

function scheduleCloudSave(): void {
  if (!remoteReady || !isGoogleSheetsConfigured()) return
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
  const snapshot = cloneState(state)
  const serializedSnapshot = JSON.stringify(snapshot)
  const localVersionAtStart = localChangeCount
  const revisionAtStart = remoteRevision
  googleSyncStatus.value = 'saving'
  googleSyncMessage.value = 'Сохраняю изменения в Google Таблицу…'

  try {
    await writeGoogleState(snapshot, adminKey)
    const confirmed = await readGoogleState()
    if (!confirmed.state || JSON.stringify(confirmed.state) !== serializedSnapshot || confirmed.revision <= revisionAtStart) {
      throw new Error('Google Таблица не подтвердила сохранение. Проверьте ключ администратора и доступ к таблице.')
    }

    remoteRevision = confirmed.revision
    pendingLocalSave = JSON.stringify(state) !== serializedSnapshot
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
  if (document.visibilityState === 'hidden' || !remoteReady || saveInProgress) return

  try {
    const remote = await readGoogleState()
    if (!remote.state || remote.revision <= remoteRevision) return

    if (pendingLocalSave) {
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
  }
}

function startPolling(): void {
  if (pollingTimer !== undefined || !isGoogleSheetsConfigured()) return
  pollingTimer = window.setInterval(() => void pollCloudState(), pollingIntervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollCloudState()
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
    remoteReady = true
    if (remote.state) {
      if (localChangeCount === initialLocalVersion) {
        applyRemoteState(remote.state, remote.revision)
        if (getGoogleAdminKey()) {
          pendingLocalSave = true
          const verified = await saveCloudState()
          if (!verified) {
            storeGoogleAdminKey('')
            googleAdminConnected.value = false
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

export async function connectGoogleAdmin(key: string): Promise<void> {
  const normalizedKey = key.trim()
  if (!normalizedKey) throw new Error('Введите ключ администратора из Apps Script.')
  if (!isGoogleSheetsConfigured()) throw new Error('Сначала укажите URL развёрнутого Google Apps Script.')

  storeGoogleAdminKey(normalizedKey)
  googleAdminConnected.value = true
  googleSyncStatus.value = 'connecting'
  googleSyncMessage.value = 'Проверяю ключ администратора…'

  try {
    const remote = await readGoogleState()
    remoteReady = true
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
    googleSyncStatus.value = 'error'
    googleSyncMessage.value = error instanceof Error ? error.message : 'Не удалось подключить админ-доступ.'
    throw error
  }
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
  persistLocalState()
  if (applyingRemoteUpdate) return

  localChangeCount += 1
  pendingLocalSave = true
  scheduleCloudSave()
}, { deep: true, flush: 'sync' })

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || !event.newValue) return
  try {
    const parsed: unknown = JSON.parse(event.newValue)
    if (!isDemoState(parsed)) return
    applyingRemoteUpdate = true
    state.players.splice(0, state.players.length, ...parsed.players)
    state.tournaments.splice(0, state.tournaments.length, ...parsed.tournaments)
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
