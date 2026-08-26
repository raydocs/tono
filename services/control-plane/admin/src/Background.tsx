/**
 * Four static CSS layers: sky, horizon arc, lat/long mesh, veil.
 *
 * No canvas, no requestAnimationFrame, no image payload — the whole ambience is
 * gradients the compositor paints once. The veil is what keeps body text
 * legible on top of it; the mesh is masked away from the reading column.
 */
export function OpsBackground() {
  return (
    <div className="ops-bg" aria-hidden>
      <div className="ops-bg-sky" />
      <div className="ops-bg-globe" />
      <div className="ops-bg-mesh" />
      <div className="ops-bg-veil" />
    </div>
  );
}
