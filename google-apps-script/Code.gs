/**
 * @OnlyCurrentDoc
 */

const DATA_SHEET_NAME = '_PokerData'
const PLAYERS_SHEET_NAME = 'Участники'
const ACTIONS_SHEET_NAME = 'Журнал действий'
const READABLE_SCHEMA_VERSION = 'readable-v1'
const ADMIN_KEY_PROPERTY = 'FRIENDLY_POKER_ADMIN_KEY'
const SPREADSHEET_ID_PROPERTY = 'FRIENDLY_POKER_SPREADSHEET_ID'
const MAX_STATE_LENGTH = 450000
const API_VERSION = 6
const KRASNOYARSK_TIME_ZONE = 'Asia/Krasnoyarsk'
const TOURNAMENT_SECTION_ROW = 16
const TABLE_HEADER_ROW = 17
const TABLE_DATA_ROW = 18

/**
 * Run once for a new spreadsheet. The generated write key is shown in the execution log.
 * On an existing installation use migrateToReadableSheets() to preserve the current key.
 */
function setupPokerDatabase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Open Apps Script from the target Google Sheet first.')
  const properties = PropertiesService.getScriptProperties()
  const existingAdminKey = properties.getProperty(ADMIN_KEY_PROPERTY)
  if (existingAdminKey) {
    const configuredSpreadsheetId = properties.getProperty(SPREADSHEET_ID_PROPERTY)
    if (configuredSpreadsheetId && configuredSpreadsheetId !== spreadsheet.getId()) {
      throw new Error('This Apps Script is already configured for another spreadsheet. The existing admin key and database were not changed.')
    }
    console.log('Database already initialized. The existing admin key and database were not changed. To publish code updates, use Deploy > Manage deployments; do not run setupPokerDatabase again.')
    return
  }
  properties.setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId())

  const dataSheet = ensureDataSheet_(spreadsheet)
  ensurePlayersSheet_(spreadsheet)
  dataSheet.hideSheet()

  const adminKey = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')
  properties.setProperty(ADMIN_KEY_PROPERTY, adminKey)
  console.log('Friendly Poker admin key (copy it into the app; do not publish it): ' + adminKey)
  console.log('Database sheet initialized: ' + spreadsheet.getUrl())
}

/**
 * Convert the existing JSON snapshot into readable tabs without rotating the admin key.
 * Run this once after saving the updated script in an existing spreadsheet project.
 */
function migrateToReadableSheets() {
  const spreadsheet = getConfiguredSpreadsheet_()
  const dataSheet = ensureDataSheet_(spreadsheet)
  if (String(dataSheet.getRange('B4').getValue()) === READABLE_SCHEMA_VERSION) {
    console.log('The spreadsheet already uses readable tournament tabs.')
    return
  }

  const stateJson = String(dataSheet.getRange('B2').getValue() || '')
  if (!stateJson) throw new Error('There is no saved state to migrate. The first app save will create the readable tabs.')

  const state = JSON.parse(stateJson)
  if (!isValidState_(state)) throw new Error('The saved state is invalid; no sheets were changed.')
  writeReadableState_(spreadsheet, state, dataSheet)
  console.log('Migrated ' + state.players.length + ' players and ' + state.tournaments.length + ' tournaments.')
}

function doGet(event) {
  const action = event && event.parameter && event.parameter.action
  if (action && action !== 'read') return output_({ ok: false, error: 'Unknown action' })

  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(10000)
    const spreadsheet = getConfiguredSpreadsheet_()
    const dataSheet = ensureDataSheet_(spreadsheet)
    const state = readState_(spreadsheet, dataSheet)
    const revision = Number(dataSheet.getRange('B3').getValue()) || 0
    const callback = event && event.parameter && event.parameter.callback
    return output_({ ok: true, state: state, revision: revision, apiVersion: API_VERSION }, callback)
  } catch (error) {
    console.error('Google Sheets read failed: ' + String(error))
    return output_({ ok: false, error: 'Could not read the tournament data.' }, event && event.parameter && event.parameter.callback)
  } finally {
    if (lock.hasLock()) lock.releaseLock()
  }
}

function doPost(event) {
  const parameters = event && event.parameter ? event.parameter : {}
  if (parameters.action !== 'write') return output_({ ok: false, error: 'Unknown action' })

  const expectedKey = PropertiesService.getScriptProperties().getProperty(ADMIN_KEY_PROPERTY)
  if (!expectedKey || !sameSecret_(String(parameters.adminKey || ''), expectedKey)) {
    return output_({ ok: false, error: 'Invalid admin key' })
  }

  const payload = String(parameters.payload || '')
  if (payload.length === 0 || payload.length > MAX_STATE_LENGTH) {
    return output_({ ok: false, error: 'Invalid state size' })
  }

  let state
  try {
    state = JSON.parse(payload)
  } catch (error) {
    return output_({ ok: false, error: 'Invalid state JSON' })
  }
  if (!isValidState_(state)) return output_({ ok: false, error: 'Invalid state shape' })

  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(10000)
    const spreadsheet = getConfiguredSpreadsheet_()
    const dataSheet = ensureDataSheet_(spreadsheet)
    const revision = Number(dataSheet.getRange('B3').getValue()) || 0
    writeReadableState_(spreadsheet, state, dataSheet)
    dataSheet.getRange('B3').setValue(revision + 1)
    return output_({ ok: true, revision: revision + 1 })
  } catch (error) {
    console.error('Google Sheets write failed: ' + String(error))
    return output_({ ok: false, error: 'Could not save the tournament data.' })
  } finally {
    if (lock.hasLock()) lock.releaseLock()
  }
}

