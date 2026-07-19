// The `@wave3d/core/renderer` entry: the heavy renderer surface (imports three directly).
// Consumers that want the raw `WaveRenderer` — or the studio, which drives palette/hero canvases
// for its editor UI — reach for this instead of the lightweight `.` shell.
export * from "./WaveRenderer";
export * from "./palette";
export * from "./heroPalette";
