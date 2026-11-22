# Stage 4: connect

1. **The host.** `mirai doctor`'s Host CLIs item names `gh` or `glab`. If neither, the owner logs in
   (stage 5, line 2). For GitLab, the owner's own `GLAB_CONFIG_DIR` is used for every `glab` call:
   ask which folder; never use glab's default config.
2. **The document store** (`[docs] store` in `.mirai/config.toml`, docs/stores.md): `repo`
   (default; teammates see the documents) or `local` (this Mac only). Ask; recommend `repo` for a
   team project. The config is the owner's file: give them the exact line to set.
3. **CI.** Which checks the integration branch requires: list the test levels the baseline
   records (`baseline show`), recommend requiring each, and say that stage 5's line 7 is where the
   owner sets it on the host. Until unit 54, the owner's merge is the gate.
4. **Playwright,** only if the owner says yes: a minimal container-based setup (a service in the
   compose file with the browsers, a test level for it). Ask first; the default is no.

End: commit (`git add -A`, `git commit -m "MIRAI setup: connect"`), then `setup done` with
`connect`.
