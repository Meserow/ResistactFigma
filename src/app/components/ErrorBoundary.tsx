import { Component, type ReactNode, type ErrorInfo } from "react";

// Matches the various browser/Vite phrasings for "a lazily-imported chunk
// failed to load" — almost always a stale tab after a redeploy (the hashed
// chunk filename it references no longer exists on the server).
const CHUNK_LOAD_ERROR =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
const CHUNK_RELOAD_KEY = "resistact:lastChunkReload";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
    // Stale-deploy recovery: a failed lazy-chunk load is almost always a tab
    // opened before a redeploy. Reload once to fetch the current build instead
    // of showing the error card. Loop-guarded so a genuinely broken chunk
    // surfaces the card rather than reloading forever.
    if (CHUNK_LOAD_ERROR.test(error?.message ?? "")) {
      const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg">
              Something went wrong
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-500 text-sm">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-[#23297e] text-white font-['Poppins',sans-serif] font-semibold text-sm rounded-xl hover:bg-[#1a2060] transition-colors"
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
