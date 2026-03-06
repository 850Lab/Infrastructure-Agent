import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ background: "#FFFFFF" }}
          data-testid="error-boundary-fallback"
        >
          <div className="max-w-md text-center space-y-4">
            <div
              className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
              style={{ background: "#FEE2E2" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold" style={{ color: "#0F172A" }}>
              Something went wrong
            </h2>
            <p className="text-sm" style={{ color: "#64748B" }}>
              The machine encountered an unexpected error. Try refreshing the page.
            </p>
            {this.state.error && (
              <p className="text-xs font-mono p-2 rounded" style={{ color: "#94A3B8", background: "#F8FAFC" }}>
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md text-sm font-medium text-white"
              style={{ background: "#10B981" }}
              data-testid="button-reload"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
