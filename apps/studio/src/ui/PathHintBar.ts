/**
 * The gesture cheatsheet shown while a wave's path is being shaped.
 *
 * Path editing is almost entirely direct manipulation — drag the ribbon, double-click to add or
 * remove a point, Shift for a tighter push — and none of that is visible on a canvas. A toast would
 * be wrong: these are not a notification but the controls themselves, needed for as long as the mode
 * is on, so this stays up until the mode ends.
 *
 * It docks over the CONTROL PANEL's column, not the stage. The export frame grows to fill whatever
 * the window gives it — at 1800×800 it reaches within 15px of the bottom, far enough that even the
 * history cluster ends up floating over it — so the panel's column is the only band that is never
 * the viewport, at any size. The panel gets matching bottom padding while the card is up, so it
 * covers nothing there either: scroll and the last control clears it.
 *
 * Rows are an icon plus a sentence, the same shape as the camera-controls cheatsheet, because these
 * are the same kind of thing: which button, and what it does.
 */
import { GESTURE_ICONS } from "./gestureIcons";

interface Hint {
  icon: string;
  text: string;
}

const WAVE_HINTS: Hint[] = [
  { icon: GESTURE_ICONS.left, text: "Drag the gizmo to move the whole wave" },
  { icon: GESTURE_ICONS.left, text: "Drag the marker itself to slide it freely" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click this wave again to shape its points" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click another wave to select that one" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click empty space to finish" },
];

const HINTS: Hint[] = [
  { icon: GESTURE_ICONS.left, text: "Drag the ribbon to shape it" },
  { icon: GESTURE_ICONS.left, text: "Shift-drag for a tighter push" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click the ribbon to add a point" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click a point to remove it" },
  // Neither of these is guessable, and one of them is the way out.
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click another wave to shape that one" },
  { icon: GESTURE_ICONS.doubleLeft, text: "Double-click empty space to finish" },
];

let card: HTMLElement | undefined;
/** Pending removal from a hide that is still fading, so a show inside that window can cancel it
 *  and REUSE the element — stepping points → whole wave hides and shows within a few ms, and two
 *  cards would otherwise overlap for the length of the fade. */
let removeTimer: ReturnType<typeof setTimeout> | undefined;
let fading: HTMLElement | undefined;
/** The panel's own bottom padding, to put back when the card goes. */
let padWas: string | undefined;

function panelEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#panel");
}

/** Reserve room under the panel's content so the card hides none of it. */
function reserve(): void {
  const panel = panelEl();
  if (!panel || !card) return;
  padWas ??= panel.style.paddingBottom;
  panel.style.paddingBottom = `${Math.round(card.getBoundingClientRect().height) + 20}px`;
}

function row(h: Hint): HTMLElement {
  const line = document.createElement("div");
  line.style.cssText = "display:flex;align-items:center;gap:9px;";
  const ic = document.createElement("span");
  ic.style.cssText = "flex:0 0 16px;display:inline-flex;color:#cfd3e2;opacity:0.9;";
  ic.innerHTML = h.icon;
  const t = document.createElement("span");
  t.textContent = h.text;
  t.style.cssText = "opacity:0.88;";
  line.append(ic, t);
  return line;
}

/** Show the cheatsheet for the wave being MOVED (whole-wave transform), or hide it at -1. The
 *  gizmo keys are listed because nothing on screen advertises them. */
export function showWaveHints(
  waveIndex: number,
  onDone?: () => void,
  waveName?: string,
  gizmo: "translate" | "rotate" | "scale" = "translate",
): void {
  const label = gizmo === "translate" ? "Moving" : gizmo === "rotate" ? "Rotating" : "Resizing";
  renderCard(waveIndex, `${label} ${waveName ?? `wave ${waveIndex + 1}`}`, WAVE_HINTS, onDone, [
    { key: "G", what: "move" },
    { key: "R", what: "rotate" },
    { key: "S", what: "resize" },
  ]);
}

