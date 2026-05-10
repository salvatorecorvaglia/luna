import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import App from './App';
import '@/assets/main.css';

import { LunarError } from '@shared/errors';
import { logger } from './lib/logger';

// Global handlers for unhandled errors and promise rejections (e.g. failed IPC).
// React's ErrorBoundary catches render-phase errors; this catches the rest.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;

  if (LunarError.isLunarError(reason)) {
    const lunarError = LunarError.fromUnknown(reason);
    logger.error(`[unhandledrejection] ${lunarError.message}`, lunarError.toObject());
    toast.error(lunarError.message, {
      description: `Error code: ${lunarError.code}`,
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
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
