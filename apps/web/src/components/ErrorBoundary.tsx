import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label shown in the fallback so the user knows which panel failed. */
  scope?: string;
}
interface State {
  error: Error | null;
}

/**
 * Catches render errors of a single view/panel so one broken component never
 * takes the whole workstation down. Offers a reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[DERIVA] ${this.props.scope ?? "component"} failed`, error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="card" role="alert" style={{ borderColor: "var(--neg)" }}>
          <h3>Fehler in {this.props.scope ?? "dieser Ansicht"}</h3>
          <div className="warning" style={{ borderLeftColor: "var(--neg)", background: "var(--neg-soft)" }}>
            {this.state.error.message}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              Erneut versuchen
            </button>
            <span className="muted xs">Der Rest der Anwendung läuft weiter. Details in der Browser-Konsole.</span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
