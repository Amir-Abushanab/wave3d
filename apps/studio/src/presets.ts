/**
 * The studio's preset list: the core presets (@wave3d/core/presets) plus the studio-only
 * One Piece / Spider-Man presets, in the user-visible dropdown/thumbnail order.
 */
import { PRESETS as CORE } from "@wave3d/core/presets";
import { PRESETS_EXTRA } from "./presets-extra";
import type { StudioConfig } from "@wave3d/core";

export const PRESETS: Record<string, () => StudioConfig> = {
  Hero: CORE["Hero"],
  "Wave 2": CORE["Wave 2"],
  "Wave 3": CORE["Wave 3"],
  "Wave 4": CORE["Wave 4"],
  Wireframe: CORE["Wireframe"],
  "Neon Dark Multistrand": CORE["Neon Dark Multistrand"],
  "Mesh Gradient": CORE["Mesh Gradient"],
  "Solar Bloom": CORE["Solar Bloom"],
  Holographic: CORE["Holographic"],
  Aurora: CORE["Aurora"],
  Palestine: CORE["Palestine"],
  "One Piece — Grand Line": PRESETS_EXTRA["One Piece — Grand Line"],
  "Spider-Man — Webbed City": PRESETS_EXTRA["Spider-Man — Webbed City"],
  "Vaporwave Sunset": CORE["Vaporwave Sunset"],
  Kaleidoscope: CORE["Kaleidoscope"],
};
