/**
 * A one-time card pointing out that the wave you designed can be handed straight to a coding agent.
 *
 * Docks bottom-right of the workspace — clear of the control panel (left), the history cluster
 * (bottom-left) and the export frame's resize handles. Copying leaves it up (the button's own
 * "Copied ✓" is the feedback); only the ✕ dismisses it, and that sticks — the same button lives
 * permanently in the Export-code dialog, which the card's footnote points at, so nothing is lost
 * once it's gone.
 *
 * Follows the HistoryControls/RecordingOverlay pattern: builds its own DOM, injects its own style,
 * cleans up via dispose() (called from main.ts's HMR teardown).
 */
import { injectStyleOnce } from "../util/dom";
import { createAgentCopyButton } from "./agentCopyButton";

const DISMISS_KEY = "wave3d:agent-card-dismissed";

/** localStorage throws in some partitioned/private contexts — never let that break the studio. */
function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* storage unavailable — the card just reappears next session */
  }
}

const STYLE = `
/* Inset from the right by more than a resize handle's width: the card sits over the stage's
   bottom-right corner whenever the export frame is tall, and would otherwise swallow clicks on the
   SE resize handle (36px, flush to the frame's corner). */
.wv-agent-card { position: fixed; right: calc(var(--edge) + 42px); bottom: var(--edge); z-index: 8;
  width: 264px; box-sizing: border-box; padding: 12px 13px 11px;
  font: 12px ui-sans-serif, system-ui, sans-serif; color: #cdd0d6;
  background: rgba(22, 23, 27, 0.92); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 9px;
  box-shadow: 0 12px 34px rgba(0,0,0,0.44);
  animation: wv-agent-in .32s cubic-bezier(.32,.72,0,1) both; }
@keyframes wv-agent-in { from { opacity: 0; transform: translateY(8px); } }
.wv-agent-card.leaving { opacity: 0; transform: translateY(8px);
  transition: opacity .2s ease, transform .2s ease; pointer-events: none; }
.wv-agent-card h3 { margin: 0 26px 5px 0; font-size: 12.5px; font-weight: 600; color: #f0f1f4; }
.wv-agent-card p { margin: 0 0 10px; line-height: 1.5; color: #a8acb6; }
.wv-agent-card .wv-agent-note { margin: 8px 0 0; font-size: 11px; color: #797f8b; }
.wv-agent-card .wv-agent-x { position: absolute; top: 7px; right: 7px; width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center; padding: 0;
  background: none; border: none; border-radius: 5px; color: #8b909b; font-size: 15px;
  line-height: 1; cursor: pointer; }
.wv-agent-card .wv-agent-x:hover { background: rgba(255,255,255,0.08); color: #e6e6e6; }
.wv-agent-card .wv-agent-x:focus-visible { outline: 2px solid #2d5cff; outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .wv-agent-card { animation: none; }
  .wv-agent-card.leaving { transition: none; }
}
@media (max-width: 900px) { .wv-agent-card { display: none; } }
`;

export class AgentHandoffCard {
  private el: HTMLElement | null = null;
  private leaveTimer = 0;

  /** `getBrief` is read on click, so the copy always reflects the wave as it is right then. */
  constructor(parent: HTMLElement, getBrief: () => string) {
    if (isDismissed()) return;
    injectStyleOnce("wave3d-agent-card", STYLE);

    const el = document.createElement("aside");
    el.className = "wv-agent-card";
    el.setAttribute("aria-label", "Hand this wave to a coding agent");

    const title = document.createElement("h3");
    title.textContent = "Building with an AI agent?";
    const body = document.createElement("p");
    body.textContent =
      "Copy this wave plus @wave3d's setup guide as one prompt — paste it into your agent and it can wire the wave into your app.";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "wv-agent-x";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "✕";
    close.addEventListener("click", () => this.dismiss());

    const note = document.createElement("p");
    note.className = "wv-agent-note";
    note.textContent = "Always available under Export code.";

    el.append(close, title, body, createAgentCopyButton(getBrief), note);
    parent.appendChild(el);
    this.el = el;
  }

  /** Fade out, persist, remove. */
  private dismiss(): void {
    const el = this.el;
    if (!el) return;
    this.el = null;
    rememberDismissed();
    el.classList.add("leaving");
    clearTimeout(this.leaveTimer);
    this.leaveTimer = window.setTimeout(() => el.remove(), 220);
  }

  dispose(): void {
    clearTimeout(this.leaveTimer);
    this.el?.remove();
    this.el = null;
  }
}
