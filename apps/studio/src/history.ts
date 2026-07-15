/**
 * Undo/redo as a snapshot timeline. The whole document is one plain-JSON `StudioConfig`, so each
 * committed version is just a deep clone; restoring is handled by main.ts's existing `applyConfig`
 * path. This class owns only the timeline + cursor and the commit/coalescing bookkeeping — it has
 * no reference to the renderer or panel.
 *
 * Model: a linear list of `entries` with a `cursor` marking the current version. Editing while the
 * cursor is behind the tip truncates the forward (redo) branch. The floating history panel renders
 * `getState()` and jumps to any entry by its stable `id`.
 */
import type { StudioConfig, WaveConfig } from "@wave3d/core";

/** One committed version in the timeline. */
interface Entry {
  id: number;
  /** History-owned clone; the big media-URL strings are shared by reference (see historyClone). */
  config: StudioConfig;
  /** Cached fingerprint of `config`, so the no-op guard never re-serializes stored entries. */
  fingerprint: string;
  /** Human label shown in the history list (e.g. "hue shift", "Tasteful Randomize", "Hero"). */
  label: string;
  /** Preset-dropdown label to restore when this entry is applied (independent of `label`). */
  presetName: string;
  /** Date.now() at commit — the history list shows this as relative time. */
  time: number;
}

/** What a restore hands back to main.ts. */
export interface Restored {
  config: StudioConfig;
  presetName: string;
}

/** Snapshot of the timeline for the floating UI. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  entries: Array<{ id: number; label: string; time: number; current: boolean }>;
}

export interface HistoryDeps {
  /** Reads main.ts's live `config`. It is reassigned on every applyConfig — never capture it. */
  getLive: () => StudioConfig;
  /** Current preset-dropdown label, tagged onto a manual-edit commit. */
  getLabel: () => string;
  /** Fired whenever the timeline or cursor changes, so the UI can re-render. */
  onChange: () => void;
}

// The four large media-URL fields. They are only ever *reassigned* (never mutated in place) and
// strings are immutable, so history snapshots share them by reference — N snapshots keep one copy
// of a multi-MB data URL instead of N. They are also excluded from the no-op fingerprint so that
// comparing two states never re-serializes megabytes.
const SCENE_MEDIA = ["backgroundImageUrl", "backgroundVideoUrl"] as const;
const WAVE_MEDIA = ["paletteImageUrl", "paletteVideoUrl"] as const;
const MEDIA_KEYS = new Set<string>([...SCENE_MEDIA, ...WAVE_MEDIA]);

function historyClone(c: StudioConfig): StudioConfig {
  const clone = structuredClone(c);
  for (const k of SCENE_MEDIA) clone[k] = c[k];
  clone.waves.forEach((w, i) => {
    for (const k of WAVE_MEDIA) w[k] = c.waves[i][k];
  });
  return clone;
}

/** Structural fingerprint used for the no-op guard; ignores the big media strings (compared by
 *  reference separately) so it stays cheap even with embedded images/video. */
function fingerprint(c: StudioConfig): string {
  return JSON.stringify(c, (k, v) => (MEDIA_KEYS.has(k) ? undefined : v));
}

function mediaRefsEqual(a: StudioConfig, b: StudioConfig): boolean {
  if (a.backgroundImageUrl !== b.backgroundImageUrl) return false;
  if (a.backgroundVideoUrl !== b.backgroundVideoUrl) return false;
  if (a.waves.length !== b.waves.length) return false;
  return a.waves.every(
    (w, i) =>
      w.paletteImageUrl === b.waves[i].paletteImageUrl &&
      w.paletteVideoUrl === b.waves[i].paletteVideoUrl,
  );
}

// Friendlier names for the noisiest config keys; everything else is de-camelCased by `humanize`.
const FRIENDLY: Record<string, string> = {
  hueShift: "hue shift",
  colorContrast: "contrast",
  colorSaturation: "saturation",
  displaceAmount: "displacement",
  displaceFrequency: "displacement",
  fiberCount: "streak freq",
  fiberStrength: "streak strength",
  creaseLight: "crease light",
  noiseBands: "noise bands",
  dprMax: "pixel ratio",
  timeOffset: "noise phase",
  backgroundMode: "background",
  backgroundPalette: "background colors",
  backgroundGradientAngle: "background gradient",
  backgroundGradientType: "background gradient",
  palette: "colors",
  paletteEdgeColor: "palette edge",
  paletteEdgeAmount: "palette edge",
  meshGradientPoints: "gradient",
  meshGradientSoftness: "gradient",
  gradientAngle: "gradient",
  gradientType: "gradient",
  cameraZoom: "zoom",
  blendMode: "blend",
  twistFrequency: "twist",
  twistPower: "twist",
  lights: "lights",
};

