/**
 * Floating, draggable undo/redo cluster + version-history panel. Docks bottom-left of the stage by
 * default (outside the export frame, clear of the left control panel), and can be dragged anywhere
 * by its grip. Purely a view: it renders a `HistoryState` and reports intents (undo / redo /
 * jump-to-version) through hooks — the timeline logic lives in `History` (src/history.ts).
 *
 * Follows the RecordingOverlay pattern: builds its own DOM, injects its own <style>, cleans up via
 * dispose() (called from main.ts's HMR teardown).
 */
import type { HistoryState } from "../history";

/** Minimal per-version thumbnail source (satisfied structurally by HistoryThumbnailer). */
export interface HistoryThumbSource {
  cached(id: number): string | undefined;
  request(id: number, cb: (url: string | null) => void): void;
}

export interface HistoryControlsHooks {
  onUndo: () => void;
  onRedo: () => void;
  onJump: (id: number) => void;
  /** Optional per-version preview thumbnails; when present, each row shows one. */
  thumb?: HistoryThumbSource;
}

const isMac = /Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent);
const UNDO_TIP = isMac ? "Undo · ⌘Z" : "Undo · Ctrl+Z";
const REDO_TIP = isMac ? "Redo · ⇧⌘Z" : "Redo · Ctrl+Y";

// Inline line icons (Lucide-style, currentColor) so nothing depends on an icon font or network.
const ICON = {
  undo: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
};

function relTime(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  left: number;
  top: number;
}

