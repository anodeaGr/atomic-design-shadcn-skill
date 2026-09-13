---
name: atomic-design-shadcn
description: Enforces Atomic Design (atoms → molecules → organisms → templates → pages) with shadcn/ui as the mandatory component base in React and Next.js projects. Use when building, scaffolding, refactoring, or reviewing any UI in a React/Next.js codebase — new pages, components, dashboards, landing pages, forms, design systems — or when the user mentions atomic design, component architecture, shadcn, component hierarchy, "where does this component go", god components, or UI folder structure. Also use before writing any .tsx that renders markup, and when auditing an existing site for architectural drift. Accepts --install to set up its own dependencies (shadcn MCP server, settings allow-list, shadcn/ui skills).
---

# Atomic Design + shadcn/ui

**The law: every rendered element traces to an atom. No page, template or organism ever renders raw interactive HTML.**
One-way layers, `components/ui/` (layer 0) as the substrate. This holds at any complexity — bigger sites get more components, never looser rules.

## `--install` mode

Trigger: the user message has `--install`. Also use this mode when the user asks to install or
to set up this skill.

**Run the three commands below. Run nothing else.**

Forbidden in this mode. Do not do any of these:

- Do not read `INSTALL.md`, `README.md` or `install.mjs`.
- Do not run `ls`, `dir`, `find`, `cat`, `head`, `sed` or `type`.
- Do not look in `.claude`, `.agents` or `skills-lock.json`.
- Do not run `--dry-run`.
- Do not write UI code in this turn.

`<SKILL_DIR>` is the folder that holds this file. You know this path. Do not search for it.
Put quotation marks around each path. Never write `~` in a command: PowerShell and cmd do not
change `~` to the home folder.

If the user gives an app folder, add `--project-root "<that folder>"` to command 1 as well.

### Command 1 — the gate. Always first.

```bash
node "<SKILL_DIR>/scripts/install.mjs" --gate
```

This command prints `PASS` or `FAIL` on the first line. It changes nothing.

| First line | Your action |
|---|---|
| `FAIL` | **STOP.** Show the output. Run no other command. |
| `PASS` | Take the `app:` path. Go to command 2. |

`PASS` gives the app folder on the second line, like this:

```
PASS
app: C:\code\my-app
```

Use that path as `<APP>` in command 2 and command 3.

**On `FAIL`, stop immediately.** Do not look for the app yourself. Do not list folders. Do not
read files. The gate has looked already. Show the output and wait for the user.

### Command 2 — install

```bash
node "<SKILL_DIR>/scripts/install.mjs" --project-root "<APP>"
```

This command can take one minute. It downloads the shadcn skills.

If it stops with an error, show the error to the user. The error text holds the correct
command. Do not try a different command. Do not explore the folders.

### Command 3 — report

```bash
node "<SKILL_DIR>/scripts/install.mjs" --status --project-root "<APP>"
```

Show the output. Then say this to the user:

> Restart your client. Then type `/mcp`. You must see `shadcn` in the list.

The client reads MCP servers one time, at start. So `/mcp` is empty before a restart. This is
correct. It is not an error.

---

This skill needs three parts: the shadcn MCP server, the settings, and the shadcn skills.
Workflow step 2 below does not work without them. If a `mcp__shadcn__*` call fails, stop. Run
`--install` first.

## The layer model

| Layer | Lives in | May import | Owns | Never |
|---|---|---|---|---|
| **ui** (layer 0) | `components/ui/` | `ui`, `lib` | shadcn primitive behaviour + `cva` variants | app logic, data |
| **atoms** | `components/atoms/` | `ui` | one indivisible thing; brand-locked | margin/position on its root, data, another atom |
| **molecules** | `components/molecules/` | `ui`, `atoms` | one small job; positions its atoms | data fetching, another molecule |
| **organisms** | `components/organisms/` | `ui`, `atoms`, `molecules`, `server/actions` | a UI section + its interaction state | data fetching, the page grid, another organism |
| **sections** | `components/sections/*Section.tsx` | `ui`, `atoms`, `molecules`, `organisms`, `server/queries` | one `await` behind a `<Suspense>` boundary | `"use client"`, layout, another section |
| **templates** | `components/templates/*Template.tsx` | nothing — `react` + `cn` only | the page grid and named `ReactNode` slots | importing any component, `"use client"`, data |
| **providers** | `components/providers/` | `ui`, external | app-wide context, mounted once in the root layout | atoms, molecules, organisms |
| **pages** | `app/**/page.tsx`, `loading.tsx`, `not-found.tsx` | `templates`, `organisms`, `sections`, `server/*` | data, metadata, exactly one `<XTemplate/>` | JSX layout, `className`, `"use client"`, a second component |
| **shell** | `app/**/layout.tsx`, `template.tsx`, `default.tsx` | `templates`, `organisms`, `sections`, `providers`, `ui` | providers, chrome, parallel-route slots | `"use client"` |
| **boundary** | `app/**/error.tsx`, `global-error.tsx` | `organisms`, `templates` | the reset UI. **Must** carry `"use client"` | anything else |
| **route asset** | **inside `app/`:** `opengraph-image` `twitter-image` `icon` `apple-icon` `route` `sitemap` `robots` `manifest` · **beside it:** `middleware` `instrumentation` `mdx-components` | unrestricted, capped at 120 lines | Next.js file conventions that resolve **by path** | living anywhere else — the filename buys nothing outside `app/` |

