import {describe, expect, it} from 'vitest'
import {TimeoutError, withTimeout} from '../with-timeout'

describe('withTimeout', () => {
  it('resolves with the promise value when it wins the race', async () => {
    const result = await withTimeout(Promise.resolve(42), 100, 'test')
    expect(result).toBe(42)
  })

  it('rejects with TimeoutError when the timer wins', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 200))
    await expect(withTimeout(slow, 50, 'op')).rejects.toBeInstanceOf(TimeoutError)
  })

  it('TimeoutError carries op name and timeout in message', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await withTimeout(slow, 10, 'sftp:list')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError)
      expect((err as TimeoutError).op).toBe('sftp:list')
      expect((err as TimeoutError).timeoutMs).toBe(10)
      expect((err as Error).message).toContain('sftp:list')
      expect((err as Error).message).toContain('10ms')
    }
  })

  it('propagates rejections from the wrapped promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'op')).rejects.toThrow('boom')
  })
})
