import log from 'electron-log/main'
import { redact } from './redact'

log.initialize()

log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB

// Redact at the hook boundary so every log path is covered, including ones
// that pass error objects directly.
log.hooks.push((message) => {
  message.data = message.data.map((v) => redact(v))
  return message
})

export default log
