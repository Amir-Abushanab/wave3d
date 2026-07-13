/**
 * Hover hints for the more cryptic control-panel labels.
 *
 * A hinted label gets a dotted underline + a "help" cursor; hovering it — or keyboard-focusing
 * the control on that row — reveals a small tooltip. The tooltip is a single shared element
 * rendered through the native Popover API (Baseline 2025), so it lives in the top layer and
 * escapes #panel's overflow/scroll clipping and the WebGL canvas beneath. Positioning is done in
 * JS from the label's rect (prefer-below, flip-above when there's no room), so no anchor-
 * positioning polyfill is needed. WCAG 1.4.13: dismissible (Escape / scroll), persistent while
 * hovered/focused, and it fades in only when motion is allowed.
 *
 * The map keys are the EXACT label strings Tweakpane renders (the `label` option, or the bare
 * property key when none is given). A handful of labels repeat across sections (e.g. "zoom" in
 * Camera vs Background) — those are disambiguated by their enclosing folder via FOLDER_HINTS.
 *
 * Hint wording is grounded in what each control actually does in the shader — a one-line gloss of
 * the visual effect, since even a well-named knob benefits from a plain-language description.
 */

/** Hints keyed by the rendered label text. */
const CONTROL_HINTS: Record<string, string> = {
  // --- Global / scene ---
  "noise phase": "Scrubs the animation's noise forward/back to freeze a chosen still frame.",
  quality:
    "Mesh subdivision. Higher = smoother geometry & shading, more GPU cost. Rebuilds the mesh.",
  dprMax: "Caps render resolution on hi-DPI screens. Higher = sharper on retina, slower.",
  grain: "Static film-grain speckle over the whole final image.",
  blur: "Soft-focus spin blur that smears toward the top and bottom edges.",
  "blur samples": "Samples taken for the blur — higher is smoother but slower.",
  ambient: "Overall brightness / exposure of the wave (~0.45 is neutral).",

  // --- Wave compositing ---
  blend:
    "How this wave composites over what's behind it. 'Squared' multiplies the colour by itself for the deep hero look — the others read pastel.",
  seed: "Phase offset so this wave's motion & noise differ from the other waves.",

  // --- Color & Gradient ---
  "2D warp": "Warps the gradient with soft noise so colour varies in 2-D, not straight bands.",
  "palette 2D":
    "Use the baked 2-D palette image (with edge tint) instead of the flat procedural gradient.",
  "mesh softness":
    "How softly the mesh colour points blend — higher is softer and broader. (Mesh type only.)",
  "edge tint": "Colour blended toward both long edges of the ribbon. (Custom-stops palette only.)",
  "edge amt": "Strength of the edge tint — 0 leaves a flat 1-D gradient.",
  hueShift: "Rotates every colour around the hue wheel (degrees).",
  colorContrast: "Pushes colours toward/away from mid-grey — >1 punchier, <1 flatter.",
  colorSaturation: "Colour intensity — 1 unchanged, 0 greyscale, >1 more vivid.",

  // --- Finish (material) ---
  "streak freq": "Density of the fine lengthwise streaks — higher = more, finer streaks.",
  "streak strength":
    "How strongly the lengthwise streaks show — their spacing is set by 'streak freq'.",
  texture: "Fine random speckle multiplied onto the surface (separate from post 'grain').",
  roundness: "Darkens the grazing edges so the flat ribbon reads as a rounded, solid form.",
  sheen: "A soft sheen lifted onto the flat, un-folded faces (varies with camera angle).",
  "crease light": "How strongly the wave's creases catch light — where the streaks and sheen sit.",
  "crease sharpness": "Concentrates the crease lighting into the sharpest folds.",
  "crease softness":
    "Softens the crease lighting — higher spreads it more gently across the surface.",
  edgeFade: "Vignette that fades the wave out toward the viewport borders.",
  "line falloff": "How sharply wireframe lines thicken where the ribbon folds away.",
  "max width": "Master scale for the fold-driven line thickening (wireframe).",

  // --- Noise Bands ---
  feather: "Softens the band's rectangular edges so its overrides blend in gradually.",
  strength: "Streak intensity inside the band (overrides the finish for this region).",
  frequency: "Streak density inside the band (overrides 'streak freq' here).",
  colorAtten: "How strongly the underlying colour suppresses streaks (fades them in bluer areas).",
  parabola: "How much streaks bunch toward the two ends versus the middle.",

  // --- Displacement ---
  "displace freq X (len)":
    "Ripple frequency along the wave's length — higher = tighter, more folds.",
  "displace freq Z (wid)":
    "Ripple frequency across the wave's width — higher = tighter, more folds.",
  displaceAmount: "Fold height / amplitude — a negative value flips the fold direction.",

  // --- Twist ---
  "twist wobble": "Animates the X-twist so it breathes / wobbles over time.",

  // --- Camera ---
  "rig minimap": "Corner minimap showing the wave, camera and lights in 3-D.",

  // --- Output ---
  "lock ratio": "Keeps width and height proportional when you change either one.",

  // --- Interaction ---
  // Scene-level shared inputs (one cursor + scroll):
  "pointer radius":
    "Reach of the pointer/hover effects, as a fraction of viewport height. Shared by every wave. Larger = a broader area reacts.",
  "pointer smoothing":
    "How much the pointer's follow lags the cursor — larger is smoother/slower (seconds).",
  touch: "Also follow touch input. Off by default so touch-scrolling a page isn't hijacked.",
  // Per-wave Hover field:
  enabled:
    "Turn this effect on for this wave. Off keeps the values but stops it affecting the wave.",
  hump: "How strongly THIS wave swells under the cursor — negative dents it. Same units as Displace amount.",
  swoosh: "Sweeps the surface toward where the cursor is moving — a velocity-driven smear.",
  agitate: "Adds fast local churn (an extra noise octave) right around the cursor.",
  thin: "Near the cursor: wireframe strands taper to hairlines; a solid surface turns locally translucent.",
  "hue shift": "Rotates the colour near the cursor around the hue wheel (degrees).",
  lighten: "Brightens (or, negative, darkens) the surface near the cursor.",
  // Per-wave Click & touch:
  ripple: "Amplitude of the rings that radiate out from a click/tap on THIS wave. 0 = no ripples.",
  // Reactions (per wave or scene) — "as <input> goes 0→1, drive <parameter> to <to>":
  input: "The signal that drives this reaction — Scroll, Hover, Pointer, Press, Appear…",
  parameter: "The wave (or scene) parameter this reaction drives.",
  "to (at full)":
    "The parameter's value at full input (input = 1). At rest it stays the authored value.",
  "start at rest value":
    "Keep the value at input 0 equal to the wave's authored value, so at rest it looks unchanged.",
  "start value": "The parameter's value at input 0 (used only when 'start at rest value' is off).",
  smoothing:
    "How much this reaction's response lags its input — larger is smoother/slower, 0 is instant (seconds).",
  // Scroll preview (studio-only):
  "scroll (drag to test)":
    "The studio page never scrolls, so drag this to fake a scroll position (0 = at rest, 1 = scrolled past) and watch any scroll reaction. On a real page this reads the actual scroll; never saved to the config.",
};

