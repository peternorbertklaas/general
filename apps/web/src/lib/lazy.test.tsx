/**
 * R6-01: a failed chunk load is retried once with a cache-busting URL, then a
 * German error card with "Neu laden" / "Erneut versuchen" is shown – and
 * "Erneut versuchen" really imports again (React.lazy alone would cache the
 * rejection for the page's lifetime).
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyComponent, retryImport } from "./lazy.js";
import { ErrorBoundary, errorMessageDe } from "../components/ErrorBoundary.js";

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: http://localhost:4971/assets/ScenariosView-BVVvYVtY.js");

describe("lazyComponent – failed chunk loads (R6-01)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries once with the cache-busting URL, shows the German card with Neu laden / Erneut versuchen, and re-imports on retry", async () => {
    let calls = 0;
    const loader = vi.fn(() => {
      calls++;
      return calls <= 2 ? Promise.reject(chunkError()) : Promise.resolve({ default: () => <div data-testid="real">real</div> });
    });
    const retry = vi.fn((e: unknown) => {
      // the default retry would `import(url?retry=…)`; here the second attempt is the loader itself
      expect(String(e)).toMatch(/dynamically imported module/);
      return loader();
    });
    const Lazy = lazyComponent<object>(loader, { fallback: () => <div data-testid="fb">…</div>, retry, label: "Ansicht" });
    render(<Lazy />);
    expect(screen.getByTestId("fb")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("chunk-error")).toBeInTheDocument());
    // first attempt + one retry, no more
    expect(loader).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(Lazy.loaded).toBe(false);
    expect(Lazy.lastError).toBeInstanceOf(TypeError);
    const card = screen.getByTestId("chunk-error");
    expect(card).toHaveAttribute("role", "alert");
    expect(card.textContent).toMatch(/Ansicht konnte nicht geladen werden – vermutlich liegt eine neue Version/);
    expect(card.textContent).not.toMatch(/Failed to fetch|http:/);
    expect(screen.getByTestId("chunk-reload")).toHaveTextContent("Neu laden");
    // "Neu laden" reloads the page
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as unknown as Location);
    fireEvent.click(screen.getByTestId("chunk-reload"));
    expect(reload).toHaveBeenCalledTimes(1);
    // "Erneut versuchen" imports again – the third call succeeds and the real component renders
    await act(async () => {
      fireEvent.click(screen.getByTestId("chunk-retry"));
    });
    await waitFor(() => expect(screen.getByTestId("real")).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(3);
    expect(Lazy.loaded).toBe(true);
    expect(Lazy.lastError).toBeUndefined();
  });

  it("a fresh mount after a failure imports again instead of showing the cached error (g s twice)", async () => {
    let calls = 0;
    const loader = vi.fn(() => {
      calls++;
      return calls <= 2 ? Promise.reject(chunkError()) : Promise.resolve({ default: () => <div data-testid="real2">real</div> });
    });
    const Lazy = lazyComponent<object>(loader, { retry: () => loader() });
    const { unmount } = render(<Lazy />);
    await waitFor(() => expect(screen.getByTestId("chunk-error")).toBeInTheDocument());
    unmount();
    render(<Lazy />);
    await waitFor(() => expect(screen.getByTestId("real2")).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("keeps the render path per mount: the first re-render after the chunk arrived does not remount the view (focus / state kept)", async () => {
    let resolve!: (m: { default: () => React.JSX.Element }) => void;
    const Lazy = lazyComponent<{ tick: number }>(() => new Promise((r) => (resolve = r)), { fallback: () => <div data-testid="fb2">…</div> });
    let mounts = 0;
    const Real = () => {
      const [n, setN] = React.useState(0);
      React.useEffect(() => {
        mounts++;
      }, []);
      return (
        <button data-testid="counter" onClick={() => setN((x) => x + 1)}>
          {n}
        </button>
      );
    };
    const { rerender } = render(<Lazy tick={0} />);
    expect(screen.getByTestId("fb2")).toBeInTheDocument();
    await act(async () => {
      resolve({ default: Real });
      await Lazy.preload();
    });
    await waitFor(() => expect(screen.getByTestId("counter")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("counter"));
    expect(screen.getByTestId("counter").textContent).toBe("1");
    // a re-render of the wrapper (store update) must not swap Suspense → direct and remount the child
    rerender(<Lazy tick={1} />);
    expect(screen.getByTestId("counter").textContent).toBe("1");
    expect(mounts).toBe(1);
  });

  it("preload rejects after both attempts failed and succeeds after a retry; without a URL there is no second attempt", async () => {
    const loader = vi.fn(() => Promise.reject(new Error("boom")));
    const Lazy = lazyComponent<object>(loader);
    await expect(Lazy.preload()).rejects.toThrow("boom");
    // retryImport finds no URL in "boom" → exactly one loader call
    expect(loader).toHaveBeenCalledTimes(1);
    expect(retryImport(new Error("boom"))).toBeUndefined();
    const ok = vi.fn(() => Promise.resolve({ default: () => <div /> }));
    const Lazy2 = lazyComponent<object>(ok);
    await Lazy2.preload();
    expect(Lazy2.loaded).toBe(true);
  });

  it("ErrorBoundary maps a chunk error to the German text with a Neu laden button and re-renders on Erneut versuchen", () => {
    let fail = true;
    const Boom = () => {
      if (fail) throw chunkError();
      return <div data-testid="fine">fine</div>;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary scope="Szenarien">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary").textContent).toMatch(/Szenarien konnte nicht geladen werden – vermutlich liegt eine neue Version/);
    expect(screen.getByTestId("error-boundary").textContent).not.toMatch(/Failed to fetch/);
    expect(screen.getByTestId("error-reload")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByTestId("error-retry"));
    expect(screen.getByTestId("fine")).toBeInTheDocument();
    expect(errorMessageDe(new Error("x is not a function"))).toBe("x is not a function");
    spy.mockRestore();
  });
});
