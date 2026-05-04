import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '@shared/constants'
import { emitToRenderer } from './emit'
import log from '../lib/logger'

let updateAvailable = false
let updateVersion = ''
let inFlightCheck: Promise<unknown> | null = null

function checkOnce(): Promise<unknown> {
  if (!app.isPackaged) return Promise.resolve(null)
  if (inFlightCheck) return inFlightCheck
  inFlightCheck = autoUpdater.checkForUpdates().finally(() => {
    inFlightCheck = null
  })
  return inFlightCheck
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Refuse to operate against an unencrypted update feed.
  try {
    const feedURL = autoUpdater.getFeedURL?.()
    if (feedURL && !feedURL.startsWith('https://')) {
      log.error(`[Updater] Refusing non-HTTPS update feed: ${feedURL}`)
      return
    }
  } catch {
    // older electron-updater versions throw before a feed is set; ignore.
  }

  autoUpdater.on('update-available', (info) => {
    updateAvailable = true
    updateVersion = info.version
    emitToRenderer(IPC.APP_UPDATE_AVAILABLE, { version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    updateAvailable = false
  })

  autoUpdater.on('download-progress', (progress) => {
    emitToRenderer(IPC.APP_UPDATE_DOWNLOAD_PROGRESS, {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', () => {
    emitToRenderer(IPC.APP_UPDATE_DOWNLOADED, {})
  })

  autoUpdater.on('error', (err) => {
    let errorMessage = err.message
    if (errorMessage.includes('code signature at URL') || errorMessage.includes('did not pass validation')) {
      errorMessage = 'Auto-update is not supported for unsigned applications. Please download the latest release manually.'
    }
    log.error('[Updater] Error:', errorMessage)
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage })
  })

  // Check for updates after a short delay
  setTimeout(() => {
    checkOnce().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('[Updater] Initial check failed:', msg)
    })
  }, 5000)
}

export function checkForUpdate(): { available: boolean; version?: string } {
  checkOnce().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('[Updater] Manual check failed:', msg)
  })
  return { available: updateAvailable, version: updateVersion || undefined }
}

export function installUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater
    .downloadUpdate()
    .then(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    .catch((err) => {
      let errorMessage = err.message
      if (errorMessage.includes('code signature at URL') || errorMessage.includes('did not pass validation')) {
        errorMessage = 'Auto-update is not supported for unsigned applications. Please download the latest release manually.'
      }
      log.error('[Updater] Failed to download update:', errorMessage)
      emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage })
    })
}

