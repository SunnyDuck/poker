/**
 * @OnlyCurrentDoc
 */

const DATA_SHEET_NAME = '_PokerData'
const ADMIN_KEY_PROPERTY = 'FRIENDLY_POKER_ADMIN_KEY'
const SPREADSHEET_ID_PROPERTY = 'FRIENDLY_POKER_SPREADSHEET_ID'
const MAX_STATE_LENGTH = 45000

/**
 * Run this once from the Apps Script editor while it is bound to the new spreadsheet.
 * The generated write key is shown in the execution log. Keep it private.
 */
function setupPokerDatabase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Open Apps Script from the target Google Sheet first.')
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId())

  let dataSheet = spreadsheet.getSheetByName(DATA_SHEET_NAME)
  if (!dataSheet) {
    const firstSheet = spreadsheet.getSheets()[0]
    if (spreadsheet.getSheets().length === 1 && firstSheet.getLastRow() === 0) {
      firstSheet.setName(DATA_SHEET_NAME)
      dataSheet = firstSheet
    } else {
      dataSheet = spreadsheet.insertSheet(DATA_SHEET_NAME)
    }
  }

  dataSheet.getRange('A1:B3').setValues([
    ['key', 'value'],
    ['state', dataSheet.getRange('B2').getValue() || ''],
    ['revision', Number(dataSheet.getRange('B3').getValue()) || 0],
  ])
  dataSheet.setFrozenRows(1)
  dataSheet.autoResizeColumns(1, 2)

  const adminKey = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')
  PropertiesService.getScriptProperties().setProperty(ADMIN_KEY_PROPERTY, adminKey)
  console.log('Friendly Poker admin key (copy it into the app; do not publish it): ' + adminKey)
  console.log('Database sheet initialized: ' + spreadsheet.getUrl())
}

function doGet(event) {
  const action = event && event.parameter && event.parameter.action
  if (action && action !== 'read') return output_({ ok: false, error: 'Unknown action' })

  try {
    const dataSheet = getDataSheet_()
    const stateJson = String(dataSheet.getRange('B2').getValue() || '')
    const revision = Number(dataSheet.getRange('B3').getValue()) || 0
    const state = stateJson ? JSON.parse(stateJson) : null
    const response = { ok: true, state: state, revision: revision }
    const callback = event && event.parameter && event.parameter.callback
    return output_(response, callback)
  } catch (error) {
    console.error('Google Sheets read failed: ' + String(error))
    return output_({ ok: false, error: 'Could not read the tournament data.' }, event && event.parameter && event.parameter.callback)
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
    const dataSheet = getDataSheet_()
    const revision = Number(dataSheet.getRange('B3').getValue()) || 0
    dataSheet.getRange('B2:B3').setValues([[JSON.stringify(state)], [revision + 1]])
    return output_({ ok: true, revision: revision + 1 })
  } catch (error) {
    return output_({ ok: false, error: 'Could not save the tournament data.' })
  } finally {
    if (lock.hasLock()) lock.releaseLock()
  }
}

function getDataSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY)
  if (!spreadsheetId) throw new Error('Run setupPokerDatabase from the target spreadsheet first.')
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet || spreadsheet.getId() !== spreadsheetId) {
    throw new Error('The active spreadsheet does not match the configured database.')
  }

  let sheet = spreadsheet.getSheetByName(DATA_SHEET_NAME)
  if (!sheet) sheet = spreadsheet.insertSheet(DATA_SHEET_NAME)
  if (sheet.getRange('A1').getValue() !== 'key') {
    sheet.getRange('A1:B3').setValues([
      ['key', 'value'],
      ['state', ''],
      ['revision', 0],
    ])
    sheet.setFrozenRows(1)
  }
  return sheet
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
