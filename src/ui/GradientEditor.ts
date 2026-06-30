import type { WaveConfig, ColorStop } from "../wave/config";

/**
 * A CSS-gradient-style stop editor: a bar with one draggable dot per colour stop.
 * Drag a dot to change its position (so the spacing controls how fast colours
 * transition); drag one past another to reorder. Click a dot to select it and
 * recolour it; double-click the bar to add a stop, double-click a dot to remove.
 *
 * It mutates `config.palette` (ColorStop[]) in place and calls `hooks.onChange`
 * so the renderer re-uploads the gradient. Stop order in the array is irrelevant
 * — the renderer/shader sort by position.
 */

const STYLE_ID = "wave-gradient-editor-style";
const CSS = `
.rge { display: flex; flex-direction: column; gap: 6px; padding: 2px 10px 4px; }
.rge-bar { position: relative; height: 24px; border-radius: 3px; cursor: copy;
  border: 1px solid rgba(255,255,255,0.18); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35); touch-action: none; }
.rge-handle { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%;
  transform: translate(-50%, -50%); border: 2px solid #fff; cursor: ew-resize; box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0,0,0,0.6); touch-action: none; }
.rge-handle.sel { border-color: #6ea8fe; width: 16px; height: 16px; box-shadow: 0 0 0 2px rgba(110,168,254,0.55); }
.rge-row { display: flex; align-items: center; gap: 6px; }
.rge-row input[type=color] { width: 36px; height: 22px; padding: 0; border-radius: 3px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.18); background: none; }
.rge-pos { font-size: 11px; color: #9a9da3; min-width: 30px; text-align: right; font-variant-numeric: tabular-nums; }
.rge-row button { flex: 1; height: 22px; font-size: 11px; color: #d6d7db; cursor: pointer; border-radius: 3px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); }
.rge-row button:disabled { opacity: 0.4; cursor: default; }
`;

export interface GradientEditorHooks {
  /** Called whenever a stop's colour or position changes. */
  onChange: () => void;
  /** Maximum number of stops. */
  max: number;
}

export class GradientEditor {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly colorInput: HTMLInputElement;
  private readonly posLabel: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private handles: HTMLElement[] = [];
  private selected = 0;
  private dragging = false;

  constructor(
    parent: HTMLElement,
    private readonly config: WaveConfig,
    private readonly hooks: GradientEditorHooks,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = div("rge");
    this.bar = div("rge-bar");
    this.bar.addEventListener("dblclick", (e) => this.onBarDblClick(e));
    this.root.appendChild(this.bar);

    const row = div("rge-row");
    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.addEventListener("input", () => {
      const s = this.stops[this.selected];
      if (!s) return;
      s.color = this.colorInput.value;
      this.paint();
      this.hooks.onChange();
    });
    this.posLabel = div("rge-pos");
    this.addBtn = button("+ stop", () => this.addStop());
    this.removeBtn = button("− stop", () => this.removeStop());
    row.append(this.colorInput, this.posLabel, this.addBtn, this.removeBtn);
    this.root.appendChild(row);

    parent.appendChild(this.root);
    this.rebuildHandles();
    this.paint();
  }

  destroy(): void {
    this.root.remove();
  }

  /** Re-read config.palette and repaint (after an external change, e.g. randomize). */
  refresh(): void {
    this.selected = Math.max(0, Math.min(this.selected, this.stops.length - 1));
    this.rebuildHandles();
    this.paint();
  }

  /** Grey out + block interaction when the stops don't drive the current palette source. */
  setEnabled(on: boolean): void {
    this.root.style.opacity = on ? "1" : "0.4";
    this.root.style.pointerEvents = on ? "" : "none";
  }

  private get stops(): ColorStop[] {
    return this.config.palette;
  }

