/** Lawh line icons: 24px grid, 1.75 stroke, round caps and joins, no fills; they take currentColor. */
const PATHS = {
  mushaf: '<path d="M5 17V6.5a2 2 0 0 1 2-2h12V18H7a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h12"/><path d="M10 12.5V11a2 2 0 0 1 4 0v1.5"/>',
  wird: '<path d="M3 18.5h18"/><path d="M7 18.5a5 5 0 0 1 10 0"/><path d="M12 6v2.5"/><path d="M5.6 10.6 7 12"/><path d="M18.4 10.6 17 12"/>',
  review: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5v4h-4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement("span");
  span.className = "lw-icon";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  return span;
}
