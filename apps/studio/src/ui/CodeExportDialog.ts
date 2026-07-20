import { injectStyleOnce } from "../util/dom";
import { flashButtonSuccess, flashButtonError } from "./buttonFeedback";
import {
  diffFromDefault,
  generateSnippet,
  generatePosterDataUri,
  type CodeTarget,
} from "../export/exportCode";
import { downloadBlob } from "../export/exporters";
import { buildAgentBrief } from "../export/agentBrief";
import { createAgentCopyButton } from "./agentCopyButton";
import type { StudioConfig } from "@wave3d/core";
import type { WaveRenderer } from "@wave3d/core/renderer";

// Inline brand-ish framework marks (kept tiny + recognizable).
const badge = (label: string, bg: string, fg: string, size = 11): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect width="24" height="24" rx="5" fill="${bg}"/><text x="12" y="16.5" font-size="${size}" font-weight="700" text-anchor="middle" fill="${fg}" font-family="ui-sans-serif,system-ui,sans-serif">${label}</text></svg>`;
const REACT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="1.9" fill="#61dafb"/><g fill="none" stroke="#61dafb" stroke-width="1.1"><ellipse cx="12" cy="12" rx="10" ry="4.3"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(120 12 12)"/></g></svg>`;
const VUE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 4h4l6 10 6-10h4L12 21 2 4z" fill="#42b883"/><path d="M6.5 4h2.5L12 9l3-5h2.5L12 13.5 6.5 4z" fill="#35495e"/></svg>`;

interface Framework {
  id: CodeTarget;
  label: string;
  icon: string;
  lang: string;
  file: string;
}

const FRAMEWORKS: Framework[] = [
  { id: "react", label: "React", icon: REACT_ICON, lang: "tsx", file: "Wave.tsx" },
  { id: "vue", label: "Vue", icon: VUE_ICON, lang: "vue", file: "Wave.vue" },
  {
    id: "svelte",
    label: "Svelte",
    icon: badge("S", "#ff3e00", "#fff"),
    lang: "svelte",
    file: "Wave.svelte",
  },
  {
    id: "vanilla",
    label: "Vanilla JS",
    icon: badge("JS", "#f7df1e", "#111", 9),
    lang: "typescript",
    file: "wave.js",
  },
  {
    id: "html",
    label: "HTML / CDN",
    icon: badge("&lt;/&gt;", "#e34f26", "#fff", 8),
    lang: "html",
    file: "wave.html",
  },
];

// Lazily load Shiki (the syntax highlighter) only when the dialog is first opened.
type CodeToHtml = (code: string, opts: { lang: string; theme: string }) => Promise<string>;
let highlighter: Promise<CodeToHtml> | null = null;
const loadHighlighter = (): Promise<CodeToHtml> =>
  (highlighter ??= import("shiki").then((m) => m.codeToHtml));

