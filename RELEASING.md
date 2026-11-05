# Releasing

Releases are automatic. Nobody runs `npm publish` by hand after the first
release.

## How it works

1. Pull requests are squash-merged with a Conventional Commit title.
2. On every push to `main`, the **Release** workflow runs
   [release-please](https://github.com/googleapis/release-please), which opens
   or updates a pull request titled `chore(main): release x.y.z` containing
   the version bump and the generated `CHANGELOG.md` entry.
3. Merging that pull request creates the `vx.y.z` tag and GitHub release.
4. The `build` job checks out the tag, runs the full check and packs the
   tarball, with no publish permission at all.
5. The `publish` job waits for approval on the protected `npm`
   environment, then publishes that tarball through **Trusted Publishing**
   (OIDC). It installs and runs no project code, so no dependency can reach
   the publish token. npm attaches a provenance statement linking the
   package to that exact workflow run.

Before 1.0.0, a breaking change bumps the minor version and a feature bumps
the patch version (`bump-minor-pre-major`, `bump-patch-for-minor-pre-major`).

## One-time setup

npm can only trust a workflow for a package that already exists, so the
first version is published once by a maintainer.

1. **First publish**: tag the initial commit `v0.1.0`, create its GitHub
   release, then from a clean checkout of that tag:

   ```bash
   pnpm install --frozen-lockfile && pnpm check
   npm publish --access public   # asks for your npm 2FA code
   ```

2. **Trusted publisher**: on npmjs.com open the package → Settings →
   Trusted publishing → GitHub Actions, and enter:
   - Organization or user: `gydr-ai`
   - Repository: `safe-fetch`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
   - Allowed actions: tick `npm publish`
3. **Lock it down**: Settings → Publishing access → _Require two-factor
   authentication and disallow tokens_.
4. **GitHub environment**: Settings → Environments → `npm` → add yourself
   (or the maintainers team) as a required reviewer. The setup script
   already limits deployments to `main`.
5. **Optional GitHub App** so CI also runs on the release pull request:
   create an org-owned GitHub App with _Contents_ and _Pull requests_
   read/write, install it on this repository, then set the repository
   variable `RELEASE_APP_ID` and secret `RELEASE_APP_PRIVATE_KEY`. Without
   it, the release pull request is opened with `GITHUB_TOKEN`, which GitHub
   does not let trigger other workflows.

## Verifying a release

```bash
npm view @gydr-ai/safe-fetch --json | jq '.dist.attestations'
npm audit signatures
```
