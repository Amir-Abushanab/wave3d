import { renderMeshGradient } from "../wave/palette";
import type { MeshGradientPoint } from "../wave/config";
import { toHex6 } from "../util/color";
import { button, div, injectStyleOnce } from "../util/dom";
import { clamp, clamp01, roundTo } from "../util/math";

const STYLE_ID = "wave-mesh-gradient-editor-style";
const CSS = `
.mge { display:flex; flex-direction:column; gap:6px; padding:2px 10px 5px; }
.mge-stage { position:relative; height:112px; overflow:hidden; border-radius:5px;
  border:1px solid rgba(255,255,255,.18); box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);
  touch-action:none; cursor:crosshair; }
.mge-canvas { display:block; width:100%; height:100%; }
.mge-handle { position:absolute; width:17px; height:17px; padding:0; border-radius:50%;
  transform:translate(-50%,-50%); border:2px solid #fff; cursor:move; box-sizing:border-box;
  box-shadow:0 1px 4px rgba(0,0,0,.7); touch-action:none; }
.mge-handle.sel { width:21px; height:21px; border-color:#fff;
  box-shadow:0 0 0 3px #6ea8fe,0 2px 6px rgba(0,0,0,.75); }
.mge-handle:focus-visible { outline:2px solid #fff; outline-offset:4px; }
.mge-row { display:flex; align-items:center; gap:6px; }
.mge-row input[type=color] { width:36px; height:23px; padding:0; border-radius:3px; cursor:pointer;
  border:1px solid rgba(255,255,255,.18); background:none; }
.mge-row input[type=range] { min-width:0; flex:1; }
.mge-pos { min-width:66px; color:#9a9da3; font-size:10px; text-align:center;
  font-variant-numeric:tabular-nums; }
.mge-row button { height:23px; padding:0 7px; font-size:11px; color:#d6d7db; cursor:pointer;
  border-radius:3px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); }
.mge-row button:disabled { opacity:.4; cursor:default; }
.mge-help { color:#858991; font-size:10px; line-height:1.3; }
`;

const ADD_COLORS = ["#30d158", "#ff2d55", "#0a84ff", "#ffd60a", "#ac8e68", "#ff453a"];

export interface MeshGradientEditorHooks {
  onChange: () => void;
  max: number;
}

export class MeshGradientEditor {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly colorInput: HTMLInputElement;
  private readonly influenceInput: HTMLInputElement;
  private readonly posLabel: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private handles: HTMLButtonElement[] = [];
  private selected = 0;
  private dragging = false;
  private rafId = 0;
  private fieldCanvas?: HTMLCanvasElement;

  constructor(
    parent: HTMLElement,
    private readonly getPoints: () => MeshGradientPoint[],
    private readonly getSoftness: () => number,
    private readonly hooks: MeshGradientEditorHooks,
  ) {
    injectStyleOnce(STYLE_ID, CSS);

    this.root = div("mge");
    this.stage = div("mge-stage");
    this.stage.setAttribute("aria-label", "Mesh gradient point editor");
    this.stage.addEventListener("dblclick", (event) => this.onStageDoubleClick(event));
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mge-canvas";
    this.canvas.width = 300;
    this.canvas.height = 112;
    this.canvas.setAttribute("aria-hidden", "true");
    this.stage.appendChild(this.canvas);
    this.root.appendChild(this.stage);

    const row = div("mge-row");
    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.setAttribute("aria-label", "Selected mesh point color");
    this.colorInput.addEventListener("input", () => {
      const point = this.points[this.selected];
      if (!point) return;
      point.color = this.colorInput.value;
      this.schedulePaint();
    });
    this.influenceInput = document.createElement("input");
    this.influenceInput.type = "range";
    this.influenceInput.min = "0.15";
    this.influenceInput.max = "1.5";
    this.influenceInput.step = "0.01";
    this.influenceInput.setAttribute("aria-label", "Selected mesh point influence");
    this.influenceInput.addEventListener("input", () => {
      const point = this.points[this.selected];
      if (!point) return;
      point.influence = Number(this.influenceInput.value);
      this.schedulePaint();
    });
    this.posLabel = div("mge-pos");
    this.addBtn = button("+", () => this.addPoint(), "Add mesh point");
    this.removeBtn = button("−", () => this.removePoint(), "Remove selected mesh point");
    row.append(this.colorInput, this.influenceInput, this.posLabel, this.addBtn, this.removeBtn);
    this.root.appendChild(row);

    const help = div("mge-help");
    help.textContent = "Drag points · double-click to add · arrows nudge · Delete removes";
    this.root.appendChild(help);

    parent.appendChild(this.root);
    this.rebuildHandles();
    this.paint();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.root.remove();
  }

  get element(): HTMLElement {
    return this.root;
  }

  refresh(): void {
    this.selected = clamp(this.selected, 0, this.points.length - 1);
    this.rebuildHandles();
    this.paint();
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? "" : "none";
  }

  private get points(): MeshGradientPoint[] {
    return this.getPoints();
  }

