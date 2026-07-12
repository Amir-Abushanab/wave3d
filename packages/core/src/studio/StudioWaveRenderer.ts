// The studio's editor-enabled renderer: WaveRenderer + orbit/zoom/pan, the light & wave drag
// gizmos, and the camera-rig minimap. Lives in @wave3d/core/studio so the drop-in shell and the
// standalone build (which never edit) don't pay for ~1,000 lines of editor code. Every member here
// moved verbatim out of WaveRenderer; the base exposes exactly five protected hook points the
// overrides below plug into.
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { WaveRenderer, FRAME_W, FRAME_H, hexToLinearVec3 } from "../renderer/WaveRenderer";
import { createLight, DEFAULT_LIGHT_POSITION, MAX_LIGHTS } from "../config/model";
import type { LightConfig } from "../config/model";
import { roundTo } from "../util/math";

// The minimap's fixed 3/4 vantage direction.
const MINIMAP_VANTAGE = new THREE.Vector3(0.85, 0.6, 1).normalize();

export class StudioWaveRenderer extends WaveRenderer {
  /** Set while the panel drives the camera, so orbit's 'change' doesn't re-refresh the
   *  panel mid-drag (the panel already knows the new value). */
  private suppressCameraChange = false;

  // Same for the minimap, which renders every frame while the camera rig is open.
  private readonly miniBox = new THREE.Box3();
  private readonly miniSphere = new THREE.Sphere();
  private readonly miniTmpA = new THREE.Vector3();
  private readonly miniTmpB = new THREE.Vector3();
  private readonly miniPrevColor = new THREE.Color();
  private readonly miniSize = new THREE.Vector2();
  // Per-wave blend/transparent stash for the minimap's forced-opaque draw (index-parallel to waves).
  private readonly miniBlendPrev: THREE.Blending[] = [];
  private readonly miniTransPrev: boolean[] = [];

  // --- Camera-rig minimap (corner inset: the wave + a little camera/light marker) ---
  private cameraRigOn = false;
  private cameraRigCollapsed = false;
  private minimapCamera?: THREE.PerspectiveCamera;
  private camMarker?: THREE.Group;
  /** Gold markers in the minimap, one per rig light (positions/colours tracked live). */
  private minimapLights: THREE.Mesh[] = [];
  /** Shown in the rig when no light has been added yet, so the light is always visible there.
   *  Matches where "drag in 3D" creates the first light, so the marker doesn't jump when added. */
  private readonly defaultRigLight: LightConfig = createLight({ ...DEFAULT_LIGHT_POSITION }, 1);
  private minimapBtn?: HTMLButtonElement;

  // --- Camera controls (orbit/zoom/pan) + light-editing gizmo ---
  private readonly overlay = new THREE.Scene();
  private readonly raycaster = new THREE.Raycaster();
  private orbit?: OrbitControls;
  private transform?: TransformControls;
  /** Whether the main view orbit/zoom/pan is on (studio); off for the embed. */
  private mainOrbitOn = false;
  private lightHelpers: THREE.Mesh[] = [];
  /** Which 3D-editing gizmo is active: none, dragging lights, or dragging the wave/waves. */
  private editMode: "none" | "light" | "wave" = "none";
  private selectedLight = 0;
  /** Wave/wave drag handles: index 0 = the whole-wave box (moves config.position); 1..N =
   *  per-wave spheres (move each layer's offset), shown only when there's >1 wave. */
  private waveHelpers: THREE.Mesh[] = [];
  private selectedWave = 0;
  /** Gizmo operation: "translate" moves the handle, "rotate" spins the whole wave. */
  private gizmoMode: "translate" | "rotate" = "translate";
  /** Active free screen-plane drag of a handle (grab anywhere on the marker, camera locked). */
  private dragState?: { helper: THREE.Mesh; offset: THREE.Vector3 };
  private readonly dragPlane = new THREE.Plane();
  /** Active left-drag camera pan in edit mode (the press missed every handle → move the view). */
  private panState?: { lastNdc: THREE.Vector2 };
  /** Camera snapshot taken when entering a 3D-edit mode and restored verbatim on exit, so the
   *  view returns exactly where it was (position + ortho zoom + up) rather than snapping to the
   *  authored hero framing. */
  private returnCamera: {
    pos: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
    up: THREE.Vector3;
  } | null = null;

  /** Set by the panel: fired after a gizmo drag/selection so sliders can refresh. */
  onLightsChanged?: (selected: number) => void;
  /** Set by the panel: fired after orbit moves the camera so sliders can refresh. */
  onCameraChanged?: () => void;
  /** Set by the panel: fired after a wave/wave gizmo drag/selection so the position and
   *  per-wave offset sliders can refresh. */
  onWaveChanged?: () => void;

  // ---------------- 3D editing (draggable gizmo: lights or wave/waves) ----------------

  /** True while any drag-in-3D gizmo owns the camera (light or wave). */
  private get editing(): boolean {
    return this.editMode !== "none";
  }

  isLightEditMode(): boolean {
    return this.editMode === "light";
  }

  isWaveEditMode(): boolean {
    return this.editMode === "wave";
  }

  /** Toggle 3D light editing: show draggable light handles; off restores the prior view. */
  async setLightEditMode(on: boolean): Promise<void> {
    await this.setEditMode(on ? "light" : "none");
  }

  /** Toggle 3D wave/wave editing: drag the whole wave (and each wave when there's >1). */
  async setWaveEditMode(on: boolean): Promise<void> {
    await this.setEditMode(on ? "wave" : "none");
  }

