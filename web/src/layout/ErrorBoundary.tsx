import { Component, type ReactNode } from 'react';
import { Alert, Button } from '@mui/material';

interface Props {
  children: ReactNode;
  /** A change (e.g. the route path) clears a caught error and renders the children again. */
  resetKey?: unknown;
  /** Defaults to reloading the page. */
  onReload?: () => void;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

function reloadPage() {
  window.location.reload();
}

/**
 * Contains a render error to one region (the routed page, a sheet, a timeline day) so a single
 * malformed record cannot blank the whole app. React reports the caught error to the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={this.props.onReload ?? reloadPage}>
            Reload
          </Button>
        }
      >
        Something went wrong.
      </Alert>
    );
  }
}
