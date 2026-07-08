# Deploying & releasing

CI lives in [`.github/workflows`](.github/workflows):

- **`ci.yml`** — on every push / PR to `main`: `pnpm check` (format, lint, typecheck, depcruise, knip, skill validate) + `pnpm build`. On a push to `main` it then deploys the studio to Cloudflare Pages **if** the Cloudflare secrets are set.
- **`release.yml`** — on a `v*` tag (or a manual run): builds and publishes the `@wave3d/*` packages to npm.

Both need some one-time account setup, below. Until you do it, CI still runs green — it just skips the deploy.

## 1. Deploy the studio → Cloudflare Pages

The studio is a static Vite SPA (`apps/studio`, `base: "./"`), deployed to Cloudflare Pages as project **`wave-studio`**.

One-time:

1. **Create a Cloudflare API token.** Dashboard → _My Profile_ → _API Tokens_ → _Create Token_ → template **"Edit Cloudflare Workers"** (or a custom token with **Account → Cloudflare Pages → Edit**). Copy it.
2. **Get your Account ID** from the Cloudflare dashboard (Workers & Pages overview, or the dashboard URL).
3. **Add two GitHub repo secrets** (repo → _Settings_ → _Secrets and variables_ → _Actions_):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. _(Optional — the first deploy auto-creates the project otherwise.)_ Create it explicitly:
   ```sh
   pnpm dlx wrangler login
   pnpm dlx wrangler pages project create wave-studio --production-branch=main
   ```

Then **push to `main`** → CI builds and deploys. The live URL is `https://wave-studio.pages.dev` until you add a custom domain.

### Custom domain (wave3d.app)

In the Cloudflare Pages project → _Custom domains_ → add `wave3d.app` (and `www`). If the domain's DNS is on Cloudflare it's a click; otherwise add the CNAME it shows you.

## 2. Publish the packages → npm

The three packages — `@wave3d/core`, `@wave3d/react`, `@wave3d/element` — publish under the **`@wave3d`** scope.

One-time:

1. **Create the free `@wave3d` organization** on [npmjs.com](https://www.npmjs.com/org/create) (the scope is public; each package already sets `publishConfig.access: "public"`).
2. **Create an npm access token** (npmjs → _Access Tokens_ → _Generate_ → **Automation**, or a Granular token with publish rights to the `@wave3d` scope).
3. **Add it as the GitHub repo secret `NPM_TOKEN`.**

To release:

```sh
# bump versions first (all three are 0.1.0 today), then:
git tag v0.1.0
git push origin v0.1.0      # → the Release workflow builds + publishes
```

Or run the **Release** workflow manually from the Actions tab.

> Prefer to publish the first release locally? `pnpm -r build`, then
> `pnpm -r --filter "@wave3d/*" publish` (after `npm login`) does the same thing.

## What's _not_ wired up here

- **The gallery** is a separate, unbuilt Cloudflare app (see the local `docs/gallery-plan.md` design note) — not part of this deploy.
- **Versioning** is manual today. If releases get frequent, add [Changesets](https://github.com/changesets/changesets) and have `release.yml` consume it.
