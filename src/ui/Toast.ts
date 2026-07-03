/**
 * Minimal transient toast, docked bottom-centre, with an optional action button (e.g. "Undo").
 * Only one shows at a time — a new toast (or an explicit dismissToast) replaces any current one.
 * Auto-dismisses after `duration`, but pauses that timer while the pointer is over it so the
 * action stays reachable.
 */
export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** ms before auto-dismiss; default 6000. */
  duration?: number;
}

let current: HTMLElement | undefined;
let timer = 0;

export function showToast(opts: ToastOptions): void {
  dismissToast();
  const duration = opts.duration ?? 6000;

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(8px);z-index:30;" +
    "display:flex;align-items:center;gap:14px;padding:9px 10px 9px 15px;border-radius:10px;" +
    "font:13px/1.2 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eceef4;" +
    "background:rgba(20,20,28,0.92);border:1px solid rgba(255,255,255,0.14);" +
    "box-shadow:0 10px 34px rgba(0,0,0,0.5);backdrop-filter:blur(10px);" +
    "-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity 0.2s ease,transform 0.2s ease;";

  const msg = document.createElement("span");
  msg.textContent = opts.message;
  toast.append(msg);

  if (opts.actionLabel && opts.onAction) {
    const onAction = opts.onAction;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = opts.actionLabel;
    btn.style.cssText =
      "appearance:none;-webkit-appearance:none;border:0;border-radius:7px;padding:5px 11px;" +
      "background:rgba(157,187,255,0.16);color:#bcd0ff;font:inherit;font-weight:600;cursor:pointer;";
    btn.addEventListener("click", () => {
      onAction();
      dismissToast();
    });
    toast.append(btn);
  }

  // Pause the auto-dismiss while hovered, so moving over to click the action doesn't lose it.
  toast.addEventListener("mouseenter", () => window.clearTimeout(timer));
  toast.addEventListener("mouseleave", () => {
    timer = window.setTimeout(dismissToast, 2500);
  });

  document.body.appendChild(toast);
  current = toast;
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });
  timer = window.setTimeout(dismissToast, duration);
}

export function dismissToast(): void {
  window.clearTimeout(timer);
  const toast = current;
  current = undefined;
  if (!toast) return;
  toast.style.opacity = "0";
  toast.style.transform = "translateX(-50%) translateY(8px)";
  setTimeout(() => toast.remove(), 220);
}
