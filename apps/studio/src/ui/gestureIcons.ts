/**
 * Icons for the camera-controls cheatsheet.
 *
 * A mouse body with the relevant button filled in says "this button" faster than the words do,
 * which is the whole point of a hover cheatsheet. Inline SVG so nothing depends on an icon font
 * or the network, and `currentColor` throughout so they inherit the tooltip's ink.
 *
 * All drawn on a 16×16 grid at 16px. The fill on a mouse button is a full QUARTER of the body —
 * centre line out to the edge, down to where the buttons end. Anything smaller reads as a smudge
 * at this size rather than as a specific button.
 */

function svg(inner: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function mouse(inner: string): string {
  return svg(`<rect x="3.5" y="1.5" width="9" height="13" rx="4.5"/>${inner}`);
}

const LEFT_BUTTON =
  '<path d="M8 1.55v5.4H3.55V6A4.45 4.45 0 0 1 8 1.55Z" fill="currentColor" stroke="none"/>';
const RIGHT_BUTTON =
  '<path d="M8 1.55v5.4h4.45V6A4.45 4.45 0 0 0 8 1.55Z" fill="currentColor" stroke="none"/>';
const DIVIDER = '<path d="M3.6 6.95h8.8"/>';

export const GESTURE_ICONS = {
  /** Left button filled. */
  left: mouse(`${LEFT_BUTTON}${DIVIDER}`),
  /** Right button filled. */
  right: mouse(`${RIGHT_BUTTON}${DIVIDER}`),
  /** Scroll wheel filled, both buttons empty. */
  wheel: mouse(
    `${DIVIDER}<path d="M8 1.6v5.3"/><rect x="7.1" y="2.6" width="1.8" height="3.2" rx=".9" fill="currentColor" stroke="none"/>`,
  ),
  /** A four-way arrow cluster — the keyboard alternative. */
  keys: svg(
    '<path d="M8 2.2v11.6M2.2 8h11.6"/><path d="M6.3 3.9 8 2.2l1.7 1.7M6.3 12.1 8 13.8l1.7-1.7M3.9 6.3 2.2 8l1.7 1.7M12.1 6.3 13.8 8l-1.7 1.7"/>',
  ),
};
