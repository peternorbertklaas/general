import { Component, type ErrorInfo, type ReactNode } from "react";
import { CHUNK_ERROR_TEXT, isChunkLoadError } from "../lib/lazy.js";

interface Props {
  children: ReactNode;
  /** Label shown in the fallback so the user knows which panel failed. */
  scope?: string;
}
interface State {
  error: Error | null;
}

/** German message for a caught render error – failed chunk loads get the deploy hint instead of the raw engine text (R6-01). */
export function errorMessageDe(error: Error, scope?: string): string {
  if (isChunkLoadError(error)) return CHUNK_ERROR_TEXT.replace("Ansicht", scope ?? "Ansicht");
  return error.message;
}

/**
 * Catches render errors of a single view/panel so one broken component never
 * takes the whole workstation down. Offers a reset; a chunk that could not be
 * loaded additionally offers a page reload (R6-01).
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
      const chunk = isChunkLoadError(this.state.error);
      return (
        <div className="card" role="alert" style={{ borderColor: "var(--neg)" }} data-testid="error-boundary">
          <h3>Fehler in {this.props.scope ?? "dieser Ansicht"}</h3>
          <div className="warning" style={{ borderLeftColor: "var(--neg)", background: "var(--neg-soft)" }}>
            {errorMessageDe(this.state.error, this.props.scope)}
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {chunk && (
              <button className="btn primary" onClick={() => window.location.reload()} data-testid="error-reload">
                Neu laden
              </button>
            )}
            <button className={`btn ${chunk ? "" : "primary"}`} onClick={() => this.setState({ error: null })} data-testid="error-retry">
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