function readState_(spreadsheet, dataSheet) {
  if (String(dataSheet.getRange('B4').getValue()) === READABLE_SCHEMA_VERSION) {
    return readReadableState_(spreadsheet, dataSheet)
  }

  const stateJson = String(dataSheet.getRange('B2').getValue() || '')
  return stateJson ? JSON.parse(stateJson) : null
}

function readReadableState_(spreadsheet, dataSheet) {
  const playersSheet = spreadsheet.getSheetByName(PLAYERS_SHEET_NAME)
  const players = []
  if (playersSheet && playersSheet.getLastRow() > 1) {
    const rows = playersSheet.getRange(2, 1, playersSheet.getLastRow() - 1, 2).getValues()
    rows.forEach(function (row) {
      if (row[1] !== '' && row[1] !== null) players.push({ id: String(row[1]), name: String(row[0] || '') })
    })
  }

  const idJson = String(dataSheet.getRange('B5').getValue() || '').trim()
  const tournamentIds = idJson ? JSON.parse(idJson) : findActiveTournamentIds_(spreadsheet)
  if (!Array.isArray(tournamentIds)) throw new Error('Invalid tournament index')
  const tournaments = tournamentIds.map(function (id) {
    const sheet = findTournamentSheet_(spreadsheet, String(id))
    return sheet ? readTournamentSheet_(sheet) : null
  }).filter(Boolean)

  return { players: players, tournaments: tournaments }
}

function findActiveTournamentIds_(spreadsheet) {
  return spreadsheet.getSheets().map(function (sheet) {
    if (sheet.getName().indexOf('Архив — ') === 0 || sheet.getMaxRows() < 3 || sheet.getMaxColumns() < 2) return null
    const marker = sheet.getRange(3, 1, 1, 2).getValues()[0]
    return String(marker[0]) === 'ID турнира' && marker[1] ? String(marker[1]) : null
  }).filter(Boolean)
}