function humanize(key: string): string {
  if (FRIENDLY[key]) return FRIENDLY[key];
  return key
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

function fieldChanged(a: unknown, b: unknown, key: string): boolean {
  // Media strings can be huge; compare them by reference rather than re-serializing.
  if (MEDIA_KEYS.has(key)) return a !== b;
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Best-effort label for a manual edit: name the first field that changed between two versions. */
function diffLabel(prev: StudioConfig, next: StudioConfig): string {
  for (const key of Object.keys(next) as (keyof StudioConfig)[]) {
    if (key === "waves" || key === "waveCount") continue;
    if (fieldChanged(prev[key], next[key], key)) return humanize(key);
  }
  if (prev.waves.length !== next.waves.length) {
    return next.waves.length > prev.waves.length ? "add wave" : "remove wave";
  }
  for (let i = 0; i < next.waves.length; i++) {
    const a = prev.waves[i];
    const b = next.waves[i];
    for (const key of Object.keys(b) as (keyof WaveConfig)[]) {
      if (fieldChanged(a[key], b[key], key)) {
        const name = humanize(key);
        return next.waves.length > 1 ? `wave ${i + 1} · ${name}` : name;
      }
    }
  }
  return "edit";
}

export class History {
  private entries: Entry[] = [];
  private cursor = -1;
  private nextId = 1;
  private dirty = false;
  private timer: number | undefined;
  /** The timeline captured by the last clear(), so it can be restored once via undoClear(). */
  private clearedSnapshot?: { entries: Entry[]; cursor: number };

  constructor(
    private readonly deps: HistoryDeps,
    private readonly cap = 80,
    private readonly delay = 350,
  ) {}

  /** Seed (or re-seed) the timeline with a single baseline entry — startup / shared-link load. */
  reset(config: StudioConfig, presetName: string, label = presetName): void {
    this.cancelTimer();
    this.dirty = false;
    this.entries = [this.makeEntry(config, label, presetName)];
    this.cursor = 0;
    this.deps.onChange();
  }

  /** Wipe the timeline back to a single baseline (keeping the live wave), remembering the old
   *  timeline so undoClear() can put it back once. Like reset(), but reversible. */
  clear(config: StudioConfig, presetName: string): void {
    this.clearedSnapshot = { entries: this.entries.slice(), cursor: this.cursor };
    this.reset(config, presetName);
  }

  /** Restore the timeline captured by the most recent clear() (the live wave is unchanged, so it
   *  still matches the restored cursor). No-op if there's nothing to restore. */
  undoClear(): boolean {
    const snap = this.clearedSnapshot;
    if (!snap) return false;
    this.clearedSnapshot = undefined;
    this.cancelTimer();
    this.dirty = false;
    this.entries = snap.entries.slice();
    this.cursor = snap.cursor;
    this.deps.onChange();
    return true;
  }

  /** Note that the live config changed; schedules a debounced commit (the coalescing backstop). */
  markDirty(): void {
    this.dirty = true;
    this.cancelTimer();
    this.timer = window.setTimeout(() => this.flush(), this.delay);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /** Commit any pending edit right now (no-op if nothing is dirty or nothing actually changed). */
  flush(): void {
    this.cancelTimer();
    if (this.dirty) this.commit(this.deps.getLive(), this.deps.getLabel());
  }

  /**
   * Record `live` as a new committed version. No-op (returns false) if it equals the current
   * entry. Truncates any forward/redo branch first. `label` is derived from a diff when omitted
   * (the manual-edit path); discrete actions pass an explicit label.
   */
  commit(live: StudioConfig, presetName: string, label?: string): boolean {
    this.cancelTimer();
    this.dirty = false;
    const cur = this.entries[this.cursor] as Entry | undefined;
    if (cur && fingerprint(live) === cur.fingerprint && mediaRefsEqual(live, cur.config)) {
      return false;
    }
    const finalLabel = label ?? (cur ? diffLabel(cur.config, live) : "edit");
    this.entries.length = this.cursor + 1; // drop the redo branch
    this.entries.push(this.makeEntry(live, finalLabel, presetName));
    this.cursor = this.entries.length - 1;
    while (this.entries.length > this.cap) {
      this.entries.shift();
      this.cursor--;
    }
    this.deps.onChange();
    return true;
  }

  undo(): Restored | null {
    if (this.cursor <= 0) return null;
    return this.goTo(this.cursor - 1);
  }

  redo(): Restored | null {
    if (this.cursor >= this.entries.length - 1) return null;
    return this.goTo(this.cursor + 1);
  }

  /** Jump to an entry by its stable id; safely no-ops if that id was truncated away. */
  jumpToId(id: number): Restored | null {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0 || i === this.cursor) return null;
    return this.goTo(i);
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  getState(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      entries: this.entries.map((e, i) => ({
        id: e.id,
        label: e.label,
        time: e.time,
        current: i === this.cursor,
      })),
    };
  }

  /** The stored config for an entry id (for rendering its thumbnail); null if the id is unknown. */
  getConfigById(id: number): StudioConfig | null {
    return this.entries.find((e) => e.id === id)?.config ?? null;
  }

  /** Cancel any pending debounce (teardown). */
  dispose(): void {
    this.cancelTimer();
  }

  private goTo(i: number): Restored {
    this.cursor = i;
    this.dirty = false;
    this.cancelTimer();
    this.deps.onChange();
    const e = this.entries[i];
    // Hand back a FRESH clone: applyConfig/ensureStudioConfig take ownership and mutate it in
    // place, so it must never alias the entry we keep in the timeline.
    return { config: historyClone(e.config), presetName: e.presetName };
  }

  private makeEntry(config: StudioConfig, label: string, presetName: string): Entry {
    const clone = historyClone(config);
    return {
      id: this.nextId++,
      config: clone,
      fingerprint: fingerprint(clone),
      label,
      presetName,
      time: Date.now(),
    };
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
