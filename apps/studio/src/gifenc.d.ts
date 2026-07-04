// Minimal ambient types for `gifenc` (the package ships no .d.ts). Covers only the
// subset we use: GIFEncoder + quantize + applyPalette.
declare module "gifenc" {
  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: number[][];
        delay?: number;
        transparent?: boolean;
        dispose?: number;
        repeat?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
  }
  export function GIFEncoder(options?: { auto?: boolean }): GifEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: "rgb565" | "rgb444" | "rgba4444";
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
