import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    fetch("/api/log-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: errorInfo.componentStack,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      }),
    }).catch((err) => console.error("Failed to send error report", err));
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#030014] p-4">
          <Card className="w-full max-w-md border-red-900/50 bg-black/40 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-6 w-6 text-red-500" />
                <CardTitle className="text-xl text-white">Critical System Error</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-400">
                The application encountered an unexpected anomaly. The error has been logged.
              </p>
              {this.state.error && (
                <div className="mt-4 rounded-md bg-red-950/30 border border-red-900/50 p-3">
                  <code className="text-xs font-mono text-red-200 break-all">
                    {this.state.error.message}
                  </code>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button 
                onClick={() => window.location.reload()} 
                className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white"
                data-testid="button-reboot-system"
              >
                <RefreshCcw className="h-4 w-4" />
                Reboot System
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