  /** Enter/leave/switch a 3D-edit mode. Modes are mutually exclusive — turning one on turns
   *  the other off. The camera is snapshotted on the first entry and restored on the final exit
   *  (so light↔wave switches keep the same return view). */
  private async setEditMode(mode: "none" | "light" | "wave"): Promise<void> {
    if (mode === this.editMode) return;
    const prev = this.editMode;
    // Tear down the previous mode's handles + gizmo.
    if (prev !== "none") {
      if (this.transform) this.transform.enabled = false;
      this.transform?.detach();
      if (prev === "light") this.clearLightHelpers();
      else this.clearWaveHelpers();
    }
    this.editMode = mode;
    // Leaving LIGHT mode undoes its transient 3/4 framing (back to the pre-edit camera). Wave
    // editing never moves the camera, so there's nothing to restore when leaving it.
    if (prev === "light") this.restoreReturnCamera();
    if (mode === "none") {
      if (this.orbit) this.orbit.enabled = this.mainOrbitOn; // keep main-view orbit on
      this.setOrbitForEdit(false); // restore left-drag camera pan
      this.dragState = undefined;
      this.renderOnce();
      return;
    }
    await this.ensureGizmo();
    if (this.editMode !== mode) return; // toggled away while controls lazy-loaded
    if (this.orbit) this.orbit.enabled = true;
    this.setOrbitForEdit(true); // left-drag on a handle moves it; on empty space it pans
    this.gizmoMode = "translate"; // each mode entry starts in move mode (rotate is wave-only)
    this.transform?.setMode("translate");
    this.transform?.setSpace("world"); // reset to world-space translate on every entry
    if (this.transform) this.transform.enabled = true;
    if (mode === "light") {
      // Light editing reframes to a 3/4 working angle, so snapshot the current view first and
      // restore it on exit (the framing is transient, not part of the authored composition).
      this.captureReturnCamera();
      this.syncLightHelpers();
      this.frameEditCamera();
      this.selectLight(Math.min(this.selectedLight, Math.max(0, this.lightHelpers.length - 1)));
    } else {
      // Wave editing leaves the camera exactly where it is — no reframing, no zoom — so the view
      // stays put on enter AND exit; you pan/rotate/zoom normally to reach a handle and drag it.
      this.syncWaveHelpers();
      this.selectWaveHandle(Math.min(this.selectedWave, Math.max(0, this.waveHelpers.length - 1)));
    }
    this.renderOnce();
  }

