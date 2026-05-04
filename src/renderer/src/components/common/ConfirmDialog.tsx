import {useEffect, useRef} from 'react'
import {AnimatePresence, motion} from 'framer-motion'
import {AlertTriangle} from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
}

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }
  },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.1 } }
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    // Auto-focus cancel button
    requestAnimationFrame(() => {
      const cancelBtn = dialog.querySelector<HTMLElement>('[data-cancel]')
      cancelBtn?.focus()
    })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key === 'Tab') {
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])'
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

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-message"
              className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                {destructive && (
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 id="confirm-dialog-title" className="text-sm font-semibold text-foreground">
                    {title}
                  </h3>
                  <p
                    id="confirm-dialog-message"
                    className="mt-1 text-xs text-muted-foreground leading-relaxed"
                  >
                    {message}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button data-cancel onClick={onCancel} className="btn-ghost">
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={destructive ? 'btn-destructive' : 'btn-primary'}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
