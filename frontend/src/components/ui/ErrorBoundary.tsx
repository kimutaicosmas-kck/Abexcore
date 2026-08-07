import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorPage } from '../../pages/ErrorPage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorPage
          onRetry={() => {
            // Full reload recovers from HMR/context tears (e.g. AuthProvider).
            window.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