`server/types*` and `server/schemas*` are importable from every layer, and `import type` from `server/` is always legal.

## Workflow — always in this order

1. **Inventory before code.** Write the layer inventory (which atoms, molecules, organisms, sections, template, page) and state it in chat. Never open an editor first.
2. **Search shadcn before inventing.** `mcp__shadcn__search_items_in_registries` → `view_items_in_registries` → `get_add_command_for_items`. Hand-rolling a primitive shadcn already ships is a violation. Missing `components.json`: `npx shadcn@latest init -d`.
3. **Build strictly bottom-up.** ui → atoms → molecules → organisms → sections → template → page. A layer is finished before the next one starts.
4. **Validate.** `node <skill>/scripts/validate-atomic.mjs .` must exit 0. Then run the shadcn audit checklist (`mcp__shadcn__get_audit_checklist`) and typecheck.
   Flags: `--app <dir>` for one workspace in a monorepo, `--json` for machine output, `--allow-blanket-ignore` (needs justification).
   ⛔ `--warn-only` forces exit 0 even with errors — diagnostic only, **never** a gate. A missing `components.json` is itself an error.

## The eight hard rules

Each rule names the validator rule id it is enforced by, so any error traces back to the rule that produced it.

1. **shadcn first.** `[structure]` `components/ui/` is layer 0 and must exist. Extend it in place with `cva` variants — never wrap a primitive just to rename it.
2. **One-way imports only.** `[import-direction]` `[same-layer-import]` The table above is exhaustive. **Same-layer imports are forbidden above layer 0** — if you need one, that dependency belongs one layer down. Move it. `components/ui/` is the exception: layer 0 composes freely, because that is how shadcn ships (`ui/sidebar.tsx` imports `ui/button.tsx`).
3. **Exactly two directories may contain `.tsx`.** `[layer-unknown]` `[barrel]` `app/` (route files only) and `components/<layer>/`. `features/`, `views/`, `modules/`, `widgets/`, `containers/`, `lib/`, `hooks/` are **not** layers — a component there is an error, not a shortcut. **Any JSX at all** in `lib/` or `hooks/` is an error, capitalised component or not; a lowercase `buildRows()` returning markup launders every rule just as well. In a monorepo, a `.tsx` under no app's `components.json` is an error too. No barrel `index.ts` inside a layer: it hides which layer an import crosses.
4. **No raw interactive HTML outside `components/ui/`.** `[raw-html]` Not even in atoms: no `<button> <input> <select> <textarea> <a> <img> <table> <dialog>`. Use the shadcn primitive, `next/link`, `next/image`. (`<form>` is also allowed in the organism that owns the form; route assets are exempt because Satori needs raw elements.) Layout elements — `div section ul header nav span` — stay free.
5. **An atom's root element carries no margin and no position.** `[atom-spacing]` Only molecules/organisms space their children (`gap-*`, `space-y-*` on the parent). Only templates set the page grid. Inside the atom, its own parts may position freely.
6. **The 3-node extraction rule.** `[god-component]` Any JSX block inside an organism/section/template that is ≥3 nested elements deep *and* has a name you can say out loud must be extracted to the layer below. Inline JSX 3 levels deep inside a `.map()` is an error, and so is any file past 2× its layer's line cap. This is what stops god components.
7. **Data flows down from the page.** `[data-fetch]` `[client-boundary]` Only `app/**/page.tsx` and `components/sections/*Section.tsx` fetch. Everything below receives props. No `fetch`/`axios` in a component, no `useEffect` that awaits, no `useQuery`/`useSWR` without page-seeded `initialData`. `"use client"` goes at the lowest layer that needs it — molecule or organism, never template, section, page or layout. `error.tsx` is the one route file that must carry it.
8. **A page is data + metadata + one template.** `[page-shape]` `[naming]` One default export, no `className`, no second component declared in the file. Templates end in `Template`, sections in `Section`. Parallel (`@slot`) and intercepting (`(.)`) routes are exempt from the one-template rule — an intercepted page renders a single organism.

## Scaling to a complex site

Namespace by feature *inside* a layer, never above it: `components/organisms/checkout/CartSummary.tsx`. Route-only components still live under `components/`; `app/` holds route files only. Lists never inline their item markup — `organisms/ProductGrid` renders `molecules/ProductCard`. Templates take named slots so one template serves many pages. Monorepos: one `components.json` per app, each app validated independently.

## Reference

- Dependency setup — shadcn MCP server, settings allow-list, shadcn/ui skills, verification, troubleshooting: [INSTALL.md](INSTALL.md) · automated by [scripts/install.mjs](scripts/install.mjs)
- Layer contracts, decision tree, shadcn↔atomic map, RSC boundary, parallel routes, forms, migration: [REFERENCE.md](REFERENCE.md)
- Full worked complex Next.js dashboard, every layer: [EXAMPLES.md](EXAMPLES.md)
- Enforcement: [scripts/validate-atomic.mjs](scripts/validate-atomic.mjs) — escape hatch `// atomic-ignore <rule-id> — why` on the violating line or the line above, or `// atomic-ignore-file <rule-id> — why`. A real rule id is required; `all` is refused. Every use must be justified in chat.
