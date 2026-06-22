import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Forward to the unified logger so renderer crashes land in the same
    // file as main-process logs. Local console.error stays for devtools.
    console.error('[ErrorBoundary]', error, info.componentStack);
    logger.error('[ErrorBoundary] renderer crash', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
          <AlertTriangle className="size-10 text-destructive" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>

          <button
            onClick={this.handleReload}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent cursor-pointer"
          >
            <RotateCcw className="size-4" />
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