/** Show the cheatsheet for the wave being shaped, or hide it when `waveIndex` is -1. */
export function showPathHints(waveIndex: number, onDone?: () => void, waveName?: string): void {
  renderCard(waveIndex, `Shaping ${waveName ?? `wave ${waveIndex + 1}`}`, HINTS, onDone);
}

function renderCard(
  waveIndex: number,
  titleText: string,
  hints: Hint[],
  onDone?: () => void,
  keys?: { key: string; what: string }[],
): void {
  if (waveIndex < 0) {
    hidePathHints();
    return;
  }
  if (!card && fading) {
    // A hide is mid-fade: take that element back instead of stacking a second one on top of it.
    clearTimeout(removeTimer);
    removeTimer = undefined;
    card = fading;
    fading = undefined;
  }
  if (!card) {
    card = document.createElement("div");
    card.setAttribute("role", "status");
    card.style.cssText =
      "position:fixed;left:var(--edge);bottom:var(--edge);width:var(--panel-width);z-index:29;" +
      "box-sizing:border-box;display:flex;flex-direction:column;gap:7px;padding:11px 13px;" +
      "border-radius:10px;font:12px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif;" +
      "color:#eceef4;background:rgba(20,20,28,0.95);border:1px solid rgba(255,255,255,0.14);" +
      "box-shadow:0 10px 34px rgba(0,0,0,0.5);backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity 0.2s ease,transform 0.2s ease;" +
      "transform:translateY(8px);pointer-events:none;";
    document.body.appendChild(card);
  }
  card.textContent = "";

  const title = document.createElement("div");
  title.textContent = titleText;
  title.style.cssText = "font-weight:600;letter-spacing:0.01em;margin-block-end:1px;";
  card.appendChild(title);
  for (const h of hints) card.appendChild(row(h));
  if (keys?.length) {
    const keyRow = document.createElement("div");
    keyRow.style.cssText =
      "display:flex;gap:6px;align-items:center;margin-block-start:3px;opacity:0.8;";
    for (const k of keys) {
      const kb = document.createElement("kbd");
      kb.textContent = k.key;
      kb.title = k.what;
      kb.style.cssText =
        "font:inherit;font-weight:600;padding:1px 5px;border-radius:4px;" +
        "background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.16);";
      const lbl = document.createElement("span");
      lbl.textContent = k.what;
      lbl.style.cssText = "opacity:0.75;margin-inline-end:4px;";
      keyRow.append(kb, lbl);
    }
    card.appendChild(keyRow);
  }

  const done = document.createElement("button");
  done.type = "button";
  done.title = "Leave path editing (Esc, or double-click empty space)";
  done.style.cssText =
    "pointer-events:auto;cursor:pointer;font:inherit;font-weight:600;color:#0f1016;" +
    "margin-block-start:4px;display:inline-flex;align-items:center;justify-content:center;gap:6px;" +
    "padding:6px 11px;border-radius:7px;background:#d8d5f0;border:1px solid rgba(255,255,255,0.2);";
  const label = document.createElement("span");
  label.textContent = "Done";
  const esc = document.createElement("kbd");
  esc.textContent = "esc";
  esc.style.cssText =
    "font:inherit;font-weight:500;opacity:0.62;padding:1px 4px;border-radius:4px;" +
    "background:rgba(15,16,22,0.14);";
  done.append(label, esc);
  done.addEventListener("click", () => onDone?.());
  card.appendChild(done);

  // Two frames so the transition actually runs on first show (the element was just inserted), and
  // so the height it reserves is the laid-out one.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!card) return;
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
      reserve();
    });
  });
}

export function hidePathHints(): void {
  if (!card) return;
  const el = card;
  card = undefined;
  fading = el;
  const panel = panelEl();
  if (panel) panel.style.paddingBottom = padWas ?? "";
  padWas = undefined;
  el.style.opacity = "0";
  el.style.transform = "translateY(8px)";
  removeTimer = setTimeout(() => {
    if (fading === el) fading = undefined;
    el.remove();
  }, 220);
}