function readTournamentSheet_(sheet) {
  const metadata = sheet.getRange(2, 1, 14, 2).getValues().map(function (row) { return row[1] })
  const storedHeaderRow = String(sheet.getRange(TABLE_HEADER_ROW, 1).getValue()) === 'Участник'
    ? TABLE_HEADER_ROW
    : TABLE_HEADER_ROW - 1
  const storedDataRow = storedHeaderRow + 1
  const tournament = {
    title: String(metadata[0] || ''),
    id: String(metadata[1] || ''),
    date: parseSheetDate_(metadata[2]),
    startTime: parseSheetTime_(metadata[3], sheet),
    status: statusFromSheet_(metadata[4]),
    buyIn: Number(metadata[5]) || 0,
    startingStack: Number(metadata[6]) || 0,
    rebuyCost: Number(metadata[7]) || 0,
    maxRebuys: Number(metadata[8]) || 0,
    rebuyUntil: parseSheetTime_(metadata[9], sheet),
    currentLevel: Math.max(0, (Number(metadata[10]) || 1) - 1),
    secondsRemaining: Number(metadata[11]) || 0,
    timerStartedAt: metadata[12] ? Date.parse(String(metadata[12])) : null,
    startedAt: metadata[13] ? parseKrasnoyarskTimestamp_(metadata[13]) : null,
    participantIds: [],
    initialDealerId: sheet.getMaxColumns() >= 12 ? String(sheet.getRange(4, 12).getValue() || '') || null : null,
    rebuys: {},
    places: {},
    eliminatedInHand: {},
    gameInitialized: String(sheet.getRange(2, 12).getValue()) === 'Да',
    stacks: {},
    hands: [],
    levels: [],
  }
  if (!Number.isFinite(tournament.timerStartedAt)) tournament.timerStartedAt = null
  const tournamentExtras = readJsonChunks_(sheet, 6, 12)
  if (tournamentExtras) {
    if (Array.isArray(tournamentExtras.operationHistory)) tournament.operationHistory = tournamentExtras.operationHistory
    if (Number.isFinite(tournamentExtras.startedAt)) tournament.startedAt = tournamentExtras.startedAt
  }

  const lastRow = sheet.getLastRow()
  if (lastRow >= storedDataRow) {
    const rowCount = lastRow - storedDataRow + 1
    const participantRows = sheet.getRange(storedDataRow, 1, rowCount, 3).getValues()
    const participantIds = sheet.getRange(storedDataRow, 4, rowCount, 1).getValues()
    participantRows.forEach(function (row, index) {
      const id = String(participantIds[index][0] || '')
      if (!id) return
      tournament.participantIds.push(id)
      const place = Number(row[1])
      const rebuys = Number(row[2])
      if (row[1] !== '' && Number.isFinite(place) && place > 0) tournament.places[id] = place
      if (row[2] !== '' && Number.isFinite(rebuys) && rebuys >= 0) tournament.rebuys[id] = rebuys
    })

    if (tournament.participantIds.length && String(sheet.getRange(TABLE_HEADER_ROW, 11).getValue()) === 'Участник') {
      const hasEliminationHand = String(sheet.getRange(TABLE_HEADER_ROW, 16).getValue()) === 'Вылет · раздача'
      const playerStateRows = sheet.getRange(storedDataRow, 11, tournament.participantIds.length, hasEliminationHand ? 6 : 5).getValues()
      playerStateRows.forEach(function (row) {
        const id = String(row[4] || '')
        if (!id) return
        const stack = Number(row[1])
        const entries = Number(row[2])
        const place = Number(row[3])
        if (row[1] !== '' && Number.isFinite(stack) && stack >= 0) tournament.stacks[id] = stack
        if (Number.isFinite(entries) && entries >= 1) tournament.rebuys[id] = entries - 1
        if (row[3] !== '' && Number.isFinite(place) && place > 0) tournament.places[id] = place
        if (hasEliminationHand) {
          const handNumber = Number(row[5])
          if (row[5] !== '' && Number.isFinite(handNumber) && handNumber >= 0) tournament.eliminatedInHand[id] = handNumber
        }
      })
    }

    const levelRows = sheet.getRange(storedDataRow, 6, rowCount, 5).getValues()
    levelRows.forEach(function (row) {
      if (row[0] === '' || row[0] === null) return
      const level = {
        small: Number(row[1]) || 0,
        big: Number(row[2]) || 0,
        minutes: Number(row[3]) || 0,
      }
      if (row[4] === true || String(row[4]).toLocaleLowerCase() === 'да') level.break = true
      tournament.levels.push(level)
    })

    if (String(sheet.getRange(TABLE_HEADER_ROW, 17).getValue()) === 'Раздача') {
      const hasRoles = sheet.getMaxColumns() >= 28 && String(sheet.getRange(TABLE_HEADER_ROW, 28).getValue()) === 'Роли'
      const hasActionDetails = sheet.getMaxColumns() >= 32 && String(sheet.getRange(TABLE_HEADER_ROW, 29).getValue()) === 'Действия префлоп'
      const hasFoldStreet = sheet.getMaxColumns() >= 33 && String(sheet.getRange(TABLE_HEADER_ROW, 33).getValue()) === 'Фолд на улице'
      const handRows = sheet.getRange(storedDataRow, 17, rowCount, hasFoldStreet ? 17 : hasActionDetails ? 16 : hasRoles ? 12 : 11).getValues()
      const handsByNumber = {}
      const handExtrasByNumber = {}
      handRows.forEach(function (row, rowIndex) {
        const number = Number(row[0])
        const id = String(row[1] || '')
        if (!Number.isFinite(number) || number < 1 || !id) return
        if (!handsByNumber[number]) {
          handsByNumber[number] = {
            number: number,
            street: String(row[9] || 'preflop'),
            players: {},
            settled: row[10] === true || String(row[10]).toLocaleLowerCase() === 'да',
            roles: null,
          }
          const extras = readJsonChunks_(sheet, storedDataRow + rowIndex, 34) || {}
          handExtrasByNumber[number] = extras
          ;['bigBlind', 'potWinners', 'settlement', 'startedAt', 'endedAt', 'events'].forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(extras, key)) handsByNumber[number][key] = extras[key]
          })
        }
        const streetTotals = {
          preflop: Number(row[3]) || 0,
          flop: Number(row[4]) || 0,
          turn: Number(row[5]) || 0,
          river: Number(row[6]) || 0,
        }
        const parsedActions = hasActionDetails ? {
          preflop: parseStreetActions_(row[12], streetTotals.preflop),
          flop: parseStreetActions_(row[13], streetTotals.flop),
          turn: parseStreetActions_(row[14], streetTotals.turn),
          river: parseStreetActions_(row[15], streetTotals.river),
        } : null
        const bets = parsedActions ? {
          preflop: parsedActions.preflop.bets,
          flop: parsedActions.flop.bets,
          turn: parsedActions.turn.bets,
          river: parsedActions.river.bets,
        } : streetTotals
        const folded = row[7] === true || String(row[7]).toLocaleLowerCase() === 'да'
        const savedFoldStreet = String(row[16] || '')
        const playerState = {
          bets: bets,
          folded: folded,
          foldedOn: hasFoldStreet && ['preflop', 'flop', 'turn', 'river'].indexOf(savedFoldStreet) >= 0 ? savedFoldStreet : null,
          takesPot: row[8] === true || String(row[8]).toLocaleLowerCase() === 'да',
        }
        if (parsedActions && ((handExtrasByNumber[number].actionPlayerIds || []).indexOf(id) >= 0 || Object.keys(parsedActions).some(function (street) {
          return parsedActions[street].actions.some(function (action) { return action !== null })
        }))) {
          playerState.actions = {
            preflop: parsedActions.preflop.actions,
            flop: parsedActions.flop.actions,
            turn: parsedActions.turn.actions,
            river: parsedActions.river.actions,
          }
        }
        handsByNumber[number].players[id] = playerState
        if (hasRoles && row[11]) {
          const roles = handsByNumber[number].roles || { dealer: '', smallBlind: '', bigBlind: '' }
          const labels = String(row[11]).split(',').map(function (label) { return label.trim() })
          if (labels.indexOf('Д') >= 0) roles.dealer = id
          if (labels.indexOf('МБ') >= 0) roles.smallBlind = id
          if (labels.indexOf('ББ') >= 0) roles.bigBlind = id
          handsByNumber[number].roles = roles
        }
      })
      tournament.hands = Object.keys(handsByNumber).map(function (number) { return handsByNumber[number] })
        .sort(function (left, right) { return left.number - right.number })
      if (tournament.hands.length) tournament.gameInitialized = true
    }
  }
  if (Object.keys(tournament.stacks).length) tournament.gameInitialized = true
  return tournament
}

