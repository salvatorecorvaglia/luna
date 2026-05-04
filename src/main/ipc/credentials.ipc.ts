import { ipcMain } from 'electron'
import { IPC } from '@shared/constants'
import { storeCredential, retrieveCredential, deleteCredential } from '../services/credential-store'
import { assertNonEmptyString } from '../lib/validate'

/**
 * Rate-limit credential retrievals so a compromised renderer can't enumerate
 * connectionIds. A legitimate flow only retrieves on connect (handful per minute).
 */
const RETRIEVE_WINDOW_MS = 60_000
const RETRIEVE_MAX_PER_WINDOW = 60
let retrieveWindowStart = Date.now()
let retrieveCount = 0

function checkRetrieveRate(): void {
  const now = Date.now()
  if (now - retrieveWindowStart > RETRIEVE_WINDOW_MS) {
    retrieveWindowStart = now
    retrieveCount = 0
  }
  retrieveCount++
  if (retrieveCount > RETRIEVE_MAX_PER_WINDOW) {
    throw new Error('Credential retrieval rate limit exceeded')
  }
}

export function registerCredentialHandlers(): void {
  // Validation errors are the validators doing their job — they propagate to
  // the renderer naturally as a rejected invoke(). Don't log them: it floods
  // the file with normal-path noise (tests + transient bad payloads).
  ipcMain.handle(
    IPC.CREDENTIAL_STORE,
    (_event, payload: { connectionId: string; secret: string }) => {
      assertNonEmptyString(payload?.connectionId, 'connectionId')
      assertNonEmptyString(payload?.secret, 'secret')
      storeCredential(payload.connectionId, payload.secret)
    }
  )

  ipcMain.handle(IPC.CREDENTIAL_RETRIEVE, (_event, connectionId: string) => {
    checkRetrieveRate()
    assertNonEmptyString(connectionId, 'connectionId')
    return retrieveCredential(connectionId)
  })

  ipcMain.handle(IPC.CREDENTIAL_DELETE, (_event, connectionId: string) => {
    assertNonEmptyString(connectionId, 'connectionId')
    deleteCredential(connectionId)
  })
}
