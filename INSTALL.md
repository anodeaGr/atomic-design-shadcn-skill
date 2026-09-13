# Installing `atomic-design-shadcn`

This is the process `--install` mode follows. Run it once per machine (global scope) or once
per project (project scope). Every step is idempotent — re-running repairs a partial install
rather than duplicating anything.

The skill has **three dependencies**. It is not functional without all three:

| # | Dependency | Why the skill needs it |
|---|---|---|
| 1 | **shadcn MCP server** | Workflow step 2 calls `mcp__shadcn__search_items_in_registries`, `view_items_in_registries` and `get_add_command_for_items`; step 4 calls `get_audit_checklist`. Without the server those rules cannot be satisfied. |
| 2 | **MCP server allow-listed in settings** | Otherwise every registry lookup raises a permission prompt and the bottom-up build stalls. |
| 3 | **shadcn/ui skills** | Supplies the component-level knowledge these architecture rules sit on top of. |

---

## 0. Prerequisites

- **Node.js 18+** (`node --version`). `npx` ships with it.
- **A Next.js app.** This skill is for Next.js. The installer stops if the folder is not a
  Next.js app. It looks for one of these:
  - a `next.config.js`, `next.config.mjs`, `next.config.ts` or `next.config.cjs` file
  - `next` in `dependencies` or `devDependencies` in `package.json`

  If you have no app yet, make one first:
  ```bash
  npx create-next-app@latest my-app
  ```
- **`components.json` in that project.** If it is missing, `scripts/install.mjs` runs
  `npx shadcn@latest init -d` for you (disable with `--no-init`). To do it by hand:
  ```bash
  npx shadcn@latest init -d
  ```
- Any of `npx` / `pnpm dlx` / `yarn dlx` / `bunx` works. This document uses `npx`; substitute freely.

Platform note: every command below is identical on **Windows, macOS and Linux**. The only
divergences are config file locations (marked per-OS where they differ) and symlink handling
in step 3.

---

## 1. Install the shadcn MCP server

Run from the **project root** — the directory holding `components.json`:

```bash
npx shadcn@latest mcp init --client claude
```

`--client` accepts `claude`, `cursor`, `vscode`, `codex`. Run it once per client you use.

### What each client ends up with

