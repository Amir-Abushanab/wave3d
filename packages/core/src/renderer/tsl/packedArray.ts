/**
 * One uniform buffer holding every array-valued uniform.
 *
 * WebGPU caps `maxUniformBuffersPerShaderStage` at 12 by default, and TSL gives each
 * `uniformArray()` its OWN buffer. The wave's fragment stage needs eleven logical arrays (palette
 * stops, mesh points, lights, noise bands) which — with the scalar block and the pass bindings —
 * overruns that limit and fails pipeline creation outright:
 *
 *   GPUValidationError: The number of uniform buffers (13) in the Fragment stage exceeds the
 *   maximum per-stage limit (12).
 *
 * So all of them share a single `vec4` array, each logical array being a view over a slot range and
 * a component mask. The arrays are tiny (8/8/8/4 entries), so the whole thing is ~52 vec4s — well
 * inside any device's minimum buffer size.
 *
 * Crucially this is invisible above: each view still exposes the plain `value` array the renderer
 * writes (`u.uColors.value[i].set(...)`), and {@link PackedArrays.sync} folds those into the shared
 * slots once per frame. That keeps the ~116 config-sync writes in `refresh()` backend-agnostic.
 */
import { Vector4 } from "three";
import { uniformArray, int } from "three/tsl";
import type { FloatNode, Vec2Node, Vec3Node, Vec4Node } from "./types";

/** Which components of each slot a view occupies. Views sharing a slot must not overlap. */
type Mask = "x" | "y" | "z" | "w" | "xy" | "xyz" | "xyzw";

/** A single component, for scalar views. */
export type Component = "x" | "y" | "z" | "w";

interface Writable {
  write(slots: Vector4[]): void;
}

/** A view over a slot range: `value` is what the renderer mutates, `el(i)` is graph access. */
export interface PackedView<TValue, TNode> {
  value: TValue[];
  el: (i: unknown) => TNode;
}

export class PackedArrays {
  private readonly slots: Vector4[] = [];
  private readonly views: Writable[] = [];
  private node?: ReturnType<typeof uniformArray>;

  /** Reserve `count` slots and return their base index. Views over the same base share slots. */
  reserve(count: number): number {
    const base = this.slots.length;
    for (let i = 0; i < count; i++) this.slots.push(new Vector4());
    return base;
  }

  private element(base: number, i: unknown) {
    this.node ??= uniformArray(this.slots as never, "vec4");
    return this.node.element(int(i as never).add(base) as never);
  }

  private view<TValue, TNode>(
    base: number,
    count: number,
    mask: Mask,
    make: (i: number) => TValue,
    write: (slot: Vector4, v: TValue) => void,
  ): PackedView<TValue, TNode> {
    const value = Array.from({ length: count }, (_, i) => make(i));
    this.views.push({
      write: (slots) => {
        for (let i = 0; i < count; i++) write(slots[base + i], value[i]);
      },
    });
    return {
      value,
      el: (i) => {
        // Swizzling by a computed key is beyond what @types/three declares for the element node,
        // so the mask is applied through an indexed lookup — the runtime proxy handles it.
        const slot = this.element(base, i) as unknown as Record<string, unknown>;
        return (mask === "xyzw" ? slot : slot[mask]) as TNode;
      },
    };
  }

  /** A `vec3` view occupying `.xyz` of its slots. */
  vec3(base: number, count: number, make: (i: number) => Vec3Like) {
    return this.view<Vec3Like, Vec3Node>(base, count, "xyz", make, (s, v) =>
      s.set(v.x, v.y, v.z, s.w),
    );
  }

  /** A `vec2` view occupying `.xy` of its slots. */
  vec2(base: number, count: number, make: (i: number) => Vec2Like) {
    return this.view<Vec2Like, Vec2Node>(base, count, "xy", make, (s, v) =>
      s.set(v.x, v.y, s.z, s.w),
    );
  }

  /** A `vec4` view occupying whole slots. */
  vec4(base: number, count: number, make: (i: number) => Vector4) {
    return this.view<Vector4, Vec4Node>(base, count, "xyzw", make, (s, v) => s.copy(v));
  }

  /** A scalar view occupying one named component of its slots. */
  scalar(base: number, count: number, make: (i: number) => number, component: Component) {
    return this.view<number, FloatNode>(base, count, component, make, (s, v) => {
      s[component] = v;
    });
  }

  /** Fold every view's `value` array into the shared slots. Called once per frame before drawing. */
  sync(): void {
    for (const v of this.views) v.write(this.slots);
  }
}

interface Vec2Like {
  x: number;
  y: number;
}
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
