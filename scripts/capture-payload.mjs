#!/usr/bin/env node
/**
 * Capture #food-disclosure-payload from the unpublished preview and compare it
 * to fixtures/products.json. Does not print URLs, GIDs, or passwords.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(homedir(), ".config/food-disclosure-webmcp");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9335;

async function cdp(ws, method, params = {}, sessionId) {
  const id = Math.floor(Math.random() * 1e9);
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cdp timeout ${method}`)), 30000);
    const onMessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
  });
}

async function evaluate(ws, sessionId, expression, awaitPromise = true) {
  const result = await cdp(
    ws,
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true, timeout: 25000 },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
  return result.result?.value;
}

const url = JSON.parse(await readFile(join(configDir, "owned/theme-push-unpublished.json"), "utf8"))
  ?.theme?.preview_url;
if (!url) throw new Error("missing preview url");
const password = (await readFile(join(configDir, "visitor-password"), "utf8")).trim();
const userDataDir = await mkdtemp(join(tmpdir(), "fd-payload-"));
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ],
  { stdio: "ignore" },
);

try {
  let version;
  for (let i = 0; i < 40; i += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
      break;
    } catch {
      await delay(250);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error("chrome debugging port did not open");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("browser websocket failed")));
  });
  const targets = await cdp(ws, "Target.getTargets");
  const page = (targets.targetInfos || []).find((t) => t.type === "page");
  const attached = await cdp(ws, "Target.attachToTarget", {
    targetId: page.targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;
  await cdp(ws, "Page.enable", {}, sessionId);
  await cdp(ws, "Runtime.enable", {}, sessionId);
  await delay(1500);
  const passwordForm = await evaluate(
    ws,
    sessionId,
    `Boolean(document.getElementById("password") && document.querySelector("form"))`,
  );
  if (passwordForm) {
    await evaluate(
      ws,
      sessionId,
      `(() => {
        const input = document.getElementById("password");
        const form = input?.form;
        if (!input || !form) return false;
        input.value = ${JSON.stringify(password)};
        form.submit();
        return true;
      })()`,
      false,
    );
    await delay(2500);
  }
  await evaluate(
    ws,
    sessionId,
    `(() => {
      const u = new URL(location.href);
      u.pathname = "/collections/food-disclosure-demo";
      location.assign(u.pathname + u.search);
      return true;
    })()`,
    false,
  );
  await delay(2500);
  const payload = await evaluate(
    ws,
    sessionId,
    `JSON.parse(document.getElementById("food-disclosure-payload")?.textContent || "null")`,
  );
  ws.close();
  if (!Array.isArray(payload) || payload.length !== 12) {
    throw new Error(`expected 12 payload rows, got ${Array.isArray(payload) ? payload.length : 0}`);
  }
  const out = join(configDir, "owned/live-payload.json");
  await writeFile(out, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  const compare = spawn(process.execPath, [join(root, "scripts/compare-payload.mjs"), out], {
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => compare.on("close", resolve));
  if (code !== 0) process.exit(code);
  const cases = Object.fromEntries(
    payload.map((row) => [
      row.handle,
      {
        ingredients: row.ingredients === null ? "null" : "string",
        label_statements:
          row.label_statements === null ? "null" : `array:${row.label_statements.length}`,
      },
    ]),
  );
  console.log("payload compared", JSON.stringify(cases));
} finally {
  chrome.kill("SIGTERM");
  await delay(400);
  await rm(userDataDir, { recursive: true, force: true });
}
