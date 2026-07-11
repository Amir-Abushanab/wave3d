# Wave gallery

Community wave designs. Every file in [`waves/`](./waves) is one wave: a `title`, your GitHub
handle, and a `config` (a Wave Studio `StudioConfig`). A static gallery site (coming) renders them
and links each one back into the studio to remix.

## Submit a wave

**Easiest:** in [Wave Studio](https://wave-studio.pages.dev), design a wave and hit **✨ Publish to
gallery** (under Actions). It copies your submission and opens GitHub's new-file page. Paste, set
your title + handle, and open the PR.

**By hand:** add a `waves/<slug>.json` and open a pull request:

```json
{
  "title": "Sunset Ripple",
  "author": "your-github-handle",
  "config": { "...": "your StudioConfig" }
}
```

Get the `config` from the studio's **💾 Save state (.json)** (paste it in as the `config` value) or
from **⟨⟩ Export code**.

CI validates every submission (`pnpm gallery:validate`); a maintainer reviews and merges.

## Rules

- **Procedural only.** No embedded images or video (`data:` URIs). Reference the built-in
  palettes/maps or a hosted image URL. This keeps files small and the rights clean.
- One wave per file, filename in `kebab-case`, under 24 KB.
- Keep it SFW, and submit your own work.
