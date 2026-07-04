import { injectStyleOnce } from "../util/dom";
import { showToast } from "./Toast";
import {
  diffFromDefault,
  generateSnippet,
  generatePosterDataUri,
  type CodeTarget,
} from "../export/exportCode";
import { downloadBlob } from "../export/exporters";
import type { StudioConfig } from "@wave3d/core";
import type { WaveRenderer } from "@wave3d/core/renderer";

const TARGETS: { id: CodeTarget; label: string }[] = [
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "svelte", label: "Svelte" },
  { id: "vanilla", label: "Vanilla JS" },
  { id: "html", label: "HTML / CDN" },
];

const STYLE = `
dialog.code-export {
  width: min(760px, 92vw); max-height: 86vh; padding: 0; border: 1px solid #333; border-radius: 10px;
  background: #16171b; color: #e6e6e6; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
}
dialog.code-export::backdrop { background: rgba(0,0,0,0.55); }
.code-export .hd { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #2a2b30; }
.code-export .hd h2 { margin: 0; font-size: 14px; }
.code-export .x { background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer; line-height: 1; }
.code-export .tabs { display: flex; gap: 4px; padding: 10px 16px 0; flex-wrap: wrap; }
.code-export .tabs button { font: inherit; padding: 5px 12px; border: 1px solid #333; border-radius: 6px; background: #1e1f24; color: #ccc; cursor: pointer; }
.code-export .tabs button[aria-selected="true"] { background: #2d5cff; border-color: #2d5cff; color: #fff; }
.code-export pre { margin: 12px 16px; padding: 12px; background: #0e0f12; border: 1px solid #2a2b30; border-radius: 8px; overflow: auto; max-height: 46vh; white-space: pre; tab-size: 2; }
.code-export .ft { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #2a2b30; flex-wrap: wrap; }
.code-export .ft label { display: flex; align-items: center; gap: 6px; color: #bbb; cursor: pointer; }
.code-export .ft .spacer { flex: 1; }
.code-export .ft button { font: inherit; padding: 6px 14px; border: 1px solid #333; border-radius: 6px; background: #1e1f24; color: #e6e6e6; cursor: pointer; }
.code-export .ft button.primary { background: #2d5cff; border-color: #2d5cff; color: #fff; }
`;

/**
 * The "Export code" dialog: shows a copy-paste snippet of the current wave for each @wave3d entry
 * (React / Vue / Svelte / vanilla / HTML-CDN), with a Copy button, a "Download poster" button, and
 * an inline-LQIP-poster toggle. A native `<dialog>` — no modal infrastructure exists in the studio.
 */
export class CodeExportDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly pre: HTMLPreElement;
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly inlineToggle: HTMLInputElement;
  private target: CodeTarget = "react";

  constructor(
    private readonly getConfig: () => StudioConfig,
    private readonly renderer: WaveRenderer,
  ) {
    injectStyleOnce("wave3d-code-export", STYLE);
    this.dialog = document.createElement("dialog");
    this.dialog.className = "code-export";

    const hd = document.createElement("div");
    hd.className = "hd";
    const h2 = document.createElement("h2");
    h2.textContent = "Export code";
    const close = document.createElement("button");
    close.className = "x";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", () => this.dialog.close());
    hd.append(h2, close);

    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    for (const t of TARGETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.label;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t.id === this.target));
      b.addEventListener("click", () => {
        this.target = t.id;
        for (const btn of this.tabButtons) {
          btn.setAttribute("aria-selected", String(btn === b));
        }
        this.renderSnippet();
      });
      this.tabButtons.push(b);
      tabs.appendChild(b);
    }

    this.pre = document.createElement("pre");
    this.pre.tabIndex = 0;

    const ft = document.createElement("div");
    ft.className = "ft";
    const inlineLabel = document.createElement("label");
    this.inlineToggle = document.createElement("input");
    this.inlineToggle.type = "checkbox";
    this.inlineToggle.addEventListener("change", () => this.renderSnippet());
    inlineLabel.append(this.inlineToggle, document.createTextNode("inline LQIP poster"));
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    const posterBtn = document.createElement("button");
    posterBtn.type = "button";
    posterBtn.textContent = "Download poster.png";
    posterBtn.addEventListener("click", () => void this.downloadPoster());
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "primary";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => void this.copy());
    ft.append(inlineLabel, spacer, posterBtn, copyBtn);

    this.dialog.append(hd, tabs, this.pre, ft);
    // Click on the backdrop (outside the dialog content) closes it.
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    document.body.appendChild(this.dialog);
  }

  show(): void {
    this.renderSnippet();
    this.dialog.showModal();
  }

  private renderSnippet(): void {
    const diff = diffFromDefault(this.getConfig());
    const posterPath = this.inlineToggle.checked
      ? generatePosterDataUri(this.renderer)
      : "/wave-poster.png";
    this.pre.textContent = generateSnippet(this.target, diff, { posterPath });
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.pre.textContent ?? "");
      showToast({ message: "Snippet copied to clipboard", duration: 2000 });
    } catch {
      showToast({ message: "Couldn't copy — select the code and copy it manually" });
    }
  }

  private async downloadPoster(): Promise<void> {
    const blob = await this.renderer.captureImage("image/png", true);
    downloadBlob(blob, "wave-poster.png");
    showToast({ message: "Poster downloaded", duration: 2000 });
  }
}
