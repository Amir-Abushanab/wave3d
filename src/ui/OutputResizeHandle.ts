import { CUSTOM_EXPORT_PRESET } from "../output/formats";
import type { ExportSize } from "../output/formats";

const MIN_OUTPUT_DIMENSION = 64;
const MAX_OUTPUT_DIMENSION = 8192;
const MIN_PREVIEW_DIMENSION = 120;

interface ResizeHooks {
  onDragStart(): void;
  /** Cheap DOM-only update used while dragging. */
  onPreviewChange(): void;
  /** Expensive renderer resize, performed once when the gesture ends. */
  onCommit(refitPreview: boolean): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startPreviewWidth: number;
  startPreviewHeight: number;
  startOutputWidth: number;
  startOutputHeight: number;
  maxPreviewWidth: number;
  maxPreviewHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Makes the export frame's bottom-right corner draggable. The preview follows the pointer
 * immediately, while the large WebGL backing buffer is resized only on release.
 */
export class OutputResizeHandle {
  private drag?: DragState;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly handle: HTMLButtonElement,
    private readonly outputSize: ExportSize,
    private readonly hooks: ResizeHooks,
  ) {
    handle.addEventListener("pointerdown", this.onPointerDown);
    handle.addEventListener("pointermove", this.onPointerMove);
    handle.addEventListener("pointerup", this.onPointerEnd);
    handle.addEventListener("pointercancel", this.onPointerEnd);
    handle.addEventListener("keydown", this.onKeyDown);
  }

  fitPreview(): void {
    this.stage.style.removeProperty("inline-size");
    this.stage.style.removeProperty("block-size");
  }

  private previewBounds(): { width: number; height: number } {
    const style = getComputedStyle(this.workspace);
    return {
      width:
        this.workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height:
        this.workspace.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
    };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.stage.getBoundingClientRect();
    const bounds = this.previewBounds();
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPreviewWidth: rect.width,
      startPreviewHeight: rect.height,
      startOutputWidth: this.outputSize.width,
      startOutputHeight: this.outputSize.height,
      maxPreviewWidth: bounds.width,
      maxPreviewHeight: bounds.height,
    };
    this.stage.style.inlineSize = `${rect.width}px`;
    this.stage.style.blockSize = `${rect.height}px`;
    this.stage.classList.add("is-resizing");
    this.hooks.onDragStart();
    this.handle.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();

    // The frame stays centred, so doubling the pointer delta keeps its bottom-right
    // corner under the pointer while the opposite edge moves symmetrically.
    const previewWidth = clamp(
      drag.startPreviewWidth + (event.clientX - drag.startX) * 2,
      Math.min(MIN_PREVIEW_DIMENSION, drag.maxPreviewWidth),
      drag.maxPreviewWidth,
    );
    const previewHeight = clamp(
      drag.startPreviewHeight + (event.clientY - drag.startY) * 2,
      Math.min(MIN_PREVIEW_DIMENSION, drag.maxPreviewHeight),
      drag.maxPreviewHeight,
    );
    const outputWidth = clamp(
      Math.round(drag.startOutputWidth * (previewWidth / drag.startPreviewWidth)),
      MIN_OUTPUT_DIMENSION,
      MAX_OUTPUT_DIMENSION,
    );
    const outputHeight = clamp(
      Math.round(drag.startOutputHeight * (previewHeight / drag.startPreviewHeight)),
      MIN_OUTPUT_DIMENSION,
      MAX_OUTPUT_DIMENSION,
    );

    this.stage.style.inlineSize = `${drag.startPreviewWidth * (outputWidth / drag.startOutputWidth)}px`;
    this.stage.style.blockSize = `${drag.startPreviewHeight * (outputHeight / drag.startOutputHeight)}px`;
    this.outputSize.preset = CUSTOM_EXPORT_PRESET;
    this.outputSize.width = outputWidth;
    this.outputSize.height = outputHeight;
    this.hooks.onPreviewChange();
  };

  private onPointerEnd = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = undefined;
    this.stage.classList.remove("is-resizing");
    if (this.handle.hasPointerCapture(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.hooks.onCommit(false);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 64 : 16;
    let width = this.outputSize.width;
    let height = this.outputSize.height;
    if (event.key === "ArrowLeft") width -= step;
    else if (event.key === "ArrowRight") width += step;
    else if (event.key === "ArrowUp") height -= step;
    else if (event.key === "ArrowDown") height += step;
    else return;

    event.preventDefault();
    event.stopPropagation();
    this.outputSize.preset = CUSTOM_EXPORT_PRESET;
    this.outputSize.width = clamp(width, MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
    this.outputSize.height = clamp(height, MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
    this.hooks.onCommit(true);
  };
}
