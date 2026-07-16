import { Component, type ErrorInfo, type ReactNode } from "react";

import { AppRecoveryScreen } from "@/components/AppRecoveryScreen";
import { isStaleChunkError, reloadApp, signOutAndRecover } from "@/lib/appRecovery";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  busy: boolean;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, busy: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, busy: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void import("@/lib/clientObservability")
      .then(({ reportReactRenderError }) => reportReactRenderError(error, info.componentStack || ""))
      .catch(() => {
        // The recovery screen must remain available even if reporting cannot load.
      });
  }

  private retry = async () => {
    this.setState({ busy: true });
    await reloadApp({ clearCaches: isStaleChunkError(this.state.error) });
  };

  private signOut = async () => {
    this.setState({ busy: true });
    await signOutAndRecover();
  };

  render() {
    if (this.state.error) {
      return <AppRecoveryScreen onRetry={this.retry} onSignOut={this.signOut} busy={this.state.busy} />;
    }
    return this.props.children;
  }
}
