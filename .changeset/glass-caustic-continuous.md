---
"@wave3d/core": patch
---

Glass: the caustic is continuous across the mesh. It was the Jacobian of the refraction taken from
screen-space derivatives of the interpolated normal — exact, but a different constant in every
triangle, and the fold's pole in `1/|det J|` amplified each jump into a visible cell. On a coarse or
heavily bent sheet the caustic drew the mesh: a lattice of squares stepping along every bright
ridge, at any `glassCaustic` above zero.

The geometry now bakes one ring of grid neighbours further out, the vertex stage builds the normal
at both neighbours as well as at the vertex, and the fragment gets `dN/du`, `dN/dv`, the two
tangents and where a unit uv step lands on screen — all interpolated, so continuous across shared
vertices. The caustic differentiates along those, chained through the inverse of the (u, v) → pixel
map, which is linear under the orthographic camera. Three more deformations per vertex, on glass
waves only. Parity, both backends: Liquid Glass `mae` 0.08 → 0.06, synthetic glass 0.23 → 0.21.
