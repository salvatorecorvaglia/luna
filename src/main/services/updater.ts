import { autoUpdater } from 'electron-updater'
import { IPC } from '@shared/constants'
import { emitToRenderer } from './emit'
import log from '../lib/logger'

let updateAvailable = false
let updateVersion = ''
let inFlightCheck: Promise<unknown> | null = null

function checkOnce(): Promise<unknown> {
  if (inFlightCheck) return inFlightCheck
  inFlightCheck = autoUpdater.checkForUpdates().finally(() => {
    inFlightCheck = null
  })
  return inFlightCheck
}

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

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
    log.error('[Updater] Error:', err.message)
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: err.message })
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
  autoUpdater
    .downloadUpdate()
    .then(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    .catch((err) => {
      log.error('[Updater] Failed to download update:', err.message)
      emitToRenderer(IPC.APP_UPDATE_ERROR, { error: err.message })
    })
}

