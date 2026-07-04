// Poster management for the shell: the static image shown first (server-rendered or generated)
// that covers the container until the live wave has painted, then crossfades out.

const POSTER_ATTR = "data-wave3d-poster";

export interface Poster {
  readonly el: HTMLImageElement;
  /** Fade the poster to transparent over `fadeMs`, then hide it so it can't block the canvas. */
  fadeOut(fadeMs: number): void;
  /** Re-show the poster instantly (used when a live wave is torn down back to the fallback). */
  show(): void;
  /** Remove the poster element from the DOM. */
  remove(): void;
}

/** Make the container a positioning context so the absolutely-positioned poster overlays the canvas. */
export function ensurePositioned(container: HTMLElement): void {
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
}

/**
 * Create the poster image — or adopt an existing SSR `<img data-wave3d-poster>` already inside the
 * container (no hydration flash). Positioned to cover the container and sit above the canvas.
 * Returns null when there's neither a `src` nor an adoptable image (poster is optional).
 */
export function setupPoster(container: HTMLElement, src?: string): Poster | null {
  let img = container.querySelector<HTMLImageElement>(`img[${POSTER_ATTR}]`);
  if (!img && !src) return null;
  if (!img) {
    img = document.createElement("img");
    img.setAttribute(POSTER_ATTR, "");
    img.decoding = "async";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    container.appendChild(img);
  }
  if (src) img.src = src;
  Object.assign(img.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none", // clicks/scrolls pass through to the canvas beneath
    zIndex: "1", // above the WebGL canvas (which sits at the default z-order)
    opacity: "1",
    visibility: "visible",
  });
  const el = img;
  return {
    el,
    fadeOut(fadeMs) {
      if (fadeMs <= 0) {
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        return;
      }
      el.style.transition = `opacity ${fadeMs}ms ease`;
      void el.offsetWidth; // force a style flush so the transition runs from the current opacity (1)
      el.style.opacity = "0";
      // Hide after the fade so the (transparent) poster can never intercept anything; the timer is
      // rAF-independent so it still completes in a throttled/backgrounded tab.
      setTimeout(() => {
        el.style.visibility = "hidden";
      }, fadeMs + 50);
    },
    show() {
      el.style.transition = "";
      el.style.opacity = "1";
      el.style.visibility = "visible";
    },
    remove() {
      el.remove();
    },
  };
}
