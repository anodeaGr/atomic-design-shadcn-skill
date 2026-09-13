# Install

This page tells you how to install the skill. Do one step at a time.

---

## Before you start

You must have two things.

**1. A Next.js app.**

This skill is for Next.js. The installer stops if the folder is not a Next.js app.

A folder is a Next.js app if it has one of these:

- a `next.config.js`, `next.config.mjs`, `next.config.ts` or `next.config.cjs` file
- `next` in `dependencies` or `devDependencies` in `package.json`

If you have no app, make one. Type this command:

```bash
npx create-next-app@latest my-app
```

**2. Node.js 18 or later.**

To see your version, type this command:

```bash
node --version
```

You do not need `components.json`. The installer makes this file for you.

---

## Step 1 — Install the skill

Go to your Next.js app:

```bash
cd my-app
```

Type this command:

```bash
npx skills add anodeaGr/atomic-design-shadcn
```

The tool asks two questions:

1. Which agent do you use? Select your agent.
2. Do you want this app only, or all apps? Select one.

On Windows, the tool can show a symlink error. If this occurs, add `--copy`:

```bash
npx skills add anodeaGr/atomic-design-shadcn --copy
```

---

## Step 2 — Install the parts

The skill needs three parts. Step 2 installs all three.

| Part | Function |
|---|---|
| The shadcn MCP server | It finds shadcn components for the agent. |
| The settings | They let the agent use the server. No questions occur. |
| The shadcn skills | They tell the agent how to use shadcn. |

### The easy way

Tell your agent:

```
/atomic-design-shadcn --install
```

The agent finds the correct folders. Then the agent installs the three parts.

### The manual way

Use this way if you do not use an agent.

Go to your Next.js app. Then run the installer. Give the full path to the installer.

The installer changes the folder that you are in. It does not change the folder that holds it.

If you installed the skill for this app only:

```bash
node .claude/skills/atomic-design-shadcn/scripts/install.mjs
```

If you installed the skill for all apps, macOS or Linux:

```bash
node ~/.claude/skills/atomic-design-shadcn/scripts/install.mjs
```

If you installed the skill for all apps, Windows PowerShell:

```powershell
node "$env:USERPROFILE\.claude\skills\atomic-design-shadcn\scripts\install.mjs"
```

If you installed the skill for all apps, Windows cmd:

```
node "%USERPROFILE%\.claude\skills\atomic-design-shadcn\scripts\install.mjs"
```

> **Warning**
> Do not use `~` on Windows. PowerShell and cmd do not change `~` to your home folder.
> The command fails. Use `$env:USERPROFILE` or `%USERPROFILE%`.

To stay in your current folder, give the path to your app:

```bash
node <path-to-skill>/scripts/install.mjs --project-root <path-to-your-app>
```

---

## Step 3 — Restart your client

The client reads MCP servers one time, at start.

Close your client. Then start your client again.

---

## Step 4 — Check the install

Type this command:

```bash
node <path-to-skill>/scripts/install.mjs --status
```

The command shows the state of each part. It changes nothing.

A correct install looks like this:

```
  Your setup: Next.js app yes · components.json yes · MCP server yes · settings yes · shadcn skills yes
  Ready - all parts are installed.
  Next: restart your client. Then type /mcp to see "shadcn".
```

Then do two more checks:

1. Type `/mcp` in your client. The list must show `shadcn`.
2. Ask the agent to find the `button` component. The agent must show results. No permission question must occur.

---

## If there is a problem

| Message or problem | Cause | What to do |
|---|---|---|
| `this skill needs a Next.js app` | The folder is not a Next.js app. | Go to your Next.js app. Or add `--project-root <path>`. |
| `run from inside the skill folder` | You are in the skill folder. | Go to your app folder first. |
| `Cannot find module 'C:\...\~\.claude\...'` | You used `~` on Windows. | Use `$env:USERPROFILE` or `%USERPROFILE%`. |
| `shadcn` is not in `/mcp` | The client did not restart. | Close the client. Start it again. |
| `shadcn` is still not in `/mcp` | There is no `components.json`. | Type `npx shadcn@latest init -d` in your app. |
| A permission question occurs at each search | The settings are not correct. | Run the installer again. |
| `EPERM` on Windows | Windows blocked a symlink. | Add `--copy` to the `skills add` command. |
| Codex does not see the server | Codex needs a manual change. | See *Other tools* below. |

---

## Options

| Option | Function |
|---|---|
| `--status` | Show the state of each part. Change nothing. |
| `--dry-run` | Show the changes. Write nothing. |
| `--project-root <path>` | Set the app to change. |
| `--global` | Write user settings. Do not use an app. |
| `-a <agent>` | Add an agent, for example `-a codex`. Use it more than one time. |
| `--client <name>` | Add a client: `claude`, `cursor`, `vscode` or `codex`. |
| `--copy` | Copy the files. Do not use symlinks. |
| `--no-init` | Do not make `components.json`. |
| `--help` | Show all options. |

The installer is safe to run again. It adds the missing parts. It does not remove your settings.

---

## Other tools

The installer writes the correct file for each client. This table shows the files.

| Client | File | Key |
|---|---|---|
| Claude Code | `.mcp.json` in your app | `mcpServers` |
| Cursor | `.cursor/mcp.json` in your app | `mcpServers` |
| VS Code | `.vscode/mcp.json` in your app | `servers` |
| Codex | `~/.codex/config.toml` in your home folder | `[mcp_servers.shadcn]` |

For Claude Code, Cursor and VS Code, the file holds this server:

```json
{
  "command": "npx",
  "args": ["shadcn@latest", "mcp"]
}
```

For Codex, the file holds this block:

```toml
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

To add a client, use `--client`:

```bash
node <path-to-skill>/scripts/install.mjs --client cursor --client vscode
```

### Claude Cowork

Cowork has no command line tool. Do these steps:

1. Make a ZIP file of the `atomic-design-shadcn` folder.
2. Make sure that the folder is at the top of the ZIP file.
3. Open Cowork.
4. Click **Customize**.
5. Click **+**.
6. Click the **Skills** tab.
7. Upload the ZIP file.

---

## Sources

- shadcn MCP — https://ui.shadcn.com/docs/mcp
- shadcn skills — https://ui.shadcn.com/docs/skills
- skills CLI — https://github.com/vercel-labs/skills
- Claude Code MCP settings — https://code.claude.com/docs/en/mcp
