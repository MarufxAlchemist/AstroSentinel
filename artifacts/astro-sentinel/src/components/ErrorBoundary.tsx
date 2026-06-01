import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            padding: "2rem",
            background: "#0d1117",
            color: "#f85149",
            fontFamily: "monospace",
            minHeight: "100vh",
          }}
        >
          <h2 style={{ marginBottom: "1rem" }}>⚠ Runtime Error</h2>
          <pre
            style={{
              background: "#161b22",
              padding: "1rem",
              borderRadius: "6px",
              border: "1px solid #30363d",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#cdd9e5",
              fontSize: "13px",
            }}
          >
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1.5rem",
              background: "#1f6feb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
