# Installing MIRAI

Unit 12c. MIRAI installs with npm from a GitHub tag, with one command. You need:

- **Node 22 or newer**;
- **git** (on macOS: `xcode-select --install`), with your name and email set
  (`git config --global user.name …` and `user.email …`), since MIRAI's commits carry them.

```bash
npm install -g github:jetmirhaxhisefa/mirai#v0.2.0
```

Open a new terminal, then:

```bash
mirai --version        # 0.2.0
mirai which            # outside a repo: "not inside a git repository"
```

- **`mirai version`** (or `mirai --version`) prints the version.
- **`mirai help`** lists every command; `mirai help <command>` (or `mirai <command> --help`)
  shows one command's usage and options.
- **Every config key** is in [config.md](config.md); [README.md](README.md) lists every page.

`-g` puts the `mirai` command in npm's global bin folder, which is on your PATH. So `mirai`
runs from any folder, with no alias and nothing set up per repo.

Installing runs none of MIRAI's code: MIRAI has no install scripts and no dependencies.

## Set up a repo

```bash
cd your-repo
mirai init --branch main     # or without --branch when the repo has a remote with a default branch
git add -A && git commit -m "Install MIRAI"
mirai which                  # names the copy committed on main
```

**Who runs what:**

- The global `mirai` is only the launcher. In a repo, it runs **that repo's pinned copy**
  (`.mirai/framework/`), committed on the integration branch.
- `mirai init` prints the install command your teammates run, for the version it installed.
- A teammate with a fresh clone of a repo that already has MIRAI runs `mirai init --join`.

## Versions

| Your launcher | The repo pins | What happens |
|---|---|---|
| the same | 0.2.0 | It runs the repo's copy. |
| newer | an older one | It runs the repo's copy. `mirai which` adds: "`mirai init --refresh` moves it to <yours>". |
| older | a newer one | **Refused:** "this repo pins MIRAI X, newer than this launcher". The message ends with the command that updates the launcher: `npm install -g github:jetmirhaxhisefa/mirai#vX`. |

To update, run the install command again with the new tag.

## Two snags

**`EACCES` when installing.** Your Node's global folder belongs to someone else, such as a
Homebrew Node another user installed. npm's message suggests running it as root. **Don't use
`sudo`**: root would own the files, and your user couldn't update them. Give npm a folder of your
own instead:

```bash
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
# open a new terminal, then run the install command again
```

**nvm.** With nvm, a global install belongs to one Node version. After `nvm use 24`, `mirai`
isn't there until you install it for that version too.

## Uninstall

```bash
npm uninstall -g mirai
```

This removes the command and the package.

- **What stays:** MIRAI's store, which holds your repos' records and launches, at
  `~/Library/Application Support/mirai`. Your key stays at `~/.config/mirai`.
- **To remove them too:** delete both folders. Your key can't be recovered, and its public half
  is still in each repo's `.mirai/keys/`.
