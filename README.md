# atomic-design-shadcn

**An Agent Skill that stops AI coding agents from turning your React/Next.js app into a pile of 800-line page components.**

It gives the agent a strict, machine-checkable architecture — Atomic Design layered on top of
shadcn/ui — and a validator that fails the build when the agent breaks it.

Works with Claude Code, Claude Cowork, Codex and Cursor.

---

## The problem

Ask any coding agent for "a dashboard page" and you reliably get the same thing:

- One `page.tsx`, 600 lines, JSX nested nine levels deep.
- Raw `<button>` and `<input>` scattered everywhere, even though shadcn/ui is installed and
  has a `Button` two imports away.
- A hand-rolled dropdown, because the agent never checked the registry before inventing one.
- `fetch()` calls buried four levels down inside a leaf component.
- `margin-top` hardcoded on a card because it happened to look right on the page it was
  written for — and wrong on every other page that reuses it.
- New folders appearing each session: `features/`, `widgets/`, `containers/`, `views/`.

Each individual file looks fine in review. The codebase still rots, because **nothing
enforces where a component belongs.** Agents are excellent at local decisions and have no
memory of your architecture between sessions. Prose instructions in a `CLAUDE.md` don't hold:
they're advisory, unverifiable, and quietly ignored the moment a task gets complicated.

The result is a codebase that is fast to generate and impossible to maintain.

## The solution

This skill replaces advice with **rules that are checked**.

It defines a one-way layer model where every layer has an exact directory, an exact list of
layers it may import from, and an exact list of things it may never do. On top of that sits
`scripts/validate-atomic.mjs` — a real validator that parses your source, applies the rules,
and exits non-zero on violation. Each rule carries an id, so every error traces back to the
rule that produced it.

The agent doesn't merely *know* the architecture. It cannot ship work that violates it and
still pass the gate.

Three things make it work:

1. **A layer model with no ambiguity.** There is exactly one correct folder for any component.
   "Where does this go?" always has an answer.
2. **shadcn/ui as the mandatory substrate.** The agent must search the registry before
   inventing a primitive.
3. **A validator, not a vibe.** `node scripts/validate-atomic.mjs .` must exit 0.

---

## What this skill forces the agent to do

### It forces a plan before any code

The agent must write the full layer inventory — which atoms, molecules, organisms, sections,
template and page — **and state it in chat** before opening an editor. No more discovering the
architecture halfway through a 600-line file.

### It forces the registry search

Before writing a primitive, the agent must call the shadcn MCP server:
`search_items_in_registries` → `view_items_in_registries` → `get_add_command_for_items`.
Hand-rolling something shadcn already ships is a violation, not a preference.

### It forces bottom-up construction

`ui → atoms → molecules → organisms → sections → template → page`. A layer is finished before
the next one starts. This is what makes components reusable by construction rather than by
later refactor.

### It forces the layer model

| Layer | Lives in | May import |
|---|---|---|
| **ui** (layer 0) | `components/ui/` | `ui`, `lib` |
| **atoms** | `components/atoms/` | `ui` |
| **molecules** | `components/molecules/` | `ui`, `atoms` |
| **organisms** | `components/organisms/` | `ui`, `atoms`, `molecules`, `server/actions` |
| **sections** | `components/sections/*Section.tsx` | + `server/queries` |
| **templates** | `components/templates/*Template.tsx` | nothing — `react` + `cn` only |
| **providers** | `components/providers/` | `ui`, external |
| **pages** | `app/**/page.tsx` | `templates`, `organisms`, `sections`, `server/*` |

Imports flow one way only. Full table, including shell, boundary and route-asset layers, is in
[SKILL.md](SKILL.md).

### It forces the eight hard rules

Each is enforced by a named validator rule id:

1. **shadcn first** `[structure]` — `components/ui/` is layer 0 and must exist. Extend it with
   `cva` variants; never wrap a primitive just to rename it.
2. **One-way imports only** `[import-direction]` `[same-layer-import]` — same-layer imports are
   forbidden above layer 0. If you need one, that dependency belongs one layer down.
