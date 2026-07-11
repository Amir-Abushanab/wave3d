import type { StudioConfig } from "@wave3d/core";
import { showToast } from "./ui/Toast";

const REPO = "Amir-Abushanab/wave3d";

/**
 * "Publish to gallery": copy a gallery submission (the current config, with title/handle
 * placeholders) to the clipboard and open GitHub's new-file page for gallery/waves/. The
 * contributor pastes it, fills in the title + their handle, and opens the PR.
 *
 * Copy-and-open rather than a prefilled `?value=` URL, because a full config overruns GitHub's URL
 * length limit. The clipboard write is kicked off before window.open so it runs while this document
 * still has focus (opening the new tab steals it).
 */
export function publishToGallery(config: StudioConfig): void {
  const submission = { title: "My wave", author: "your-github-handle", config };
  const json = JSON.stringify(submission, null, 2) + "\n";
  const url = `https://github.com/${REPO}/new/main?filename=gallery/waves/my-wave.json`;

  let copy: Promise<void> | undefined;
  try {
    copy = navigator.clipboard.writeText(json);
  } catch {
    copy = undefined;
  }
  window.open(url, "_blank", "noopener");

  // Custom images end up as data: URIs and the gallery validator rejects them; flag it here too.
  const note = /data:(image|video)\//i.test(json)
    ? " Note: custom images aren't allowed (the gallery is procedural). Switch to a built-in map."
    : "";
  const fail = (): void => {
    console.log(json);
    showToast({ message: "Couldn't copy the wave; its JSON is in the console." });
  };
  if (copy) {
    void copy.then(
      () =>
        showToast({
          message:
            "Wave copied. Paste it into the file, set your title + handle, then open the PR." +
            note,
          duration: 6500,
        }),
      fail,
    );
  } else {
    fail();
  }
}
