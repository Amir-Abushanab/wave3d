import { injectStyleOnce } from "../util/dom";
import { showToast } from "./Toast";
import { downloadText, pickConfigFile } from "../export/exporters";
import type { StudioConfig } from "@wave3d/core";

// The "Edit config" dialog: view/manipulate the whole StudioConfig as JSON, then Apply it to the
// live wave — plus Copy / Download / Load-from-file for round-tripping the raw config. A native
// <dialog> (same lightweight pattern as CodeExportDialog); Apply keeps it open behind a translucent
// backdrop so you can iterate. Applying routes through the app's ensureStudioConfig + history, so a
// hand-edited config is normalized and undoable like any other edit.

const STYLE = `
dialog.config-editor {
  width: min(760px, 94vw); max-height: 88vh; padding: 0; border: 1px solid #333; border-radius: 10px;
  background: #16171b; color: #e6e6e6; font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
}
dialog.config-editor::backdrop { background: rgba(0,0,0,0.5); }
.config-editor .hd { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #2a2b30; }
.config-editor .hd h2 { margin: 0; font-size: 14px; }
.config-editor .hd .sub { color: #8a8d96; font-size: 12px; }
.config-editor .hd .spacer { flex: 1; }
.config-editor .x { background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer; line-height: 1; }
.config-editor textarea {
  display: block; width: 100%; box-sizing: border-box; height: 52vh; resize: vertical;
  padding: 12px 14px; border: none; outline: none; background: #0e0f13; color: #e6e6e6;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; white-space: pre;
}
.config-editor .err {
  min-height: 1.4em; padding: 6px 16px; color: #ff8a8a; font: 12px/1.4 ui-monospace, monospace;
  border-top: 1px solid #2a2b30; white-space: pre-wrap; word-break: break-word;
}
.config-editor .err:empty { display: none; }
.config-editor .ft { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid #2a2b30; }
.config-editor .ft .spacer { flex: 1; }
.config-editor button.b {
  cursor: pointer; border: 1px solid #3a3b42; background: #24252b; color: #e6e6e6;
  border-radius: 6px; padding: 6px 12px; font: 12px ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.config-editor button.b:hover { background: #2e2f36; }
.config-editor button.b.primary { background: #3f6fe0; border-color: #3f6fe0; color: #fff; }
.config-editor button.b.primary:hover { background: #4a7bf0; }
`;

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = primary ? "b primary" : "b";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Modal JSON editor for the whole config: view / edit / apply, plus copy / download / load. */
export class ConfigEditorDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly errEl: HTMLDivElement;

  constructor(
    private readonly getConfig: () => StudioConfig,
    private readonly onApply: (config: StudioConfig) => void,
  ) {
    injectStyleOnce("wave3d-config-editor", STYLE);
    this.dialog = document.createElement("dialog");
    this.dialog.className = "config-editor";

    const hd = document.createElement("div");
    hd.className = "hd";
    const h2 = document.createElement("h2");
    h2.textContent = "Edit config";
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = "the whole wave, as JSON";
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    const close = document.createElement("button");
    close.className = "x";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", () => this.dialog.close());
    hd.append(h2, sub, spacer, close);

    this.textarea = document.createElement("textarea");
    this.textarea.spellcheck = false;
    this.textarea.setAttribute("aria-label", "Config JSON");
    this.textarea.addEventListener("input", () => this.clearError());

    this.errEl = document.createElement("div");
    this.errEl.className = "err";

    const ft = document.createElement("div");
    ft.className = "ft";
    const ftSpacer = document.createElement("div");
    ftSpacer.className = "spacer";
    ft.append(
      button("📂 Load .json…", () => void this.load()),
      ftSpacer,
      button("Copy", () => void this.copy()),
      button("💾 Download .json", () => this.download()),
      button("Apply", () => this.apply(), true),
    );

    this.dialog.append(hd, this.textarea, this.errEl, ft);
    // Backdrop click closes (edits are transient until Apply — reopening shows the live config).
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    document.body.appendChild(this.dialog);
  }

  /** Open the dialog, seeded with the current live config. */
  show(): void {
    this.textarea.value = JSON.stringify(this.getConfig(), null, 2);
    this.clearError();
    this.dialog.showModal();
  }

  private apply(): void {
    let parsed: StudioConfig;
    try {
      parsed = JSON.parse(this.textarea.value) as StudioConfig;
    } catch (e) {
      this.showError(`Invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as StudioConfig).waves)) {
      this.showError('Not a wave config — expected an object with a "waves" array.');
      return;
    }
    try {
      this.onApply(parsed); // routes through ensureStudioConfig + history in the app
    } catch (e) {
      this.showError(`Couldn't apply — ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.clearError();
    showToast({ message: "Config applied", duration: 2000 });
    // Stay open (translucent backdrop) so you can keep iterating.
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.textarea.value);
      showToast({ message: "Copied config JSON", duration: 2000 });
    } catch {
      this.showError("Clipboard copy was blocked — select the text and copy it manually.");
    }
  }

  private download(): void {
    downloadText(this.textarea.value, "wave.json", "application/json");
  }

  private async load(): Promise<void> {
    try {
      const cfg = await pickConfigFile();
      this.textarea.value = JSON.stringify(cfg, null, 2);
      this.clearError();
      showToast({ message: "Loaded into the editor — review, then Apply", duration: 2500 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/no file selected/i.test(msg)) this.showError(`Load failed — ${msg}`);
    }
  }

  private showError(msg: string): void {
    this.errEl.textContent = msg;
  }

  private clearError(): void {
    this.errEl.textContent = "";
  }
}