3. **Exactly two directories may contain `.tsx`** `[layer-unknown]` `[barrel]` — `app/` (route
   files) and `components/<layer>/`. `features/`, `views/`, `modules/`, `widgets/`,
   `containers/` are **not** layers. Any JSX at all in `lib/` or `hooks/` is an error — a
   lowercase `buildRows()` returning markup launders every rule just as well as a component
   would. No barrel `index.ts` inside a layer.
4. **No raw interactive HTML outside `components/ui/`** `[raw-html]` — not even in atoms. No
   `<button> <input> <select> <textarea> <a> <img> <table> <dialog>`. Use the shadcn primitive,
   `next/link`, `next/image`. Layout elements stay free.
5. **An atom's root carries no margin and no position** `[atom-spacing]` — only parents space
   their children, only templates set the page grid. This is what makes an atom reusable.
6. **The 3-node extraction rule** `[god-component]` — any JSX block ≥3 nested elements deep
   *with a name you can say out loud* must be extracted to the layer below. **This is the rule
   that kills god components.**
7. **Data flows down from the page** `[data-fetch]` `[client-boundary]` — only `page.tsx` and
   `*Section.tsx` fetch. No `fetch`/`axios` in a component, no `useEffect` that awaits.
   `"use client"` goes at the lowest layer that needs it.
8. **A page is data + metadata + one template** `[page-shape]` `[naming]` — one default export,
   no `className`, no second component in the file.

### It forces validation, with a deliberately narrow escape hatch

```bash
node scripts/validate-atomic.mjs .        # must exit 0
```

| Flag | Purpose |
|---|---|
| `--app <dir>` | validate one workspace in a monorepo |
| `--json` | machine-readable output for CI |
| `--allow-blanket-ignore` | permit blanket ignores (requires justification) |
| `--warn-only` | ⛔ forces exit 0 even with errors — **diagnostic only, never a gate** |

Suppressing a rule requires naming it and saying why, on the violating line or the one above:

```ts
// atomic-ignore raw-html — Satori needs a bare <img> in this OG route
```

A real rule id is required. `all` is refused. Every use must be justified in chat.

---

## Install

### Before you start

You must have a Next.js app. The install stops if the folder is not a Next.js app.

If you have no app, make one first:

```bash
npx create-next-app@latest my-app
```

You must also have Node.js 18 or later. You do not need `components.json`. The installer
makes that file for you.

### Step 1 - install the skill

Go to your Next.js app. Then type this command:

```bash
npx skills add anodeaGr/atomic-design-shadcn
```

On Windows, add `--copy` if you see a symlink error.

### Step 2 - install the parts

Tell your agent:

```
/atomic-design-shadcn --install
```

The agent installs three parts:

| Part | Function |
|---|---|
| The shadcn MCP server | It finds shadcn components for the agent. |
| The settings | They let the agent use the server. No questions occur. |
| The shadcn skills | They tell the agent how to use shadcn. |

### Step 3 - restart your client

The client reads MCP servers one time, at start. Close your client. Then start it again.

### Step 4 - check the install

```bash
node <path-to-skill>/scripts/install.mjs --status
```

The command shows the state of each part. It changes nothing:

```
  Your setup: Next.js app yes · components.json yes · MCP server yes · settings yes · shadcn skills yes
  Ready - all parts are installed.
  Next: restart your client. Then type /mcp to see "shadcn".
```

The installer is safe to run again. It adds the missing parts only.

For a manual install, for other tools, or if there is a problem, see **[INSTALL.md](INSTALL.md)**.

---

## Repository contents

| File | |
|---|---|
| `SKILL.md` | the skill itself — layer model, workflow, the eight rules |
| `REFERENCE.md` | layer contracts, decision tree, shadcn↔atomic map, RSC boundary, forms, migration |
| `EXAMPLES.md` | a full worked Next.js dashboard, every layer |
| `INSTALL.md` | the install process, verification and troubleshooting |
| `scripts/validate-atomic.mjs` | the validator |
| `scripts/install.mjs` | the dependency installer |

---

## License

**MIT.** Free to use, modify, distribute and use commercially. See [LICENSE](LICENSE) for
the full terms.

Note: this skill modifies local configuration files and installs third-party dependencies.
Review it before use.