  private rebuildHandles(): void {
    for (const handle of this.handles) handle.remove();
    this.handles = this.points.map((_, index) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "mge-handle";
      handle.addEventListener("pointerdown", (event) => this.onHandleDown(event, index));
      handle.addEventListener("pointermove", (event) => this.onHandleMove(event, index));
      handle.addEventListener("pointerup", (event) => this.onHandleUp(event));
      handle.addEventListener("click", () => {
        this.selected = index;
        this.paint();
      });
      handle.addEventListener("keydown", (event) => this.onHandleKeyDown(event, index));
      this.stage.appendChild(handle);
      return handle;
    });
  }

  private paint(): void {
    this.paintField();
    this.points.forEach((point, index) => {
      const handle = this.handles[index];
      if (!handle) return;
      handle.style.left = `${point.x * 100}%`;
      handle.style.top = `${(1 - point.y) * 100}%`;
      handle.style.background = point.color;
      handle.classList.toggle("sel", index === this.selected);
      handle.setAttribute("aria-label", `Mesh point ${index + 1}`);
      handle.title = `Point ${index + 1}: drag or use arrow keys`;
    });
    const selectedPoint = this.points[this.selected];
    if (selectedPoint) {
      this.colorInput.value = toHex6(selectedPoint.color);
      this.influenceInput.value = String(selectedPoint.influence);
      this.posLabel.textContent = `${Math.round(selectedPoint.x * 100)}, ${Math.round(selectedPoint.y * 100)}%`;
    }
    this.addBtn.disabled = this.points.length >= this.hooks.max;
    this.removeBtn.disabled = this.points.length <= 2;
  }

  private paintField(): void {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    // Shared with the background renderer so the preview and the actual background can't drift.
    // The field renders at half resolution and upscales: renderMeshGradient is O(w·h·points) on
    // the CPU and runs during handle drags, and the mesh field is smooth enough that the
    // upscale is imperceptible at preview size.
    const { width, height } = this.canvas;
    const fw = Math.max(1, width >> 1);
    const fh = Math.max(1, height >> 1);
    this.fieldCanvas ??= document.createElement("canvas");
    if (this.fieldCanvas.width !== fw || this.fieldCanvas.height !== fh) {
      this.fieldCanvas.width = fw;
      this.fieldCanvas.height = fh;
    }
    this.fieldCanvas
      .getContext("2d")
      ?.putImageData(renderMeshGradient(this.points, this.getSoftness(), fw, fh), 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.fieldCanvas, 0, 0, width, height);
  }

  private pointFromEvent(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(rect.width, 1)),
      y: clamp01(1 - (event.clientY - rect.top) / Math.max(rect.height, 1)),
    };
  }

  private onHandleDown(event: PointerEvent, index: number): void {
    event.stopPropagation();
    this.selected = index;
    this.dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.paint();
  }

  private onHandleMove(event: PointerEvent, index: number): void {
    if (!this.dragging) return;
    const point = this.points[index];
    if (!point) return;
    Object.assign(point, roundPoint(this.pointFromEvent(event)));
    this.schedulePaint();
  }

  /** Coalesce continuous-input updates (drags, colour/influence scrubs) to one CPU field
   *  repaint + renderer refresh per frame — pointermove can fire far above 60 Hz. */
  private schedulePaint(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.paint();
      this.hooks.onChange();
    });
  }

  private onHandleUp(event: PointerEvent): void {
    this.dragging = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  }

  private onHandleKeyDown(event: KeyboardEvent, index: number): void {
    const point = this.points[index];
    if (!point) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.selected = index;
      this.removePoint();
      return;
    }
    const delta =
      event.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight"
          ? { x: step, y: 0 }
          : event.key === "ArrowDown"
            ? { x: 0, y: -step }
            : event.key === "ArrowUp"
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    event.preventDefault();
    point.x = clamp01(point.x + delta.x);
    point.y = clamp01(point.y + delta.y);
    this.selected = index;
    this.paint();
    this.hooks.onChange();
  }

  private onStageDoubleClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains("mge-handle")) return;
    this.insertPoint(this.pointFromEvent(event));
  }

  private addPoint(): void {
    const angle = this.points.length * 2.4;
    this.insertPoint({
      x: clamp01(0.5 + Math.cos(angle) * 0.22),
      y: clamp01(0.5 + Math.sin(angle) * 0.22),
    });
  }

  private insertPoint(position: { x: number; y: number }): void {
    if (this.points.length >= this.hooks.max) return;
    this.points.push({
      ...roundPoint(position),
      color: ADD_COLORS[this.points.length % ADD_COLORS.length],
      influence: 0.62,
    });
    this.selected = this.points.length - 1;
    this.rebuildHandles();
    this.paint();
    this.handles[this.selected]?.focus();
    this.hooks.onChange();
  }

  private removePoint(): void {
    if (this.points.length <= 2) return;
    this.points.splice(this.selected, 1);
    this.selected = clamp(this.selected, 0, this.points.length - 1);
    this.rebuildHandles();
    this.paint();
    this.handles[this.selected]?.focus();
    this.hooks.onChange();
  }
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: roundTo(clamp01(point.x), 3), y: roundTo(clamp01(point.y), 3) };
}
