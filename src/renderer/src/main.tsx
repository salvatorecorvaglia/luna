import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import App from './App';
import '@/assets/main.css';

import { LunaError } from '@shared/errors';
import { logger } from './lib/logger';

// Global handlers for unhandled errors and promise rejections (e.g. failed IPC).
// React's ErrorBoundary catches render-phase errors; this catches the rest.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;

  if (LunaError.isLunaError(reason)) {
    const lunaError = LunaError.fromUnknown(reason);
    logger.error(`[unhandledrejection] ${lunaError.message}`, lunaError.toObject());
    toast.error(lunaError.message, {
      description: `Error code: ${lunaError.code}`,
    });
  } else {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unknown error';
    logger.error(`[unhandledrejection] ${message}`, { reason });
    toast.error(message, { description: 'An unexpected error occurred.' });
  }
});

window.addEventListener('error', (event) => {
  const error = event.error;
  if (error instanceof Error) {
    logger.error('[window.error]', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  } else {
    logger.error('[window.error]', { error: event.message || error });
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/*
        `prefers-reduced-motion` in main.css only neutralises CSS transitions.
        Every overlay in the app animates through framer-motion, which drives
        values in JavaScript and never consults that media query — so a user
        who asked the OS to reduce motion still got scale + slide on every
        modal, panel, and toast. reducedMotion="user" makes framer-motion
        honour the same preference: it drops transform animations while
        keeping opacity crossfades, so things still read as appearing without
        the movement that triggers vestibular symptoms.
      */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>,
);
