/**
 * The TSL mirror of the particle material's own uniforms.
 *
 * Only the particle-specific ones live here. The SHAPE and POINTER uniforms are not copied at all
 * on this backend: the graph reads the owning wave's registry directly, so the dust rides the exact
 * same nodes the ribbon does. The GLSL path has to mirror those values across two materials every
 * frame (see `ParticleField.configure`), which is a sync step this backend simply does not have.
 */
import { Matrix4, Vector3 } from "three";
import { uniform } from "three/tsl";
import { floatUniform, type FloatUniform } from "./types";
import type { Mat4Node, Vec3Node } from "./types";

export type Vec3Uniform = Vec3Node & { value: Vector3 };
export type Mat4Uniform = Mat4Node & { value: Matrix4 };

const vec3Uniform = (x: number, y: number, z: number): Vec3Uniform =>
  uniform(new Vector3(x, y, z)) as unknown as Vec3Uniform;

/** Build one field's uniform registry. Defaults mirror the GLSL material's. */
export function makeParticleUniforms() {
  return {
    uTime: floatUniform(0),
    uLoopSeconds: floatUniform(0),
    uLife: floatUniform(6),
    uPartSpeed: floatUniform(1),
    uSize: floatUniform(2),
    uSizeJitter: floatUniform(0),
    uTwinkle: floatUniform(0),
    uColor: vec3Uniform(1, 0.81, 0.54),
    uColor2: vec3Uniform(1, 0.81, 0.54),
    uCenter: vec3Uniform(0, 0, 0),
    uRight: vec3Uniform(1, 0, 0),
    uUp: vec3Uniform(0, 1, 0),
    uDrift: floatUniform(0),
    uRise: floatUniform(0),
    uSwirl: floatUniform(0),
    uWander: floatUniform(0),
    uShape: floatUniform(0),
    /** The owning wave's matrixWorld: deformed LOCAL -> world. */
    uShedModel: uniform(new Matrix4()) as unknown as Mat4Uniform,
    uShedSpeed: floatUniform(0),
    uShedSeed: floatUniform(0),
    uPartShove: floatUniform(1),
  };
}

export type ParticleTslUniforms = ReturnType<typeof makeParticleUniforms> & {
  uPixelRatio?: FloatUniform;
};