export class HistoryControls {
  private readonly el: HTMLDivElement;
  private readonly grip: HTMLDivElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private open = false;
  private lastState: HistoryState = { canUndo: false, canRedo: false, entries: [] };
  private tick = 0;
  private drag?: DragState;
  private scrollRaf = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: HistoryControlsHooks,
  ) {
    HistoryControls.injectStyle();
    this.el = document.createElement("div");
    this.el.className = "wv-hist";

    // Version list — absolutely positioned above (or below) the bar, so dragging just moves the bar.
    this.panel = document.createElement("div");
    this.panel.className = "wv-hist-panel";
    this.panel.hidden = true;
    const head = document.createElement("div");
    head.className = "wv-hist-head";
    head.textContent = "History";
    this.list = document.createElement("ul");
    this.list.className = "wv-hist-list";
    this.panel.append(head, this.list);

    // Button bar (the always-visible, draggable cluster).
    const bar = document.createElement("div");
    bar.className = "wv-hist-bar";
    this.grip = document.createElement("div");
    this.grip.className = "wv-hist-grip";
    this.grip.innerHTML = ICON.grip;
    this.grip.setAttribute("data-tip", "Drag to move");
    this.grip.setAttribute("aria-hidden", "true");
    this.undoBtn = HistoryControls.mkBtn("undo", ICON.undo, "Undo", UNDO_TIP);
    this.redoBtn = HistoryControls.mkBtn("redo", ICON.redo, "Redo", REDO_TIP);
    this.toggleBtn = HistoryControls.mkBtn(
      "toggle",
      ICON.list,
      "Version history",
      "Version history",
    );
    bar.append(this.grip, this.undoBtn, this.redoBtn, this.toggleBtn);

    this.el.append(this.panel, bar);
    this.el.addEventListener("click", this.onClick);
    this.grip.addEventListener("pointerdown", this.onDragStart);
    // Thumbnails load lazily for rows in view; re-check as the list scrolls.
    if (this.hooks.thumb) this.list.addEventListener("scroll", this.onScroll);
    this.host.appendChild(this.el);
    this.render();
  }

  /** Re-render from the latest timeline state. */
  update(state: HistoryState): void {
    this.lastState = state;
    this.render();
  }

  dispose(): void {
    this.stopTicking();
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.list.removeEventListener("scroll", this.onScroll);
    this.el.removeEventListener("click", this.onClick);
    this.grip.removeEventListener("pointerdown", this.onDragStart);
    this.el.remove();
  }

  private onClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.getAttribute("aria-disabled") === "true") return;
    const act = btn.dataset.act;
    if (act === "undo") this.hooks.onUndo();
    else if (act === "redo") this.hooks.onRedo();
    else if (act === "toggle") this.setOpen(!this.open);
    else if (btn.dataset.id) this.hooks.onJump(Number(btn.dataset.id));
  };

  // ---- Dragging (by the grip) ----
  private onDragStart = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      left: r.left,
      top: r.top,
    };
    this.grip.setPointerCapture(e.pointerId);
    this.grip.addEventListener("pointermove", this.onDragMove);
    this.grip.addEventListener("pointerup", this.onDragEnd);
    this.grip.addEventListener("pointercancel", this.onDragEnd);
    this.el.classList.add("wv-hist--dragging");
  };

  private onDragMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(
      6,
      Math.min(this.drag.left + (e.clientX - this.drag.startX), window.innerWidth - w - 6),
    );
    const top = Math.max(
      6,
      Math.min(this.drag.top + (e.clientY - this.drag.startY), window.innerHeight - h - 6),
    );
    // Switch from the CSS bottom/left anchor to explicit top/left while dragging.
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.right = "auto";
    this.el.style.bottom = "auto";
    this.updateFlip();
  };

  private onDragEnd = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.grip.releasePointerCapture(e.pointerId);
    this.grip.removeEventListener("pointermove", this.onDragMove);
    this.grip.removeEventListener("pointerup", this.onDragEnd);
    this.grip.removeEventListener("pointercancel", this.onDragEnd);
    this.drag = undefined;
    this.el.classList.remove("wv-hist--dragging");
  };

  private setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggleBtn.setAttribute("aria-expanded", String(open));
    this.toggleBtn.classList.toggle("is-active", open);
    if (open) {
      this.updateFlip();
      this.startTicking();
    } else {
      this.stopTicking();
    }
    this.render();
  }

  /** Open the list above the bar when the cluster sits low, below it when it sits high. */
  private updateFlip(): void {
    const r = this.el.getBoundingClientRect();
    this.el.classList.toggle("wv-hist--below", r.top < window.innerHeight * 0.5);
  }

  private render(): void {
    this.setDisabled(this.undoBtn, !this.lastState.canUndo);
    this.setDisabled(this.redoBtn, !this.lastState.canRedo);
    if (!this.open) return;
    // Newest (current) at the top, oldest at the bottom.
    const entries = this.lastState.entries;
    const rows: string[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const cur = e.current ? " is-current" : "";
      rows.push(
        `<li><button type="button" class="wv-hist-row${cur}" data-id="${e.id}"` +
          `${e.current ? ' aria-current="true"' : ""}>` +
          `<span class="wv-hist-thumb"></span>` +
          `<span class="wv-hist-label">${escapeHtml(e.label)}</span>` +
          `<span class="wv-hist-time">${relTime(e.time)}</span>` +
          `</button></li>`,
      );
    }
    this.list.innerHTML = rows.join("") || '<li class="wv-hist-empty">Edits will appear here</li>';
    this.fillThumbs();
  }

  private onScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.fillThumbs();
    });
  };

  /** Fill thumbnails for rows in (or near) the visible list area — cached instantly, else render
   *  on demand. Geometry-based rather than IntersectionObserver so it also works when the tab isn't
   *  focused, and stays lazy: offscreen rows aren't rendered until scrolled near. */
  private fillThumbs(): void {
    const thumb = this.hooks.thumb;
    if (!thumb || !this.open) return;
    const view = this.list.getBoundingClientRect();
    const margin = 80;
    for (const row of this.list.querySelectorAll<HTMLElement>(".wv-hist-row")) {
      const id = Number(row.dataset.id);
      const cached = thumb.cached(id);
      if (cached) {
        this.setThumb(row, cached);
        continue;
      }
      if (row.dataset.req === "1") continue; // already requested this row instance
      const r = row.getBoundingClientRect();
      if (r.bottom < view.top - margin || r.top > view.bottom + margin) continue; // offscreen
      row.dataset.req = "1";
      thumb.request(id, (url) => {
        if (!url) return;
        const el = this.list.querySelector<HTMLElement>(`.wv-hist-row[data-id="${id}"]`);
        if (el) this.setThumb(el, url);
      });
    }
  }

  private setThumb(row: HTMLElement, url: string): void {
    const el = row.querySelector<HTMLElement>(".wv-hist-thumb");
    if (el) el.style.backgroundImage = `url('${url}')`;
  }

  /** Update just the relative-time labels (called by the tick, so it never re-renders thumbnails). */
  private refreshTimes(): void {
    if (!this.open) return;
    for (const row of this.list.querySelectorAll<HTMLElement>(".wv-hist-row")) {
      const e = this.lastState.entries.find((x) => x.id === Number(row.dataset.id));
      const t = row.querySelector(".wv-hist-time");
      if (e && t) t.textContent = relTime(e.time);
    }
  }

  // aria-disabled (not the `disabled` attribute) so the shortcut tooltip still shows on hover even
  // when the action is unavailable.
  private setDisabled(btn: HTMLButtonElement, disabled: boolean): void {
    btn.setAttribute("aria-disabled", String(disabled));
    btn.classList.toggle("is-disabled", disabled);
  }

  private startTicking(): void {
    if (this.tick) return;
    this.tick = window.setInterval(() => this.refreshTimes(), 20000); // keep relative times fresh
  }

  private stopTicking(): void {
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = 0;
    }
  }

  private static mkBtn(act: string, icon: string, label: string, tip: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wv-hist-btn";
    b.dataset.act = act;
    b.innerHTML = icon;
    b.setAttribute("aria-label", label);
    b.setAttribute("data-tip", tip);
    return b;
  }

  private static injectStyle(): void {
    const id = "wv-hist-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
.wv-hist{position:fixed;left:calc(var(--panel-width) + var(--edge) * 2);bottom:var(--edge);z-index:8;
  font:12px/1.3 ui-sans-serif,system-ui,-apple-system,sans-serif;}
.wv-hist-bar{display:inline-flex;align-items:center;gap:4px;padding:5px;border-radius:12px;
  background:rgba(18,18,26,0.72);border:1px solid rgba(255,255,255,0.12);
  box-shadow:0 6px 22px rgba(0,0,0,0.38);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
.wv-hist--dragging .wv-hist-bar{box-shadow:0 10px 30px rgba(0,0,0,0.5);}
.wv-hist-grip{display:inline-flex;align-items:center;justify-content:center;width:20px;height:32px;
  color:#7d8093;cursor:grab;border-radius:6px;touch-action:none;}
.wv-hist-grip:hover{color:#c3c5d2;background:rgba(255,255,255,0.06);}
.wv-hist--dragging .wv-hist-grip{cursor:grabbing;}
.wv-hist-btn{position:relative;width:32px;height:32px;display:inline-flex;align-items:center;
  justify-content:center;border-radius:8px;border:1px solid transparent;background:rgba(255,255,255,0.06);
  color:#e6e7ec;cursor:pointer;transition:background 0.12s ease,color 0.12s ease;}
.wv-hist-btn:hover:not(.is-disabled){background:rgba(255,255,255,0.14);}
.wv-hist-btn:focus-visible{outline:2px solid #7a73ff;outline-offset:1px;}
.wv-hist-btn.is-disabled{color:#6a6c7d;cursor:default;}
.wv-hist-btn.is-active{background:rgba(122,115,255,0.32);border-color:rgba(122,115,255,0.5);color:#fff;}
/* Hover tooltip (shortcut hint). */
.wv-hist-bar [data-tip]::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 9px);left:50%;
  transform:translateX(-50%) translateY(3px);padding:4px 8px;border-radius:6px;white-space:nowrap;
  background:rgba(10,10,14,0.97);color:#e8e8ee;font-size:11px;font-variant-numeric:tabular-nums;
  border:1px solid rgba(255,255,255,0.14);box-shadow:0 4px 14px rgba(0,0,0,0.42);pointer-events:none;
  opacity:0;transition:opacity 0.12s ease,transform 0.12s ease;z-index:2;}
.wv-hist-bar [data-tip]:hover::after,.wv-hist-btn[data-tip]:focus-visible::after{opacity:1;
  transform:translateX(-50%) translateY(0);}
.wv-hist--dragging [data-tip]::after{opacity:0 !important;}
.wv-hist-panel{position:absolute;left:0;bottom:calc(100% + 8px);width:240px;max-height:min(46vh,340px);
  display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:rgba(18,18,26,0.86);
  border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 28px rgba(0,0,0,0.44);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}
.wv-hist--below .wv-hist-panel{bottom:auto;top:calc(100% + 8px);}
.wv-hist-panel[hidden]{display:none;}
.wv-hist-head{padding:9px 12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;
  font-size:10px;color:#9a9cab;border-bottom:1px solid rgba(255,255,255,0.08);flex:0 0 auto;}
.wv-hist-list{margin:0;padding:4px;list-style:none;overflow-y:auto;flex:1 1 auto;}
.wv-hist-list::-webkit-scrollbar{width:8px;}
.wv-hist-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.16);border-radius:8px;}
.wv-hist-row{width:100%;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;
  border:0;background:transparent;color:#d4d5dd;text-align:left;cursor:pointer;font:inherit;
  transition:background 0.1s ease;}
.wv-hist-row:hover{background:rgba(255,255,255,0.08);}
.wv-hist-row:focus-visible{outline:2px solid #7a73ff;outline-offset:-2px;}
.wv-hist-thumb{flex:0 0 auto;width:46px;height:26px;border-radius:4px;box-sizing:border-box;
  background:#14141a center/cover no-repeat;border:1px solid rgba(255,255,255,0.1);}
.wv-hist-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wv-hist-time{flex:0 0 auto;color:#8286a0;font-variant-numeric:tabular-nums;font-size:11px;}
.wv-hist-row.is-current{background:rgba(122,115,255,0.16);color:#fff;}
.wv-hist-row.is-current .wv-hist-thumb{border-color:#7a73ff;box-shadow:0 0 0 1px #7a73ff;}
.wv-hist-empty{padding:10px 12px;color:#82859c;}
/* On narrow screens the control panel becomes a bottom sheet, so dock top-left by default. */
@media (max-width:760px){
  .wv-hist{left:var(--edge);top:var(--edge);bottom:auto;}
  .wv-hist-panel{width:min(62vw,240px);}
}`;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
