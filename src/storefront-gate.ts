import type { GateDecision } from "./cart-gate";
import {
  cartLineIdForChange,
  parseCartRequest,
  resolveCartRequest,
  type CartSnapshot,
  type ParsedCartRequest,
} from "./cart-routes";

export {
  isCartAddPath,
  parseCartRequest,
  resolveCartRequest,
  variantIdFromCartAddBody,
  variantIdFromSearchParams,
  variantIdsFromCartAddBody,
} from "./cart-routes";

export function requestHref(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isProductAddForm(form: HTMLFormElement): boolean {
  if (form.querySelector('[name="add"]')) return true;
  const action = form.getAttribute("action") || form.action || "";
  const method = (form.getAttribute("method") || form.method || "POST").toUpperCase();
  const parsed = parseCartRequest(action, method);
  return parsed.type !== "ignore";
}

export function variantIdFromForm(form: HTMLFormElement): string | undefined {
  const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(
    'select[name="id"], input[name="id"]',
  );
  const value = input?.value?.trim();
  return value || undefined;
}

type GuardOptions = {
  evaluate: (raw: string) => Promise<GateDecision>;
  onBlocked: (decision: Extract<GateDecision, { ok: false }>) => void;
};

export type StorefrontGuard = {
  reconcile: () => Promise<boolean>;
};

const BLOCKED_JSON = {
  status: 422,
  message: "DISCLOSURE_RETRIEVAL_REQUIRED",
  description:
    "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.",
};

function unknownDecision(): Extract<GateDecision, { ok: false }> {
  return {
    ok: false,
    reason: "UNKNOWN_PRODUCT_VARIANT",
    field: ["id"],
    message:
      "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.",
  };
}

async function decide(raw: string | undefined, options: GuardOptions): Promise<boolean> {
  if (!raw) {
    options.onBlocked(unknownDecision());
    return false;
  }
  const decision = await options.evaluate(raw);
  if (!decision.ok) {
    options.onBlocked(decision);
    return false;
  }
  return true;
}

async function decideAll(ids: string[], options: GuardOptions): Promise<boolean> {
  if (ids.length === 0) return decide(undefined, options);
  for (const id of ids) {
    if (!(await decide(id, options))) return false;
  }
  return true;
}

function blockedResponse(): Response {
  return new Response(JSON.stringify(BLOCKED_JSON), {
    status: 422,
    headers: { "Content-Type": "application/json" },
  });
}

async function readCartSnapshot(
  nativeFetch: typeof fetch,
): Promise<CartSnapshot | null> {
  try {
    const response = await nativeFetch("/cart.js", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as CartSnapshot;
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

async function allowParsed(
  parsed: ParsedCartRequest,
  options: GuardOptions,
  nativeFetch: typeof fetch,
): Promise<boolean> {
  if (parsed.type === "ignore" || parsed.type === "allow") return true;
  const cart = parsed.type === "mutate" ? await readCartSnapshot(nativeFetch) : null;
  const resolved = resolveCartRequest(parsed, cart);
  if (resolved.type === "allow") return true;
  return decideAll(resolved.variantIds, options);
}

async function stripUnauthorizedCartLines(
  nativeFetch: typeof fetch,
  evaluate: GuardOptions["evaluate"],
): Promise<boolean> {
  const cart = await readCartSnapshot(nativeFetch);
  if (!cart || cart.items.length === 0) return false;
  let changed = false;
  for (const item of cart.items) {
    const variantId = String(item.variant_id ?? item.id);
    const decision = await evaluate(variantId);
    if (decision.ok) continue;
    try {
      const lineId = cartLineIdForChange(item);
      const response = await nativeFetch("/cart/change.js", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lineId, quantity: 0 }),
      });
      if (response.ok) changed = true;
    } catch {
      /* keep going */
    }
  }
  return changed;
}

async function bodyFromFetch(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (init?.body) return init.body;
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function installStorefrontCartGuard(options: GuardOptions): StorefrontGuard {
  const allowedForms = new WeakSet<HTMLFormElement>();
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const nativeFetch = window.fetch.bind(window);
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrUrl = new WeakMap<XMLHttpRequest, string>();
  const xhrMethod = new WeakMap<XMLHttpRequest, string>();
  const nativeAssignFn = Location.prototype.assign;
  const nativeReplaceFn = Location.prototype.replace;
  const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
  const nativeOpen = window.open.bind(window);
  const nativeBeacon = navigator.sendBeacon?.bind(navigator);

  let queue: Promise<void> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function gatedParse(url: string, method: string, body?: unknown): ParsedCartRequest {
    return parseCartRequest(url, method, body);
  }

  async function submitIfAllowed(form: HTMLFormElement): Promise<void> {
    if (!isProductAddForm(form)) {
      nativeSubmit.call(form);
      return;
    }
    const action = form.getAttribute("action") || form.action || "";
    const method = (form.getAttribute("method") || form.method || "POST").toUpperCase();
    const allowed = form.querySelector('[name="add"]')
      ? await serialize(() => decide(variantIdFromForm(form), options))
      : await serialize(() =>
          allowParsed(gatedParse(action, method, new FormData(form)), options, nativeFetch),
        );
    if (!allowed) return;
    allowedForms.add(form);
    try {
      nativeSubmit.call(form);
    } finally {
      allowedForms.delete(form);
    }
  }

  function interceptNavigation(url: string, proceed: () => void): void {
    const parsed = gatedParse(url, "GET");
    if (parsed.type === "ignore" || parsed.type === "allow") {
      proceed();
      return;
    }
    void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
      if (allowed) proceed();
    });
  }

  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    if (allowedForms.has(this) || !isProductAddForm(this)) {
      nativeSubmit.call(this);
      return;
    }
    void submitIfAllowed(this);
  };

  HTMLFormElement.prototype.requestSubmit = function (
    this: HTMLFormElement,
    submitter?: HTMLElement | null,
  ) {
    if (allowedForms.has(this) || !isProductAddForm(this)) {
      nativeRequestSubmit.call(this, submitter ?? undefined);
      return;
    }
    void submitIfAllowed(this);
  };

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !isProductAddForm(form)) return;
      if (allowedForms.has(form)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void submitIfAllowed(form);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const addButton = target.closest<HTMLButtonElement>('button[name="add"], input[name="add"]');
      if (addButton?.form instanceof HTMLFormElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void submitIfAllowed(addButton.form);
        return;
      }
      const increase = target.closest<HTMLAnchorElement>("a[data-cart-increase]");
      if (increase) {
        const raw = increase.getAttribute("data-cart-increase")?.trim();
        event.preventDefault();
        event.stopImmediatePropagation();
        void serialize(() => decide(raw, options)).then((allowed) => {
          if (allowed && increase.href) nativeAssignFn.call(window.location, increase.href);
        });
        return;
      }
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link?.href) return;
      const parsed = gatedParse(link.href, "GET");
      if (parsed.type === "ignore" || parsed.type === "allow") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
        if (allowed) nativeAssignFn.call(window.location, link.href);
      });
    },
    true,
  );

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = requestHref(input);
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const parsed = gatedParse(
      input instanceof Request ? input.url : href,
      method,
      await bodyFromFetch(input, init),
    );
    if (parsed.type === "ignore" || parsed.type === "allow") {
      return nativeFetch(input as RequestInfo, init);
    }
    const allowed = await serialize(() => allowParsed(parsed, options, nativeFetch));
    if (!allowed) return blockedResponse();
    return nativeFetch(input as RequestInfo, init);
  };

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    xhrMethod.set(this, method);
    xhrUrl.set(this, String(url));
    return xhrOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const href = xhrUrl.get(this) ?? "";
    const method = xhrMethod.get(this) ?? "GET";
    const parsed = gatedParse(href, method, body);
    if (parsed.type === "ignore" || parsed.type === "allow") {
      xhrSend.call(this, body);
      return;
    }
    void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
      if (!allowed) {
        Object.defineProperty(this, "status", { configurable: true, value: 422 });
        Object.defineProperty(this, "responseText", {
          configurable: true,
          value: JSON.stringify({ status: 422, message: "DISCLOSURE_RETRIEVAL_REQUIRED" }),
        });
        this.dispatchEvent(new Event("load"));
        return;
      }
      xhrSend.call(this, body);
    });
  };

  function patchLocation(loc: Location) {
    try {
      loc.assign = (url: string | URL) => {
        interceptNavigation(String(url), () => nativeAssignFn.call(loc, url));
      };
    } catch {
      /* Location.assign can be read-only */
    }
    try {
      loc.replace = (url: string | URL) => {
        interceptNavigation(String(url), () => nativeReplaceFn.call(loc, url));
      };
    } catch {
      /* Location.replace can be read-only */
    }
    if (hrefDesc?.get && hrefDesc.set) {
      try {
        Object.defineProperty(loc, "href", {
          configurable: true,
          enumerable: hrefDesc.enumerable === true,
          get() {
            return hrefDesc.get!.call(loc);
          },
          set(value: string) {
            interceptNavigation(String(value), () => hrefDesc.set!.call(loc, value));
          },
        });
      } catch {
        /* Location.href can be read-only */
      }
    }
  }

  try {
    Location.prototype.assign = function (this: Location, url: string | URL) {
      interceptNavigation(String(url), () => nativeAssignFn.call(this, url));
    };
    Location.prototype.replace = function (this: Location, url: string | URL) {
      interceptNavigation(String(url), () => nativeReplaceFn.call(this, url));
    };
    if (hrefDesc?.get && hrefDesc.set) {
      Object.defineProperty(Location.prototype, "href", {
        configurable: true,
        enumerable: hrefDesc.enumerable === true,
        get() {
          return hrefDesc.get!.call(this);
        },
        set(value: string) {
          interceptNavigation(String(value), () => hrefDesc.set!.call(this, value));
        },
      });
    }
  } catch {
    /* some browsers keep Location methods read-only */
  }
  patchLocation(window.location);

  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (navigation) {
    let bypassNavigation = false;
    navigation.addEventListener("navigate", (event) => {
      if (bypassNavigation) return;
      const navEvent = event as Event & {
        canIntercept?: boolean;
        hashChange?: boolean;
        downloadRequest?: string | null;
        destination?: { url?: string };
        intercept?: (options: { handler: () => Promise<void> }) => void;
      };
      if (!navEvent.canIntercept || navEvent.hashChange || navEvent.downloadRequest) return;
      const url = navEvent.destination?.url;
      if (!url || !navEvent.intercept) return;
      const parsed = gatedParse(url, "GET");
      if (parsed.type === "ignore" || parsed.type === "allow") return;
      const originHref = window.location.href;
      navEvent.intercept({
        handler: async () => {
          const allowed = await serialize(() => allowParsed(parsed, options, nativeFetch));
          if (!allowed) {
            history.replaceState(history.state, "", originHref);
            return;
          }
          bypassNavigation = true;
          try {
            nativeAssignFn.call(window.location, url);
          } finally {
            bypassNavigation = false;
          }
        },
      });
    });
  }

  window.open = function (this: Window, url?: string | URL, target?: string, features?: string) {
    if (url == null || url === "") return nativeOpen(url, target, features);
    const parsed = gatedParse(String(url), "GET");
    if (parsed.type === "ignore" || parsed.type === "allow") {
      return nativeOpen(String(url), target, features);
    }
    void serialize(() => allowParsed(parsed, options, nativeFetch)).then((allowed) => {
      if (allowed) nativeOpen(String(url), target, features);
    });
    return null;
  };

  if (nativeBeacon) {
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const parsed = gatedParse(String(url), "POST", data);
      if (parsed.type === "ignore" || parsed.type === "allow") {
        return nativeBeacon(url, data);
      }
      return false;
    };
  }

  return {
    reconcile: () => serialize(() => stripUnauthorizedCartLines(nativeFetch, options.evaluate)),
  };
}
