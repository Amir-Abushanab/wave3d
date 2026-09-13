/**
 * The gesture bar shown while a wave's path is being shaped.
 *
 * Path editing is almost entirely direct manipulation — drag the ribbon, double-click to add or
 * remove a point, Shift for a tighter push — and none of that is visible on a canvas. A toast would
 * be wrong: these are not a notification but the controls themselves, needed for as long as the mode
 * is on, so this stays up until the mode ends.
 *
 * It sits bottom-centre like the toast, and steps aside for one (`bottom` leaves the toast's lane
 * clear) rather than stacking on top of it.
 */

interface Hint {
  keys: string;
  what: string;
}

const HINTS: Hint[] = [
  { keys: "drag the ribbon", what: "shape it" },
  { keys: "shift-drag", what: "tighter push" },
  { keys: "double-click ribbon", what: "add point" },
  { keys: "double-click point", what: "remove" },
  { keys: "esc", what: "done" },
];

let bar: HTMLElement | undefined;

/** Show the bar for the wave being edited, or hide it when `waveIndex` is -1. */
export function showPathHints(waveIndex: number): void {
  if (waveIndex < 0) {
    hidePathHints();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:50%;bottom:74px;transform:translateX(-50%) translateY(8px);z-index:29;" +
      "display:flex;align-items:center;gap:14px;padding:8px 14px;border-radius:10px;" +
      "font:12px/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eceef4;" +
      "background:rgba(20,20,28,0.92);border:1px solid rgba(255,255,255,0.14);" +
      "box-shadow:0 10px 34px rgba(0,0,0,0.5);backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity 0.2s ease,transform 0.2s ease;" +
      "pointer-events:none;max-width:min(94vw,760px);flex-wrap:wrap;justify-content:center;";
    document.body.appendChild(bar);
  }
  bar.textContent = "";
  const title = document.createElement("span");
  title.textContent = `Shaping wave ${waveIndex + 1}`;
  title.style.cssText = "font-weight:600;letter-spacing:0.01em;";
  bar.appendChild(title);
  for (const h of HINTS) {
    const item = document.createElement("span");
    item.style.cssText = "display:inline-flex;align-items:center;gap:5px;opacity:0.86;";
    const k = document.createElement("kbd");
    k.textContent = h.keys;
    k.style.cssText =
      "font:inherit;padding:2px 6px;border-radius:5px;background:rgba(255,255,255,0.1);" +
      "border:1px solid rgba(255,255,255,0.14);";
    const w = document.createElement("span");
    w.textContent = h.what;
    item.append(k, w);
    bar.appendChild(item);
  }
  // Two frames so the transition actually runs on first show (the element was just inserted).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (bar) {
        bar.style.opacity = "1";
        bar.style.transform = "translateX(-50%) translateY(0)";
      }
    });
  });
}

export function hidePathHints(): void {
  if (!bar) return;
  const el = bar;
  bar = undefined;
  el.style.opacity = "0";
  el.style.transform = "translateX(-50%) translateY(8px)";
  setTimeout(() => el.remove(), 220);
}
