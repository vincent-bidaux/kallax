// Orthographic camera whose projection can be sheared to produce an OBLIQUE
// projection (cavalière / cabinet). The shear is applied in view space,
// relative to a pivot plane (the orbit target depth), so the target stays
// centred whatever the shear:
//
//   x' = x − kx·(z + D)      y' = y − ky·(z + D)
//
// where z is the view-space depth (negative in front of the camera) and D the
// distance camera → pivot plane. A point lying `d` cm behind the pivot plane
// is shifted on screen by (kx, ky)·d world units: with kx = r·cos α and
// ky = r·sin α the receding axis goes up-right at angle α, scaled by r.
import * as THREE from 'three';

const _S = new THREE.Matrix4();

export class ShearOrthoCamera extends THREE.OrthographicCamera {
  /** Screen offset (world units) per cm of depth behind the pivot plane. */
  shearX = 0;
  shearY = 0;
  /** View-space distance from the camera to the pivot (target) plane. */
  pivotDepth = 0;

  get sheared(): boolean { return !!(this.shearX || this.shearY); }

  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    // NB: fields are undefined while the base constructor runs → falsy.
    const kx = this.shearX, ky = this.shearY;
    if (!kx && !ky) return;
    const D = this.pivotDepth || 0;
    _S.set(
      1, 0, -kx, -kx * D,
      0, 1, -ky, -ky * D,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this.projectionMatrix.multiply(_S);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
