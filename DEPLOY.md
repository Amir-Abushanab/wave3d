# Deploying & releasing

CI lives in [`.github/workflows`](.github/workflows):

- **`ci.yml`** — on every push / PR to `main`: `pnpm check` (format, lint, typecheck, depcruise, knip, skill validate) + `pnpm build`. On a push to `main` it then deploys the studio to Cloudflare Pages **if** the Cloudflare secrets are set.
- **`release.yml`** — on push to `main`, [Changesets](https://github.com/changesets/changesets) opens a "Version Packages" PR from any pending changesets; merging that PR publishes the bumped `@wave3d/*` packages to npm via OIDC / Trusted Publishing.

Both need some one-time account setup, below. Until you do it, CI still runs green — it just skips the deploy.

## 1. Deploy the studio + gallery → Cloudflare Pages

The **`apps/studio`** app is one multi-page Vite build: the studio at `/` and the wave gallery at `/gallery/` (its `gallery/index.html` entry). `pnpm --filter wave-studio build` produces `apps/studio/dist`, deployed to Cloudflare Pages as project **`wave-studio`**.

One-time:

1. **Create a Cloudflare API token.** Dashboard → _My Profile_ → _API Tokens_ → _Create Token_ → template **"Edit Cloudflare Workers"** (or a custom token with **Account → Cloudflare Pages → Edit**). Copy it.
2. **Get your Account ID** from the Cloudflare dashboard (Workers & Pages overview, or the dashboard URL).
3. **Add two GitHub repo secrets** (repo → _Settings_ → _Secrets and variables_ → _Actions_):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. _(Not needed — the workflow creates the project on its first deploy. Do it by hand only if you prefer.)_ Create it explicitly:
   ```sh
   pnpm dlx wrangler login
   pnpm dlx wrangler pages project create wave-studio --production-branch=main
   ```

Then **push to `main`** → CI builds and deploys. The live URLs are `https://wave-studio.pages.dev` (studio) and `https://wave-studio.pages.dev/gallery/` (gallery), until you add a custom domain.

### Custom domain (wave3d.app)

In the Cloudflare Pages project → _Custom domains_ → add `wave3d.app` (and `www`). If the domain's DNS is on Cloudflare it's a click; otherwise add the CNAME it shows you.

## 2. Publish the packages → npm

The **`@wave3d`**-scoped packages publish via [Changesets](https://github.com/changesets/changesets). `@wave3d/core`, `@wave3d/react`, and `@wave3d/element` are a **fixed** group — they always share one version; **`@wave3d/vite`** (the dev-time Vite plugin) versions independently.

### Recording a change

Whenever you change a published package, add a changeset — it drives the next version bump and changelog:

```sh
pnpm changeset          # pick the packages, the bump (patch/minor/major), write a summary
```

Commit the generated `.changeset/*.md` file alongside your change.

### First release (one-time, from your laptop)

npm can't do a package's **first** publish over OIDC, so bootstrap `0.1.0` by hand. First create the free **`@wave3d` organization** on [npmjs.com](https://www.npmjs.com/org/create) (the scope is public; each package already sets `publishConfig.access: "public"`), then:

```sh
npm login               # uses your account's 2FA — nothing stored anywhere
pnpm install
pnpm release            # builds + `changeset publish` → publishes @wave3d/{core,react,element}@0.1.0
```

### Enable tokenless CI releases (one-time, right after the first publish)

On **each** package's npm page → _Settings_ → _Trusted Publisher_ → add provider **GitHub Actions**, repository **`Amir-Abushanab/wave3d`**, workflow **`release.yml`** (leave _Environment_ blank). Now CI publishes over OIDC with **no `NPM_TOKEN`** — nothing to leak or rotate — and every release gets provenance automatically.

### Adding a new package

A new package needs the same one-time bootstrap as the originals. The preflight gate keys off `@wave3d/core` (already on npm), so CI will _try_ to publish the newcomer — but npm can't do a package's **first** publish over OIDC, so the Release workflow **fails** on it until you bootstrap by hand:

1. `npm login` → `pnpm release` from your laptop — publishes the new package's first version (plus any pending bumps).
2. Add its **Trusted Publisher** on npmjs.com — same values as above (GitHub Actions · `Amir-Abushanab/wave3d` · `release.yml`).

After that it releases tokenlessly via CI like the rest.

### Ongoing releases (automated)

1. Merge PRs that include changesets into `main`.
2. Changesets opens/updates a **"Version Packages"** PR (bumps the shared version, writes `CHANGELOG.md`).
3. **Merge that PR** → CI publishes the new version, tags it, and cuts a GitHub Release.

> **Fallback:** pnpm's OIDC support is still maturing — if CI publishing 404s, create a granular **`NPM_TOKEN`** (scoped to `@wave3d`, read-write, no IP allowlist) and uncomment the `NODE_AUTH_TOKEN` line in `release.yml`.

## What's _not_ wired up here

- **The gallery** is a separate, unbuilt Cloudflare app (see the local `docs/gallery-plan.md` design note) — not part of this deploy.