  /** In edit mode, take PAN off OrbitControls' left button so left-drag is free to grab handles;
   *  onPointerDown/Move pan the camera manually when a left-press misses every handle (so panning
   *  never fights the object drag). Right-drag still rotates the camera; scroll/middle zooms. */
  private setOrbitForEdit(editing: boolean): void {
    if (!this.orbit) return;
    this.orbit.mouseButtons = editing
      ? { MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  }

  /** Switch the wave-edit gizmo between moving handles and rotating the whole wave. Rotate
   *  targets the whole-wave box (config.rotation), so selecting it makes the intent obvious. */
  setGizmoMode(mode: "translate" | "rotate"): void {
    this.gizmoMode = mode;
    this.transform?.setMode(mode);
    // Rotate in LOCAL space so the gizmo rings reorient with the wave — a visual read-out of its
    // current rotation; translate stays in world space so the arrows track the world axes.
    this.transform?.setSpace(mode === "rotate" ? "local" : "world");
    if (mode === "rotate" && this.editMode === "wave") {
      const waveIdx = this.waveHelpers.findIndex((h) => h.userData.kind === "wave");
      if (waveIdx >= 0) this.selectWaveHandle(waveIdx);
    }
    if (!this.running) this.renderOnce();
  }

  getGizmoMode(): "translate" | "rotate" {
    return this.gizmoMode;
  }

  /** Snapshot the live camera so leaving edit mode returns exactly here (incl. ortho zoom). */
  private captureReturnCamera(): void {
    this.returnCamera = {
      pos: this.camera.position.clone(),
      target: this.orbit
        ? this.orbit.target.clone()
        : this.camera.getWorldDirection(new THREE.Vector3()).add(this.camera.position),
      zoom: this.camera.zoom,
      up: this.camera.up.clone(),
    };
  }

  /** Restore the snapshot from captureReturnCamera (falls back to the authored hero camera). */
  private restoreReturnCamera(): void {
    const s = this.returnCamera;
    this.returnCamera = null;
    if (!s) {
      this.restoreHeroCamera();
      return;
    }
    this.camera.position.copy(s.pos);
    this.camera.up.copy(s.up);
    this.camera.zoom = s.zoom;
    this.camera.updateProjectionMatrix();
    if (this.orbit) {
      this.orbit.target.copy(s.target);
      this.orbit.update(); // fires onControlsChange → writes the restored view back to config
    } else {
      this.camera.lookAt(s.target);
    }
  }

  /** Turn on mouse/trackpad orbit + zoom + pan + arrow-key orbit (studio only). */
  async enableOrbit(): Promise<void> {
    this.mainOrbitOn = true;
    this.renderer.domElement.style.cursor = "move"; // 4-way move arrows: left-drag pans the view
    window.addEventListener("keydown", this.onKeyDown);
    await this.ensureOrbit();
    if (this.orbit && !this.editing) this.orbit.enabled = true;
  }

  /** Arrow keys orbit the camera around the target (←/→ azimuth, ↑/↓ elevation). */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.mainOrbitOn || !this.orbit || this.editing) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.closest("#panel") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // let the panel keep arrows
    const step = e.shiftKey ? 0.015 : 0.05;
    let az = 0;
    let pol = 0;
    if (e.key === "ArrowLeft") az = -step;
    else if (e.key === "ArrowRight") az = step;
    else if (e.key === "ArrowUp") pol = -step;
    else if (e.key === "ArrowDown") pol = step;
    else return;
    e.preventDefault();
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += az;
    sph.phi = THREE.MathUtils.clamp(sph.phi + pol, 0.05, Math.PI - 0.05);
    offset.setFromSpherical(sph);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update(); // fires 'change' → writes camera to config + renders
  };

  /** Reset the camera to the straight-on hero framing at the configured distance. */
  resetView(): void {
    this.camera.position.copy(this.homeCamPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.homeCamTarget);
    if (this.orbit) {
      this.orbit.target.copy(this.homeCamTarget);
      this.orbit.update();
    }
    this.writeCameraToConfig();
    this.onCameraChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Dolly/aim the camera so the whole wave fills the viewport (keeps the view angle).
   *  Fits the geometry box's actual *projected* screen extent — tighter than a bounding
   *  sphere for a flat, diagonal ribbon. */
  fitToView(): void {
    const box = new THREE.Box3();
    for (const s of this.waves) {
      s.mesh.updateWorldMatrix(true, false);
      if (!s.mesh.geometry.boundingBox) s.mesh.geometry.computeBoundingBox();
      const bb = s.mesh.geometry.boundingBox;
      if (bb) box.union(bb.clone().applyMatrix4(s.mesh.matrixWorld));
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());

    // Aim at the centre, then measure how much of the viewport the box spans (in NDC).
    if (this.orbit) this.orbit.target.copy(center);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    const c = box.min,
      m = box.max;
    let frac = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? m.x : c.x, i & 2 ? m.y : c.y, i & 4 ? m.z : c.z).project(this.camera);
      frac = Math.max(frac, Math.abs(v.x), Math.abs(v.y)); // |ndc| 0→1 = half-viewport
    }
    // Overfill slightly (>1): the folded geometry's bounding box has empty diagonal
    // corners, so filling past the box edges lets the actual ribbon fill the frame.
    // Ortho: framing is the zoom, not the distance.
    const target = 1.18;
    this.config.cameraZoom = ((this.config.cameraZoom ?? 1) * target) / Math.max(0.001, frac);
    this.applyZoom();
    if (this.orbit) this.orbit.update();
    this.writeCameraToConfig();
    this.onCameraChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Dolly the camera to a distance from the orbit target (or set z when no orbit). */
  setCameraDistance(d: number): void {
    if (this.orbit) {
      const dir = this.camera.position.clone().sub(this.orbit.target);
      const len = dir.length() || 1;
      this.camera.position.copy(this.orbit.target).addScaledVector(dir.multiplyScalar(1 / len), d);
      this.orbit.update();
    } else {
      this.camera.position.z = d;
    }
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** The current look-at target (orbit's if present, else from config). */
  private camTarget(): THREE.Vector3 {
    if (this.orbit) return this.orbit.target;
    const t = this.config.cameraTarget;
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Read the camera as orbit values for the panel (angles in degrees). */
  getCameraOrbit(): {
    azimuth: number;
    elevation: number;
    distance: number;
    panX: number;
    panY: number;
  } {
    const t = this.camTarget();
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t));
    return {
      azimuth: THREE.MathUtils.radToDeg(sph.theta),
      elevation: 90 - THREE.MathUtils.radToDeg(sph.phi),
      distance: sph.radius,
      panX: t.x,
      panY: t.y,
    };
  }

  /** Place the camera at azimuth/elevation (degrees) + distance around the target. */
  setCameraOrbit(azimuthDeg: number, elevationDeg: number, distance: number): void {
    const target = this.camTarget();
    const sph = new THREE.Spherical(
      Math.max(0.01, distance),
      THREE.MathUtils.degToRad(90 - elevationDeg),
      THREE.MathUtils.degToRad(azimuthDeg),
    );
    sph.makeSafe();
    this.suppressCameraChange = true;
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (this.orbit) this.orbit.update();
    this.suppressCameraChange = false;
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** Roll the camera around its view axis (degrees) — tilts the composition without
   *  moving the camera. Applied after positioning; reset by any orbit interaction. */
  rollView(deg: number): void {
    this.camera.rotateZ(THREE.MathUtils.degToRad(deg));
    this.camera.updateMatrixWorld();
    if (!this.running) this.renderOnce();
  }

  /** Pan: move the look-at target (and camera with it) to (x, y) in world units. */
  setCameraTarget(x: number, y: number): void {
    const target = this.camTarget();
    const delta = new THREE.Vector3(x - target.x, y - target.y, 0);
    this.suppressCameraChange = true;
    this.camera.position.add(delta);
    if (this.orbit) this.orbit.target.add(delta);
    else this.config.cameraTarget = { x, y, z: target.z };
    this.camera.lookAt(this.camTarget());
    if (this.orbit) this.orbit.update();
    this.suppressCameraChange = false;
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** Ortho zoom MULTIPLIER (the camera has no real fov). 1 = the responsive base framing (the hero crop). */
  getZoom(): number {
    return this.config.cameraZoom ?? 1;
  }

  setZoom(zoom: number): void {
    this.config.cameraZoom = THREE.MathUtils.clamp(zoom, 0.1, 6);
    this.applyZoom();
    if (!this.running) this.renderOnce();
  }

  /** Studio-only scroll preview (the studio page doesn't scroll): override the `scroll` source with
   *  a fixed 0..1 value, or pass null to return to the live container-progress read. NEVER touches
   *  config. No-op until interaction is enabled (the controller exists). */
  setScrollPreview(v: number | null): void {
    if (this.interaction) this.interaction.scrollOverride = v;
    if (!this.running) this.renderOnce();
  }

  duplicateOffset(): { x: number; y: number; z: number } {
    this.camera.updateMatrixWorld();
    const worldW = (this.camera.right - this.camera.left) / this.camera.zoom; // visible world span
    const worldH = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    // Screen-left ~40% + screen-down ~15% of the frame: enough to clearly separate the copy, small
    // enough that a few successive adds cascade diagonally and stay on-screen before running off.
    const off = right.multiplyScalar(-0.4 * worldW).add(up.multiplyScalar(-0.15 * worldH));
    return { x: off.x, y: off.y, z: 0 };
  }

  /** Toggle the corner camera-rig minimap (studio aid; off in the embed). */
  setCameraRig(on: boolean): void {
    this.cameraRigOn = on;
    if (on) this.ensureMinimap();
    if (this.minimapBtn) this.minimapBtn.style.display = on ? "" : "none";
    if (on) this.positionMinimapBtn();
    if (!this.running) this.renderOnce();
  }

  /** Corner rectangle (logical px) for the minimap viewport. */
  private minimapRect(): { x: number; y: number; size: number; pad: number } {
    const sz = this.renderer.getSize(new THREE.Vector2());
    const size = Math.round(Math.min(sz.x, sz.y) * 0.27);
    const pad = Math.round(size * 0.06);
    return { x: sz.x - size - pad, y: pad, size, pad };
  }

  /** Place the collapse button at the minimap's top-right (or bottom corner when collapsed). */
  private positionMinimapBtn(): void {
    const b = this.minimapBtn;
    if (!b) return;
    const { size, pad } = this.minimapRect();
    // minimapRect() is in renderer BUFFER px (= the export size); the canvas is CSS-scaled to
    // fill the container, so convert to on-screen px or the button detaches from the minimap.
    const canvas = this.renderer.domElement;
    const buf = this.renderer.getSize(new THREE.Vector2());
    const sx = buf.x > 0 ? canvas.clientWidth / buf.x : 1;
    const sy = buf.y > 0 ? canvas.clientHeight / buf.y : 1;
    b.style.right = pad * sx + "px";
    b.style.bottom = (this.cameraRigCollapsed ? pad * sy : (pad + size) * sy - 22) + "px";
    b.textContent = this.cameraRigCollapsed ? "▴ camera" : "▾ camera";
  }

  /** Build the minimap's fixed 3rd-person camera + the camera/light markers (once). */
  private ensureMinimap(): void {
    if (this.minimapCamera) return;
    // Pose/near/far are recomputed every frame by frameMinimap() to fit the current scene
    // (the wave sits in a ×10 ortho world, so a fixed vantage can't frame it).
    this.minimapCamera = new THREE.PerspectiveCamera(42, 1, 1, 10000);

    // A little camera (body + lens) marking where the main camera views the wave from.
    const marker = new THREE.Group();
    marker.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 2.4, 4.2),
        new THREE.MeshBasicMaterial({ color: 0x2a2f3d }),
      ),
    );
    const lens = new THREE.Mesh(
      new THREE.ConeGeometry(1.3, 2.4, 18),
      new THREE.MeshBasicMaterial({ color: 0x6ea8fe }),
    );
    lens.rotation.x = -Math.PI / 2; // cone points -Z (the camera's forward)
    lens.position.z = -2.7;
    marker.add(lens);
    marker.visible = false;
    this.scene.add(marker);
    this.camMarker = marker;

    // Collapse/expand toggle overlaid on the minimap corner.
    const btn = document.createElement("button");
    btn.style.cssText =
      "position:absolute;z-index:30;padding:2px 8px;border-radius:5px;cursor:pointer;" +
      "font:11px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#cdd0d6;" +
      "background:rgba(18,18,26,0.85);border:1px solid rgba(255,255,255,0.16);";
    btn.addEventListener("click", () => {
      this.cameraRigCollapsed = !this.cameraRigCollapsed;
      this.positionMinimapBtn();
      this.renderOnce();
    });
    this.container.appendChild(btn);
    this.minimapBtn = btn;
    this.positionMinimapBtn();
  }

  /** The lights the rig should show: the configured lights, or a single default-position
   *  marker when none has been added yet — so the light is always visible in the rig. */
  private rigLights(): LightConfig[] {
    const lights = this.config.lights ?? [];
    return lights.length ? lights : [this.defaultRigLight];
  }

  /** Reconcile the minimap's light markers with the rig lights (count, position, colour). */
  private syncMinimapLights(visible: boolean): void {
    const lights = this.rigLights();
    while (this.minimapLights.length < lights.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd24a }),
      );
      m.visible = false;
      this.scene.add(m);
      this.minimapLights.push(m);
    }
    while (this.minimapLights.length > lights.length) {
      const m = this.minimapLights.pop();
      if (!m) break;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    lights.forEach((l, i) => {
      const m = this.minimapLights[i];
      m.position.set(l.position.x, l.position.y, l.position.z);
      (m.material as THREE.MeshBasicMaterial).color.set(l.color); // track the light's colour
      m.visible = visible;
    });
  }

  /** Fit the minimap's 3rd-person camera to the wave (+ lights) and size/place the camera
   *  proxy, so the rig reads at any scene scale. The main camera is orthographic — its literal
   *  distance is arbitrary — so the proxy sits a fixed multiple of the scene radius back along
   *  the true view direction rather than at the far-away ortho position. */
  private frameMinimap(): void {
    const cam = this.minimapCamera;
    const marker = this.camMarker;
    if (!cam || !marker) return;
    const box = this.miniBox.setFromObject(this.group);
    if (box.isEmpty()) return; // geometry not built yet
    for (const l of this.rigLights()) {
      box.expandByPoint(this.miniTmpA.set(l.position.x, l.position.y, l.position.z));
    }
    const subject = box.getBoundingSphere(this.miniSphere);
    const radius = Math.max(subject.radius, 1);

    // Point the little camera at the wave from its real view direction, kept a sane distance
    // away (using the ortho camera's actual z would push it thousands of units off and dwarf
    // the wave).
    const viewDir = this.camera.getWorldDirection(this.miniTmpA); // points toward the wave
    const markerPos = this.miniTmpB.copy(subject.center).addScaledVector(viewDir, -radius * 1.5);
    marker.position.copy(markerPos);
    marker.quaternion.copy(this.camera.quaternion);
    marker.scale.setScalar(radius * 0.05);
    for (const m of this.minimapLights) m.scale.setScalar(radius * 0.045);

    // Frame the whole rig (wave + proxy) from a fixed 3/4 vantage. (`rig` reuses the sphere
    // behind `subject`, which has no readers past this point.)
    box.expandByPoint(markerPos);
    const rig = box.getBoundingSphere(this.miniSphere);
    const frameR = Math.max(rig.radius, 1);
    cam.position.copy(rig.center).addScaledVector(MINIMAP_VANTAGE, frameR * 2.9);
    cam.near = Math.max(1, frameR * 0.02);
    cam.far = frameR * 10;
    cam.up.set(0, 1, 0);
    cam.lookAt(rig.center);
    cam.updateProjectionMatrix();
  }

  /** Draw the camera-rig minimap into a corner viewport (called after the main render). */
  private renderMinimap(): void {
    if (!this.cameraRigOn || this.cameraRigCollapsed || !this.mainOrbitOn || this.capturing) return;
    if (!this.minimapCamera || !this.camMarker) return;
    // setViewport/setScissor take LOGICAL (CSS) pixels — three applies pixelRatio itself.
    const { x, y, size } = this.minimapRect();

    this.camMarker.visible = true;
    this.syncMinimapLights(true);
    this.frameMinimap();

    const r = this.renderer;
    const prevColor = this.miniPrevColor;
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setRenderTarget(null); // draw to the screen — NOT a leftover composer buffer
    r.setScissorTest(true);
    r.setViewport(x, y, size, size);
    r.setScissor(x, y, size, size);
    r.setClearColor(0x12121a, 0.92);
    r.clear(true, true);
    // scene.background (the wave's page colour / image / gradient) fills ANY camera's view, so
    // hide it while drawing the minimap — otherwise it covers the 3rd-person wave.
    const prevBg = this.scene.background;
    this.scene.background = null;
    // The wave's own blend mode (additive for the neon / Spider-Man presets) makes it vanish on
    // the dark minimap backdrop; force opaque normal blending just for this draw so the shape
    // always reads. The main render already happened, so we restore immediately after.
    for (let i = 0; i < this.waves.length; i++) {
      const m = this.waves[i].material;
      this.miniBlendPrev[i] = m.blending;
      this.miniTransPrev[i] = m.transparent;
      m.blending = THREE.NormalBlending;
      m.transparent = false;
    }
    r.render(this.scene, this.minimapCamera);
    for (let i = 0; i < this.waves.length; i++) {
      const m = this.waves[i].material;
      m.blending = this.miniBlendPrev[i];
      m.transparent = this.miniTransPrev[i];
    }
    this.scene.background = prevBg;
    r.setScissorTest(false);
    const full = this.renderer.getSize(this.miniSize);
    r.setViewport(0, 0, full.x, full.y);
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = true;

    this.camMarker.visible = false;
    for (const m of this.minimapLights) m.visible = false;
  }

  private async ensureOrbit(): Promise<void> {
    if (this.orbit) return;
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    if (this.orbit) return; // a concurrent call already set it up
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.enabled = false; // enabled by enableOrbit() / light-edit
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.minDistance = 12;
    this.orbit.maxDistance = 600;
    // Left drag PANS (moves the view around); right drag ROTATES — swapped from the
    // OrbitControls default so the primary drag moves the scene rather than orbiting it.
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbit.target.set(
      this.config.cameraTarget.x,
      this.config.cameraTarget.y,
      this.config.cameraTarget.z,
    );
    this.orbit.update();
    this.orbit.addEventListener("change", this.onControlsChange);
    // Cursor feedback by drag type: left-drag pans → 4-way move arrows; right-drag rotates →
    // grab/closed-hand. Idle stays on the move arrows (the primary drag pans). OrbitControls
    // doesn't expose the button, so we read it from pointerdown directly.
    this.renderer.domElement.addEventListener("pointerdown", this.onCursorDown);
    window.addEventListener("pointerup", this.onCursorUp);
  }

  private onCursorDown = (e: PointerEvent): void => {
    if (this.mainOrbitOn) {
      this.renderer.domElement.style.cursor = e.button === 2 ? "grabbing" : "move";
    }
  };

  private onCursorUp = (): void => {
    if (this.mainOrbitOn) this.renderer.domElement.style.cursor = "move";
  };

  private async ensureGizmo(): Promise<void> {
    await this.ensureOrbit();
    if (this.transform) return;
    const { TransformControls } = await import("three/addons/controls/TransformControls.js");
    if (this.transform) return; // a concurrent call already set it up
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.addEventListener("dragging-changed", (e) => {
      if (this.orbit) this.orbit.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.transform.addEventListener("objectChange", this.onGizmoMoved);
    // (onGizmoMoved routes to the light- or wave-drag handler based on the active mode.)
    this.transform.addEventListener("change", this.onControlsChange);
    const tc = this.transform as unknown as { getHelper?: () => THREE.Object3D };
    this.overlay.add(tc.getHelper ? tc.getHelper() : (this.transform as unknown as THREE.Object3D));

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerUp);
  }

  private onControlsChange = (): void => {
    // Orbit/zoom/pan moved the camera → capture it so exports match the view. Wave editing keeps
    // the live view (persist it); light editing uses a transient 3/4 working view (don't persist).
    if (
      this.orbit &&
      this.orbit.enabled &&
      this.editMode !== "light" &&
      !this.suppressCameraChange
    ) {
      this.writeCameraToConfig();
      this.onCameraChanged?.();
    }
    if (!this.running) this.renderOnce();
  };

  /** Persist the live camera (position/target/distance) into the config. */
  private writeCameraToConfig(): void {
    const p = this.camera.position;
    this.config.cameraPosition = {
      x: roundTo(p.x, 3),
      y: roundTo(p.y, 3),
      z: roundTo(p.z, 3),
    };
    // Capture the LIVE ortho zoom (mouse-scroll changes camera.zoom directly) back into
    // config.cameraZoom — the user multiplier — by inverting applyZoom's responsive COVER
    // factor. Without this, scroll-zoom changed the view but was never saved/exported, so a
    // framing tuned at a scrolled zoom didn't reproduce (its pan made sense only at that zoom).
    const cover = Math.max(
      (this.camera.right - this.camera.left) / FRAME_W,
      (this.camera.top - this.camera.bottom) / FRAME_H,
    );
    if (cover > 0) this.config.cameraZoom = roundTo(this.camera.zoom / cover, 3);
    if (this.orbit) {
      const t = this.orbit.target;
      this.config.cameraTarget = {
        x: roundTo(t.x, 3),
        y: roundTo(t.y, 3),
        z: roundTo(t.z, 3),
      };
      this.config.cameraDistance = roundTo(p.distanceTo(this.orbit.target), 3);
    }
  }

  /** Pointer position in normalized device coords (-1..1), from a canvas-relative event. */
  private pointerNdc(ev: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.editing || !this.transform) return;
    if (ev.button !== 0) return; // only left-drag moves objects; right-drag rotates the camera
    if (this.transform.dragging || this.transform.axis) return; // on a gizmo handle → let it move
    this.raycaster.setFromCamera(this.pointerNdc(ev), this.camera);
    const helpers = this.editMode === "wave" ? this.waveHelpers : this.lightHelpers;
    const hit = this.raycaster.intersectObjects(helpers, false)[0];
    if (!hit) {
      // Missed every handle → pan the view (the tool's normal left-drag). OrbitControls' LEFT is
      // unmapped in edit mode, so onPointerMove pans manually without fighting the object drag.
      if (this.orbit) {
        this.panState = { lastNdc: this.pointerNdc(ev) };
        this.renderer.domElement.setPointerCapture?.(ev.pointerId);
      }
      return;
    }
    const idx = helpers.indexOf(hit.object as THREE.Mesh);
    if (idx < 0) return;
    if (this.editMode === "wave") this.selectWaveHandle(idx);
    else this.selectLight(idx);
    // Free screen-plane drag: the WHOLE marker is grabbable (not just the thin gizmo arrows) and
    // the camera stays locked. Rotate mode uses the gizmo's rings instead, so skip it there.
    if (this.gizmoMode !== "translate") return;
    const helper = helpers[idx];
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, helper.position);
    const grab = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, grab)) return;
    this.dragState = { helper, offset: helper.position.clone().sub(grab) };
    if (this.orbit) this.orbit.enabled = false; // lock the camera for the whole drag
    this.renderer.domElement.setPointerCapture?.(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.panState) {
      // Ortho pan: unproject the pointer delta into world units (auto-handles zoom/aspect/dpr),
      // then shift camera + orbit target together so the grabbed point tracks the cursor.
      const ndc = this.pointerNdc(ev);
      const before = new THREE.Vector3(this.panState.lastNdc.x, this.panState.lastNdc.y, 0);
      const after = new THREE.Vector3(ndc.x, ndc.y, 0);
      const delta = before.unproject(this.camera).sub(after.unproject(this.camera)); // opposite the cursor
      this.camera.position.add(delta);
      this.panState.lastNdc = ndc;
      if (this.orbit) {
        this.orbit.target.add(delta);
        this.orbit.update(); // fires 'change' → persists the new framing + renders
      } else {
        this.camera.updateProjectionMatrix();
        if (!this.running) this.renderOnce();
      }
      return;
    }
    if (!this.dragState) return;
    this.raycaster.setFromCamera(this.pointerNdc(ev), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return;
    this.dragState.helper.position.copy(p.add(this.dragState.offset));
    this.onGizmoMoved(); // write the new position into config + uniforms
    if (!this.running) this.renderOnce();
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.panState) {
      this.panState = undefined;
      this.renderer.domElement.releasePointerCapture?.(ev.pointerId);
      return;
    }
    if (!this.dragState) return;
    this.dragState = undefined;
    if (this.orbit) this.orbit.enabled = true; // still editing → keep right-drag camera rotate
    this.renderer.domElement.releasePointerCapture?.(ev.pointerId);
  };

  private selectLight(i: number): void {
    this.selectedLight = i;
    const h = this.lightHelpers[i];
    if (h && this.transform) this.transform.attach(h);
    else this.transform?.detach();
    this.onLightsChanged?.(i);
    if (!this.running) this.renderOnce();
  }

  private selectWaveHandle(i: number): void {
    this.selectedWave = i;
    const h = this.waveHelpers[i];
    if (h && this.transform) this.transform.attach(h);
    else this.transform?.detach();
    this.onWaveChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Gizmo drag → route to the active mode's writer. */
  private onGizmoMoved = (): void => {
    if (this.editMode === "wave") this.onWaveGizmoMoved();
    else this.onLightGizmoMoved();
  };

  /** Light gizmo drag → write the moved handle back into the config + uniforms. */
  private onLightGizmoMoved(): void {
    const h = this.lightHelpers[this.selectedLight];
    const light = this.config.lights?.[this.selectedLight];
    if (!h || !light) return;
    light.position.x = roundTo(h.position.x, 2);
    light.position.y = roundTo(h.position.y, 2);
    light.position.z = roundTo(h.position.z, 2);
    this.pushLightUniforms();
    this.onLightsChanged?.(this.selectedLight);
  }

  /** Wave gizmo drag → the whole-wave box writes config.position (and the wave handles
   *  follow it); a per-wave sphere writes that layer's offset (relative to config.position). */
  private onWaveGizmoMoved(): void {
    const h = this.waveHelpers[this.selectedWave];
    if (!h) return;
    const wave = this.config.waves[h.userData.index as number];
    if (!wave) return;
    // Mutate the wave's vectors IN PLACE (don't reassign a new object): the panel's Transform
    // sliders hold a reference to these objects, so replacing them would leave the sliders
    // reading the stale old object even though the wave moved.
    if (this.gizmoMode === "rotate") {
      wave.rotation.x = roundTo(THREE.MathUtils.radToDeg(h.rotation.x), 2);
      wave.rotation.y = roundTo(THREE.MathUtils.radToDeg(h.rotation.y), 2);
      wave.rotation.z = roundTo(THREE.MathUtils.radToDeg(h.rotation.z), 2);
    } else {
      wave.position.x = roundTo(h.position.x, 2);
      wave.position.y = roundTo(h.position.y, 2);
      wave.position.z = roundTo(h.position.z, 2);
    }
    this.pushWaveTransforms();
    this.onWaveChanged?.();
  }

  /** Reconcile the helper spheres with config.lights (count, position, colour). */
  private syncLightHelpers(): void {
    const lights = this.config.lights ?? [];
    while (this.lightHelpers.length < lights.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      );
      mesh.renderOrder = 999;
      this.overlay.add(mesh);
      this.lightHelpers.push(mesh);
    }
    while (this.lightHelpers.length > lights.length) {
      const mesh = this.lightHelpers.pop();
      if (!mesh) break;
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    lights.forEach((l, i) => {
      const h = this.lightHelpers[i];
      h.position.set(l.position.x, l.position.y, l.position.z);
      (h.material as THREE.MeshBasicMaterial).color.set(l.color);
    });
    if (this.selectedLight >= this.lightHelpers.length) {
      this.selectedLight = Math.max(0, this.lightHelpers.length - 1);
    }
    const sel = this.lightHelpers[this.selectedLight];
    if (sel && this.transform && this.transform.object !== sel) this.transform.attach(sel);
    if (!sel) this.transform?.detach();
  }

  private clearLightHelpers(): void {
    for (const mesh of this.lightHelpers) {
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.lightHelpers = [];
  }

  /** Reconcile the wave drag handles with config: one box handle per wave, sitting at that
   *  wave's absolute position (and oriented to its rotation so the rotate gizmo starts there). */
  private syncWaveHelpers(): void {
    if (this.transform?.dragging) return; // don't yank a handle out from under an active drag
    const waves = this.config.waves ?? [];
    const wantTotal = waves.length;
    if (this.waveHelpers.length !== wantTotal) {
      this.clearWaveHelpers();
      for (let i = 0; i < wantTotal; i++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.55, 0.55),
          new THREE.MeshBasicMaterial({ color: 0x39d0ff, depthTest: false, transparent: true }),
        );
        box.renderOrder = 999;
        box.userData = { kind: "wave", index: i };
        this.overlay.add(box);
        this.waveHelpers.push(box);
      }
    }
    for (const h of this.waveHelpers) {
      const sc = waves[h.userData.index as number];
      if (!sc) continue;
      h.position.set(sc.position.x, sc.position.y, sc.position.z);
      h.rotation.set(
        THREE.MathUtils.degToRad(sc.rotation.x),
        THREE.MathUtils.degToRad(sc.rotation.y),
        THREE.MathUtils.degToRad(sc.rotation.z),
      );
    }
    if (this.selectedWave >= this.waveHelpers.length) this.selectedWave = 0;
    const sel = this.waveHelpers[this.selectedWave];
    if (sel && this.transform && this.transform.object !== sel) this.transform.attach(sel);
    if (!sel) this.transform?.detach();
  }

  private clearWaveHelpers(): void {
    for (const mesh of this.waveHelpers) {
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.waveHelpers = [];
  }

  /** Reposition just the wave MESHES from each wave's absolute transform — the transform
   *  subset of refresh(), used live during a wave gizmo drag so the ribbon follows without a
   *  full uniform re-push or a helper resync. */
  private pushWaveTransforms(): void {
    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      wave.mesh.scale.set(sc.scale.x, sc.scale.y, sc.scale.z);
      wave.mesh.rotation.set(
        THREE.MathUtils.degToRad(sc.rotation.x),
        THREE.MathUtils.degToRad(sc.rotation.y),
        THREE.MathUtils.degToRad(sc.rotation.z),
      );
      wave.mesh.position.set(sc.position.x, sc.position.y, sc.position.z);
    });
    if (!this.running) this.renderOnce();
  }

  /** Pull the camera back to a 3/4 angle that frames the edit target: the origin wave + all
   *  lights (light mode), or a region around config.position + the handles (wave mode). */
  private frameEditCamera(): void {
    const box = new THREE.Box3();
    if (this.editMode === "wave") {
      // The wave can sit far from the origin (some presets push position to the hundreds), so
      // frame around it — a ~200-unit margin shows a good chunk of the ×10-scaled ribbon.
      const target = this.config.waves[this.selectedWave] ?? this.config.waves[0];
      const c = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
      box.expandByPoint(c.clone().addScalar(200));
      box.expandByPoint(c.clone().addScalar(-200));
      for (const h of this.waveHelpers) box.expandByPoint(h.position);
    } else {
      // The baked + scaled wave spans ~±25 units; frame that plus any lights.
      box.expandByPoint(new THREE.Vector3(25, 25, 25));
      box.expandByPoint(new THREE.Vector3(-25, -25, -25));
      for (const l of this.config.lights ?? []) {
        box.expandByPoint(new THREE.Vector3(l.position.x, l.position.y, l.position.z));
      }
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 2);
    const dir = new THREE.Vector3(0.45, 0.35, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, radius * 3 + 200);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(sphere.center);
    // Ortho: frame by zoom (frustum is in px), not distance.
    this.camera.zoom = (this.camera.right - this.camera.left) / Math.max(1, radius * 2.6);
    this.camera.updateProjectionMatrix();
    if (this.orbit) {
      this.orbit.target.copy(sphere.center);
      this.orbit.update();
    }
  }

  /** Restore the authored camera (from config) — used when leaving light-edit. */
  private restoreHeroCamera(): void {
    const p = this.config.cameraPosition;
    const t = this.config.cameraTarget;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t.x, t.y, t.z);
    if (this.orbit) {
      this.orbit.target.set(t.x, t.y, t.z);
      this.orbit.update();
    }
  }

  /** Push only the light uniforms (used live during a gizmo drag). */
  private pushLightUniforms(): void {
    const lights = this.config.lights ?? [];
    for (const wave of this.waves) {
      const u = wave.material.uniforms;
      u.uNumLights.value = Math.min(lights.length, MAX_LIGHTS);
      const lPos = u.uLightPos.value as THREE.Vector3[];
      const lCol = u.uLightColor.value as THREE.Vector3[];
      const lInt = u.uLightIntensity.value as number[];
      for (let li = 0; li < MAX_LIGHTS; li++) {
        const light = lights[li];
        if (light) {
          lPos[li].set(light.position.x, light.position.y, light.position.z);
          hexToLinearVec3(light.color, lCol[li]);
          lInt[li] = light.intensity;
        } else {
          lInt[li] = 0;
        }
      }
    }
    if (!this.running) this.renderOnce();
  }

  // ---- Hook overrides: plug the editor behavior into the base render pipeline (5 hook points) ----

  protected override isCameraExternallyDriven(): boolean {
    return !!this.orbit || this.editing;
  }

  protected override onAfterRefresh(): void {
    if (this.editMode === "light") this.syncLightHelpers();
    else if (this.editMode === "wave") this.syncWaveHelpers();
  }

  protected override onAfterRenderFrame(): void {
    // Draw the light/wave gizmo helpers on top, crisp (not through the post pass), and never into
    // exports. Guarded on `overlay` because the base constructor renders a first frame before this
    // subclass's own fields are initialized (base-ctor-calls-virtual-hook order).
    if (this.overlay && this.editing && !this.capturing && this.overlay.children.length > 0) {
      const helpers = this.editMode === "wave" ? this.waveHelpers : this.lightHelpers;
      for (const h of helpers) {
        h.scale.setScalar(Math.max(0.1, this.camera.position.distanceTo(h.position) * 0.09));
      }
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(null); // draw to the screen, not a leftover composer buffer
      this.renderer.render(this.overlay, this.camera);
      this.renderer.autoClear = true;
    }
    this.renderMinimap();
  }

  protected override onAfterResize(): void {
    if (this.cameraRigOn) this.positionMinimapBtn();
  }

  protected override applyCameraFromConfig(): void {
    if (this.editing) return; // a 3D-edit gizmo owns the camera; don't fight it
    const p = this.config.cameraPosition;
    const tg = this.config.cameraTarget;
    this.suppressCameraChange = true;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(tg.x, tg.y, tg.z);
    if (this.orbit) {
      this.orbit.target.set(tg.x, tg.y, tg.z);
      this.orbit.update();
    }
    this.applyZoom();
    this.suppressCameraChange = false;
    this.onCameraChanged?.(); // keep the panel's camera sliders in sync
    if (!this.running) this.renderOnce();
  }

  override dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onCursorDown);
    window.removeEventListener("pointerup", this.onCursorUp);
    this.transform?.detach();
    this.transform?.dispose();
    this.orbit?.dispose();
    this.minimapBtn?.remove();
    this.clearLightHelpers();
    this.clearWaveHelpers();
    for (const m of this.minimapLights) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    super.dispose();
  }
}
