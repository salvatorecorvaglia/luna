import {AnimatePresence, motion} from 'framer-motion'
import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {Database, Download, FileText, Info, Monitor, Terminal, Upload, Wifi, X} from 'lucide-react'
import {toast} from 'sonner'
import {cn} from '@/lib/utils'
import {useUIStore} from '@/stores/ui-store'
import {useTerminalStore} from '@/stores/terminal-store'
import type {TerminalThemeName} from '@shared/types/terminal'
import {DEFAULT_SETTINGS} from '@shared/types/settings'
import lunarLogo from '../../../../../resources/lunar.png'

const TERMINAL_THEMES: {
  value: TerminalThemeName
  label: string
  bg: string
  fg: string
  accent: string
}[] = [
  { value: 'dracula', label: 'Dracula', bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9' },
  { value: 'nord', label: 'Nord', bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0' },
  { value: 'tokyo-night', label: 'Tokyo Night', bg: '#1a1b26', fg: '#a9b1d6', accent: '#7aa2f7' },
  { value: 'solarized-dark', label: 'Solarized', bg: '#002b36', fg: '#839496', accent: '#268bd2' },
  { value: 'gruvbox', label: 'Gruvbox', bg: '#282828', fg: '#ebdbb2', accent: '#fabd2f' },
  { value: 'one-dark', label: 'One Dark', bg: '#282c34', fg: '#abb2bf', accent: '#61afef' },
  { value: 'monokai', label: 'Monokai', bg: '#272822', fg: '#f8f8f2', accent: '#a6e22e' }
]

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
}

const panelVariants = {
  initial: { opacity: 0, x: '100%' },
  animate: { opacity: 1, x: 0, transition: { type: 'spring', damping: 28, stiffness: 320 } },
  exit: { opacity: 0, x: '100%', transition: { duration: 0.2 } }
}

export function SettingsPanel() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const applyTerminalThemeToUI = useUIStore((s) => s.applyTerminalThemeToUI)
  const setApplyTerminalThemeToUI = useUIStore((s) => s.setApplyTerminalThemeToUI)
  const { terminalTheme, setTerminalTheme, fontSize, setFontSize, scrollback, setScrollback } =
    useTerminalStore()
  const [concurrency, setConcurrency] = useState(DEFAULT_SETTINGS['transfer.concurrency'])
  const [autoReconnect, setAutoReconnect] = useState(DEFAULT_SETTINGS['ssh.autoReconnect'])
  const [readyTimeout, setReadyTimeout] = useState(DEFAULT_SETTINGS['ssh.readyTimeout'] / 1000)
  const [keepAliveInterval, setKeepAliveInterval] = useState(DEFAULT_SETTINGS['ssh.keepAliveInterval'] / 1000)
  const [maxReconnectAttempts, setMaxReconnectAttempts] = useState(DEFAULT_SETTINGS['ssh.maxReconnectAttempts'])
  const [appVersion, setAppVersion] = useState('0.0.0')

  // Load settings from DB on open
  useEffect(() => {
    if (!settingsOpen) return
    window.api.app.getVersion().then(setAppVersion)
    window.api.settings.getAll().then((settings: Record<string, unknown>) => {
      if (settings['terminal.fontSize'] != null) setFontSize(Number(settings['terminal.fontSize']))
      if (settings['terminal.scrollback'] != null)
        setScrollback(Number(settings['terminal.scrollback']))
      if (settings['transfer.concurrency'] != null)
        setConcurrency(Number(settings['transfer.concurrency']))
      if (settings['ssh.autoReconnect'] != null)
        setAutoReconnect(Boolean(settings['ssh.autoReconnect']))
      if (settings['ssh.readyTimeout'] != null)
        setReadyTimeout(Number(settings['ssh.readyTimeout']) / 1000)
      if (settings['ssh.keepAliveInterval'] != null)
        setKeepAliveInterval(Number(settings['ssh.keepAliveInterval']) / 1000)
      if (settings['ssh.maxReconnectAttempts'] != null)
        setMaxReconnectAttempts(Number(settings['ssh.maxReconnectAttempts']))
      if (settings['ui.applyTerminalTheme'] != null) {
        setApplyTerminalThemeToUI(Boolean(settings['ui.applyTerminalTheme']))
      }
    })
  }, [settingsOpen, setFontSize, setScrollback, setApplyTerminalThemeToUI])

  const persistSetting = useCallback((key: string, value: unknown) => {
    window.api.settings.set(key, JSON.stringify(value))
  }, [])

  const panelRef = useRef<HTMLDivElement>(null)

  // Focus trap + Escape
  useEffect(() => {
    if (!settingsOpen) return
    const panel = panelRef.current
    if (!panel) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        return
      }
      if (e.key === 'Tab') {
        const focusable = panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [settingsOpen, setSettingsOpen])

  return (
    <AnimatePresence>
      {settingsOpen && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />
          <motion.div
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            className="no-drag fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/60 bg-card shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h2 id="settings-dialog-title" className="text-base font-semibold text-foreground">
                Settings
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="btn-icon"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Appearance */}
              <Section title="Appearance" icon={<Monitor className="h-4 w-4" />}>
                <ToggleRow
                  label="Apply terminal theme to UI"
                  enabled={applyTerminalThemeToUI}
                  onToggle={setApplyTerminalThemeToUI}
                />
              </Section>

              {/* Terminal */}
              <Section title="Terminal" icon={<Terminal className="h-4 w-4" />}>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2.5 block">
                    Color Theme
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {TERMINAL_THEMES.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => setTerminalTheme(t.value)}
                        className={cn(
                          'group flex flex-col items-center gap-2 rounded-lg border p-3 cursor-pointer',
                          terminalTheme === t.value
                            ? 'border-ring bg-accent shadow-xs'
                            : 'border-border hover:border-ring/50 hover:bg-accent/40'
                        )}
                      >
                        {/* Mini terminal preview */}
                        <div
                          className="w-full rounded-md p-2 font-mono text-[8px] leading-tight"
                          style={{ backgroundColor: t.bg, color: t.fg }}
                        >
                          <span style={{ color: t.accent }}>$</span> ls -la
                          <br />
                          <span className="opacity-60">drwxr-xr-x</span>
                        </div>
                        <span className="text-[11px] font-medium">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <SettingRow label="Font" value="JetBrains Mono" />
                <EditableNumberRow
                  label="Font Size"
                  value={fontSize}
                  min={10}
                  max={24}
                  suffix="px"
                  onChange={(v) => {
                    setFontSize(v)
                    persistSetting('terminal.fontSize', v)
                  }}
                />
                <EditableNumberRow
                  label="Scrollback"
                  value={scrollback}
                  min={1000}
                  max={100000}
                  step={1000}
                  suffix=" lines"
                  onChange={(v) => {
                    setScrollback(v)
                    persistSetting('terminal.scrollback', v)
                  }}
                />
              </Section>

              {/* SSH */}
              <Section title="SSH" icon={<Wifi className="h-4 w-4" />}>
                <ToggleRow
                  label="Auto-reconnect"
                  enabled={autoReconnect}
                  onToggle={(v) => {
                    setAutoReconnect(v)
                    persistSetting('ssh.autoReconnect', v)
                  }}
                />
                <EditableNumberRow
                  label="Connection timeout"
                  value={readyTimeout}
                  min={5}
                  max={120}
                  suffix="s"
                  onChange={(v) => {
                    setReadyTimeout(v)
                    persistSetting('ssh.readyTimeout', v * 1000)
                  }}
                />
                <EditableNumberRow
                  label="Keep-alive interval"
                  value={keepAliveInterval}
                  min={5}
                  max={120}
                  suffix="s"
                  onChange={(v) => {
                    setKeepAliveInterval(v)
                    persistSetting('ssh.keepAliveInterval', v * 1000)
                  }}
                />
                <EditableNumberRow
                  label="Max reconnect attempts"
                  value={maxReconnectAttempts}
                  min={0}
                  max={20}
                  onChange={(v) => {
                    setMaxReconnectAttempts(v)
                    persistSetting('ssh.maxReconnectAttempts', v)
                  }}
                />
              </Section>

              {/* Transfers */}
              <Section title="Transfers" icon={<Upload className="h-4 w-4" />}>
                <EditableNumberRow
                  label="Concurrent transfers"
                  value={concurrency}
                  min={1}
                  max={10}
                  onChange={(v) => {
                    setConcurrency(v)
                    persistSetting('transfer.concurrency', v)
                  }}
                />
              </Section>

              {/* Data */}
              <Section title="Data" icon={<Database className="h-4 w-4" />}>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const connections = await window.api.connections.export()
                        if (connections.length === 0) {
                          toast.info('No connections to export')
                          return
                        }
                        const content = JSON.stringify(connections, null, 2)
                        const saved = await window.api.shell.saveFileDialog({
                          defaultPath: 'lunar-connections.json',
                          filters: [{ name: 'JSON', extensions: ['json'] }],
                          content
                        })
                        if (saved) toast.success(`Exported ${connections.length} connections`)
                      } catch (err: unknown) {
                        toast.error(
                          `Export failed: ${err instanceof Error ? err.message : String(err)}`
                        )
                      }
                    }}
                    className="btn-outline flex-1"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const { imported, skipped } =
                          await window.api.connections.importFromFile()
                        if (imported === -1) return // Dialog cancelled
                        if (imported > 0) {
                          toast.success(
                            `Imported ${imported} connection${imported > 1 ? 's' : ''}` +
                              (skipped.length > 0 ? ` — ${skipped.length} skipped` : '')
                          )
                        } else {
                          toast.info(
                            skipped.length > 0
                              ? `No new connections imported (${skipped.length} skipped)`
                              : 'No new connections to import'
                          )
                        }
                        for (const s of skipped.slice(0, 5)) {
                          toast.warning(`Skipped "${s.name}": ${s.reason}`)
                        }
                      } catch (err: unknown) {
                        toast.error(
                          `Import failed: ${err instanceof Error ? err.message : String(err)}`
                        )
                      }
                    }}
                    className="btn-outline flex-1"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  Export and import connections (credentials are not included)
                </p>
              </Section>

              {/* Logs */}
              <Section title="Diagnostics" icon={<FileText className="h-4 w-4" />}>
                <button onClick={() => window.api.app.openLogFile()} className="btn-outline w-full">
                  <FileText className="h-3.5 w-3.5" />
                  Open log file
                </button>
                <p className="text-[11px] text-muted-foreground/60">
                  Open the application log folder to attach to bug reports
                </p>
              </Section>

              {/* About */}
              <Section title="About" icon={<Info className="h-4 w-4" />}>
                <div className="rounded-lg border border-border/60 bg-background/50 p-4 text-center">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center">
                    <img src={lunarLogo} alt="Lunar Logo" className="h-full w-full object-contain drop-shadow-sm" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Lunar</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    SSH Terminal & SFTP File Manager
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/60">v{appVersion}</p>
                </div>
              </Section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({
  title,
  icon,
  children
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3.5">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="space-y-3 pl-6">{children}</div>
    </div>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground/70">{label}</span>
      <span className="text-xs text-muted-foreground/70">{value}</span>
    </div>
  )
}

function ToggleRow({
  label,
  enabled,
  onToggle
}: {
  label: string
  enabled: boolean
  onToggle?: (value: boolean) => void
}) {
  // Use React.useId for stable, unique IDs instead of module-level counter
  const labelId = useId()

  return (
    <div className="flex items-center justify-between py-1">
      <span id={labelId} className="text-xs text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        onClick={() => onToggle?.(!enabled)}
        className={cn(
          'flex h-5 w-9 items-center rounded-full px-0.5 cursor-pointer transition-colors',
          enabled ? 'bg-emerald-500' : 'bg-muted'
        )}
      >
        <div
          className={cn(
            'h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  )
}

function EditableNumberRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= min && v <= max) onChange(v)
          }}
          className="w-16 rounded border border-border bg-background px-2 py-0.5 text-right text-xs font-medium text-foreground outline-none focus:border-ring"
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}
