import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";

function CheckoutButton({ loading }: { loading: boolean }) {
  return (
    <button>
      {loading && <span aria-label="loading">…</span>}
      {!loading && "Betala 99 kr"}
    </button>
  );
}

describe("external browser DOM mutation reproduction", () => {
  it("reproduces the native removeChild failure when translation reparents React text", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => root.render(<CheckoutButton loading={false} />));

    const button = container.querySelector("button")!;
    const originalText = button.firstChild!;
    const translatedWrapper = document.createElement("font");
    button.replaceChild(translatedWrapper, originalText);
    translatedWrapper.appendChild(originalText);

    expect(() => flushSync(() => root.render(<CheckoutButton loading />)))
      .toThrow(/not a child|child of this node/i);

    container.remove();
    consoleError.mockRestore();
  });
});
