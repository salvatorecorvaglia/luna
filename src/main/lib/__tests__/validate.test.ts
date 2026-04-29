import { describe, it, expect } from 'vitest'
import {
  assertNonEmptyString,
  assertBoundedInt,
  assertValidPath,
  sanitizeStartupCommand,
  MAX_STARTUP_COMMAND_LEN
} from '../validate'

describe('assertNonEmptyString', () => {
  it('accepts a non-empty string', () => {
    expect(() => assertNonEmptyString('hello', 'name')).not.toThrow()
  })

  it('rejects empty string', () => {
    expect(() => assertNonEmptyString('', 'name')).toThrow(/non-empty string/)
  })

  it('rejects whitespace-only string', () => {
    expect(() => assertNonEmptyString('   ', 'name')).toThrow(/non-empty string/)
  })

  it('rejects non-string values', () => {
    expect(() => assertNonEmptyString(42, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(null, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(undefined, 'name')).toThrow(/non-empty string/)
  })

  it('rejects strings with null bytes', () => {
    expect(() => assertNonEmptyString('hello\0world', 'name')).toThrow(/null bytes/)
  })
})

describe('assertBoundedInt', () => {
  it('accepts values within bounds', () => {
    expect(() => assertBoundedInt(5, 'n', 1, 10)).not.toThrow()
    expect(() => assertBoundedInt(1, 'n', 1, 10)).not.toThrow()
    expect(() => assertBoundedInt(10, 'n', 1, 10)).not.toThrow()
  })

  it('rejects out-of-bound values', () => {
    expect(() => assertBoundedInt(0, 'n', 1, 10)).toThrow(/integer between/)
    expect(() => assertBoundedInt(11, 'n', 1, 10)).toThrow(/integer between/)
  })

  it('rejects non-integers', () => {
    expect(() => assertBoundedInt(1.5, 'n', 1, 10)).toThrow(/integer between/)
    expect(() => assertBoundedInt('5', 'n', 1, 10)).toThrow(/integer between/)
  })
})

describe('assertValidPath', () => {
  it('accepts valid paths', () => {
    expect(() => assertValidPath('/home/user/file.txt', 'path')).not.toThrow()
  })

  it('rejects empty paths', () => {
    expect(() => assertValidPath('', 'path')).toThrow()
  })

  it('rejects paths with null bytes', () => {
    expect(() => assertValidPath('/home/\0/x', 'path')).toThrow(/null bytes/)
  })
})

describe('sanitizeStartupCommand', () => {
  it('returns null for empty input', () => {
    expect(sanitizeStartupCommand(undefined)).toBeNull()
    expect(sanitizeStartupCommand(null)).toBeNull()
    expect(sanitizeStartupCommand('')).toBeNull()
    expect(sanitizeStartupCommand('   ')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeStartupCommand('  ls -la  ')).toBe('ls -la')
  })

  it('allows multi-line commands separated by newlines and tabs', () => {
    const cmd = 'cd /tmp\necho\thello'
    expect(sanitizeStartupCommand(cmd)).toBe(cmd)
  })

  it('rejects null bytes and other control characters', () => {
    expect(() => sanitizeStartupCommand('echo\0evil')).toThrow(/control characters/)
    expect(() => sanitizeStartupCommand('echo\x07bell')).toThrow(/control characters/)
    expect(() => sanitizeStartupCommand('echo\x1bescape')).toThrow(/control characters/)
  })

  it('rejects non-string input', () => {
    expect(() => sanitizeStartupCommand(123 as unknown)).toThrow(/string/)
  })

  it('rejects over-length input', () => {
    expect(() => sanitizeStartupCommand('a'.repeat(MAX_STARTUP_COMMAND_LEN + 1))).toThrow(
      /exceeds/
    )
  })
})
