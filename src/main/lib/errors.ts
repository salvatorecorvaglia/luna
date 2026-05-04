export class SshConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshConnectionError'
  }
}

export class SftpTransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SftpTransferError'
  }
}

/** Signals that a transfer (or a generic op) was aborted by the caller. */
export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}