function writeReadableState_(spreadsheet, state, dataSheet) {
  writePlayersSheet_(spreadsheet, state.players)
  const activeIds = state.tournaments.map(function (tournament) { return tournament.id })
  const playerNames = {}
  state.players.forEach(function (player) { playerNames[player.id] = player.name })
  state.tournaments.forEach(function (tournament) {
    writeTournamentSheet_(spreadsheet, tournament, playerNames)
  })
  writeActionsSheet_(spreadsheet, state.tournaments, playerNames)
  archiveInactiveTournamentSheets_(spreadsheet, activeIds)

  dataSheet.getRange('B4:B5').setValues([[READABLE_SCHEMA_VERSION], [JSON.stringify(activeIds)]])
  if (!dataSheet.isSheetHidden()) dataSheet.hideSheet()
}

function writePlayersSheet_(spreadsheet, players) {
  let sheet = spreadsheet.getSheetByName(PLAYERS_SHEET_NAME)
  if (!sheet) sheet = spreadsheet.insertSheet(PLAYERS_SHEET_NAME)
  clearSheetContents_(sheet)

  const rows = [['Имя', 'ID игрока']].concat(players.map(function (player) { return [player.name, player.id] }))
  sheet.getRange(1, 1, rows.length, 2).setValues(rows)
  sheet.setFrozenRows(1)
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.setColumnWidth(1, 240)
  sheet.setColumnWidth(2, 180)
  sheet.showColumns(1, 2)
  sheet.hideColumns(2)
  if (players.length) sheet.getRange(1, 1, rows.length, 2).createFilter()
  sheet.setTabColor('#537b61')
}

