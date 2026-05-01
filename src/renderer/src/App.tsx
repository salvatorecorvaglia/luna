import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { useUIStore } from '@/stores/ui-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useConnectionStore } from '@/stores/connection-store'
import { WelcomeView } from '@/components/common/WelcomeView'
import { ConnectionForm } from '@/components/connection/ConnectionForm'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { SettingsPanel } from '@/components/common/SettingsPanel'
import { HostKeyDialog } from '@/components/common/HostKeyDialog'
import { TerminalView } from '@/components/terminal/TerminalView'
import { SftpManager } from '@/components/sftp/SftpManager'
import { useTransferEventListener } from '@/hooks/use-transfers'
import { useUpdaterEventListener } from '@/hooks/use-updater'
import { applyUIThemeTokens, buildUIThemeTokens } from '@/themes/ui-from-terminal'

export default function App() {
  const activeView = useUIStore((s) => s.activeView)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const applyTerminalThemeToUI = useUIStore((s) => s.applyTerminalThemeToUI)
  const tabOrder = useTerminalStore((s) => s.tabOrder)
  const terminalTheme = useTerminalStore((s) => s.terminalTheme)

  // Apply terminal palette to UI tokens when toggled on
  useEffect(() => {
    applyUIThemeTokens(applyTerminalThemeToUI ? buildUIThemeTokens(terminalTheme) : null)
  }, [applyTerminalThemeToUI, terminalTheme])

  // Wire IPC transfer events into the Zustand store
  useTransferEventListener()

  // Wire IPC auto-update events into toast notifications
  useUpdaterEventListener()

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // Cmd+K: Command palette
      if (mod && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }

      // Cmd+B: Toggle sidebar
      if (mod && e.key === 'b') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
      }

      // Cmd+,: Settings
      if (mod && e.key === ',') {
        e.preventDefault()
        useUIStore.getState().setSettingsOpen(true)
      }

      // Cmd+N: New connection
      if (mod && e.key === 'n') {
        e.preventDefault()
        useConnectionStore.getState().openCreateForm()
      }

      // Cmd+Shift+1 — Switch to Terminal view
      if (mod && e.shiftKey && e.key === '!') {
        e.preventDefault()
        useUIStore.getState().setActiveView('terminal')
      }

      // Cmd+Shift+2 — Switch to SFTP view
      if (mod && e.shiftKey && e.key === '@') {
        e.preventDefault()
        useUIStore.getState().setActiveView('sftp')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCommandPaletteOpen])

  const hasTerminals = tabOrder.length > 0
  const showTerminal = activeView === 'terminal' && hasTerminals
  const showSftp = activeView === 'sftp'
  const showWelcome = !showTerminal && !showSftp

  return (
    <>
      <AppShell>
        {/* Keep TerminalView mounted across view switches so xterm buffers/history survive */}
        {hasTerminals && (
          <div className={showTerminal ? 'h-full' : 'hidden'}>
            <TerminalView />
          </div>
        )}
        {showSftp && <SftpManager />}
        {showWelcome && <WelcomeView />}
      </AppShell>

      {/* Overlays */}
      <ConnectionForm />
      <CommandPalette />
      <SettingsPanel />
      <HostKeyDialog />

      <Toaster
        theme="dark"
        position="bottom-right"
        // Sonner forwards `aria-live` onto the live region; "polite" so toasts
        // don't interrupt screen-reader users mid-utterance.
        toastOptions={{
          className: 'text-sm'
        }}
        richColors={false}
        closeButton
      />
    </>
  )
}
