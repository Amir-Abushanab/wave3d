/** Shared DOM helpers for the studio UI. */

/** Append a <style> to <head> once; repeat calls with the same id are no-ops. */
export function injectStyleOnce(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

export function div(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

export function button(label: string, onClick: () => void, ariaLabel?: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (ariaLabel) element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", onClick);
  return element;
}
