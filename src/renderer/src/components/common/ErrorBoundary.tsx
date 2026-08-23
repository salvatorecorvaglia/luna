import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  /**
   * Name of the view this boundary wraps. When set, the fallback renders
   * scoped to that view (and offers to retry just it) instead of taking over
   * the whole window — a crash in the file browser shouldn't hide terminal
   * sessions that are still perfectly healthy.
   */
  viewName?: string;
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
      view: this.props.viewName ?? 'root',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  /**
   * Scoped boundaries clear their own error and re-render the subtree; only
   * the root boundary has to fall back to a full reload, because at that
   * point there's no known-good tree left to keep.
   */
  handleRetry = (): void => {
    if (this.props.viewName) {
      this.setState({ hasError: false, error: null });
      return;
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const scoped = Boolean(this.props.viewName);
      return (
        <div
          role="alert"
          className={cn(
            'flex flex-col items-center justify-center gap-4 bg-background text-foreground',
            scoped ? 'h-full w-full' : 'h-screen w-screen',
          )}
        >
          <AlertTriangle className="size-10 text-destructive-fg" />
          <h2 className="text-lg font-semibold">
            {scoped ? `${this.props.viewName} stopped responding` : 'Something went wrong'}
          </h2>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          {scoped && (
            <p className="max-w-md text-center text-xs text-muted-foreground/70">
              Your other sessions are unaffected.
            </p>
          )}

          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent cursor-pointer"
          >
            <RotateCcw className="size-4" />
            {scoped ? 'Retry' : 'Reload'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