  /** (Re)create the handle elements — only on init / add / remove. */
  private rebuildHandles(): void {
    for (const h of this.handles) h.remove();
    this.handles = this.stops.map((_, i) => {
      const h = div("rge-handle");
      h.addEventListener("pointerdown", (e) => this.onHandleDown(e, i));
      h.addEventListener("pointermove", (e) => this.onHandleMove(e, i));
      h.addEventListener("pointerup", (e) => this.onHandleUp(e));
      h.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.selected = i;
        this.removeStop();
      });
      this.bar.appendChild(h);
      return h;
    });
    if (this.selected > this.stops.length - 1) this.selected = this.stops.length - 1;
  }

  /** Repaint bar + handle positions/colours (cheap; safe to call during a drag). */
  private paint(): void {
    const sorted = [...this.stops].sort((a, b) => a.pos - b.pos);
    this.bar.style.background = `linear-gradient(to right, ${sorted
      .map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
      .join(", ")})`;
    this.stops.forEach((s, i) => {
      const h = this.handles[i];
      if (!h) return;
      h.style.left = `${s.pos * 100}%`;
      h.style.background = s.color;
      h.classList.toggle("sel", i === this.selected);
    });
    const sel = this.stops[this.selected];
    if (sel) {
      this.colorInput.value = toHex6(sel.color);
      this.posLabel.textContent = `${Math.round(sel.pos * 100)}%`;
    }
    this.addBtn.disabled = this.stops.length >= this.hooks.max;
    this.removeBtn.disabled = this.stops.length <= 2;
  }

  private posFromEvent(e: PointerEvent | MouseEvent): number {
    const r = this.bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(r.width, 1)));
  }

  private onHandleDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.selected = i;
    this.dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.paint();
  }

  private onHandleMove(e: PointerEvent, i: number): void {
    if (!this.dragging) return;
    const s = this.stops[i];
    if (!s) return;
    s.pos = Math.round(this.posFromEvent(e) * 1000) / 1000;
    this.paint();
    this.hooks.onChange();
  }

  private onHandleUp(e: PointerEvent): void {
    this.dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  }

  private onBarDblClick(e: MouseEvent): void {
    this.insertStop(this.posFromEvent(e));
  }

  private addStop(): void {
    // Insert at the midpoint of the widest gap, so it lands somewhere useful.
    const sorted = [...this.stops].sort((a, b) => a.pos - b.pos);
    let bestGap = -1;
    let bestPos = 0.5;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].pos - sorted[i].pos;
      if (gap > bestGap) {
        bestGap = gap;
        bestPos = (sorted[i].pos + sorted[i + 1].pos) / 2;
      }
    }
    this.insertStop(bestPos);
  }

  private insertStop(pos: number): void {
    if (this.stops.length >= this.hooks.max) return;
    this.stops.push({ color: this.sampleAt(pos), pos: Math.round(pos * 1000) / 1000 });
    this.selected = this.stops.length - 1;
    this.rebuildHandles();
    this.paint();
    this.hooks.onChange();
  }

  private removeStop(): void {
    if (this.stops.length <= 2) return;
    this.stops.splice(this.selected, 1);
    this.selected = Math.max(0, Math.min(this.selected, this.stops.length - 1));
    this.rebuildHandles();
    this.paint();
    this.hooks.onChange();
  }

  /** Interpolated colour of the current gradient at a position (for new stops). */
  private sampleAt(pos: number): string {
    const sorted = [...this.stops].sort((a, b) => a.pos - b.pos);
    if (sorted.length === 0) return "#ffffff";
    if (pos <= sorted[0].pos) return toHex6(sorted[0].color);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (pos >= a.pos && pos <= b.pos) {
        const t = (pos - a.pos) / Math.max(b.pos - a.pos, 1e-5);
        return hexLerp(toHex6(a.color), toHex6(b.color), t);
      }
    }
    return toHex6(sorted[sorted.length - 1].color);
  }
}

// ---- small DOM/colour helpers ----

function div(cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function toHex6(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${h.slice(0, 6).padEnd(6, "0")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = toHex6(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexLerp(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = (i: number): string =>
    Math.max(0, Math.min(255, Math.round(A[i] + (B[i] - A[i]) * t)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}