function writeTournamentSheet_(spreadsheet, tournament, playerNames) {
  let sheet = findTournamentSheet_(spreadsheet, tournament.id)
  if (!sheet) sheet = spreadsheet.insertSheet(uniqueSheetName_(spreadsheet, tournament.title, null))
  else {
    const nextName = uniqueSheetName_(spreadsheet, tournament.title, sheet)
    if (sheet.getName() !== nextName) sheet.setName(nextName)
  }
  clearSheetContents_(sheet)
  if (sheet.getMaxColumns() < 33) sheet.insertColumnsAfter(sheet.getMaxColumns(), 33 - sheet.getMaxColumns())

  const metadata = [
    ['Параметр', 'Значение'],
    ['Турнир', tournament.title],
    ['ID турнира', tournament.id],
    ['Дата', displaySheetDate_(tournament.date)],
    ['Начало', tournament.startTime],
    ['Статус', statusToSheet_(tournament.status)],
    ['Взнос, ₽', tournament.buyIn],
    ['Стартовый стек', tournament.startingStack],
    ['Стоимость докупки, ₽', tournament.buyIn],
    ['Лимит докупок', tournament.maxRebuys],
    ['Докупки до', tournament.rebuyUntil],
    ['Текущий уровень', Number(tournament.currentLevel) + 1],
    ['Осталось секунд', tournament.secondsRemaining],
    ['Таймер запущен', tournament.timerStartedAt === null ? '' : new Date(tournament.timerStartedAt).toISOString()],
    ['Фактический старт (Красноярск)', tournament.startedAt == null ? '' : formatKrasnoyarskTimestamp_(tournament.startedAt)],
  ]
  sheet.getRange(15, 2).setNumberFormat('@')
  sheet.getRange(5, 2).setNumberFormat('@')
  sheet.getRange(11, 2).setNumberFormat('@')
  sheet.getRange(1, 1, metadata.length, 2).setValues(metadata)
  sheet.getRange(2, 11, 1, 2).setValues([['Учёт раздач', tournament.gameInitialized ? 'Да' : 'Нет']])
  sheet.getRange(4, 11, 1, 2).setValues([['Первый дилер (ID)', tournament.initialDealerId || '']])
  const tournamentExtras = {}
  if (tournament.operationHistory !== undefined) tournamentExtras.operationHistory = tournament.operationHistory
  if (tournament.startedAt != null && tournament.startedAt % 1000 !== 0) tournamentExtras.startedAt = tournament.startedAt
  if (Object.keys(tournamentExtras).length) writeJsonChunks_(sheet, 6, 12, tournamentExtras)
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(2, 1, metadata.length - 1, 1).setFontWeight('bold')
  sheet.getRange(TOURNAMENT_SECTION_ROW, 1, 1, 3).setValues([['УЧАСТНИКИ', '', '']])
  sheet.getRange(TOURNAMENT_SECTION_ROW, 6, 1, 5).setValues([['УРОВНИ БЛАЙНДОВ', '', '', '', '']])
  sheet.getRange(TABLE_HEADER_ROW, 1, 1, 3).setValues([['Участник', 'Место (авто)', 'Докупки (авто)']])
  sheet.getRange(TABLE_HEADER_ROW, 4).setValue('ID игрока')
  sheet.getRange(TABLE_HEADER_ROW, 6, 1, 5).setValues([['Уровень', 'Малый блайнд', 'Большой блайнд', 'Минуты', 'Перерыв']])
  sheet.getRange(TOURNAMENT_SECTION_ROW, 11, 1, 6).setValues([['СОСТОЯНИЕ ИГРОКОВ', '', '', '', '', '']])
  sheet.getRange(TABLE_HEADER_ROW, 11, 1, 6).setValues([['Участник', 'Фишки', 'Входов', 'Место', 'ID игрока', 'Вылет · раздача']])
  sheet.getRange(TOURNAMENT_SECTION_ROW, 17, 1, 17).setValues([['ИСТОРИЯ РАЗДАЧ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']])
  sheet.getRange(TABLE_HEADER_ROW, 17, 1, 17).setValues([['Раздача', 'ID игрока', 'Игрок', 'Префлоп · всего', 'Флоп · всего', 'Тёрн · всего', 'Ривер · всего', 'Фолд', 'Забирает банк', 'Текущая улица', 'Завершена', 'Роли', 'Действия префлоп', 'Действия флоп', 'Действия тёрн', 'Действия ривер', 'Фолд на улице']])

  const participants = tournament.participantIds.map(function (id) {
    const place = tournament.places[id]
    const rebuys = tournament.rebuys[id]
    return [playerNames[id] || 'Неизвестный участник', place === undefined ? '' : place, rebuys === undefined ? '' : rebuys]
  })
  if (participants.length) {
    sheet.getRange(TABLE_DATA_ROW, 1, participants.length, 3).setValues(participants)
    sheet.getRange(TABLE_DATA_ROW, 4, participants.length, 1).setValues(tournament.participantIds.map(function (id) { return [id] }))
  }

  const playerStates = tournament.participantIds.map(function (id) {
    const hasStack = Object.prototype.hasOwnProperty.call(tournament.stacks || {}, id)
    const entries = 1 + (Number((tournament.rebuys || {})[id]) || 0)
    const hasEntries = tournament.gameInitialized || Object.prototype.hasOwnProperty.call(tournament.rebuys || {}, id)
    const handNumber = (tournament.eliminatedInHand || {})[id]
    return [playerNames[id] || 'Неизвестный участник', hasStack ? tournament.stacks[id] : '', hasEntries ? entries : '', tournament.places[id] === undefined ? '' : tournament.places[id], id, handNumber === undefined ? '' : handNumber]
  })
  if (playerStates.length) sheet.getRange(TABLE_DATA_ROW, 11, playerStates.length, 6).setValues(playerStates)

  const handRows = []
  const handExtras = []
  ;(tournament.hands || []).forEach(function (hand) {
    const extras = {}
    ;['bigBlind', 'potWinners', 'settlement', 'startedAt', 'endedAt', 'events'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(hand, key)) extras[key] = hand[key]
    })
    const actionPlayerIds = Object.keys(hand.players || {}).filter(function (id) { return Boolean(hand.players[id].actions) })
    if (actionPlayerIds.length) extras.actionPlayerIds = actionPlayerIds
    if (Object.keys(extras).length) handExtras.push({ row: TABLE_DATA_ROW + handRows.length, value: extras })
    Object.keys(hand.players || {}).forEach(function (id) {
      const player = hand.players[id]
      handRows.push([
        hand.number,
        id,
        playerNames[id] || 'Неизвестный участник',
        streetTotal_(player.bets, 'preflop'),
        streetTotal_(player.bets, 'flop'),
        streetTotal_(player.bets, 'turn'),
        streetTotal_(player.bets, 'river'),
        player.folded ? 'Да' : 'Нет',
        player.takesPot ? 'Да' : 'Нет',
        hand.street,
        hand.settled ? 'Да' : 'Нет',
        hand.roles ? [hand.roles.dealer === id ? 'Д' : '', hand.roles.smallBlind === id ? 'МБ' : '', hand.roles.bigBlind === id ? 'ББ' : ''].filter(Boolean).join(', ') : '',
        streetActionsForSheet_(player.bets, player.actions, 'preflop'),
        streetActionsForSheet_(player.bets, player.actions, 'flop'),
        streetActionsForSheet_(player.bets, player.actions, 'turn'),
        streetActionsForSheet_(player.bets, player.actions, 'river'),
        player.foldedOn || '',
      ])
    })
  })
  if (handRows.length) {
    const requiredLastRow = TABLE_DATA_ROW + handRows.length - 1
    if (sheet.getMaxRows() < requiredLastRow) sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows())
    sheet.getRange(TABLE_DATA_ROW, 17, handRows.length, 17).setValues(handRows)
  }
  handExtras.forEach(function (entry) { writeJsonChunks_(sheet, entry.row, 34, entry.value) })

  const levels = tournament.levels.map(function (level, index) {
    return [index + 1, level.small, level.big, level.minutes, level.break ? 'Да' : 'Нет']
  })
  if (levels.length) sheet.getRange(TABLE_DATA_ROW, 6, levels.length, 5).setValues(levels)

  sheet.setFrozenRows(1)
  sheet.getRange(TOURNAMENT_SECTION_ROW, 1, 2, 3).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(TOURNAMENT_SECTION_ROW, 6, 2, 5).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(TOURNAMENT_SECTION_ROW, 11, 2, 6).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(TOURNAMENT_SECTION_ROW, 17, 2, 17).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(TABLE_HEADER_ROW, 4).setFontWeight('bold').setBackground('#dfe9e2')
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 33).setVerticalAlignment('middle')
  sheet.setColumnWidth(1, 210)
  sheet.setColumnWidth(2, 90)
  sheet.setColumnWidth(3, 105)
  sheet.setColumnWidth(4, 180)
  sheet.setColumnWidth(5, 28)
  sheet.setColumnWidth(6, 105)
  sheet.setColumnWidth(7, 130)
  sheet.setColumnWidth(8, 140)
  sheet.setColumnWidth(9, 105)
  sheet.setColumnWidth(10, 90)
  sheet.setColumnWidth(11, 210)
  sheet.setColumnWidth(12, 95)
  sheet.setColumnWidth(13, 95)
  sheet.setColumnWidth(14, 85)
  sheet.setColumnWidth(15, 150)
  sheet.setColumnWidth(16, 105)
  sheet.setColumnWidth(17, 85)
  sheet.setColumnWidth(18, 150)
  sheet.setColumnWidth(19, 210)
  sheet.setColumnWidth(20, 95)
  sheet.setColumnWidth(21, 95)
  sheet.setColumnWidth(22, 95)
  sheet.setColumnWidth(23, 95)
  sheet.setColumnWidth(24, 75)
  sheet.setColumnWidth(25, 125)
  sheet.setColumnWidth(26, 95)
  sheet.setColumnWidth(27, 95)
  sheet.setColumnWidth(28, 100)
  sheet.setColumnWidth(29, 160)
  sheet.setColumnWidth(30, 160)
  sheet.setColumnWidth(31, 160)
  sheet.setColumnWidth(32, 160)
  sheet.setColumnWidth(33, 130)
  sheet.showColumns(1, 33)
  sheet.hideColumns(4)
  sheet.hideColumns(15)
  sheet.hideColumns(18)
  if (sheet.getMaxColumns() >= 34) sheet.hideColumns(34, sheet.getMaxColumns() - 33)
  sheet.showRows(1, Math.max(sheet.getLastRow(), TABLE_HEADER_ROW))
  sheet.hideRows(3)
  if (participants.length) sheet.getRange(TABLE_HEADER_ROW, 1, participants.length + 1, 4).createFilter()
  sheet.setTabColor('#537b61')
}

