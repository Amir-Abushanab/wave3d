/**
 * Node type aliases for the TSL shader graphs.
 *
 * `three/webgpu` is imported for TYPES ONLY here. That import is erased at build time, so this
 * module stays out of the runtime graph — which matters: a single *value* import of `three/webgpu`
 * or `three/tsl` anywhere reachable from the package entry pulls the whole ~200 KB (gzipped) node
 * system into the eager bundle instead of the lazy backend chunk. `src/index.ts` keeps three out
 * the same way.
 */
import type { Node } from "three/webgpu";

export type FloatNode = Node<"float">;
export type Vec2Node = Node<"vec2">;
export type Vec3Node = Node<"vec3">;
export type Vec4Node = Node<"vec4">;
export type Mat4Node = Node<"mat4">;

export type UintNode = Node<"uint">;
export type UVec2Node = Node<"uvec2">;

/**
 * `floatBitsToUint` / `uintBitsToFloat` are typed as a bare `BitcastNode` in @types/three 0.185,
 * which declares none of the node operators (`.x`, `.sub`, `.toVar`, …) the runtime proxy actually
 * carries. These shims restore the real node type. Delete them once the upstream types catch up —
 * the runtime behaviour is already correct, this is purely a typings gap.
 */
export const asUVec2 = (n: unknown): UVec2Node => n as UVec2Node;
export const asFloat = (n: unknown): FloatNode => n as FloatNode;
