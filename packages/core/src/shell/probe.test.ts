import { describe, it, expect } from "vitest";
import { isSoftwareRenderer } from "./probe";

/** A stand-in for the bits of a GL context the probe touches. */
function fakeGl(renderer: string | null, opts: { extension?: boolean; throws?: boolean } = {}) {
  const { extension = true, throws = false } = opts;
  return {
    getExtension: () => {
      if (throws) throw new Error("blocked");
      return extension ? { UNMASKED_RENDERER_WEBGL: 37446 } : null;
    },
    getParameter: () => renderer,
  } as unknown as WebGLRenderingContext;
}

describe("isSoftwareRenderer", () => {
  it("recognises the rasterisers that actually show up", () => {
    for (const name of [
      "Google SwiftShader",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Mesa OffScreen",
      "Microsoft Basic Render Driver",
      "Apple Software Renderer",
    ]) {
      expect(isSoftwareRenderer(fakeGl(name)), name).toBe(true);
    }
  });

  it("leaves real hardware alone", () => {
    for (const name of [
      "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)",
      "NVIDIA GeForce RTX 4090/PCIe/SSE2",
      "ANGLE (AMD, AMD Radeon Pro 5500M, OpenGL 4.1)",
      "Intel(R) Iris(TM) Plus Graphics",
    ]) {
      expect(isSoftwareRenderer(fakeGl(name)), name).toBe(false);
    }
  });

  // The important half. A false positive here is invisible to the person it happens to: they get a
  // poster forever and have nothing to report, so "cannot tell" must never mean "software".
  it("assumes hardware whenever it cannot tell", () => {
    expect(isSoftwareRenderer(fakeGl(null, { extension: false }))).toBe(false); // privacy settings
    expect(isSoftwareRenderer(fakeGl(null))).toBe(false); // extension there, parameter empty
    expect(isSoftwareRenderer(fakeGl(""))).toBe(false);
    expect(isSoftwareRenderer(fakeGl("Google SwiftShader", { throws: true }))).toBe(false);
  });

  it("matches regardless of case", () => {
    expect(isSoftwareRenderer(fakeGl("GOOGLE SWIFTSHADER"))).toBe(true);
  });
});
