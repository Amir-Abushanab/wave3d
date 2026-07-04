// WebGL capability probe for the shell. Kept dependency-free (no three) so it can run before the
// heavy renderer chunk is fetched — the shell decides poster-vs-upgrade from this.

/**
 * Synchronously test whether the browser can give us a usable WebGL context. Uses
 * `failIfMajorPerformanceCaveat` so a software/blocklisted renderer (which would run the wave at a
 * slideshow framerate) reports as unavailable and we keep the poster. Releases the throwaway
 * context immediately via WEBGL_lose_context so probing doesn't consume one of the browser's ~16
 * live contexts.
 */
export function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const gl =
      canvas.getContext("webgl2", attrs) ??
      (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null);
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** True when the OS/browser is set to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True when the user has asked for reduced data usage (Save-Data / Data Saver). */
export function prefersReducedData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conn?.saveData === true;
}
