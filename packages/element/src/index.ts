import { createWave } from "@wave3d/core";
import type {
  StudioConfig,
  WaveHandle,
  WaveOptions,
  WaveRenderer,
  FallbackReason,
} from "@wave3d/core";

const OBSERVED = ["config", "src", "preset", "poster", "paused", "lazy", "webgl"] as const;

// SSR-safe base: `class extends HTMLElement` evaluates HTMLElement at import time, which throws
// under Node. Fall back to a dummy base there — the element is never instantiated server-side
// (register() is guarded), so the missing DOM methods are never called.
const ElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (function Wave3DElementBase() {} as unknown as typeof HTMLElement);

/**
 * `<wave-3d>` — the framework-agnostic drop-in (Vue/Svelte/plain HTML). Light DOM, `display:block`.
 * Attributes: `config` (JSON), `src` (URL to a config JSON), `preset` (name), `poster`, `paused`,
 * `lazy`, `webgl`. Also a `config` property and a read-only `handle` getter. Emits `wave3d-ready`
 * (detail = renderer) and `wave3d-fallback` (detail = reason) events.
 */
export class Wave3DElement extends ElementBase {
  static get observedAttributes(): string[] {
    return [...OBSERVED];
  }

  #handle: WaveHandle | null = null;
  #config: Partial<StudioConfig> = {};
  #debounce?: ReturnType<typeof setTimeout>;

  /** The live shell handle (null before connect / after disconnect). */
  get handle(): WaveHandle | null {
    return this.#handle;
  }

  /** Programmatic config, merged last (over the `preset`/`src`/`config` attributes). */
  get config(): Partial<StudioConfig> {
    return this.#config;
  }
  set config(value: Partial<StudioConfig>) {
    this.#config = value ?? {};
    this.#scheduleUpdate();
  }

  connectedCallback(): void {
    if (!this.style.display) this.style.display = "block";
    void this.#mount();
  }

  disconnectedCallback(): void {
    clearTimeout(this.#debounce);
    this.#handle?.destroy();
    this.#handle = null;
  }

  attributeChangedCallback(name: string): void {
    if (!this.#handle) return;
    if (name === "paused") {
      if (this.#boolAttr("paused")) this.#handle.pause();
      else this.#handle.play();
    } else {
      this.#scheduleUpdate();
    }
  }

  async #mount(): Promise<void> {
    const config = await this.#buildConfig();
    if (!this.isConnected) return; // disconnected while the config resolved
    const options: WaveOptions = {
      poster: this.getAttribute("poster") ?? undefined,
      lazy: this.#boolAttr("lazy"),
      webgl: (this.getAttribute("webgl") as WaveOptions["webgl"]) ?? undefined,
      paused: this.#boolAttr("paused"),
      onReady: (renderer: WaveRenderer) =>
        this.dispatchEvent(new CustomEvent("wave3d-ready", { detail: renderer })),
      onFallback: (reason: FallbackReason) =>
        this.dispatchEvent(new CustomEvent("wave3d-fallback", { detail: reason })),
    };
    this.#handle = createWave(this, config, options);
  }

  /** default ← preset ← src JSON ← config attribute ← config property. */
  async #buildConfig(): Promise<Partial<StudioConfig>> {
    let base: Partial<StudioConfig> = {};
    const presetName = this.getAttribute("preset");
    if (presetName) {
      const { PRESETS } = await import("@wave3d/core/presets");
      base = PRESETS[presetName]?.() ?? {};
    }
    const src = this.getAttribute("src");
    if (src) {
      try {
        base = { ...base, ...(await fetch(src).then((r) => r.json())) };
      } catch {
        // ignore a failed/invalid config fetch — fall through to whatever we have
      }
    }
    base = { ...base, ...parseJson(this.getAttribute("config")), ...this.#config };
    return base;
  }

  #scheduleUpdate(): void {
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      void this.#update();
    }, 50);
  }

  async #update(): Promise<void> {
    const handle = this.#handle;
    if (!handle) return;
    handle.set(await this.#buildConfig());
  }

  /** Presence = true; `"false"`/`"0"` = false; absent = undefined (shell default). */
  #boolAttr(name: string): boolean | undefined {
    if (!this.hasAttribute(name)) return undefined;
    const value = this.getAttribute(name);
    return value !== "false" && value !== "0";
  }
}

function parseJson(json: string | null): Partial<StudioConfig> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Partial<StudioConfig>;
  } catch {
    return {};
  }
}

/** Define the element (idempotent, SSR/Node-import-safe). */
export function register(tag = "wave-3d"): void {
  if (typeof window === "undefined" || typeof customElements === "undefined") return;
  if (!customElements.get(tag)) customElements.define(tag, Wave3DElement);
}

// Self-register on import so a bare `import "@wave3d/element"` makes <wave-3d> work. Guarded so
// importing under Node (SSR) is a no-op rather than a ReferenceError.
register();

export type {
  StudioConfig,
  WaveHandle,
  WaveRenderer,
  FallbackReason,
  SnapshotOptions,
} from "@wave3d/core";
