// Landing-page hero: draggable before/after comparison. Positions are applied
// through the CSSOM (not inline style attributes), so the CSP stays strict.

const stage = document.getElementById("cmp-stage") as HTMLElement;
const clip = document.getElementById("cmp-clip") as HTMLElement;
const divider = document.getElementById("cmp-divider") as HTMLElement;
const slider = document.getElementById("cmp") as HTMLInputElement;

let dragging = false;

function setPos(pos: number): void {
  const p = Math.max(5, Math.min(95, pos));
  clip.style.setProperty("clip-path", `inset(0 0 0 ${p}%)`);
  divider.style.setProperty("left", `${p}%`);
  slider.value = String(p);
}

function fromPointer(e: PointerEvent): void {
  const r = stage.getBoundingClientRect();
  setPos(((e.clientX - r.left) / r.width) * 100);
}

stage.addEventListener("pointerdown", (e) => {
  dragging = true;
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {
    // pointer capture is a nicety, not a requirement
  }
  fromPointer(e);
});
stage.addEventListener("pointermove", (e) => {
  if (dragging) fromPointer(e);
});
const release = () => {
  dragging = false;
};
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
slider.addEventListener("input", () => setPos(Number(slider.value)));

setPos(50);
