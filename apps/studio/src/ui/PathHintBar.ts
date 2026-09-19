/**
 * The gesture bar shown while a wave's path is being shaped.
 *
 * Path editing is almost entirely direct manipulation — drag the ribbon, double-click to add or
 * remove a point, Shift for a tighter push — and none of that is visible on a canvas. A toast would
 * be wrong: these are not a notification but the controls themselves, needed for as long as the mode
 * is on, so this stays up until the mode ends.
 *
 * The way OUT is a real button, not just the `esc` legend it used to be. Everything else here is a
 * mouse gesture, so telling a person reaching for the mouse to find a key is the one instruction the
 * bar cannot give — and the bar is the only place that says the mode can be left at all.
 */

/** A gesture the mode responds to. `keys` is the gesture itself, `what` is what it does. */
interface Hint {
  keys: string;
  what: string;
}

const HINTS: Hint[] = [
  { keys: "drag the ribbon", what: "shape it" },
  { keys: "shift-drag", what: "tighter push" },
  { keys: "double-click the ribbon", what: "add a point" },
  { keys: "double-click a point", what: "remove it" },
  // Both of these are double-clicks off the wave being shaped, and neither is guessable: one
  // switches which wave you are shaping, the other leaves the mode.
  { keys: "double-click another wave", what: "shape that one" },
  { keys: "double-click empty space", what: "done" },
];

/**
 * Bottom offset, clear of the two things that already live down there: the toast lane (docked at
 * bottom 20) and the history cluster's DEFAULT dock (bottom `--edge`, 44 tall). The cluster can be
 * dragged anywhere, but the bar stays put — following it would make the bar jump around as the
 * cluster moves, and it is the default position that has to be left alone.
 */
const BOTTOM = "calc(var(--edge) + 44px + 40px)";

let bar: HTMLElement | undefined;

function chip(h: Hint): HTMLElement {
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
  return item;
}

/** Show the bar for the wave being edited, or hide it when `waveIndex` is -1. */
export function showPathHints(waveIndex: number, onDone?: () => void): void {
  if (waveIndex < 0) {
    hidePathHints();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText =
      `position:fixed;left:50%;bottom:${BOTTOM};transform:translateX(-50%) translateY(8px);z-index:29;` +
      "display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;border-radius:10px;" +
      "font:12px/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eceef4;" +
      "background:rgba(20,20,28,0.92);border:1px solid rgba(255,255,255,0.14);" +
      "box-shadow:0 10px 34px rgba(0,0,0,0.5);backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity 0.2s ease,transform 0.2s ease;" +
      // The bar itself must not eat canvas drags; only its button takes pointer events.
      "pointer-events:none;max-width:min(94vw,1010px);flex-wrap:wrap;justify-content:center;";
    document.body.appendChild(bar);
  }
  bar.textContent = "";

  const title = document.createElement("span");
  title.textContent = `Shaping wave ${waveIndex + 1}`;
  title.style.cssText = "font-weight:600;letter-spacing:0.01em;";
  bar.appendChild(title);
  for (const h of HINTS) bar.appendChild(chip(h));

  const done = document.createElement("button");
  done.type = "button";
  done.title = "Leave path editing (Esc, or double-click empty space)";
  done.style.cssText =
    "pointer-events:auto;cursor:pointer;font:inherit;font-weight:600;color:#0f1016;" +
    "display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:7px;" +
    "background:#d8d5f0;border:1px solid rgba(255,255,255,0.2);";
  const label = document.createElement("span");
  label.textContent = "Done";
  const esc = document.createElement("kbd");
  esc.textContent = "esc";
  esc.style.cssText =
    "font:inherit;font-weight:500;opacity:0.62;padding:1px 4px;border-radius:4px;" +
    "background:rgba(15,16,22,0.14);";
  done.append(label, esc);
  done.addEventListener("click", () => onDone?.());
  bar.appendChild(done);

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
