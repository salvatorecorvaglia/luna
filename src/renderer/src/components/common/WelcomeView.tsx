import { FolderOpen, Plus, Command, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import lunarLogo from '../../../../../resources/lunar.png'
import { useConnectionStore } from '@/stores/connection-store'
import { useUIStore } from '@/stores/ui-store'

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } }
}

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } }
}

const actions = [
  {
    key: 'new',
    icon: Plus,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 group-hover:bg-blue-500/15',
    title: 'New Connection',
    desc: 'Set up an SSH connection to a server'
  },
  {
    key: 'sftp',
    icon: FolderOpen,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10 group-hover:bg-violet-500/15',
    title: 'SFTP Browser',
    desc: 'Browse and transfer files over SSH'
  }
] as const

export function WelcomeView() {
  const { openCreateForm } = useConnectionStore()
  const { setActiveView } = useUIStore()

  const handleAction = (key: string) => {
    if (key === 'new') openCreateForm()
    else if (key === 'sftp') setActiveView('sftp')
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      {/* Subtle radial glow behind content */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-500/[0.07] to-violet-500/[0.07] blur-3xl" />
      </div>

      <motion.div
        initial="initial"
        animate="animate"
        variants={stagger}
        className="relative max-w-md text-center"
      >
        {/* Logo */}
        <motion.div variants={fadeUp} className="mx-auto mb-6">
          <div className="mx-auto flex h-24 w-24 items-center justify-center">
            <img src={lunarLogo} alt="Lunar Logo" className="h-full w-full object-contain drop-shadow-xl" />
          </div>
        </motion.div>

        <motion.h1 variants={fadeUp} className="text-2xl font-bold tracking-tight text-foreground">
          Welcome to Lunar
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2 text-sm text-muted-foreground">
          A modern SSH terminal and SFTP file manager
        </motion.p>

        {/* Quick Actions */}
        <motion.div variants={fadeUp} className="mt-8 grid gap-2.5">
          {actions.map((action) => (
            <motion.button
              key={action.key}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => handleAction(action.key)}
              className="group flex w-full items-center gap-3.5 rounded-xl border border-border/80 bg-card/80 p-4 text-left hover:border-border hover:bg-accent/50 cursor-pointer"
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${action.bg}`}
              >
                <action.icon className={`h-5 w-5 ${action.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{action.title}</div>
                <div className="text-xs text-muted-foreground/80">{action.desc}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/70" />
            </motion.button>
          ))}
        </motion.div>

        {/* Keyboard shortcut hint */}
        <motion.div
          variants={fadeUp}
          className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70"
        >
          <kbd className="inline-flex items-center gap-0.5 rounded-md border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
          <span>to open command palette</span>
        </motion.div>
      </motion.div>
    </div>
  )
}