**Claude Code** — writes `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

**Cursor** — `.cursor/mcp.json`, same `mcpServers` shape.

**VS Code** — `.vscode/mcp.json`. Note the key is `servers`, not `mcpServers`:

```json
{
  "servers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

**Codex** — must be configured by hand in `~/.codex/config.toml`
(Windows: `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

### Alternative: register through Claude Code itself

Instead of `mcp init` you may register the server with the CLI. Pick the scope deliberately:

```bash
# project scope — writes .mcp.json, shared with the team via version control
claude mcp add shadcn --scope project -- npx shadcn@latest mcp

# user scope — writes ~/.claude.json, available in every project
claude mcp add shadcn --scope user -- npx shadcn@latest mcp
```

**Restart the client after this step.** MCP servers are read at startup.

---

## 2. Allow-list the server in settings

A project `.mcp.json` is untrusted by default: Claude Code prompts before starting it, then
prompts again per tool call. Both prompts are removed by settings keys.

`enabledMcpjsonServers` is only honoured in a settings file **not checked into the repo**, so
it belongs in `.claude/settings.local.json` (this project) or `~/.claude/settings.json` (every
project). Putting it in the committed `.claude/settings.json` has no effect.

Merge this into `.claude/settings.local.json`:

```json
{
  "enabledMcpjsonServers": ["shadcn"],
  "permissions": {
    "allow": [
      "mcp__shadcn",
      "Bash(npx shadcn@latest:*)",
      "Bash(node scripts/validate-atomic.mjs:*)"
    ]
  }
}
```

- `"mcp__shadcn"` allows every tool on the server. To be narrower, list them individually
  instead: `"mcp__shadcn__search_items_in_registries"`,
  `"mcp__shadcn__view_items_in_registries"`, `"mcp__shadcn__get_add_command_for_items"`,
  `"mcp__shadcn__get_audit_checklist"`.
- `"enableAllProjectMcpServers": true` is the blunter alternative — it approves *every* server
  in `.mcp.json`, not only shadcn. Prefer the named list.

Settings file locations, highest precedence first:

| Scope | Path |
|---|---|
| Project, local (not committed) | `.claude/settings.local.json` |
| Project, shared (committed) | `.claude/settings.json` |
| User (all projects) | `~/.claude/settings.json` — Windows: `%USERPROFILE%\.claude\settings.json` |

**Merge, never overwrite.** If the file already exists, add the keys and append to
`permissions.allow`, leaving everything else intact.

---

## 3. Install the shadcn/ui skills

The architecture rules here assume the official shadcn/ui skills are present.

Run these **from the project root** — the `skills` CLI resolves project scope from the working
directory, so running them elsewhere silently installs into the wrong folder. The source
`shadcn/ui` currently delivers two skills: `shadcn` and `migrate-radix-to-base`.

```bash
# project scope, Claude Code
npx skills add shadcn/ui -a claude-code -y

# global — available in every project
npx skills add shadcn/ui -a claude-code -g -y

# several agents at once
npx skills add shadcn/ui -a claude-code -a codex -a cursor -y
```

Where the files land:

| Agent | `--agent` | Project path | Global path |
|---|---|---|---|
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.codex/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |

**Windows symlinks.** The installer symlinks by default, which needs Developer Mode or an
elevated shell. If it fails, force copies:

```bash
npx skills add shadcn/ui -a claude-code -y --copy
```

**Claude Cowork** has no CLI installer. Zip the skill folder — the folder itself must be the
zip root, and the folder name must match the skill name — then in Cowork open
**Customize → + → Skills** and upload the zip.

Verify with `npx skills list`.

---

## 4. Install this skill

Same mechanism, pointed at this repository:

```bash
npx skills add anodeaGr/atomic-design-shadcn
```

The CLI prompts for the agents to install to and for project vs global scope. To answer those
up front instead — useful in CI or a setup script:

```bash
# project scope, Claude Code
npx skills add anodeaGr/atomic-design-shadcn -a claude-code -y

# global
npx skills add anodeaGr/atomic-design-shadcn -a claude-code -g -y

# Windows, if symlinking fails
npx skills add anodeaGr/atomic-design-shadcn --copy
```

Manual equivalent — copy the whole folder, keeping `SKILL.md`, `REFERENCE.md`, `EXAMPLES.md`
and `scripts/` together:

| OS | Destination |
|---|---|
| macOS / Linux | `~/.claude/skills/atomic-design-shadcn/` |
| Windows | `%USERPROFILE%\.claude\skills\atomic-design-shadcn\` |

For Cowork, zip this folder and upload it as described in step 3.

### Locating `scripts/install.mjs` afterwards

`<skill-dir>` below means wherever step 4 put the skill. It depends on the scope you chose:

| Scope | `<skill-dir>` |
|---|---|
| Project | `<project>/.claude/skills/atomic-design-shadcn` |
| Global — macOS / Linux | `~/.claude/skills/atomic-design-shadcn` |
| Global — Windows | `%USERPROFILE%\.claude\skills\atomic-design-shadcn` |

**The installer configures the directory you run it *from*, not the directory it lives in.**
So `cd` to the project you want set up, then call the script by its full path:

```bash
# project-scoped skill, from the project root
node .claude/skills/atomic-design-shadcn/scripts/install.mjs

# globally-installed skill — macOS / Linux
node ~/.claude/skills/atomic-design-shadcn/scripts/install.mjs

# globally-installed skill — Windows PowerShell
node "$env:USERPROFILE\.claude\skills\atomic-design-shadcn\scripts\install.mjs"

# globally-installed skill — Windows cmd
node "%USERPROFILE%\.claude\skills\atomic-design-shadcn\scripts\install.mjs"
```

> **`~` is not expanded by PowerShell or cmd.** Writing `node ~/.claude/skills/...` on Windows
> fails with `Cannot find module 'C:\your\cwd\~\.claude\...'`. Use `$env:USERPROFILE` or
> `%USERPROFILE%` instead.

If you would rather not `cd`, name the project explicitly — this works from anywhere:

```bash
node <skill-dir>/scripts/install.mjs --project-root /path/to/your-project
```

Running the installer from inside the skill folder is refused with a message containing the
correct absolute paths, because there is no project there to configure.

To configure user-wide settings rather than a single project, use `--global`. Note that
`.mcp.json` is inherently per-project and has no global form — with `--global` and no project,
the installer tells you to register the server at user scope instead:

```bash
claude mcp add shadcn --scope user -- npx shadcn@latest mcp
```

---

## 5. Verify

Run all five. The install is complete only when every one passes.

| # | Check | Expected |
|---|---|---|
| 1 | `node --version` | v18 or higher |
| 2 | `/mcp` in Claude Code | `shadcn` listed as **connected** |
| 3 | Ask the agent to search the registry for `button` | returns results, no permission prompt |
| 4 | `npx skills list` | lists `shadcn`, `migrate-radix-to-base` and `atomic-design-shadcn` |
| 5 | `node <skill-dir>/scripts/validate-atomic.mjs . --warn-only` | runs and reports; exits 0 |

Check 5 uses `--warn-only` deliberately: here it is a smoke test that the validator executes.
Never use that flag as a quality gate — see SKILL.md workflow step 4.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `shadcn` missing from `/mcp` | client not restarted | restart the client; MCP servers load at startup |
| MCP server starts then exits | no `components.json` in the project root | `npx shadcn@latest init -d` |
| Permission prompt on every registry call | step 2 skipped, or the keys landed in the committed `.claude/settings.json` | move `enabledMcpjsonServers` to `.claude/settings.local.json` or `~/.claude/settings.json` |
| `EPERM` / `operation not permitted` during `skills add` on Windows | symlink creation blocked | re-run with `--copy`, or enable Developer Mode |
| Skill not picked up after install | wrong agent directory | run `npx skills list` and confirm the path matches the table in step 3 |
| Codex does not see the server | `mcp init` does not write Codex config | hand-edit `~/.codex/config.toml` per step 1 |
| `Cannot find module 'C:\...\~\.claude\skills\...'` | `~` is not expanded by PowerShell or cmd | use `$env:USERPROFILE` (PowerShell) or `%USERPROFILE%` (cmd) — see step 4 |
| `Install aborted: ... run from inside the skill folder` | you `cd`'d into the skill instead of your project | `cd` to the project first, or pass `--project-root <dir>`, or use `--global` |
| `Install aborted: this skill needs a Next.js app` | the folder is not a Next.js app | go to your Next.js app, or use `--project-root <path>`. No app yet? Run `npx create-next-app@latest my-app` |
| `shadcn init did not produce a components.json` | the project is not a framework shadcn recognises | run `npx shadcn@latest init` manually and answer its prompts, then re-run the installer |
| `/mcp` still empty after a restart, in a project with no `components.json` | the server exits at startup without one | create it, then restart again |

---

## Sources

- shadcn MCP — https://ui.shadcn.com/docs/mcp
- shadcn skills — https://ui.shadcn.com/docs/skills
- skills CLI — https://github.com/vercel-labs/skills
- Claude Code MCP settings — https://code.claude.com/docs/en/mcp
