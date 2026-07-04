// Transient (Phase 1 only). The One Piece / Spider-Man presets in config/model.ts import IP
// images through Vite's `?inline` query (which returns a base64 data-URI). Phase 2 moves those
// presets and their assets to the studio, after which this declaration — and the assets — are
// removed from the core package, leaving it free of any Vite/asset coupling.
declare module "*.png?inline" {
  const src: string;
  export default src;
}
declare module "*.webp?inline" {
  const src: string;
  export default src;
}
declare module "*.svg?inline" {
  const src: string;
  export default src;
}