// Keep financial metadata lossless without exceeding the 50,000-character limit of a cell.
// Human-readable player, action and blind tables remain authoritative for their own fields.
function writeJsonChunks_(sheet, row, column, value) {
  const json = 'json:' + JSON.stringify(value)
  const chunks = []
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + 40000, json.length)
    const lastCode = json.charCodeAt(end - 1)
    if (end < json.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1
    chunks.push(json.slice(start, end))
    start = end
  }
  const lastColumn = column + chunks.length - 1
  if (sheet.getMaxColumns() < lastColumn) sheet.insertColumnsAfter(sheet.getMaxColumns(), lastColumn - sheet.getMaxColumns())
  if (sheet.getMaxRows() < row) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows())
  sheet.getRange(row, column, 1, chunks.length).setNumberFormat('@').setValues([chunks])
}

function readJsonChunks_(sheet, row, column) {
  if (sheet.getMaxColumns() < column) return null
  const values = sheet.getRange(row, column, 1, sheet.getMaxColumns() - column + 1).getValues()[0]
  if (String(values[0] || '').indexOf('json:') !== 0) return null
  const chunks = []
  for (let index = 0; index < values.length && values[index] !== ''; index += 1) chunks.push(String(values[index]))
  return JSON.parse(chunks.join('').slice(5))
}

