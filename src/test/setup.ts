import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      if (!this.open) {
        Object.defineProperty(this, "open", {
          value: true,
          configurable: true,
          writable: true,
        });
      }
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
      returnValue?: string
    ) {
      this.removeAttribute("open");
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      if (this.open) {
        Object.defineProperty(this, "open", {
          value: false,
          configurable: true,
          writable: true,
        });
      }
      this.dispatchEvent(new Event("close"));
    };
  }
}

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

if (typeof window !== "undefined" && !window.print) {
  window.print = () => {};
}
