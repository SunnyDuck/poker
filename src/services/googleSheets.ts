import type { DemoState } from '@/domain/types'

const endpoint = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL?.trim() ?? ''
const adminKeyStorageKey = 'friendly-poker-admin-key'

export interface GoogleStateSnapshot {
  state: DemoState | null
  revision: number
  apiVersion: number
}

interface GoogleResponse extends GoogleStateSnapshot {
  ok: boolean
  error?: string
}

function getEndpoint(): string {
  if (!endpoint) throw new Error('Google Apps Script URL is not configured')

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('Google Apps Script URL is invalid')
  }

  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('Expected a deployed Google Apps Script /exec URL')
  }

  return url.toString()
}

export function isGoogleSheetsConfigured(): boolean {
  try {
    getEndpoint()
    return true
  } catch {
    return false
  }
}

export function getGoogleAdminKey(): string {
  let sessionKey = ''
  try {
    sessionKey = sessionStorage.getItem(adminKeyStorageKey) ?? ''
  } catch {
    // Fall back to persistent storage when session storage is unavailable.
  }
  if (sessionKey) return sessionKey

  try {
    return localStorage.getItem(adminKeyStorageKey) ?? ''
  } catch {
    return ''
  }
}

export function isGoogleAdminKeyRemembered(): boolean {
  try {
    return Boolean(localStorage.getItem(adminKeyStorageKey))
  } catch {
    return false
  }
}

export function storeGoogleAdminKey(value: string, remember = false): void {
  try {
    if (value) sessionStorage.setItem(adminKeyStorageKey, value)
    else sessionStorage.removeItem(adminKeyStorageKey)
  } catch {
    // Persistent storage may still be available below.
  }

  try {
    if (value && remember) localStorage.setItem(adminKeyStorageKey, value)
    else localStorage.removeItem(adminKeyStorageKey)
  } catch {
    // The key remains usable for the current page even when browser storage is disabled.
  }
}

export function setGoogleAdminKeyRemembered(remember: boolean): void {
  const key = getGoogleAdminKey()
  try {
    if (remember && key) localStorage.setItem(adminKeyStorageKey, key)
    else {
      if (key) sessionStorage.setItem(adminKeyStorageKey, key)
      localStorage.removeItem(adminKeyStorageKey)
    }
  } catch {
    // Keep the current session usable if persistent browser storage is unavailable.
  }
}

export function readGoogleState(): Promise<GoogleStateSnapshot> {
  const url = new URL(getEndpoint())
  url.searchParams.set('action', 'read')

  return new Promise((resolve, reject) => {
    const callbackName = `friendlyPokerRead${crypto.randomUUID().replaceAll('-', '')}`
    const script = document.createElement('script')
    const timer = window.setTimeout(() => finish(new Error('Не удалось дождаться ответа Google Таблицы.')), 45_000)
    let settled = false

    function cleanup() {
      window.clearTimeout(timer)
      script.remove()
      delete (window as unknown as Record<string, unknown>)[callbackName]
    }

    function finish(error?: Error, snapshot?: GoogleStateSnapshot) {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(snapshot!)
    }

    ;(window as unknown as Record<string, unknown>)[callbackName] = (response: GoogleResponse) => {
      if (!response?.ok) {
        finish(new Error(response?.error || 'Google Sheets returned an error'))
        return
      }
      finish(undefined, {
        state: response.state ?? null,
        revision: Number(response.revision) || 0,
        apiVersion: Number(response.apiVersion) || 0,
      })
    }

    url.searchParams.set('callback', callbackName)
    script.async = true
    script.src = url.toString()
    script.onerror = () => finish(new Error('Could not reach Google Apps Script'))
    document.head.append(script)
  })
}

export async function writeGoogleState(snapshot: DemoState, adminKey: string): Promise<void> {
  if (!adminKey) throw new Error('Enter the Google Sheets admin key first')

  const target = `friendly-poker-write-${crypto.randomUUID()}`
  const iframe = document.createElement('iframe')
  iframe.name = target
  iframe.title = 'Google Sheets sync'
  iframe.hidden = true

  await new Promise<void>((resolve) => {
    iframe.addEventListener('load', () => resolve(), { once: true })
    document.body.append(iframe)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const form = document.createElement('form')
      const url = new URL(getEndpoint())
      url.searchParams.set('action', 'write')
      form.action = url.toString()
      form.method = 'POST'
      form.target = target
      form.hidden = true

      const fields: Record<string, string> = {
        action: 'write',
        adminKey,
        payload: JSON.stringify(snapshot),
      }
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = value
        form.append(input)
      }

      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('Google Таблица не подтвердила запись вовремя. Проверяем, не завершилась ли она позже.'))
      }, 90_000)

      function cleanup() {
        window.clearTimeout(timeout)
        form.remove()
      }

      iframe.addEventListener('load', () => {
        cleanup()
        resolve()
      }, { once: true })
      document.body.append(form)
      form.submit()
    })
  } finally {
    iframe.remove()
  }
}
