/**
 * On-stage "● REC 0:05" indicator shown while a video capture is running. It lives in the
 * DOM over the canvas (top-right, clear of the export-area label) — the recording captures
 * the WebGL canvas via captureStream, so this overlay never shows up in the saved video.
 * Replaces the old read-only "recording" checkbox in the panel.
 */
export class RecordingOverlay {
  private readonly el: HTMLDivElement;
  private readonly timeEl: HTMLSpanElement;
  private startMs = 0;
  private timerId = 0;

  constructor(private readonly host: HTMLElement) {
    RecordingOverlay.injectStyle();
    this.el = document.createElement("div");
    this.el.className = "wv-rec";
    const dot = document.createElement("span");
    dot.className = "wv-rec-dot";
    const label = document.createElement("span");
    label.textContent = "REC";
    this.timeEl = document.createElement("span");
    this.timeEl.className = "wv-rec-time";
    this.timeEl.textContent = "0:00";
    this.el.append(dot, label, this.timeEl);
  }

  /** Show the indicator and start counting up. */
  start(): void {
    this.startMs = performance.now();
    this.render();
    if (!this.el.isConnected) this.host.appendChild(this.el);
    clearInterval(this.timerId);
    this.timerId = window.setInterval(() => this.render(), 250);
  }

  /** Hide the indicator and stop the timer. */
  stop(): void {
    clearInterval(this.timerId);
    this.timerId = 0;
    this.el.remove();
  }

  private render(): void {
    const total = Math.max(0, Math.floor((performance.now() - this.startMs) / 1000));
    const m = Math.floor(total / 60);
    this.timeEl.textContent = `${m}:${String(total % 60).padStart(2, "0")}`;
  }

  private static injectStyle(): void {
    const id = "wv-rec-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
.wv-rec{position:absolute;top:10px;right:10px;z-index:6;display:inline-flex;align-items:center;gap:7px;
  padding:6px 11px 6px 9px;border-radius:999px;background:rgba(15,16,22,0.66);color:#fff;
  font:600 12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:0.06em;
  border:1px solid rgba(255,255,255,0.14);box-shadow:0 4px 18px rgba(0,0,0,0.35);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);pointer-events:none;}
.wv-rec-dot{width:9px;height:9px;border-radius:50%;background:#ff3b30;
  box-shadow:0 0 8px rgba(255,59,48,0.9);animation:wv-rec-pulse 1.1s ease-in-out infinite;}
.wv-rec-time{font-variant-numeric:tabular-nums;opacity:0.9;min-width:30px;}
@keyframes wv-rec-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.25;transform:scale(0.8);}}
@media (prefers-reduced-motion:reduce){.wv-rec-dot{animation:none;}}`;
    document.head.appendChild(s);
  }
}
