import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  React.PropsWithChildren<object>,
  State
> {
  constructor(props: React.PropsWithChildren<object>) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "50vh",
            gap: "16px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px" }}>😵</div>
          <h2 style={{ margin: 0, color: "var(--text-primary, #fff)" }}>
            页面加载出错
          </h2>
          <p style={{ color: "var(--text-secondary, #999)", maxWidth: "400px" }}>
            {this.state.error?.message || "发生了一个意外错误"}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              background: "var(--color-primary, #5ee8c5)",
              color: "#000",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "14px",
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
