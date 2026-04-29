import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { readFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { IPC, LIMITS } from '@shared/constants'
import { emitToRenderer } from './emit'
import type { SessionStatus } from '@shared/types/terminal'
import { getDatabase, getSetting, type ConnectionRow } from './database'
import { retrieveCredential } from './credential-store'
import { verifyHostKey, fingerprintKey, getStoredHostKey, updateHostKey } from './host-key-store'
import { withTimeout, TimeoutError } from '../lib/with-timeout'
import { sanitizeStartupCommand } from '../lib/validate'
import log from '../lib/logger'

interface StreamListeners {
  onData: (data: Buffer) => void
  onClose: () => void
  onStderrData: (data: Buffer) => void
}

interface SshSession {
  id: string
  connectionId: string
  client: Client
  shell: ClientChannel | null
  status: SessionStatus
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnecting: boolean
  _streamListeners?: StreamListeners
  historyId?: string
}

class SshManager {
  private sessions = new Map<string, SshSession>()
  private onDisconnectCallbacks: ((sessionId: string) => void)[] = []
  /** Candidate host keys captured during a rejected verification, awaiting user trust. */
  private pendingHostKeys = new Map<string, { key: Buffer; algorithm: string }>()

  /**
   * Trust a captured host key so the next connect succeeds.
   * Returns the fingerprint that was stored, or null if no candidate is pending.
   */
  trustPendingHostKey(host: string, port: number): string | null {
    const key = `${host}:${port}`
    const pending = this.pendingHostKeys.get(key)
    if (!pending) return null
    updateHostKey(host, port, pending.key, pending.algorithm)
    this.pendingHostKeys.delete(key)
    return fingerprintKey(pending.key)
  }

  /** Register a callback invoked when a session disconnects or begins reconnecting. */
  onSessionDisconnect(cb: (sessionId: string) => void): void {
    this.onDisconnectCallbacks.push(cb)
  }

  private setStatus(session: SshSession, status: SessionStatus): void {
    session.status = status
    emitToRenderer(IPC.SSH_ON_STATUS, {
      sessionId: session.id,
      status
    })
  }

  async connect(
    sessionId: string,
    connectionId: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as
      | ConnectionRow
      | undefined
    if (!row) {
      return { success: false, error: 'Connection not found' }
    }

    const client = new Client()

    const session: SshSession = {
      id: sessionId,
      connectionId,
      client,
      shell: null,
      status: 'connecting',
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnecting: false
    }

    this.sessions.set(sessionId, session)
    this.setStatus(session, 'connecting')

    const connectConfig: ConnectConfig = {
      host: row.host,
      port: row.port,
      username: row.username,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      readyTimeout: getSetting('ssh.readyTimeout', 30000),
      hostVerifier: (key: Buffer) => {
        const result = verifyHostKey(row.host, row.port, key, 'ssh-rsa')
        if (!result.trusted) {
          // Capture the candidate key so the renderer can prompt the user.
          // The verifier is synchronous, so we cannot wait for confirmation —
          // we reject, surface the change, and let the user re-attempt after trusting.
          const stored = getStoredHostKey(row.host, row.port)
          this.pendingHostKeys.set(`${row.host}:${row.port}`, {
            key: Buffer.from(key),
            algorithm: 'ssh-rsa'
          })
          emitToRenderer(IPC.SSH_ON_HOST_KEY_CHANGE, {
            sessionId,
            connectionId,
            host: row.host,
            port: row.port,
            storedFingerprint: stored?.fingerprint ?? '',
            newFingerprint: fingerprintKey(key),
            algorithm: 'ssh-rsa'
          })
          emitToRenderer(IPC.SSH_ON_ERROR, {
            sessionId,
            error: `Host key for ${row.host}:${row.port} has changed. Confirm the new fingerprint before reconnecting.`
          })
        }
        return result.trusted
      }
    }

    // Set up auth
    const credential = retrieveCredential(connectionId)

    if (row.auth_type === 'password') {
      connectConfig.password = credential || undefined
    } else if (row.auth_type === 'key' || row.auth_type === 'key+passphrase') {
      try {
        if (!row.private_key_path) {
          this.sessions.delete(sessionId)
          return { success: false, error: 'Private key path not configured' }
        }
        const keyPath = row.private_key_path.replace(/^~/, process.env.HOME || '')
        connectConfig.privateKey = await readFile(keyPath)
        if (row.auth_type === 'key+passphrase' && credential) {
          connectConfig.passphrase = credential
        }
      } catch (err: unknown) {
        this.sessions.delete(sessionId)
        return {
          success: false,
          error: `Failed to read key: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }

    const connectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      client.on('ready', () => {
        session.reconnectAttempts = 0
        this.setStatus(session, 'connected')

        // Update last_connected_at
        db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(
          Math.floor(Date.now() / 1000),
          connectionId
        )

        // Record connection history
        const historyId = uuidv4()
        session.historyId = historyId
        try {
          db.prepare('INSERT INTO connection_history (id, connection_id) VALUES (?, ?)').run(
            historyId,
            connectionId
          )
        } catch {
          // History table may not exist on older DBs before migration runs
        }

        client.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
          if (err) {
            // Clean up zombie session on shell creation failure
            this.sessions.delete(sessionId)
            resolve({ success: false, error: err.message })
            return
          }

          session.shell = stream

          const onData = (data: Buffer) => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8')
            })
          }

          const onClose = () => {
            this.handleDisconnect(sessionId)
          }

          const onStderrData = (data: Buffer) => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8')
            })
          }

          stream.on('data', onData)
          stream.on('close', onClose)
          stream.stderr.on('data', onStderrData)

          // Store listener refs for cleanup
          session._streamListeners = { onData, onClose, onStderrData }

          // Run startup command after shell is ready (wait for first data from server).
          // Sanitize defensively in case a record was written before validation existed,
          // or imported through an older code path.
          if (row.startup_command) {
            let safeCmd: string | null = null
            try {
              safeCmd = sanitizeStartupCommand(row.startup_command)
            } catch (err) {
              log.warn(
                `[SSH] Refusing to run unsafe startup_command for ${connectionId}: ${
                  err instanceof Error ? err.message : String(err)
                }`
              )
            }
            if (safeCmd) {
              stream.once('data', () => {
                stream.write(safeCmd + '\n')
              })
            }
          }

          resolve({ success: true })
        })
      })

      client.on('error', (err) => {
        emitToRenderer(IPC.SSH_ON_ERROR, {
          sessionId,
          error: err.message
        })

        if (session.status === 'connecting') {
          this.sessions.delete(sessionId)
          resolve({ success: false, error: err.message })
        } else {
          this.handleDisconnect(sessionId)
        }
      })

      client.on('close', () => {
        if (session.status === 'connected') {
          this.handleDisconnect(sessionId)
        }
      })

      client.connect(connectConfig)
    })

    const timeoutMs = getSetting('ssh.connectTimeoutMs', LIMITS.SSH_CONNECT_TIMEOUT_MS)
    try {
      return await withTimeout(connectPromise, timeoutMs, `ssh.connect(${sessionId})`)
    } catch (err: unknown) {
      try {
        client.end()
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId)
      const isTimeout = err instanceof TimeoutError
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        error: isTimeout ? `Connection timed out after ${timeoutMs}ms` : message
      }
    }
  }

  private cleanupStreamListeners(session: SshSession): void {
    if (session.shell && session._streamListeners) {
      const { onData, onClose, onStderrData } = session._streamListeners
      session.shell.removeListener('data', onData)
      session.shell.removeListener('close', onClose)
      session.shell.stderr.removeListener('data', onStderrData)
      session._streamListeners = undefined
    }
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.status === 'disconnected') return

    this.cleanupStreamListeners(session)
    this.setStatus(session, 'disconnected')
    emitToRenderer(IPC.SSH_ON_CLOSE, { sessionId })

    // Notify listeners (e.g. SFTP cache cleanup)
    for (const cb of this.onDisconnectCallbacks) {
      cb(sessionId)
    }

    // Auto-reconnect
    this.attemptReconnect(sessionId)
  }

  private attemptReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.reconnecting) return

    const maxAttempts = 5
    if (session.reconnectAttempts >= maxAttempts) {
      session.reconnecting = false
      this.setStatus(session, 'error')
      return
    }

    session.reconnecting = true
    session.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts - 1), 30000)

    this.setStatus(session, 'reconnecting')

    session.reconnectTimer = setTimeout(async () => {
      const sess = this.sessions.get(sessionId)
      if (!sess || sess.status === 'connected') {
        if (sess) sess.reconnecting = false
        return
      }

      // Clean up old client and stream listeners
      this.cleanupStreamListeners(sess)
      try {
        sess.client.end()
      } catch (err) {
        log.error(`[SSH] Error ending client for reconnect ${sessionId}:`, err)
      }

      // Remove session, then reconnect (atomic: connect re-adds it)
      const connectionId = sess.connectionId
      const reconnectAttempts = sess.reconnectAttempts
      this.sessions.delete(sessionId)
      const result = await this.connect(sessionId, connectionId)

      if (result.success) {
        const newSess = this.sessions.get(sessionId)
        if (newSess) newSess.reconnecting = false
      } else {
        // Restore reconnect attempt count on the new session
        const newSess = this.sessions.get(sessionId)
        if (newSess) {
          newSess.reconnectAttempts = reconnectAttempts
          newSess.reconnecting = false
        }
        this.attemptReconnect(sessionId)
      }
    }, delay)
  }

  sendData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.shell?.writable) {
      session.shell.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session?.shell) {
      session.shell.setWindow(rows, cols, rows * 16, cols * 8)
    }
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
    }

    this.cleanupStreamListeners(session)

    try {
      session.shell?.close()
      session.client.end()
    } catch (err) {
      log.error(`[SSH] Error closing session ${sessionId}:`, err)
    }

    // Record disconnect in history
    if (session.historyId) {
      try {
        const db = getDatabase()
        const now = Math.floor(Date.now() / 1000)
        db.prepare(
          'UPDATE connection_history SET disconnected_at = ?, duration_secs = (? - connected_at) WHERE id = ?'
        ).run(now, now, session.historyId)
      } catch {
        // History recording is best-effort
      }
    }

    session.status = 'disconnected'
    this.sessions.delete(sessionId)
  }

  /**
   * Open a transient SSH connection using a saved connection's config, then close it.
   * Used by the UI's "Test connection" button to surface auth/host errors before save.
   */
  async testConnection(connectionId: string): Promise<{ ok: boolean; error?: string }> {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as
      | ConnectionRow
      | undefined
    if (!row) return { ok: false, error: 'Connection not found' }

    const credential = retrieveCredential(connectionId)
    const config: ConnectConfig = {
      host: row.host,
      port: row.port,
      username: row.username,
      readyTimeout: getSetting('ssh.readyTimeout', 30000)
    }

    if (row.auth_type === 'password') {
      config.password = credential || undefined
    } else if (row.auth_type === 'key' || row.auth_type === 'key+passphrase') {
      if (!row.private_key_path) return { ok: false, error: 'Private key path not configured' }
      try {
        const keyPath = row.private_key_path.replace(/^~/, process.env.HOME || '')
        config.privateKey = await readFile(keyPath)
        if (row.auth_type === 'key+passphrase' && credential) config.passphrase = credential
      } catch (err: unknown) {
        return {
          ok: false,
          error: `Failed to read key: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }

    return new Promise((resolve) => {
      const client = new Client()
      let settled = false
      const finish = (result: { ok: boolean; error?: string }): void => {
        if (settled) return
        settled = true
        try {
          client.removeAllListeners()
          client.end()
        } catch {
          // ignore
        }
        resolve(result)
      }
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: `Connection test timed out after ${LIMITS.SSH_CONNECT_TIMEOUT_MS}ms`
          }),
        LIMITS.SSH_CONNECT_TIMEOUT_MS
      )
      client.on('ready', () => {
        clearTimeout(timer)
        finish({ ok: true })
      })
      client.on('error', (err) => {
        clearTimeout(timer)
        finish({ ok: false, error: err.message })
      })
      try {
        client.connect(config)
      } catch (err: unknown) {
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  getSession(sessionId: string): SshSession | undefined {
    return this.sessions.get(sessionId)
  }

  disconnectAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.disconnect(sessionId)
    }
  }
}

export const sshManager = new SshManager()
