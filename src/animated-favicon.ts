// Optional animated alternative to the static favicon configured in index.html.
import waveEmojiFramesUrl from "./assets/wave-emoji-frames.png";

const FAVICON_SIZE = 64;
const SOURCE_FRAME_SIZE = 128;
const FRAME_COLUMNS = 4;
const STATIC_FRAME = 8;
// Ease through the cycle by lingering at the trough and crest, then moving faster between them.
const FRAME_DURATIONS_MS = [
  120, 95, 85, 80, 75, 75, 80, 105, 125, 105, 80, 75, 75, 80, 95, 120,
] as const;

const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

if (favicon) {
  const waveFrames = new Image();
  waveFrames.decoding = "async";
  waveFrames.src = waveEmojiFramesUrl;

  void waveFrames
    .decode()
    .then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = FAVICON_SIZE;
      canvas.height = FAVICON_SIZE;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      let frame = 0;
      let frameElapsed = 0;
      let previousTime = 0;
      let animationFrame: number | undefined;

      const drawFrame = (): void => {
        const sourceX = (frame % FRAME_COLUMNS) * SOURCE_FRAME_SIZE;
        const sourceY = Math.floor(frame / FRAME_COLUMNS) * SOURCE_FRAME_SIZE;

        context.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
        context.drawImage(
          waveFrames,
          sourceX,
          sourceY,
          SOURCE_FRAME_SIZE,
          SOURCE_FRAME_SIZE,
          0,
          0,
          FAVICON_SIZE,
          FAVICON_SIZE,
        );

        favicon.type = "image/png";
        favicon.href = canvas.toDataURL("image/png");
      };

      const tick = (time: number): void => {
        if (previousTime === 0) previousTime = time;
        frameElapsed += Math.min(time - previousTime, 250);
        previousTime = time;

        let changed = false;
        while (frameElapsed >= FRAME_DURATIONS_MS[frame]) {
          frameElapsed -= FRAME_DURATIONS_MS[frame];
          frame = (frame + 1) % FRAME_DURATIONS_MS.length;
          changed = true;
        }
        if (changed) {
          drawFrame();
        }

        animationFrame = requestAnimationFrame(tick);
      };

      const syncPlayback = (): void => {
        if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
        previousTime = 0;

        if (document.visibilityState === "visible" && !motionPreference.matches) {
          animationFrame = requestAnimationFrame(tick);
        } else if (motionPreference.matches) {
          frame = STATIC_FRAME;
          frameElapsed = 0;
          drawFrame();
        }
      };

      document.addEventListener("visibilitychange", syncPlayback);
      motionPreference.addEventListener("change", syncPlayback);
      drawFrame();
      syncPlayback();
    })
    .catch(() => {
      // Keep the static first-frame favicon when the sprite cannot be decoded.
    });
}
