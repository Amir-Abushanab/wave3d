/**
 * In-place success feedback ON the button the user just clicked — a green checkmark + short label
 * with a tasteful pop — instead of a toast, so confirmation stays where the eye already is. Works on
 * a Tweakpane button (its `.tp-btnv_t` title element) or a plain `<button>`; the resting content
 * (icon + label) is captured and restored, so the button's SVG icon survives the flash. Motion-safe:
 * under reduced-motion the checkmark + label still swap in, just without the animation.
 */
import { injectStyleOnce } from "../util/dom";

const CHECK =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.6 6.6 11.7 12.6 5"/></svg>';

const CSS = `
.wv-bf-ic{display:inline-flex;align-items:center;vertical-align:-2px;margin-right:6px;color:#6fe3a6}
@media (prefers-reduced-motion: no-preference){
  .wv-bf-flash .tp-btnv_b, button.wv-bf-flash{
    animation: wv-bf-pop 260ms cubic-bezier(0.16,1,0.3,1), wv-bf-glow 900ms ease-out;
  }
  .wv-bf-ic{animation: wv-bf-check 300ms cubic-bezier(0.16,1,0.3,1) both}
  @keyframes wv-bf-pop{40%{transform:scale(1.03)}}
  @keyframes wv-bf-glow{
    0%{box-shadow:0 0 0 0 rgba(111,227,166,0)}
    16%{box-shadow:0 0 0 1.5px rgba(111,227,166,0.6), 0 0 12px rgba(111,227,166,0.3)}
    100%{box-shadow:0 0 0 0 rgba(111,227,166,0)}
  }
  @keyframes wv-bf-check{from{transform:scale(0.3);opacity:0}to{transform:scale(1);opacity:1}}
}
`;

const resting = new WeakMap<HTMLElement, string>();
const timers = new WeakMap<HTMLElement, number>();

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Flash a "✓ label" success state on `el` (a Tweakpane button root or a plain button), then revert
 *  after `duration` ms — long enough to read the confirmation at a glance before it settles back. */
export function flashButtonSuccess(el: HTMLElement, label = "Done", duration = 2500): void {
  injectStyleOnce("wv-btn-feedback-style", CSS);
  const target = el.querySelector<HTMLElement>(".tp-btnv_t") ?? el;
  // The FIRST flash captures the resting content (icon + label); a re-entrant flash reuses it and
  // just resets the timer, so the success state can never be captured AS the resting content.
  if (!resting.has(target)) resting.set(target, target.innerHTML);
  window.clearTimeout(timers.get(target));
  target.innerHTML = `<span class="wv-bf-ic">${CHECK}</span>${esc(label)}`;
  // Restart the pop/glow even on a rapid re-click.
  el.classList.remove("wv-bf-flash");
  void el.offsetWidth;
  el.classList.add("wv-bf-flash");
  timers.set(
    target,
    window.setTimeout(() => {
      target.innerHTML = resting.get(target) ?? target.innerHTML;
      el.classList.remove("wv-bf-flash");
      resting.delete(target);
      timers.delete(target);
    }, duration),
  );
}