/** Overrides for labels that mean different things in different folders. Keyed `Folder label`. */
const FOLDER_HINTS: Record<string, string> = {
  "Camera zoom": "Orthographic framing — scales the crop (no perspective/FOV). Higher = tighter.",
  "Background zoom": "Scale of the background image/video within the frame.",
  // Output → "quality" is the exported-image compression, not the Global mesh "quality".
  "Output quality":
    "Compression quality for the exported image — higher looks better but weighs more.",
};

const SEP = " ";

const supportsPopover = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let tooltipEl: HTMLElement | null = null;
let currentAnchor: HTMLElement | null = null;
let hideTimer = 0;
/** Whether the most recent interaction was via keyboard. Gates the focus-reveal so a hint doesn't
 *  pop when a slider is clicked/dragged with the mouse (mirrors what :focus-visible does, but
 *  reliably — :focus-visible can still read false during the focusin event itself). */
let keyboardModality = false;
let listenersReady = false;

/** Resolve the hint text for a row, preferring a folder-qualified override. */
function lookupHint(label: string, row: HTMLElement): string | undefined {
  let el: HTMLElement | null = row;
  while ((el = el.parentElement)) {
    if (el.classList.contains("tp-fldv")) {
      const title = (el.querySelector(".tp-fldv_t")?.textContent ?? "").trim();
      const scoped = title && FOLDER_HINTS[`${title}${SEP}${label}`];
      if (scoped) return scoped;
    }
  }
  return CONTROL_HINTS[label];
}

/** Lazily create the one shared tooltip element. */
function getTooltip(): HTMLElement {
  if (tooltipEl) return tooltipEl;
  const tip = document.createElement("div");
  tip.id = "wv-tooltip";
  tip.setAttribute("role", "tooltip");
  if (supportsPopover) tip.setAttribute("popover", "manual");
  else tip.hidden = true;
  document.body.appendChild(tip);
  tooltipEl = tip;
  return tip;
}

