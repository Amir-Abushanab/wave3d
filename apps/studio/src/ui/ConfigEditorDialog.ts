import { basicSetup } from "codemirror";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { showMinimap } from "@replit/codemirror-minimap";
import { injectStyleOnce } from "../util/dom";
import { showToast } from "./Toast";
import { flashButtonSuccess } from "./buttonFeedback";
import { downloadText, pickConfigFile } from "../export/exporters";
import type { StudioConfig } from "@wave3d/core";

// The "Edit config" dialog: a mini-IDE view of the whole StudioConfig as JSON, powered by
// CodeMirror 6 — syntax highlighting, code folding, bracket matching, live JSON linting, a minimap,
// inline color swatches (click → native colour picker), and a bounding box around the key/value at
// the cursor that turns red when that value fails to parse. Apply routes through the app's
// ensureStudioConfig + history like any edit. CodeMirror is only pulled in when this module loads,
// so it's lazy-imported (see main.ts) and stays out of the initial studio bundle.

const STYLE = `
dialog.config-editor {
  width: min(880px, 95vw); max-height: 90vh; padding: 0; border: 1px solid #333; border-radius: 10px;
  background: #16171b; color: #e6e6e6; font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
}
dialog.config-editor::backdrop { background: rgba(0,0,0,0.5); }
.config-editor .hd { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #2a2b30; }
.config-editor .hd h2 { margin: 0; font-size: 14px; }
.config-editor .hd .sub { color: #8a8d96; font-size: 12px; }
.config-editor .hd .spacer { flex: 1; }
.config-editor .x { background: none; border: none; color: #aaa; font-size: 18px; cursor: pointer; line-height: 1; }
.config-editor .host { position: relative; }
.config-editor .host .cm-editor { height: 58vh; }
.config-editor .host .cm-editor.cm-focused { outline: none; }
.config-editor .host .cm-scroller { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
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
/* inline colour swatch before a "#rrggbb" value */
.cm-color-swatch {
  display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 5px;
  vertical-align: -1px; cursor: pointer; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.4);
}
/* key/value box at the cursor; red variant when the value doesn't parse */
.cm-kvbox { border-radius: 3px; outline: 1px solid rgba(120,160,255,0.55); background: rgba(120,160,255,0.09); }
.cm-kvbox-invalid { outline-color: #ff6a6a; background: rgba(255,80,80,0.12); }
.cm-kvbox-invalid, .cm-kvbox-invalid * { color: #ff8a8a !important; }
`;

// A "#rgb" / "#rgba" / "#rrggbb" / "#rrggbbaa" string literal (quotes included).
const HEX_STRING_RE = /^"(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))"$/;

/** Collapse any supported hex to the 6-digit form a native <input type=color> accepts. */
function toPickerHex(hex: string): string {
  const body = hex.slice(1);
  if (body.length === 3 || body.length === 4) {
    return "#" + Array.from(body.slice(0, 3), (c) => c + c).join("");
  }
  return "#" + body.slice(0, 6);
}

/** An inline colour swatch rendered just before a hex string; clicking opens the OS colour picker,
 *  and dragging it live-rewrites the hex in the document (keeping quotes). */
class ColorSwatchWidget extends WidgetType {
  constructor(
    readonly hex: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  override eq(other: ColorSwatchWidget): boolean {
    return other.hex === this.hex && other.from === this.from && other.to === this.to;
  }
  override toDOM(view: EditorView): HTMLElement {
    const sw = document.createElement("span");
    sw.className = "cm-color-swatch";
    sw.style.background = this.hex;
    sw.title = `${this.hex} — click to edit`;
    sw.addEventListener("mousedown", (e) => {
      e.preventDefault(); // don't move the caret / start a selection
      const input = document.createElement("input");
      input.type = "color";
      input.value = toPickerHex(this.hex);
      input.style.cssText = "position:fixed;left:-9999px;opacity:0;pointer-events:none;";
      document.body.appendChild(input);
      // Track the live range as we rewrite (the widget is rebuilt on each doc change, so its own
      // from/to would go stale across successive picker inputs).
      let range = { from: this.from, to: this.to };
      input.addEventListener("input", () => {
        view.dispatch({ changes: { from: range.from, to: range.to, insert: input.value } });
        range = { from: range.from, to: range.from + input.value.length };
      });
      input.addEventListener("change", () => input.remove(), { once: true });
      input.click();
    });
    return sw;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** Scan the visible JSON for hex-colour string values and drop a clickable swatch before each. */
const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSwatches(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildSwatches(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

function buildSwatches(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "String") return;
        const text = view.state.sliceDoc(node.from, node.to);
        const m = HEX_STRING_RE.exec(text);
        if (!m) return;
        b.add(
          node.from,
          node.from,
          Decoration.widget({
            widget: new ColorSwatchWidget(m[1], node.from + 1, node.to - 1),
            side: -1,
          }),
        );
      },
    });
  }
  return b.finish();
}

/** Box the key/value (JSON Property) enclosing the cursor; turn it red when that property's value
 *  contains a parse error (Lezer error node) — an at-a-glance "this value is invalid" cue. */
