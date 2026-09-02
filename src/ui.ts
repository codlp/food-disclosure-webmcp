import { DEMO_REQUEST } from "./demo-request";

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

  document.querySelectorAll("[data-disclosure-dialog]").forEach((control) => {
    control.addEventListener("click", () => {
      const id = control.getAttribute("data-disclosure-dialog");
      const dialog = id ? document.getElementById(id) : null;
      if (dialog instanceof HTMLDialogElement) dialog.showModal();
    });
  });

  document.querySelectorAll("[data-close-dialog]").forEach((control) => {
    control.addEventListener("click", () => {
      control.closest("dialog")?.close();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
