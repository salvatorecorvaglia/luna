import {TitleBar} from './TitleBar'
import {Sidebar} from './Sidebar'
import {StatusBar} from './StatusBar'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background theme-transition">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
      <StatusBar />
    </div>
  )
}
