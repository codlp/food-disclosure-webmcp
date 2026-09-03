"use strict";
(() => {
  // src/demo-request.ts
  var DEMO_REQUEST = "Build a snack basket under $40. Avoid wheat, barley, rye, malt, semolina, and anything with a \u201Cmay contain wheat\u201D or \u201Cmay contain gluten\u201D label statement. Do not add products with missing ingredient or label statement data.";

  // src/ui.ts
  function start() {
    const button = document.getElementById("copy-demo-request");
    if (button) {
      const copied = button.getAttribute("data-copied-label") ?? "Copied";
      const failed = button.getAttribute("data-failed-label") ?? button.textContent ?? "";
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(DEMO_REQUEST);
          button.setAttribute("data-copied", "true");
          button.textContent = copied;
        } catch {
          button.setAttribute("data-copied", "false");
          button.textContent = failed;
        }
      });
    }
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const opener = target.closest("[data-disclosure-dialog]");
      if (opener) {
        const id = opener.getAttribute("data-disclosure-dialog");
        const dialog = id ? document.getElementById(id) : null;
        if (dialog instanceof HTMLDialogElement) dialog.showModal();
        return;
      }
      const closer = target.closest("[data-close-dialog]");
      if (closer) closer.closest("dialog")?.close();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
