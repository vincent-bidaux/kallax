// ─────────────────────────────────────────────────────────────
// Contracts between modules. Each module is owned by one agent;
// they only talk through these interfaces + `store`.
//
//  render/viewport.ts      → export class Viewport implements ViewportAPI
//  render/measurements.ts  → export class Measurements  (ctor(viewport: ViewportAPI))
//  render/viewcube.ts      → export class ViewCube      (ctor(viewport: ViewportAPI, host: HTMLElement))
//  interaction/*           → drag & drop, snapping, selection, keyboard
//  ui/*                    → Apple-style app shell
//  main.ts                 → wiring (owned by the UI agent)
// ─────────────────────────────────────────────────────────────
import type * as THREE from 'three';
import type { Item, Projection, Vec3, ViewPreset } from './types';
import type { ThemeTokens } from './theme';

export interface SurfaceHit {
  /** World point in cm (Z-up model space). */
  point: Vec3;
  /** World face normal (axis aligned for our boxes). */
  normal: Vec3;
  /** Item hit, or null for the ground plane (z = 0). */
  itemId: string | null;
}

export interface GhostState {
  /** Item being placed / moved (not necessarily in the store). */
  item: Item;
  /** false → drawn in `ghostBad` colour (collision). */
  valid: boolean;
  /** Several items placed together (component drop): every one of them, `item` included. */
  items?: Item[];
}

export interface SnapshotOpts {
  /** Frame and show only these items (default: everything visible, current view). */
  ids?: string[];
  /** Output size in px (default 320 × 240). */
  width?: number;
  height?: number;
  /** JPEG quality (default 0.8). */
  quality?: number;
}

export interface ViewportAPI {
  readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  /**
   * World-space group for annotations (measurements…). The scene is Z-up
   * (camera.up = 0,0,1), so model coordinates can be used directly.
   */
  readonly overlay: THREE.Group;

  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  getRenderer(): THREE.WebGLRenderer;
  getTheme(): ThemeTokens;
  /** Canvas size in CSS px. */
  getSize(): { width: number; height: number };

  // ── picking (clientX/Y = DOM event coordinates) ──
  pickItem(clientX: number, clientY: number): string | null;
  /** Pointer ray in world space (origin + unit direction), correct for every projection. */
  pickRay(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 };
  raycastSurface(clientX: number, clientY: number, ignoreIds?: string[]): SurfaceHit | null;
  /** Intersect the pointer ray with the plane  normal·p = constant  (world). */
  rayToPlane(clientX: number, clientY: number, normal: Vec3, constant: number): Vec3 | null;
  /** Project a world point to container-relative CSS px. */
  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean };

  /** Preview of an item being dragged (or null to clear). */
  setGhost(g: GhostState | null): void;
  /** Enable/disable camera orbit/pan/zoom (disabled while dragging an item). */
  setControlsEnabled(on: boolean): void;

  // ── camera ──
  /** Animate to a preset. 'cavalier' = oblique projection (front view + sheared depth). */
  setView(preset: ViewPreset, animate?: boolean): void;
  /** Look along `dir` (from camera towards target), used by the ViewCube faces/edges/corners. */
  setViewDirection(dir: Vec3, animate?: boolean): void;
  setProjection(p: Projection): void;
  /** Frame all visible items (or the origin area when empty). */
  zoomToFit(animate?: boolean): void;
  /** Current camera viewing direction (unit, camera → target), world. */
  getViewDirection(): Vec3;
  /** Camera quaternion, for widgets that mirror the orientation (ViewCube). */
  getCameraQuaternion(): THREE.Quaternion;

  // ── frame hooks ──
  /** Called every frame before the main render. Returns an unsubscribe fn. */
  onBeforeRender(cb: () => void): () => void;
  /** Called every frame after the main render (CSS2D overlays, view cube…). */
  onAfterRender(cb: () => void): () => void;
  /** Ask for a redraw (render loop is on-demand). */
  requestRender(): void;
  /**
   * Render a still image (JPEG data URL) of some items, framed with the current
   * view direction, without the grid, dimensions or selection colours. The
   * on-screen view is restored right after. Undefined if the canvas can't be read.
   */
  snapshot(o?: SnapshotOpts): string | undefined;

  // ── first-person walk ──
  /**
   * Render with `camera` (perspective, Z-up) and call `tick(dt)` every frame
   * (continuous loop) until endWalk(); orbit controls, dimensions, gizmos and
   * the origin axes are disabled. The editor camera is not touched.
   * `hideIds`: items not drawn meanwhile (the Human the walk starts from).
   */
  beginWalk(camera: THREE.PerspectiveCamera, tick: (dt: number) => void, hideIds?: string[]): void;
  /** Back to the editor camera, exactly as it was. */
  endWalk(): void;
  isWalking(): boolean;
}
