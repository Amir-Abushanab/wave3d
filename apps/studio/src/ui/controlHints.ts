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
 *
 * UV AXES — several hints below hinge on uv.y being the ribbon's LENGTH and uv.x its folded
 * WIDTH, which is the reverse of what a few of the knob names suggest. The derivation and its
 * corroboration live in the UV AXES note atop `WaveGeometry.ts`; read that before "correcting"
 * any hint here that mentions a length, a width, an end or a long edge.
 */

/** Shared text for knobs that repeat per axis — the map needs one entry per exact label. */
const COLOR_DRIFT =
  "Scrolls the palette over the wave each second, so the colour animates on its own even while the geometry holds still. 0 = static. (Texture palettes only — not mesh or procedural stops.)";
const TWIST_FREQ =
  "The twist angle for this axis — how far the ribbon rotates. Negative reverses the direction; the matching 'twist power' decides where along the strip that rotation is spent.";
const TWIST_POWER_LEN =
  "How sharply this twist falls off ALONG the ribbon's length. 0 rotates the whole strip rigidly (a pure phase offset); higher concentrates the rotation into one end and leaves the rest straight. The crossover always sits at the halfway point — power only sets how abrupt it is, never where.";
const TWIST_POWER_WID =
  "How sharply this twist falls off ACROSS the ribbon's width. 0 rotates the whole strip rigidly (a pure phase offset); higher concentrates the rotation into one long edge. The crossover always sits at the halfway point — power only sets how abrupt it is, never where.";

