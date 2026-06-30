/**
 * A palette-source picker that shows an image preview of each option *in* the dropdown
 * (Tweakpane's list can't render thumbnails). A trigger row shows the current source's
 * thumbnail; clicking it expands an inline, grouped list of thumbnails to pick from.
 */

export interface PaletteOption {
  id: string;
  label: string;
  group: string;
}

export interface PaletteDropdownHooks {
  options: PaletteOption[];
  /** Extra class on the root (e.g. "wv-pd-big" to enlarge the list thumbnails). */
  rootClass?: string;
  /** Thumbnail canvas for an option id (redrawn on open so live "stops" stays current). */
  thumbFor: (id: string) => HTMLCanvasElement;
  /** The active option id, or null when a custom image overrides it. */
  selectedId: () => string | null;
  /** Label to show when a custom image is loaded (else null). */
  customLabel: () => string | null;
  onSelect: (id: string) => void;
}

const STYLE_ID = "wv-palette-dd-style";
const CSS = `
.wv-pd { padding: 2px 10px 6px; position: relative; }
.wv-pd-trigger { display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box;
  padding:4px 8px; border-radius:5px; cursor:pointer; color:#d6d7db;
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14);
  font:12px ui-sans-serif,system-ui,-apple-system,sans-serif; }
.wv-pd-trigger:hover { background:rgba(255,255,255,0.1); }
.wv-pd-sw { width:44px; height:20px; border-radius:3px; flex:0 0 auto;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.4); }
.wv-pd-name { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wv-pd-caret { flex:0 0 auto; opacity:0.6; }
.wv-pd-list { margin-top:4px; border-radius:5px; overflow:hidden;
  background:rgba(12,12,18,0.96); border:1px solid rgba(255,255,255,0.14); }
.wv-pd-group { padding:5px 9px 3px; font:10px ui-sans-serif,system-ui,sans-serif;
  letter-spacing:.04em; text-transform:uppercase; color:#7e828c; }
.wv-pd-opt { display:flex; align-items:center; gap:8px; padding:4px 9px; cursor:pointer;
  font:12px ui-sans-serif,system-ui,-apple-system,sans-serif; color:#cdd0d6; }
.wv-pd-opt:hover { background:rgba(255,255,255,0.08); }
.wv-pd-opt.sel { background:rgba(110,168,254,0.16); color:#fff; }
.wv-pd-opt .wv-pd-sw { width:40px; height:18px; }
/* Bigger list thumbnails for the preset picker (the wave shape needs room to read). */
.wv-pd-big .wv-pd-list .wv-pd-opt { padding:6px 9px; }
.wv-pd-big .wv-pd-list .wv-pd-sw { width:104px; height:60px; }
.wv-pd-big .wv-pd-trigger .wv-pd-sw { width:52px; height:30px; }
`;

export class PaletteDropdown {
  private readonly root: HTMLElement;
  private readonly trigger: HTMLElement;
  private readonly list: HTMLElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: PaletteDropdownHooks,
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = el("div", "wv-pd" + (hooks.rootClass ? " " + hooks.rootClass : ""));
    this.trigger = el("div", "wv-pd-trigger");
    this.list = el("div", "wv-pd-list");
    this.list.style.display = "none";
    this.root.append(this.trigger, this.list);
    parent.appendChild(this.root);

    this.trigger.addEventListener("click", () => this.toggle());
    document.addEventListener("pointerdown", this.onDocDown, true);
    this.refresh();
  }

  /** The picker's root element (so callers can reposition it in the DOM). */
  get element(): HTMLElement {
    return this.root;
  }

  private onDocDown = (e: PointerEvent): void => {
    if (this.open && !this.root.contains(e.target as Node)) this.close();
  };

  private toggle(): void {
    if (this.open) this.close();
    else this.openList();
  }

  private openList(): void {
    this.open = true;
    this.buildList();
    this.list.style.display = "";
  }

  private close(): void {
    this.open = false;
    this.list.style.display = "none";
  }

  /** Rebuild the trigger (and the open list) — call after the value or stops change. */
  refresh(): void {
    const custom = this.hooks.customLabel();
    this.trigger.replaceChildren();
    if (custom) {
      this.trigger.append(swatch(null), name(custom), caret());
    } else {
      const id = this.hooks.selectedId();
      const opt = this.hooks.options.find((o) => o.id === id);
      this.trigger.append(
        swatch(id ? this.hooks.thumbFor(id) : null),
        name(opt?.label ?? "—"),
        caret(),
      );
    }
    if (this.open) this.buildList();
  }

  private buildList(): void {
    this.list.replaceChildren();
    const sel = this.hooks.customLabel() ? null : this.hooks.selectedId();
    let lastGroup = "";
    for (const o of this.hooks.options) {
      if (o.group !== lastGroup) {
        lastGroup = o.group;
        this.list.appendChild(el("div", "wv-pd-group", o.group));
      }
      const row = el("div", "wv-pd-opt" + (o.id === sel ? " sel" : ""));
      row.append(swatch(this.hooks.thumbFor(o.id)), name(o.label));
      row.addEventListener("click", () => {
        this.close();
        this.hooks.onSelect(o.id);
        this.refresh();
      });
      this.list.appendChild(row);
    }
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.onDocDown, true);
    this.root.remove();
  }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function swatch(canvas: HTMLCanvasElement | null): HTMLElement {
  const sw = el("div", "wv-pd-sw");
  if (canvas) {
    sw.style.backgroundImage = `url(${canvas.toDataURL()})`;
    sw.style.backgroundSize = "cover";
  } else {
    sw.style.background = "repeating-conic-gradient(#3a3a44 0 25%, #2a2a32 0 50%) 50%/10px 10px";
  }
  return sw;
}

function name(text: string): HTMLElement {
  return el("span", "wv-pd-name", text);
}

function caret(): HTMLElement {
  return el("span", "wv-pd-caret", "▾");
}
