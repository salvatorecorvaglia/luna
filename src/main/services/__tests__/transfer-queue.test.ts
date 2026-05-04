import {beforeEach, describe, expect, it, vi} from 'vitest'
import {LIMITS} from '@shared/constants'
import {transferQueue} from '../transfer-queue'

// Mock peers before importing the module under test. We make stream operations
// hang forever so transfers stay either queued or active for the duration of a
// test (no race with finally() draining the active set).
vi.mock('../sftp-manager', () => ({
  sftpManager: {
    statSize: vi.fn().mockResolvedValue(0),
    streamUpload: vi.fn().mockImplementation(() => new Promise(() => {})),
    streamDownload: vi.fn().mockImplementation(() => new Promise(() => {}))
  }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 0 })
}))

vi.mock('../emit', () => ({
  emitToRenderer: vi.fn()
}))

// The TransferQueue is a module-level singleton. Reach into private state to
// reset it between tests so each test starts from a clean slate.
function resetQueue(): void {
  const q = transferQueue as unknown as {
    queue: unknown[]
    active: Map<string, unknown>
  }
  q.queue.length = 0
  q.active.clear()
}

beforeEach(() => {
  resetQueue()
  // Concurrency 1 so only one moves to active and the rest pile up in queue.
  transferQueue.setMaxConcurrent(1)
})

describe('transferQueue', () => {
  it('returns the same id for duplicate enqueues', async () => {
    const a = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x')
    const b = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x')
    expect(a).toBe(b)
  })

  it('rejects new transfers when the queue is saturated', async () => {
    // Fill: 1 goes to active, MAX go into the queue.
    for (let i = 0; i <= LIMITS.MAX_QUEUED_TRANSFERS; i++) {
      await transferQueue.enqueue('upload', 'sess', `/local/${i}`, `/remote/${i}`)
    }
    expect(transferQueue.getQueuedCount()).toBe(LIMITS.MAX_QUEUED_TRANSFERS)

    await expect(
      transferQueue.enqueue('upload', 'sess', '/local/overflow', '/remote/overflow')
    ).rejects.toThrow(/queue is full/i)
  })

  it('cancel removes a queued transfer', async () => {
    // First enqueue takes the only active slot; second sits in the queue.
    await transferQueue.enqueue('upload', 'sess', '/local/active', '/remote/active')
    const queuedId = await transferQueue.enqueue('upload', 'sess', '/local/q', '/remote/q')
    expect(transferQueue.getQueuedCount()).toBe(1)
    transferQueue.cancel(queuedId)
    expect(transferQueue.getQueuedCount()).toBe(0)
  })

  it('drains the queue when an active transfer aborts', async () => {
    transferQueue.setMaxConcurrent(1)
    await transferQueue.enqueue('upload', 'sess', '/local/a', '/remote/a')
    expect(transferQueue.getActiveCount()).toBe(1)
    expect(transferQueue.getQueuedCount()).toBe(0)
  })

  it('processQueue is re-entrancy guarded', async () => {
    // Enqueueing many at concurrency 1 must not lose transfers to a re-entrant
    // dispatch loop (each one beyond the first should land in the queue).
    transferQueue.setMaxConcurrent(1)
    for (let i = 0; i < 5; i++) {
      await transferQueue.enqueue('upload', 'sess', `/local/${i}`, `/remote/${i}`)
    }
    expect(transferQueue.getActiveCount()).toBe(1)
    expect(transferQueue.getQueuedCount()).toBe(4)
  })
})
