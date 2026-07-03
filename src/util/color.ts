/** Shared colour-string helpers. Dependency-free — safe to import from src/wave/* (the embed bundle). */

/** Normalize #rgb / #rrggbb(aa) to exactly "#rrggbb" (the only form <input type=color> accepts). */
export function toHex6(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${h.slice(0, 6).padEnd(6, "0")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = toHex6(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
