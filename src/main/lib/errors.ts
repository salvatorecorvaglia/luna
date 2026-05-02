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
