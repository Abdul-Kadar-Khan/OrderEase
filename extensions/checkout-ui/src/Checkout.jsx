import '@shopify/ui-extensions/preact';
import { render, Component } from "preact";
import OrderStatusBlock2 from "./OrderStatusBlock2.jsx";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[Checkout UI ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <s-banner tone="critical" heading="Order Management Extension">
          <s-text>Unable to render order management UI: {this.state.error?.message || "Unexpected error"}</s-text>
        </s-banner>
      );
    }
    return this.props.children;
  }
}

export default async () => {
  render(
    <ErrorBoundary>
      <Extension />
    </ErrorBoundary>,
    document.body
  );
};

function Extension() {
  return <OrderStatusBlock2 />;
}