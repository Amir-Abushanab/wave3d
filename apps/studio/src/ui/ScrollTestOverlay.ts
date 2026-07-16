import type { StudioWaveRenderer } from "@wave3d/core/studio";

// A scroll-driven test surface laid over the wave preview (#stage), so you can author a `scroll` /
// `scrollVelocity` reaction and then actually SCROLL to feel it — a more natural companion to the
// exact-position slider in the Interaction panel. The overlay is transparent (the live wave shows
// through) and only covers the stage, so the control panel stays fully usable while you test.
//
// It drives renderer.setScrollTestProgress(0..1), which (while the loop runs) lets the renderer
// derive real scroll velocity from the delta — so velocity reactions react here, unlike the slider.

const STYLE_ID = "wv-scrolltest-style";
const RUNWAY = 4; // scroll runway height as a multiple of the stage (→ 3× stage of travel)

const CSS = `
.wv-scrolltest {
  position: absolute; inset: 0; z-index: 40;
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.35) transparent;
  opacity: 0; transition: opacity .18s ease;
}
.wv-scrolltest.is-open { opacity: 1; }
.wv-scrolltest__bar {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 12px;
  padding: 9px 12px;
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #e7e9ee;
  background: rgba(16,17,24,0.72);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.wv-scrolltest__label { flex: 1 1 auto; min-width: 0; }
.wv-scrolltest__label b { color: #9ad0ff; font-weight: 600; }
.wv-scrolltest__pct {
  flex: none; font-variant-numeric: tabular-nums; font-weight: 600;
  min-width: 3.1em; text-align: right; color: #9ad0ff;
}
.wv-scrolltest__close {
  flex: none; cursor: pointer; border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06); color: #e7e9ee;
  border-radius: 6px; padding: 4px 9px; font: inherit;
}
.wv-scrolltest__close:hover { background: rgba(255,255,255,0.14); }
.wv-scrolltest__track {
  position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  background: rgba(255,255,255,0.08);
}
.wv-scrolltest__fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #6ea8fe, #9b7bff);
}
.wv-scrolltest__runway { position: relative; }
.wv-scrolltest__mark {
  position: absolute; left: 50%; transform: translate(-50%, -50%);
  padding: 3px 10px; border-radius: 999px;
  background: rgba(16,17,24,0.5); color: rgba(231,233,238,0.72);
  font: 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
  border: 1px solid rgba(255,255,255,0.1);
  pointer-events: none; white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .wv-scrolltest { transition: none; }
}
`;

/** Overlay that turns the wave preview into a scrollable surface driving the scroll interaction. */
export class ScrollTestOverlay {
  private root?: HTMLDivElement;
  private fill?: HTMLElement;
  private pct?: HTMLElement;
  private rafPending = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly renderer: StudioWaveRenderer,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }

  isOpen(): boolean {
    return !!this.root;
  }

  toggle(): void {
    if (this.root) this.close();
    else this.open();
  }

  open(): void {
    if (this.root) return;
    const marks = [0, 25, 50, 75, 100]
      .map((p) => {
        const label = p === 0 ? "top · 0%" : p === 100 ? "bottom · 100%" : `${p}%`;
        return `<div class="wv-scrolltest__mark" style="top:${p}%">${label}</div>`;
      })
      .join("");
    const root = document.createElement("div");
    root.className = "wv-scrolltest";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Scroll test");
    root.innerHTML =
      `<div class="wv-scrolltest__bar">` +
      `<span class="wv-scrolltest__label">Scroll here to drive your <b>scroll</b> / <b>scroll&nbsp;velocity</b> reactions</span>` +
      `<span class="wv-scrolltest__pct">0%</span>` +
      `<button type="button" class="wv-scrolltest__close" aria-label="Close scroll test">Close ✕</button>` +
      `<div class="wv-scrolltest__track"><div class="wv-scrolltest__fill"></div></div>` +
      `</div>` +
      `<div class="wv-scrolltest__runway" style="height:${RUNWAY * 100}%">${marks}</div>`;
    this.stage.appendChild(root);
    this.root = root;
    this.fill = root.querySelector<HTMLElement>(".wv-scrolltest__fill") ?? undefined;
    this.pct = root.querySelector<HTMLElement>(".wv-scrolltest__pct") ?? undefined;
    root
      .querySelector<HTMLButtonElement>(".wv-scrolltest__close")
      ?.addEventListener("click", () => this.close());
    root.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("keydown", this.onKey);
    root.scrollTop = 0;
    this.apply(0);
    requestAnimationFrame(() => root.classList.add("is-open"));
  }

  close(): void {
    const root = this.root;
    if (!root) return;
    root.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("keydown", this.onKey);
    root.remove();
    this.root = this.fill = this.pct = undefined;
    this.renderer.setScrollPreview(0); // return the wave to rest when the test closes
  }

  dispose(): void {
    this.close();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private onScroll = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const el = this.root;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      this.apply(max > 0 ? el.scrollTop / max : 0);
    });
  };

  private apply(p: number): void {
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    this.renderer.setScrollTestProgress(p);
    if (this.fill) this.fill.style.width = `${(p * 100).toFixed(1)}%`;
    if (this.pct) this.pct.textContent = `${Math.round(p * 100)}%`;
  }
}