/** Register the one-time global listeners: interaction-modality tracking + tooltip dismissers. */
function ensureGlobalListeners(): void {
  if (listenersReady) return;
  listenersReady = true;
  // Modality: any key press means "keyboard"; a pointer press means "mouse/touch". Pointer is
  // capture-phase so it lands before the focus it triggers.
  window.addEventListener("keydown", (e) => {
    keyboardModality = true;
    if (e.key === "Escape") hideNow(); // manual popovers don't light-dismiss
  });
  window.addEventListener(
    "pointerdown",
    () => {
      keyboardModality = false;
    },
    true,
  );
  window.addEventListener("resize", hideNow);
  // Capture phase so scrolling the inner #panel reaches us. Keep the hint glued to its label as
  // the panel scrolls under the pointer (pointerleave handles the case where it scrolls away).
  window.addEventListener(
    "scroll",
    () => {
      if (currentAnchor) position(currentAnchor);
    },
    true,
  );
}

function openTip(tip: HTMLElement): void {
  if (supportsPopover) {
    if (!tip.matches(":popover-open")) {
      try {
        (tip as HTMLElement & { showPopover(): void }).showPopover();
      } catch {
        /* already open / not connected */
      }
    }
  } else {
    tip.hidden = false;
  }
}

function closeTip(tip: HTMLElement): void {
  if (supportsPopover) {
    if (tip.matches(":popover-open")) {
      try {
        (tip as HTMLElement & { hidePopover(): void }).hidePopover();
      } catch {
        /* already closed */
      }
    }
  } else {
    tip.hidden = true;
  }
}

/** Place the tooltip below the anchor, flipping above and clamping to the viewport as needed. */
function position(anchor: HTMLElement): void {
  const tip = getTooltip();
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = Math.min(r.left, vw - tw - margin);
  left = Math.max(margin, left);

  let top = r.bottom + gap;
  if (top + th > vh - margin) {
    const above = r.top - gap - th;
    top = above >= margin ? above : Math.max(margin, vh - th - margin);
  }

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function show(anchor: HTMLElement, text: string): void {
  window.clearTimeout(hideTimer);
  const tip = getTooltip();
  currentAnchor = anchor;
  tip.textContent = text;
  openTip(tip); // make it laid out so we can measure it
  position(anchor);
  if (prefersReducedMotion()) tip.classList.add("wv-tip-show");
  else requestAnimationFrame(() => tip.classList.add("wv-tip-show"));
}

function scheduleHide(): void {
  window.clearTimeout(hideTimer);
  // Small grace period so a flick of the pointer off the label doesn't flicker it away.
  hideTimer = window.setTimeout(hideNow, 90);
}

function hideNow(): void {
  window.clearTimeout(hideTimer);
  currentAnchor = null;
  if (!tooltipEl) return;
  tooltipEl.classList.remove("wv-tip-show");
  closeTip(tooltipEl);
}

/** Hide any open hint. Called before a panel rebuild, since the anchor DOM is about to vanish. */
export function hideControlHint(): void {
  hideNow();
}

/**
 * Mark every hinted label in `container` with the underline affordance and wire its hover/focus
 * triggers. Idempotent per row (safe to re-run after each panel rebuild — Tweakpane hands us
 * fresh DOM each time, so old listeners are discarded with the old nodes).
 */
export function applyControlHints(container: HTMLElement): void {
  ensureGlobalListeners();
  container.querySelectorAll<HTMLElement>(".tp-lblv").forEach((row) => {
    if (row.dataset.wvHinted) return;
    const labelEl = row.querySelector<HTMLElement>(".tp-lblv_l");
    if (!labelEl) return;
    const label = (labelEl.textContent ?? "").trim();
    if (!label) return;
    const text = lookupHint(label, row);
    if (!text) return;

    row.dataset.wvHinted = "1";
    labelEl.classList.add("wv-has-hint");
    labelEl.addEventListener("pointerenter", () => show(labelEl, text));
    labelEl.addEventListener("pointerleave", scheduleHide);
    // Keyboard bonus: reveal the hint when the row's own control (already a tab stop, so no new
    // ones) receives focus via the keyboard. Gated on modality so it doesn't pop when a slider is
    // clicked/dragged with the mouse.
    row.addEventListener("focusin", () => {
      if (keyboardModality) show(labelEl, text);
    });
    row.addEventListener("focusout", scheduleHide);
  });
}
