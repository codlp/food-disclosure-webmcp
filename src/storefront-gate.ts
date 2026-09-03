import type { GateDecision } from "./cart-gate";

function pathnameOf(url: string): string {
  try {
    return new URL(url, "https://shop.example/").pathname;
  } catch {
    return url;
  }
}

export function isCartAddPath(url: string): boolean {
  return /\/cart\/add(?:\.js|\.json)?$/i.test(pathnameOf(url));
}

export function variantIdFromSearchParams(params: URLSearchParams): string | undefined {
  const id = params.get("id");
  return id?.trim() || undefined;
}

export function variantIdFromCartAddBody(body: unknown): string | undefined {
  if (body == null || body === "") return undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const id = body.get("id");
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return variantIdFromSearchParams(body);
  }
  if (typeof body === "string") {
    try {
      return variantIdFromCartAddBody(JSON.parse(body) as unknown);
    } catch {
      return variantIdFromSearchParams(new URLSearchParams(body));
    }
  }
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    try {
      return variantIdFromCartAddBody(new TextDecoder().decode(body));
    } catch {
      return undefined;
    }
  }
  if (typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.id === "string" || typeof rec.id === "number") return String(rec.id);
    const items = rec.items;
    if (Array.isArray(items) && items[0] && typeof items[0] === "object") {
      const first = items[0] as { id?: unknown };
      if (typeof first.id === "string" || typeof first.id === "number") return String(first.id);
    }
  }
  return undefined;
}

export function requestHref(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isProductAddForm(form: HTMLFormElement): boolean {
  const action = form.getAttribute("action") || form.action || "";
  if (isCartAddPath(action)) return true;
  return Boolean(form.querySelector('[name="add"]'));
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

async function decide(raw: string | undefined, options: GuardOptions): Promise<boolean> {
  if (!raw) {
    const decision: Extract<GateDecision, { ok: false }> = {
      ok: false,
      reason: "UNKNOWN_PRODUCT_VARIANT",
      field: ["id"],
      message:
        "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.",
    };
    options.onBlocked(decision);
    return false;
  }
  const decision = await options.evaluate(raw);
  if (!decision.ok) {
    options.onBlocked(decision);
    return false;
  }
  return true;
}

export function installStorefrontCartGuard(options: GuardOptions): void {
  const allowedForms = new WeakSet<HTMLFormElement>();
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const nativeFetch = window.fetch.bind(window);
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrUrl = new WeakMap<XMLHttpRequest, string>();

  async function submitIfAllowed(form: HTMLFormElement): Promise<void> {
    if (!isProductAddForm(form)) {
      nativeSubmit.call(form);
      return;
    }
    const allowed = await decide(variantIdFromForm(form), options);
    if (!allowed) return;
    allowedForms.add(form);
    try {
      nativeSubmit.call(form);
    } finally {
      allowedForms.delete(form);
    }
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
        void decide(raw, options).then((allowed) => {
          if (allowed && increase.href) window.location.assign(increase.href);
        });
        return;
      }
      const addLink = target.closest<HTMLAnchorElement>("a[href]");
      if (addLink?.href && isCartAddPath(addLink.href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const raw =
          variantIdFromSearchParams(new URL(addLink.href, window.location.href).searchParams) ??
          addLink.getAttribute("data-variant-id") ??
          undefined;
        void decide(raw, options).then((allowed) => {
          if (allowed) window.location.assign(addLink.href);
        });
      }
    },
    true,
  );

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = requestHref(input);
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (!isCartAddPath(href) && !(input instanceof Request && isCartAddPath(input.url))) {
      return nativeFetch(input as RequestInfo, init);
    }
    let raw: string | undefined;
    if (input instanceof Request) {
      raw = variantIdFromSearchParams(new URL(input.url, window.location.href).searchParams);
      if (!raw && method !== "GET") {
        try {
          raw = variantIdFromCartAddBody(await input.clone().text());
        } catch {
          raw = undefined;
        }
      }
    } else {
      raw = variantIdFromSearchParams(new URL(href, window.location.href).searchParams);
    }
    if (!raw && init?.body) raw = variantIdFromCartAddBody(init.body);
    const allowed = await decide(raw, options);
    if (!allowed) {
      return new Response(
        JSON.stringify({
          status: 422,
          message: "DISCLOSURE_RETRIEVAL_REQUIRED",
          description:
            "Retrieve this product's current ingredient and label statements with get_product_food_disclosures, then retry the cart update.",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
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
    xhrUrl.set(this, String(url));
    return xhrOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const href = xhrUrl.get(this) ?? "";
    if (!isCartAddPath(href)) {
      xhrSend.call(this, body);
      return;
    }
    const raw =
      variantIdFromSearchParams(new URL(href, window.location.href).searchParams) ??
      variantIdFromCartAddBody(body);
    void decide(raw, options).then((allowed) => {
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
}