const STYLE = `
dialog.code-export {
  /* 860 (not 780): the footer's five controls need ~800px to stay on one row once the agent-copy
     button is in there, and the wider code block is a bonus. */
  width: min(860px, 92vw); max-height: 86vh; padding: 0; border: 1px solid #333; border-radius: 10px;
  background: #16171b; color: #e6e6e6; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
}
dialog.code-export::backdrop { background: rgba(0,0,0,0.55); }
.code-export .hd { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #2a2b30; }
.code-export .hd h2 { margin: 0; font-size: 14px; flex: 0 0 auto; }
.code-export .hd .spacer { flex: 1; }
.code-export .x { background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer; line-height: 1; }
/* framework icon-dropdown */
.code-export .fw { position: relative; font: 12px ui-sans-serif, system-ui, sans-serif; }
.code-export .fw-trigger { display: flex; align-items: center; gap: 8px; min-width: 150px; padding: 5px 10px;
  border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; background: #1e1f24; color: #e6e6e6; cursor: pointer; }
.code-export .fw-trigger:hover { background: #24262c; }
.code-export .fw-trigger .nm { flex: 1; text-align: left; }
.code-export .fw-trigger .cr { opacity: 0.6; }
.code-export .fw-list { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; min-width: 100%;
  background: #1b1c21; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; overflow: hidden; }
.code-export .fw-opt { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; color: #cdd0d6; }
.code-export .fw-opt:hover { background: rgba(255,255,255,0.08); }
.code-export .fw-opt.sel { background: rgba(45,92,255,0.22); color: #fff; }
.code-export .fw svg { flex: 0 0 auto; vertical-align: -3px; }
.code-export .code { margin: 12px 16px; border: 1px solid #2a2b30; border-radius: 8px; overflow: auto; max-height: 48vh; }
.code-export .code pre { margin: 0; padding: 12px; overflow: auto; tab-size: 2; }
.code-export .code pre:not(.shiki) { color: #d6d7db; white-space: pre; }
.code-export .ft { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid #2a2b30; flex-wrap: wrap; }
.code-export .ft label { display: flex; align-items: center; gap: 6px; color: #bbb; cursor: pointer; }
.code-export .ft .spacer { flex: 1; }
/* :not(.agent-copy) — the agent button brings its own chrome (glyphs + hover fan-out) and this
   rule would otherwise outspecify it. */
.code-export .ft button:not(.agent-copy) { font: 12px ui-sans-serif, system-ui, sans-serif; padding: 6px 14px; border: 1px solid #333; border-radius: 6px; background: #1e1f24; color: #e6e6e6; cursor: pointer; }
.code-export .ft button.primary { background: #2d5cff; border-color: #2d5cff; color: #fff; }
`;

/**
 * The "Export code" dialog: pick a framework from an icon-dropdown, see the current wave's snippet
 * with syntax highlighting (Shiki), then Copy / Download the file / Download a poster. A native
 * `<dialog>` — no modal infrastructure exists in the studio.
 */
