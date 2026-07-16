/**
 * In-place feedback ON the button the user just clicked — a green ✓ (success) or red ✕ (failure)
 * with a short label and a tasteful pop — instead of a toast, so confirmation stays where the eye
 * already is. Works on a Tweakpane button (its `.tp-btnv_t` title element) or a plain `<button>`;
 * the resting content (icon + label) is captured and restored, so the button's SVG icon survives the
 * flash. Motion-safe: under reduced-motion the icon + label still swap in, just without the animation.
 */
import { injectStyleOnce } from "../util/dom";

const svg = (inner: string): string =>
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const CHECK = svg('<path d="M3.5 8.6 6.6 11.7 12.6 5"/>');
const CROSS = svg('<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"/>');

// The icon + glow tint come from --wv-bf-col (green by default, red for the error variant), so the
// success and error flashes share one keyframe.
const CSS = `
.wv-bf-ic{display:inline-flex;align-items:center;vertical-align:-2px;margin-right:6px;
  color:rgb(var(--wv-bf-col,111,227,166))}
.wv-bf-flash{--wv-bf-col:111,227,166}
.wv-bf-flash.wv-bf-err{--wv-bf-col:255,138,138}
@media (prefers-reduced-motion: no-preference){
  .wv-bf-flash .tp-btnv_b, button.wv-bf-flash{
    animation: wv-bf-pop 260ms cubic-bezier(0.16,1,0.3,1), wv-bf-glow 900ms ease-out;
  }
  .wv-bf-ic{animation: wv-bf-icon 300ms cubic-bezier(0.16,1,0.3,1) both}
  @keyframes wv-bf-pop{40%{transform:scale(1.03)}}
  @keyframes wv-bf-glow{
    0%{box-shadow:0 0 0 0 rgba(var(--wv-bf-col,111,227,166),0)}
    16%{box-shadow:0 0 0 1.5px rgba(var(--wv-bf-col,111,227,166),0.6), 0 0 12px rgba(var(--wv-bf-col,111,227,166),0.3)}
    100%{box-shadow:0 0 0 0 rgba(var(--wv-bf-col,111,227,166),0)}
  }
  @keyframes wv-bf-icon{from{transform:scale(0.3);opacity:0}to{transform:scale(1);opacity:1}}
}
`;

const resting = new WeakMap<HTMLElement, string>();
const timers = new WeakMap<HTMLElement, number>();

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function flash(el: HTMLElement, label: string, duration: number, error: boolean): void {
  injectStyleOnce("wv-btn-feedback-style", CSS);
  const target = el.querySelector<HTMLElement>(".tp-btnv_t") ?? el;
  // The FIRST flash captures the resting content (icon + label); a re-entrant flash reuses it and
  // just resets the timer, so a flashed state can never be captured AS the resting content.
  if (!resting.has(target)) resting.set(target, target.innerHTML);
  window.clearTimeout(timers.get(target));
  target.innerHTML = `<span class="wv-bf-ic">${error ? CROSS : CHECK}</span>${esc(label)}`;
  // Restart the pop/glow even on a rapid re-click.
  el.classList.remove("wv-bf-flash", "wv-bf-err");
  void el.offsetWidth;
  el.classList.add("wv-bf-flash");
  if (error) el.classList.add("wv-bf-err");
  timers.set(
    target,
    window.setTimeout(() => {
      target.innerHTML = resting.get(target) ?? target.innerHTML;
      el.classList.remove("wv-bf-flash", "wv-bf-err");
      resting.delete(target);
      timers.delete(target);
    }, duration),
  );
}

/** Flash a green "✓ label" success state on `el`, then revert after `duration` ms — long enough to
 *  read the confirmation at a glance before it settles back. */
export function flashButtonSuccess(el: HTMLElement, label = "Done", duration = 2500): void {
  flash(el, label, duration, false);
}

/** Flash a red "✕ label" failure state on `el`, then revert after `duration` ms. */
export function flashButtonError(el: HTMLElement, label = "Failed", duration = 2500): void {
  flash(el, label, duration, true);
}
