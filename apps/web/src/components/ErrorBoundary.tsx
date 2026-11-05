import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Last-resort guard so a rendering bug shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally silent: Dockside has no external error reporting. The browser console keeps the stack.
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth">
        <div className="auth__panel" role="alert">
          <h1>Something broke on this screen</h1>
          <p className="muted">
            Your data is safe. Reload to try again; if it keeps happening, check the browser console.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