export class CodeExportDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly codeBox: HTMLDivElement;
  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLDivElement;
  private readonly inlineToggle: HTMLInputElement;
  private framework = FRAMEWORKS[0];
  private rawCode = "";
  private renderToken = 0;
  private listOpen = false;

  constructor(
    private readonly getConfig: () => StudioConfig,
    private readonly renderer: WaveRenderer,
  ) {
    injectStyleOnce("wave3d-code-export", STYLE);
    this.dialog = document.createElement("dialog");
    this.dialog.className = "code-export";

    // Header: title + framework icon-dropdown + close.
    const hd = document.createElement("div");
    hd.className = "hd";
    const h2 = document.createElement("h2");
    h2.textContent = "Export code";

    const fw = document.createElement("div");
    fw.className = "fw";
    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "fw-trigger";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.addEventListener("click", () => this.toggleList());
    this.list = document.createElement("div");
    this.list.className = "fw-list";
    this.list.setAttribute("role", "listbox");
    this.list.style.display = "none";
    for (const f of FRAMEWORKS) {
      const opt = document.createElement("div");
      opt.className = "fw-opt";
      opt.setAttribute("role", "option");
      opt.innerHTML = `${f.icon}<span>${f.label}</span>`;
      opt.addEventListener("click", () => {
        this.closeList();
        this.setFramework(f);
      });
      this.list.appendChild(opt);
    }
    fw.append(this.trigger, this.list);

    const spacer = document.createElement("div");
    spacer.className = "spacer";
    const close = document.createElement("button");
    close.className = "x";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", () => this.dialog.close());
    hd.append(h2, fw, spacer, close);

    this.codeBox = document.createElement("div");
    this.codeBox.className = "code";

    // Footer: inline-LQIP toggle + Download poster + Download file + Copy.
    const ft = document.createElement("div");
    ft.className = "ft";
    const inlineLabel = document.createElement("label");
    this.inlineToggle = document.createElement("input");
    this.inlineToggle.type = "checkbox";
    this.inlineToggle.checked = true; // default: a self-contained snippet that works when pasted
    this.inlineToggle.addEventListener("change", () => this.renderSnippet());
    inlineLabel.append(this.inlineToggle, document.createTextNode("inline LQIP poster"));
    const ftSpacer = document.createElement("div");
    ftSpacer.className = "spacer";
    const posterBtn = button("Download poster.png", async (btn) => {
      await this.downloadPoster();
      flashButtonSuccess(btn, "Saved");
    });
    const fileBtn = button("Download file", (btn) => {
      this.downloadFile();
      flashButtonSuccess(btn, "Saved");
    });
    const copyBtn = button("Copy", async (btn) => {
      if (await this.copy()) flashButtonSuccess(btn, "Copied");
      else flashButtonError(btn, "Copy failed");
    });
    copyBtn.classList.add("primary");
    // Hands the whole job to a coding agent: this wave's snippet + @wave3d's own skill doc. Uses
    // the dialog's selected framework so the embedded snippet matches what's on screen.
    const agentBtn = createAgentCopyButton(() =>
      buildAgentBrief(this.getConfig(), this.framework.id),
    );
    ft.append(inlineLabel, ftSpacer, agentBtn, posterBtn, fileBtn, copyBtn);

    this.dialog.append(hd, this.codeBox, ft);
    this.dialog.addEventListener("click", (e) => {
      const target = e.target as Node;
      if (e.target === this.dialog) this.dialog.close();
      // Close the framework list on any click outside it AND outside the trigger (contains(),
      // not ===, so clicking the trigger's icon/label/arrow still counts as hitting the trigger
      // rather than an outside click that would immediately re-close what the trigger just opened).
      else if (!this.list.contains(target) && !this.trigger.contains(target)) this.closeList();
    });
    document.body.appendChild(this.dialog);
    this.refreshTrigger();
  }

  show(): void {
    this.renderSnippet();
    this.dialog.showModal();
  }

  private toggleList(): void {
    if (this.listOpen) this.closeList();
    else this.openList();
  }
  private openList(): void {
    this.listOpen = true;
    this.list.style.display = "";
    this.list
      .querySelectorAll(".fw-opt")
      .forEach((o, i) => o.classList.toggle("sel", FRAMEWORKS[i] === this.framework));
  }
  private closeList(): void {
    this.listOpen = false;
    this.list.style.display = "none";
  }

  private setFramework(f: Framework): void {
    this.framework = f;
    this.refreshTrigger();
    this.renderSnippet();
  }

  private refreshTrigger(): void {
    this.trigger.innerHTML = `${this.framework.icon}<span class="nm">${this.framework.label}</span><span class="cr">▾</span>`;
  }

  private renderSnippet(): void {
    const diff = diffFromDefault(this.getConfig());
    const posterPath = this.inlineToggle.checked
      ? generatePosterDataUri(this.renderer)
      : "/wave-poster.png";
    this.rawCode = generateSnippet(this.framework.id, diff, { posterPath });
    // Show the raw code immediately, then swap in the highlighted version once Shiki resolves.
    const pre = document.createElement("pre");
    pre.textContent = this.rawCode;
    this.codeBox.replaceChildren(pre);
    const token = ++this.renderToken;
    const { lang } = this.framework;
    const code = this.rawCode;
    void loadHighlighter()
      .then((codeToHtml) => codeToHtml(code, { lang, theme: "github-dark" }))
      .then((html) => {
        if (token === this.renderToken) this.codeBox.innerHTML = html;
      })
      .catch(() => {
        /* keep the plain-text fallback if Shiki fails to load */
      });
  }

  private async copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.rawCode);
      return true;
    } catch {
      return false;
    }
  }

  private downloadFile(): void {
    downloadBlob(new Blob([this.rawCode], { type: "text/plain" }), this.framework.file);
  }

  private async downloadPoster(): Promise<void> {
    const blob = await this.renderer.captureImage("image/png", true);
    downloadBlob(blob, "wave-poster.png");
  }
}

function button(label: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => onClick(b));
  return b;
}