/** Hints keyed by the rendered label text. */
const CONTROL_HINTS: Record<string, string> = {
  // --- Global / scene ---
  "noise phase": "Scrubs the animation's noise forward/back to freeze a chosen still frame.",
  "loop (s, 0=off)":
    "Seamless-loop period. Above 0 the motion walks a circle through noise space so it repeats exactly every N seconds — set it to your clip length for a gapless GIF/video. Scene-wide, so a multi-wave stack shares one period.",
  quality:
    "Mesh subdivision. Higher = smoother geometry & shading, more GPU cost. Rebuilds the mesh.",
  dprMax: "Caps render resolution on hi-DPI screens. Higher = sharper on retina, slower.",
  grain: "Static film-grain speckle over the whole final image.",
  blur: "Soft-focus spin blur that smears toward the top and bottom edges.",
  "blur samples": "Samples taken for the blur — higher is smoother but slower.",
  ambient: "Overall brightness / exposure of the wave (~0.45 is neutral).",

  // --- Post FX (each pass is skipped entirely at 0, so its sub-knobs are inert until you lift it) ---
  "bloom threshold":
    "How bright a pixel must be before it blooms — raise it to glow only the hottest highlights, lower it to let mid-tones bleed too.",
  dither:
    "Ordered (Bayer) dithering over the finished image: posterizes it, then hides the banding under a cross-hatched retro pattern. Runs last, after tone-mapping.",
  "dither px": "Size of one dither cell in device pixels — larger reads as a chunkier pattern.",
  "dither steps": "Colour levels kept per channel — fewer means heavier posterization.",
  "halftone cell":
    "Dot spacing in pixels — larger reads as a coarser, more obviously printed screen.",
  "halftone angle": "Rotation of the dot grid, like a print screen angle (radians).",
  "cmyk halftone":
    "Four rotated dot screens (cyan/magenta/yellow/black) instead of the single grey one — the misregistered-print look.",
  "cmyk cell": "Dot size in pixels for the four CMYK screens.",
  heatmap: "Recolours by brightness into a thermal palette, replacing the wave's own hues.",
  "paper scale": "Size of the paper fibres — larger reads as coarser stock.",
  "inner light":
    "God-rays: streaks scattered out of the wave and radiating from the light point below. Only opaque pixels emit, so the shafts come off the wave itself rather than the background.",
  "light spread": "How far the god-ray shafts reach out from the light point.",
  "light decay":
    "How fast the shafts fade along their length — lower gives shorter, punchier rays.",
  "light x": "Horizontal position of the god-ray light point (0 = left edge, 1 = right).",
  "light y": "Vertical position of the god-ray light point (0 = bottom edge, 1 = top).",

  // --- Background ---
  "color / matte":
    "The background colour under the 'Solid color' fill — and, under the others, the matte that shows wherever the gradient or image doesn't cover. Ignored while 'transparent' is on.",

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
  "edge tint":
    "Colour blended toward the ribbon's two ENDS — it rides the palette's second axis, which samples uv.y. (Custom-stops palette only.)",
  "edge amt": "Strength of the edge tint — 0 leaves a flat 1-D gradient.",
  "color drift X": COLOR_DRIFT,
  "color drift Y": COLOR_DRIFT,
  hueShift: "Rotates every colour around the hue wheel (degrees).",
  colorContrast: "Pushes colours toward/away from mid-grey — >1 punchier, <1 flatter.",
  colorSaturation: "Colour intensity — 1 unchanged, 0 greyscale, >1 more vivid.",

  // --- Finish (material) ---
  material:
    "Solid surface vs. wireframe line shader — two different fragment shaders, not a toggle on one. Switching swaps which controls below are shown, since most belong to only one of them.",
  "streak freq": "Density of the fine lengthwise streaks — higher = more, finer streaks.",
  "streak strength":
    "How strongly the lengthwise streaks show — their spacing is set by 'streak freq'.",
  texture: "Fine random speckle multiplied onto the surface (separate from post 'grain').",
  roundness: "Darkens the grazing edges so the flat ribbon reads as a rounded, solid form.",
  sheen: "A soft sheen lifted onto the flat, un-folded faces (varies with camera angle).",
  iridescence: "Thin-film / holographic hue response that shifts with the viewing angle.",
  "crease light": "How strongly the wave's creases catch light — where the streaks and sheen sit.",
  "crease sharpness": "Concentrates the crease lighting into the sharpest folds.",
  "crease softness":
    "Softens the crease lighting — higher spreads it more gently across the surface.",
  edgeFade: "Vignette that fades the wave out toward the viewport borders.",
  "edge feather":
    "How softly the ribbon fades out at its two ENDS. Small is a razor-crisp cut-off, large is soft vapour. (Not 'edgeFade' above — that vignettes against the viewport; this one shapes the ribbon itself.)",
  "depth tint":
    "Fades fragments toward the tint colour as they recede from the camera, so stacked waves separate by depth instead of flattening into each other.",
  "line count":
    "How many strands the ribbon is carved into. They run lengthwise, so this counts them ACROSS the width.",
  "line thickness":
    "Base strand width, before 'line falloff' and 'max width' thicken it where the ribbon folds away.",
  "rung count":
    "A second family of lines carved ACROSS the ribbon, crossing the lengthwise strands into a ladder. Roughly count ÷ π rungs. 0 = off, and the cross-wise path isn't even compiled.",
  "rung thickness": "Rung line width in pixels — screen-space, so it holds at any zoom.",
  "line falloff": "How sharply wireframe lines thicken where the ribbon folds away.",
  "max width": "Master scale for the fold-driven line thickening (wireframe).",

  // --- Noise Bands ---
  // The names are the reverse of what they suggest: the bounds gate on uv, where uv.x wraps the
  // folded cross-section (the short axis) and uv.y runs end to end. See the UV AXES note above.
  startX:
    "Where the band begins ACROSS the ribbon's WIDTH (0–1). Despite the name, the X pair is the SHORT axis — it wraps the folded cross-section.",
  endX: "Where the band ends across the ribbon's width (0–1).",
  startY:
    "Where the band begins ALONG the ribbon's LENGTH (0–1). Despite the name, the Y pair is the LONG axis.",
  endY: "Where the band ends along the ribbon's length; 0→1 spans it end to end.",
  feather: "Softens the band's rectangular edges so its overrides blend in gradually.",
  strength: "Streak intensity inside the band (overrides the finish for this region).",
  frequency: "Streak density inside the band (overrides 'streak freq' here).",
  colorAtten: "How strongly the underlying colour suppresses streaks (fades them in bluer areas).",
  parabola:
    "How much streaks bunch toward the ribbon's two long edges versus its width centreline (the weighting rides uv.x, the short axis).",

  // --- Displacement ---
  "displace freq X (len)":
    "Ripple frequency along the wave's length — higher = tighter, more folds.",
  "displace freq Z (wid)":
    "Ripple frequency across the wave's width — higher = tighter, more folds.",
  displaceAmount: "Fold height / amplitude — a negative value flips the fold direction.",
  "detail amount":
    "A second, finer octave of folds riding on the broad swell. 0 leaves only the base displacement; negative flips its direction.",
  "detail freq":
    "Ripple frequency of that second octave — higher = tighter detail folds. One frequency for both axes (unlike the base displacement's separate length/width knobs), and inert while 'detail amount' is 0.",

  // --- Twist ---
  "twist freq X": TWIST_FREQ,
  "twist freq Y": TWIST_FREQ,
  "twist freq Z": TWIST_FREQ,
  // Which axis each falloff runs along is not the axis in its name: the X and Z rotations key off
  // uv.y (the length), the Y rotation off uv.x (the folded width). See the UV AXES note above.
  "twist power X": TWIST_POWER_LEN,
  "twist power Y": TWIST_POWER_WID,
  "twist power Z": TWIST_POWER_LEN,
  "twist wobble": "Animates the X-twist so it breathes / wobbles over time.",

  // --- Helix --- the periodic sweep the three twists can't reach (their falloff only ramps once).
  turns:
    "How many full turns the ribbon makes around its own length axis, end to end. On its own it does nothing — dial up 'radius' or 'roll' to give the turning something to move.",
  radius:
    "Swings the whole ribbon out to this distance from the axis, keeping it facing the same way, so a narrow ribbon reads as one coiled STRAND. Two waves set 180° apart in 'phase' make a double helix. 0 = off.",
  roll: "Rolls the ribbon's own cross-section as it advances, as a fraction of 'turns' (1 = exactly in step, a rigid twisted ribbon). It throws the two long edges onto opposite sides of the axis, so a SINGLE wave becomes a ladder with a strand on each edge — add 'rung count' for the rungs between them. 0 = off.",
  "phase °":
    "Where along the turn the ribbon starts. This is the knob that offsets a second wave onto the other side of the same helix (set it to 180).",

  // --- Camera ---
  "rig minimap": "Corner minimap showing the wave, camera and lights in 3-D.",
  "min visible W":
    "Narrow-screen crop guard: the least of the authored frame's WIDTH that must stay on screen (0 = off, 1 = all of it). Cover binds on height below 16:9, so a portrait phone zooms deep into the middle — this only ever zooms back out.",

  // --- Output ---
  "lock ratio": "Keeps width and height proportional when you change either one.",

  // --- Interaction ---
  // Scene-level shared inputs (one cursor + scroll):
  "pointer radius":
    "Reach of the pointer/hover effects, as a fraction of viewport height. Shared by every wave. Larger = a broader area reacts.",
  "ribbon flow":
    "Stretches the pointer's reach ALONG each ribbon's length instead of a round patch around the cursor, so the effect flows with the strip rather than sitting on top of it. 0 = a plain circle.",
  touch:
    "Also follow touch input — the wave tracks the finger while it's down. Off by default, so on a phone the hover and click effects do nothing until you turn this on. Page scrolling keeps working either way.",
  // Per-wave Hover field:
  enabled:
    "Turn this effect on for this wave. Off keeps the values but stops it affecting the wave.",
  agitate: "Adds fast local churn (an extra noise octave) right around the cursor.",
  "push (± repel/attract)":
    "A smooth dome at the cursor — positive swells the surface toward you, negative dents it away. It rides the sprung field, so it drags like a poke under fabric rather than snapping.",
  "drag-wake":
    "While the cursor moves, the surface just BEHIND it is pulled into a trailing trough that heals once you stop. It scales with pointer speed, so it only shows on a fast drag.",
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
  // Camera → "fit" reconciles aspect ratios; Background → "fit" is plain object-fit, left unhinted.
  "Camera fit":
    "How the authored 16:9 frame maps onto a canvas of a different shape. Cover fills both axes and crops the overflow (the hero look); Contain fits the whole frame and reveals world beyond it; Width and Height always bind on that one axis.",
  // Output → "quality" is the exported-image compression, not the Global mesh "quality".
  "Output quality":
    "Compression quality for the exported image — higher looks better but weighs more.",
  // Hover → "smoothing" is this wave's cursor-follow lag, not a reaction's input smoothing.
  "Hover smoothing":
    "How quickly THIS wave's swell trails the cursor — larger lags more. Give stacked strands different values for a parallax drag.",
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