function writeActionsSheet_(spreadsheet, tournaments, playerNames) {
  let sheet = spreadsheet.getSheetByName(ACTIONS_SHEET_NAME)
  if (!sheet) sheet = spreadsheet.insertSheet(ACTIONS_SHEET_NAME)
  clearSheetContents_(sheet)

  const rows = [['Турнир', '№ раздачи', 'Улица', 'Игрок', 'Действие №', 'Тип действия', 'Фишки']]
  const labels = { check: 'Чек', call: 'Колл', bet: 'Ставка', raise: 'Рейз', 'all-in': 'Олл-ин', 'small-blind': 'Малый блайнд', 'big-blind': 'Большой блайнд' }
  tournaments.forEach(function (tournament) {
    ;(tournament.hands || []).forEach(function (hand) {
      Object.keys(hand.players || {}).forEach(function (playerId) {
        const player = hand.players[playerId]
        ;['preflop', 'flop', 'turn', 'river'].forEach(function (street) {
          const amounts = streetActions_(player.bets, street)
          const types = player.actions && Array.isArray(player.actions[street]) ? player.actions[street] : []
          const actionCount = Math.max(amounts.length, types.length)
          for (let index = 0; index < actionCount; index += 1) {
            const amount = Number(amounts[index] || 0)
            const action = types[index] || ''
            if (!action && amount === 0) continue
            rows.push([
              tournament.title,
              hand.number,
              street,
              playerNames[playerId] || 'Неизвестный участник',
              index + 1,
              labels[action] || (amount > 0 ? 'Тип не записан' : ''),
              amount,
            ])
          }
        })
        if (player.folded && player.foldedOn) {
          rows.push([tournament.title, hand.number, player.foldedOn, playerNames[playerId] || 'Неизвестный участник', '', 'Фолд', 0])
        }
      })
    })
  })

  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows)
  sheet.setFrozenRows(1)
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#dfe9e2')
  ;[180, 100, 110, 210, 105, 150, 100].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width) })
  if (rows.length > 1) sheet.getRange(1, 1, rows.length, rows[0].length).createFilter()
  sheet.setTabColor('#c7a960')
}

function streetActions_(bets, street) {
  const value = bets && bets[street]
  const source = Array.isArray(value) ? value : [value === undefined || value === null ? 0 : value, 0, 0]
  return source.map(function (amount) {
    const number = Number(amount)
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
  })
}

function streetTotal_(bets, street) {
  return streetActions_(bets, street).reduce(function (total, amount) { return total + amount }, 0)
}

function streetActionsForSheet_(bets, actionTypes, street) {
  const actions = streetActions_(bets, street)
  const types = actionTypes && Array.isArray(actionTypes[street]) ? actionTypes[street] : []
  if (actions.length <= 3 && types.length <= 3 && actions.every(function (amount) { return amount === 0 }) && types.every(function (type) { return !type })) return ''
  const labels = { check: 'Чек', call: 'Колл', bet: 'Ставка', raise: 'Рейз', 'all-in': 'Олл-ин', 'small-blind': 'МБ', 'big-blind': 'ББ' }
  return actions.map(function (amount, index) {
    const label = labels[types[index]]
    if (!label) return String(amount)
    return label + (types[index] === 'check' && amount === 0 ? '' : ' ' + amount)
  }).join(' + ')
}

function parseStreetActions_(value, legacyTotal) {
  const text = String(value || '').trim()
  const fallback = [Number(legacyTotal) || 0, 0, 0]
  if (!text) return { bets: fallback, actions: [null, null, null] }
  const labels = { 'Чек': 'check', 'Колл': 'call', 'Ставка': 'bet', 'Рейз': 'raise', 'Олл-ин': 'all-in', 'МБ': 'small-blind', 'ББ': 'big-blind' }
  const bets = []
  const actions = []
  for (const part of text.split('+')) {
    const token = part.trim()
    const typed = token.match(/^(.+?)(?:\s+(\d+))?$/)
    if (typed && labels[typed[1]]) {
      const action = labels[typed[1]]
      const amount = Number(typed[2] || 0)
      if (!Number.isFinite(amount) || amount < 0) return { bets: fallback, actions: [null, null, null] }
      bets.push(amount)
      actions.push(action)
      continue
    }
    const amount = Number(token)
    if (!Number.isFinite(amount) || amount < 0) return { bets: fallback, actions: [null, null, null] }
    bets.push(amount)
    actions.push(null)
  }
  return { bets: bets, actions: actions }
}

function archiveInactiveTournamentSheets_(spreadsheet, activeIds) {
  const active = {}
  activeIds.forEach(function (id) { active[id] = true })
  spreadsheet.getSheets().forEach(function (sheet) {
    const marker = sheet.getRange(3, 1, 1, 2).getValues()[0]
    if (String(marker[0]) !== 'ID турнира' || !marker[1]) return
    const id = String(marker[1])
    if (active[id]) return
    if (sheet.getName().indexOf('Архив — ') !== 0) {
      sheet.setName(uniqueSheetName_(spreadsheet, 'Архив — ' + sheet.getName(), sheet))
    }
    sheet.setTabColor('#aaaaaa')
  })
}

function findTournamentSheet_(spreadsheet, tournamentId) {
  const sheets = spreadsheet.getSheets()
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index]
    if (sheet.getMaxRows() < 2 || sheet.getMaxColumns() < 2) continue
    const marker = sheet.getRange(3, 1, 1, 2).getValues()[0]
    if (String(marker[0]) === 'ID турнира' && String(marker[1]) === tournamentId) return sheet
  }
  return null
}