const cursorKeyValueBox = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCursorBox(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildCursorBox(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildCursorBox(view: EditorView): DecorationSet {
  const sel = view.state.selection.main;
  if (!sel.empty) return Decoration.none; // only for a plain caret
  const line = view.state.doc.lineAt(sel.head);
  const tree = syntaxTree(view.state);
  // Prefer the exact JSON Property enclosing the caret; when the parse is broken (an invalid value),
  // there's no clean Property, so fall back to the line's trimmed content — there's always a box to
  // turn red.
  let node = tree.resolveInner(sel.head, 0);
  while (node.parent && node.name !== "Property") node = node.parent;
  let from: number;
  let to: number;
  if (node.name === "Property" && node.from >= line.from) {
    from = node.from;
    to = Math.min(node.to, line.to); // clamp to this line so a multi-line value isn't one giant box
  } else {
    const lead = line.text.length - line.text.trimStart().length;
    const trail = line.text.length - line.text.trimEnd().length;
    from = line.from + lead;
    to = line.to - trail;
  }
  if (to <= from) return Decoration.none;
  // Invalid = any parse-error node on this line (synchronous — no lint-debounce delay).
  let invalid = false;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (n.type.isError) {
        invalid = true;
        return false;
      }
    },
  });
  const cls = invalid ? "cm-kvbox cm-kvbox-invalid" : "cm-kvbox";
  return Decoration.set([Decoration.mark({ class: cls }).range(from, to)]);
}

/** The corner minimap (a scaled overview of the whole document). */
const minimap = showMinimap.compute([], () => ({
  create: () => {
    const dom = document.createElement("div");
    dom.className = "cm-minimap-host";
    return { dom };
  },
  displayText: "blocks",
  showOverlay: "always",
}));

const editorTheme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "#0e0f13" },
  ".cm-gutters": { backgroundColor: "#0e0f13" },
});

function button(
  label: string,
  onClick: (btn: HTMLButtonElement) => void,
  primary = false,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = primary ? "b primary" : "b";
  b.textContent = label;
  b.addEventListener("click", () => onClick(b));
  return b;
}

/** Modal mini-IDE for the whole config: view / edit / apply, plus copy / download / load. */
export class ConfigEditorDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly host: HTMLDivElement;
  private readonly errEl: HTMLDivElement;
  private view?: EditorView;

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

    this.host = document.createElement("div");
    this.host.className = "host";

    this.errEl = document.createElement("div");
    this.errEl.className = "err";

    const ft = document.createElement("div");
    ft.className = "ft";
    const ftSpacer = document.createElement("div");
    ftSpacer.className = "spacer";
    ft.append(
      button("📂 Load .json…", () => void this.load()),
      ftSpacer,
      button("Copy", async (btn) => {
        if (await this.copy()) flashButtonSuccess(btn, "Copied");
      }),
      button("💾 Download .json", (btn) => {
        this.download();
        flashButtonSuccess(btn, "Saved");
      }),
      button(
        "Apply",
        (btn) => {
          if (this.apply()) flashButtonSuccess(btn, "Applied");
        },
        true,
      ),
    );

    this.dialog.append(hd, this.host, this.errEl, ft);
    // Backdrop click closes (edits are transient until Apply — reopening shows the live config).
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    document.body.appendChild(this.dialog);
  }

  /** Open the dialog, seeded with the current live config. */
  show(): void {
    this.dialog.showModal(); // show first so CodeMirror measures against a laid-out container
    if (!this.view) this.view = this.createView();
    this.setDoc(JSON.stringify(this.getConfig(), null, 2));
    this.clearError();
    this.view.focus();
    this.view.requestMeasure();
  }

  private createView(): EditorView {
    return new EditorView({
      parent: this.host,
      extensions: [
        basicSetup, // line numbers, code folding, bracket matching, history, highlight infra…
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        oneDark,
        editorTheme,
        colorSwatches,
        cursorKeyValueBox,
        minimap,
      ],
    });
  }

  private setDoc(text: string): void {
    const view = this.view;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  private getDoc(): string {
    return this.view?.state.doc.toString() ?? "";
  }

  private apply(): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.getDoc());
    } catch (e) {
      this.showError(`Invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as StudioConfig).waves)) {
      this.showError('Not a wave config — expected an object with a "waves" array.');
      return false;
    }
    try {
      this.onApply(parsed as StudioConfig); // routes through ensureStudioConfig + history in the app
    } catch (e) {
      this.showError(`Couldn't apply — ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    this.clearError();
    // Stay open (translucent backdrop) so you can keep iterating.
    return true;
  }

  private async copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.getDoc());
      return true;
    } catch {
      this.showError("Clipboard copy was blocked — select the text and copy it manually.");
      return false;
    }
  }

  private download(): void {
    downloadText(this.getDoc(), "wave.json", "application/json");
  }

  private async load(): Promise<void> {
    try {
      const cfg = await pickConfigFile();
      this.setDoc(JSON.stringify(cfg, null, 2));
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
