# Releasing MIRAI

Unit 12c (Jet's decision 2). A release is a `vX.Y.Z` tag on `main`, cut when you decide.
Teammates install it with `npm install -g github:jetmirhaxhisefa/mirai#vX.Y.Z`.

1. **Bump the version in a PR:** `package.json`'s `version` goes to the new `X.Y.Z`. The PR can be
   a unit's own PR or one of its own. `main` is protected, so the bump goes through a PR.
2. **After it's merged, cut the release:**

   ```bash
   gh release create vX.Y.Z --target main --generate-notes
   ```

3. **The release check runs** on the new tag (`.github/workflows/release.yml`):
   - the tag is `v` + `package.json`'s version (`tools/release-check.js`);
   - the tests pass on Ubuntu;
   - the tagged package installs into an empty npm prefix, and `mirai init`, `which` and `status`
     work in a fresh repo.

   A red check means the release is broken. Fix the cause in a PR, delete the release and the
   tag (`gh release delete vX.Y.Z --cleanup-tag`), then release again. A tag teammates may
   already have installed is never moved: use the next version instead.

Nothing is published anywhere else. There's no registry and no install script.