function uniqueSheetName_(spreadsheet, requestedName, currentSheet) {
  const invalid = '[]:*?/\\'
  let base = String(requestedName || 'Турнир').split('').map(function (character) {
    return invalid.indexOf(character) >= 0 ? ' ' : character
  }).join('').trim().slice(0, 85)
  if (!base) base = 'Турнир'

  let candidate = base
  let suffix = 2
  while (true) {
    const existing = spreadsheet.getSheetByName(candidate)
    if (!existing || (currentSheet && existing.getSheetId() === currentSheet.getSheetId())) return candidate
    candidate = (base.slice(0, 78) + ' (' + suffix + ')').slice(0, 99)
    suffix += 1
  }
}

function clearSheetContents_(sheet) {
  const filter = sheet.getFilter()
  if (filter) filter.remove()
  sheet.clearContents()
}

function ensurePlayersSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PLAYERS_SHEET_NAME)
  if (!sheet) sheet = spreadsheet.insertSheet(PLAYERS_SHEET_NAME)
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 2).setValues([['Имя', 'ID игрока']])
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#dfe9e2')
    sheet.setFrozenRows(1)
    sheet.setColumnWidth(1, 240)
    sheet.setColumnWidth(2, 180)
    sheet.hideColumns(2)
  }
  return sheet
}

function ensureDataSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(DATA_SHEET_NAME)
  if (!sheet) {
    const sheets = spreadsheet.getSheets()
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0]
      sheet.setName(DATA_SHEET_NAME)
    } else {
      sheet = spreadsheet.insertSheet(DATA_SHEET_NAME)
    }
  }
  if (sheet.getRange('A1').getValue() !== 'key') {
    const state = sheet.getRange('B2').getValue() || ''
    const revision = Number(sheet.getRange('B3').getValue()) || 0
    const schema = String(sheet.getRange('B4').getValue() || '')
    const ids = String(sheet.getRange('B5').getValue() || '[]')
    sheet.getRange('A1:B5').setValues([
      ['key', 'value'],
      ['state', state],
      ['revision', revision],
      ['schemaVersion', schema],
      ['tournamentIds', ids],
    ])
    sheet.setFrozenRows(1)
    sheet.autoResizeColumns(1, 2)
  } else if (sheet.getRange('A4').getValue() !== 'schemaVersion' || sheet.getRange('A5').getValue() !== 'tournamentIds') {
    sheet.getRange('A4:B5').setValues([
      ['schemaVersion', sheet.getRange('B4').getValue() || ''],
      ['tournamentIds', sheet.getRange('B5').getValue() || '[]'],
    ])
  }
  return sheet
}

function getConfiguredSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY)
  if (!spreadsheetId) throw new Error('Run setupPokerDatabase from the target spreadsheet first.')
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet || spreadsheet.getId() !== spreadsheetId) {
    throw new Error('The active spreadsheet does not match the configured database.')
  }
  return spreadsheet
}

function statusToSheet_(status) {
  return ({ upcoming: 'Предстоит', live: 'Идёт сейчас', finished: 'Завершён' })[status] || 'Предстоит'
}

function statusFromSheet_(status) {
  return ({ 'Предстоит': 'upcoming', 'Идёт сейчас': 'live', 'Завершён': 'finished' })[String(status)] || String(status || 'upcoming')
}

function displaySheetDate_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? match[3] + '.' + match[2] + '.' + match[1] : String(value || '')
}

function parseSheetDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, getConfiguredSpreadsheet_().getSpreadsheetTimeZone(), 'yyyy-MM-dd')
  const text = String(value || '')
  const localized = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return localized ? localized[3] + '-' + localized[2] + '-' + localized[1] : text
}

function parseSheetTime_(value, sheet) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, sheet.getParent().getSpreadsheetTimeZone(), 'HH:mm')
  }
  return String(value || '')
}

function formatKrasnoyarskTimestamp_(timestamp) {
  return Utilities.formatDate(new Date(timestamp), KRASNOYARSK_TIME_ZONE, 'dd.MM.yyyy HH:mm:ss')
}

function parseKrasnoyarskTimestamp_(value) {
  if (value instanceof Date) return value.getTime()
  const text = String(value || '')
  const localized = text.match(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/)
  if (localized) return Utilities.parseDate(text, KRASNOYARSK_TIME_ZONE, 'dd.MM.yyyy HH:mm:ss').getTime()
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? timestamp : null
}

function isValidState_(state) {
  return Boolean(
    state &&
    Array.isArray(state.players) &&
    Array.isArray(state.tournaments) &&
    state.players.every((player) => player && typeof player.id === 'string' && typeof player.name === 'string') &&
    state.tournaments.every((tournament) =>
      tournament &&
      typeof tournament.id === 'string' &&
      typeof tournament.title === 'string' &&
      Array.isArray(tournament.participantIds) &&
      Array.isArray(tournament.levels),
    ),
  )
}

function sameSecret_(left, right) {
  if (!left || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function output_(value, callback) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c')
  if (callback) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(callback)) {
      return ContentService.createTextOutput('Invalid callback').setMimeType(ContentService.MimeType.TEXT)
    }
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT)
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON)
}
