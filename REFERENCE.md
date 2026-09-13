# Reference — Atomic Design with shadcn/ui

## 1. Folder structure (canonical)

```
src/
├── app/                              ← Next.js App Router. Route files ONLY.
│   ├── layout.tsx                    ← shell: providers + chrome organisms + a template
│   ├── page.tsx                      ← page: data + one <XTemplate />
│   ├── error.tsx                     ← boundary: MUST be "use client"
│   ├── opengraph-image.tsx           ← route asset: resolves by path, cannot move
│   └── (dashboard)/orders/page.tsx
├── components/
│   ├── ui/                           ← shadcn primitives = layer 0. Owned, editable, cva-extended.
│   ├── atoms/                        ← project atoms shadcn does not ship
│   ├── molecules/
│   │   └── orders/                   ← feature namespace inside the layer
│   ├── organisms/
│   │   └── orders/
│   ├── sections/                     ← async server sections for <Suspense> boundaries
│   ├── templates/
│   └── providers/                    ← app-wide context mounted once in the root layout
├── lib/                              ← cn(), formatters, pure helpers (importable anywhere)
├── hooks/                            ← client hooks, no JSX (shadcn's own `ui/sidebar.tsx` uses `use-mobile`)
└── server/                           ← types, schemas, queries, actions
```

`src/` is optional; `components/` and `app/` at repo root work identically. **Monorepos:** one `components.json` per app (`apps/web/`, `apps/admin/`); the validator discovers each and validates them independently. Custom shadcn aliases (`"ui": "@/ui"`, `"components": "@/parts"`) are read from `components.json` and honoured — the layer folders follow the alias, not a hardcoded `components/`.

**No barrel `index.ts` inside a layer.** Not for tree-shaking reasons — modern bundlers handle that. The real reason: `import { OrdersTable } from "@/components/organisms"` hides *which layer* the import crosses, which defeats this validator and every human review. A one-line re-export in `lib/` does the same thing and is caught too. Import the explicit path.

**Exactly two directories may contain `.tsx` that renders markup:** `app/` (route files) and `components/<layer>/`. A component in `features/`, `views/`, `modules/`, `widgets/`, `containers/`, `lib/` or `hooks/` is a `layer-unknown` error. There is no "just this once" folder.

Three ways that rule used to be evaded, all now closed:
- **`lib/*.tsx` behind a lowercase function.** Any JSX at all in `lib/` or `hooks/` is an error — `export async function buildRows()` returning markup is a component wearing a helper's name. `hooks/` holds `.ts`; `lib/utils.ts` is unaffected.
- **Borrowing a Next.js filename.** `features/reports/icon.tsx` is not a route asset. The stem is only recognised where Next.js resolves it (see §2 → route assets).
- **A monorepo orphan.** A `.tsx` under no app's `components.json` is an error, not a skipped file. Every workspace that holds UI needs its own `components.json`.

## 2. Layer contracts in full

Import rights below are exactly what `scripts/validate-atomic.mjs` enforces (its `ALLOWED` map) and exactly what SKILL.md's table states. If the three ever disagree, the script is the tiebreaker and the docs are the bug.

### ui — the substrate, layer 0 (`components/ui/`)
shadcn/ui source you own. Radix or Base UI primitives + Tailwind + `cva`.

- **May import:** other `ui` files, `lib/`, `hooks/`, external packages. **`ui` → `ui` is legal and normal** — `ui/sidebar.tsx` imports button, input, separator, sheet, skeleton and tooltip; `ui/form.tsx` imports `ui/label`; `ui/alert-dialog.tsx` imports `buttonVariants`. Same-layer imports are forbidden *above* layer 0 only.
- **Do:** add project variants directly to the `cva` block (`variant: { brand: "..." }`), adjust tokens, add sizes.
- **Do not:** import from `atoms/`+ or from `server/`. No product vocabulary — a `ui` component never knows what an "order" is.
- Multi-part primitives (`Card`/`CardHeader`/`CardContent`) are one file and count as one primitive.
- **Uncapped by size and exempt from the naming rule.** This is vendored source; shadcn ships kebab-case filenames and files as long as `sidebar.tsx`. Never rename or split them.

### atoms (`components/atoms/`)
The smallest thing that carries meaning in *your* product and that shadcn does not already ship.

- Examples: `Logo`, `PriceTag`, `StatusDot`, `Kbd`, `CurrencyAmount`. (`AvatarStack` is a molecule.)
- **Stateless.** The only state permitted is state internal to the shadcn primitive it renders.
- **The root element carries no margin, no positioning, no grid placement.** Banned *on the root only*: `m-*`, `mt/mr/mb/ml/mx/my-*`, `absolute`, `fixed`, `sticky`, `col-span-*`, `row-span-*`. Size (`h-*`, `w-*`, `size-*`) is allowed. **What the validator checks:** the attributes of the first JSX element after each `return`/`=>`. Internal parts are free — `relative` on the root wrapper with `absolute` on a ping dot inside it, or `-mt-px` for optical alignment on a nested `<svg>`, are all legal and are how shadcn builds icon-in-input, badge dots and focus rings.
- **No atom imports another atom.** If you need two, you are writing a molecule.
- **No raw interactive HTML, not even here.** An atom renders `ui` primitives plus inert markup (`span`, `div`, `svg`). Hand-rolling `<button>` in an atom is the exact thing shadcn exists to prevent.
- Accepts `className` and spreads `...props` so parents can position it from outside.

**When NOT to create an atom:** if it would only re-export `<Button>` under a new name. Add a `cva` variant to `ui/button.tsx` instead.

### molecules (`components/molecules/`)
One small, nameable job. Combines atoms and `ui` primitives and **is the first layer allowed to position them.**

- Examples: `SearchField` (Input + Button), `FormFieldRow` (Label + control + error), `ProductCard`, `StatCard`, `NavLinkItem`.
- May hold **local UI state** (`useState` for open/typed value) and take callbacks. No global store reads, no data fetching.
- Positions its children with `flex`/`grid` + `gap-*` on **its own** container. It does not give itself margin.
- **No molecule imports another molecule.** If it does, the imported one is an atom-level concern or the importer is an organism.

### organisms (`components/organisms/`)
A self-contained, portable section of interface.

- Examples: `SiteHeader`, `OrdersTable`, `CheckoutSummary`, `OrdersToolbar`, `PricingGrid`.
- Owns **feature interaction state**: selection, sorting, open sheets, optimistic updates, `useForm`, and calls to server actions.
- **Does not fetch.** It receives its data as props. Enforced: no `fetch()`, no `axios.*`, no `useEffect` that `await`s or `.then()`s, no `useQuery`/`useSWR`/`useInfiniteQuery` without page-seeded `initialData`/`initialPageParam`/`fallbackData`.
- **May import `server/actions*`** — a mutation is not a fetch. It may also receive an action as a prop, which is the preferred shape.
- **Does not set the page grid** and does not know where on the page it sits. It fills the width it is given.
- **No organism imports another organism.** A `SiteHeader` that needs a nav means the nav is a molecule.
- Lists: an organism renders `items.map(i => <ItemCard …/>)` — the card is a molecule. Inline JSX three levels deep inside the map is a rule-6 error.

### sections (`components/sections/<feature>/XSection.tsx`)
**The one narrow, named exemption to "only pages fetch."** A section exists solely to give the React streaming pattern a home outside `page.tsx`.

- Filename must end in `Section`. It is an **async Server Component**, rendered as the child of a `<Suspense>` boundary declared in the page.
- **May import `server/queries*` and `server/actions*`** and may `await`. That is its entire reason to exist.
- **May import organisms** — a section awaits data and hands it to one organism. It adds no markup of its own beyond that.
- **Never `"use client"`.** Never layout, never a page grid, never another section.
- Without this layer the async `<Suspense>` child has nowhere legal to live and gets declared inside `page.tsx`, which rule 8 forbids. If a route needs no streaming, it needs no section.

### templates (`components/templates/XTemplate.tsx`)
The page grid. **Wireframe only — no content, no colour decisions, no components.**

- **Imports nothing but `react` (usually `type { ReactNode }`) and `cn`.** Not organisms, not `ui`, not atoms. If a template imports a component, it has stopped being a grid.
- Props are **slots**: a `ReactNode` per region — `{ header, sidebar, main, aside, overlay }`. The page fills them; the template only places them.
- Pure and synchronous. No `"use client"`, no `useState`, no `async`, no data.
- One template serves many pages. `DashboardTemplate` is used by `/orders`, `/customers`, `/settings`.
- This is the layer that makes responsive layout testable in isolation.

### providers (`components/providers/`)
App-wide React context mounted **once**, in the root layout.

- Example: `AppProviders.tsx` composing `ThemeProvider` + `QueryClientProvider` + `TooltipProvider`.
- **May import `ui/` and external packages only.** Never atoms, molecules, organisms or templates — a provider that renders product UI is an organism wearing a costume.
- A *single* root-level singleton does not need this layer: mount `<Toaster/>`, `<TooltipProvider>` or `<SidebarProvider>` in `layout.tsx` directly from `components/ui/`, which is why the shell may import `ui`. Two or more that must nest go in `components/providers/`.

### pages (`app/**/page.tsx`, `loading.tsx`, `not-found.tsx`)
- `export const metadata` / `generateMetadata`.
- Fetch data (RSC `await`, `server/queries`), or declare `<Suspense>` boundaries around sections.
- Render **exactly one** `*Template`, passing organisms and sections into its slots.
- May import **templates, organisms, sections and `server/*`**. A molecule, atom or `ui` primitive in a page means the page is doing composition that belongs in an organism.
- **One default export and nothing else.** Declaring a second component in the page file is the loophole every god page grows through — it is an error.
- Target ≤ 60 lines. **No `className` at all** — any styling is layout, and layout belongs to the template. No `"use client"`.
- Exempt from the one-template rule: a page with no JSX (a `redirect()`-only page), and any page inside a parallel (`@slot`) or intercepting (`(.)`, `(..)`, `(...)`) segment.

### shell (`app/**/layout.tsx`, `template.tsx`, `default.tsx`)
The persistent chrome: providers, `SiteHeader`/`SiteSidebar` organisms, usually inside a `ShellTemplate`. May import templates, organisms, sections, providers and `ui`. Never `"use client"` — push it to the provider or organism.

### boundary (`app/**/error.tsx`, `app/global-error.tsx`)
- **These are the one route file that MUST carry `"use client"`.** Next.js passes `reset: () => void`, a non-serializable prop; a Server Component here crashes at runtime. They are therefore classified as `boundary`, not `pages`, and are exempt from the client-boundary and page-shape rules.
- May import **organisms and templates**. Keep them ≤ 40 lines: the reset UI is an organism, and the boundary just wires `error.message` and `reset` into it.

### route assets (Next.js file conventions)
**Inside `app/` only:** `opengraph-image.*`, `twitter-image.*`, `icon.*`, `apple-icon.*`, `manifest.*`, `robots.*`, `sitemap.*`, `route.*`.
**Directly beside `app/`** (repo root or `src/`): `middleware.*`, `instrumentation.*`, `mdx-components.*`.

Next resolves these **by path**; they cannot be moved into `components/`. They are exempt from import-direction, `raw-html` (Satori requires literal `<div>`/`<img>`), `page-shape` and `client-boundary` — but they are capped at 120 lines (hard error at 240), because an exemption without a ceiling is a dumping ground.

**The name only works in the right place.** `components/orders/route.tsx` or `features/reports/icon.tsx` is a `layer-unknown` error, not a route asset. Recognising the stem anywhere on disk would let any god component rename itself to safety. These are build-time or edge artefacts, not part of the component tree — keep product UI out of them.

## 3. The classification decision tree

Ask in order. Stop at the first yes.

1. Does shadcn already ship this? → **use `components/ui/`**, add a `cva` variant if it needs brand behaviour. Stop.
2. Is it app-wide context with no product UI? → **provider**.
3. Does it render exactly one indivisible thing and carry no layout? → **atom**.
4. Does it combine 2+ atoms/primitives to do one small nameable job, with no data? → **molecule**.
5. Is it a section of the page a user would name out loud ("the filter bar", "the orders table"), holding interaction state? → **organism**.
6. Is it *only* an `await` plus one organism, behind a `<Suspense>`? → **section**.
7. Does it define where sections sit on screen and nothing else? → **template**.
8. Does it own data and metadata for a route? → **page**.

If two answers feel true, choose the **lower** layer and let the parent add the rest.

## 4. shadcn primitive → atomic layer map

| shadcn item | Layer it lands in | Note |
|---|---|---|
| `button`, `input`, `label`, `badge`, `avatar`, `skeleton`, `separator`, `checkbox`, `switch` | **ui**, consumed by atoms/molecules | atomic-scale primitives |
| `card`, `tabs`, `accordion`, `table`, `select`, `dropdown-menu`, `popover`, `tooltip` | **ui**, consumed by molecules/organisms | compound primitives; still layer 0 |
| `dialog`, `alert-dialog`, `sheet`, `drawer`, `command` | **ui**, driven from an **organism** | the *content* you put inside is a molecule/organism |
| `sidebar` | **ui** (it imports six other `ui` files — expected) | your nav is an **organism** that composes it |
| `form` (react-hook-form) | **ui**; a labelled field row = **molecule**; the whole form = **organism** | |
| `sonner` / `toast` | **ui**, `<Toaster/>` mounted in the root layout | the only `ui` import a shell should need |
| shadcn **blocks** (`dashboard-01`, `login-03`, `sidebar-07`) | **decompose, never paste** | a block is a finished organism+template pair. Split it: grid → template, sections → organisms, cards → molecules. Pasting a block whole is the single most common way this architecture dies. |

**Sourcing order, every time:** `search_items_in_registries` → `view_items_in_registries` (read the source) → `get_add_command_for_items` → `npx shadcn@latest add …` → then place per the tree above.

## 5. Server / client boundary (Next.js App Router)

- Default everything to a **Server Component**.
- `"use client"` is legal in `ui`, `atoms`, `molecules`, `organisms`, `providers`. It is **illegal** in `templates`, `sections`, `page.tsx` and `layout.tsx`. It is **mandatory** in `error.tsx` / `global-error.tsx`.
- Put the directive on the **lowest** component that needs interactivity. A client organism forces its whole subtree client-side — if only the sort dropdown is interactive, the dropdown molecule takes the directive, not the table organism.
- A client organism can still receive Server Components as `children`/slot props. Use that to keep expensive rendering on the server.

**Streaming.** The page declares the boundary; a section does the awaiting:

```tsx
// app/(dashboard)/analytics/page.tsx
content={<Suspense fallback={<StatGridSkeleton />}><RevenueSection /></Suspense>}
```

`RevenueSection` lives in `components/sections/dashboard/RevenueSection.tsx`, awaits `getRevenueByMonth()` and renders `<StatGrid stats={…} />`. Nothing is declared inside `page.tsx`.

**Providers.** A single root-level singleton — `<Toaster/>`, `<TooltipProvider>`, `<SidebarProvider>` — mounts in `layout.tsx` straight from `components/ui/`, exactly as shadcn's install steps say. Two or more that must nest are composed once in `components/providers/AppProviders.tsx` and the layout mounts that.

**Parallel and intercepting routes.**
- A parallel slot folder (`@modal`) is received by the **layout** as a named prop alongside `children`, and forwarded into a template slot: `<AppShellTemplate modal={modal}>{children}</AppShellTemplate>`.
- `@modal/default.tsx` is a shell file; returning `null` is correct and complete.
- An **intercepted** `page.tsx` (`(.)orders/[id]/page.tsx`) renders **one organism**, not a template. A modal has no page grid, and inventing a `fixed inset-0 ModalTemplate` would push a positioning decision into the layer that is forbidden to make them. Both parallel and intercepting pages are exempt from the one-template rule.

**Server modules.** `server/` is not one thing:

| Module | Who may import it |
|---|---|
| `server/types*`, `server/schemas*` (also `validation*`, `constants*`) | **every layer.** Pure values and types — a zod schema shared between a server action and a client `useForm` is the normal case. |
| `server/queries*`, `server/db*` | pages, shell, sections, route assets |
| `server/actions*` (`"use server"`) | pages, shell, sections **and organisms** — a mutation is not a fetch |

`import type { Order } from "@/server/…"` is legal from **anywhere**, always. A component must be able to type its own props.

## 6. Data flow

```
server/queries.ts → page.tsx (await)          → template slots → organisms → molecules → atoms
                  → sections/XSection.tsx (await, behind <Suspense>) ↑
```

- Nothing below a page or a section fetches. No `useEffect` data loading, no `fetch()`/`axios` in a component.
- Client-side revalidation (SWR/React Query) is permitted **only** in organisms, and only for data the page seeded via `initialData` / `initialPageParam` / `fallbackData`. "Load more" is done with a server action passed down as a prop, not with a client fetch.
- **URL state.** The page reads `searchParams` and pushes the resulting *data* down as props. An organism may call `useSearchParams()` for exactly one purpose: **to preserve unrelated params while writing a new one.** It must never derive what it renders from `useSearchParams()` — rendered data always arrives as props. `new URLSearchParams(params.toString())` then `router.replace(…)` is the sanctioned shape.

## 7. Styling contract

- Tokens only: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`. No raw hex, no ad-hoc palette classes for foundational surfaces.
- One density system per page: comfortable (`gap-6 p-6`) or compact (`gap-4 p-4`).
- **Spacing ownership:** parent owns the gap, child owns its own padding. Never `mt-4` on a child to space it from a sibling — put `space-y-4` on the parent.
- Variants belong in `cva` inside `components/ui/`, not in ternaries scattered across organisms.
- `cn()` from `lib/utils` merges incoming `className` last, always.

## 8. Naming

- **`components/ui/` keeps shadcn's kebab-case filenames — `button.tsx`, `dropdown-menu.tsx`, `alert-dialog.tsx`. Never rename them**; `npx shadcn add` and every diff/update depends on them.
- Every other layer: `PascalCase.tsx`, one component per file, named export matching the filename.
- Molecules/organisms carry a domain noun: `OrderStatusBadge`, not `Badge2`.
- Templates end in `Template`, sections end in `Section`. The validator relies on both.
- Feature folders are `kebab-case`: `components/organisms/order-history/`.
- Colocated `*.test.tsx`, `*.spec.tsx`, `*.stories.tsx`, `*.bench.tsx` and `*.mdx` files are skipped entirely — they may sit next to the component and import it directly.

## 9. Forms

| Piece | Layer |
|---|---|
| `ui/form.tsx`, `ui/input.tsx`, `ui/label.tsx` | ui |
| A single labelled field with error text | molecule (`FormFieldRow`) |
| The whole form: `useForm`, resolver, steps, submit, server-action call | organism |
| Where the form sits on the page | template |
| Zod schema | `server/schemas.ts` — importable by the organism *and* the action |
| The server action itself | `server/actions.ts` (`"use server"`) |

The organism owns validation. Molecules receive `error` as a prop and render it. Atoms know nothing about forms. A multi-step wizard is still **one organism**: the step state is interaction state.

## 10. Anti-patterns

**Tool-enforced — the validator errors on these:**

- A component outside `app/` and `components/<layer>/` (`features/`, `views/`, `modules/`, `lib/`, `hooks/`). `[layer-unknown]`
- Two organisms importing each other; two molecules importing each other. `[same-layer-import]`
- A template importing `Card` "just for the wrapper". `[import-direction]`
- An organism that `await`s a query, calls `fetch`, or runs `useQuery` with no seeded data. `[data-fetch]`
- `<button onClick=…>` anywhere outside `components/ui/`. `[raw-html]`
- `mt-6` on an atom's root to space it from the thing above. `[atom-spacing]`
- `page.tsx` containing `<div className="grid grid-cols-12 …">`, or declaring a second component. `[page-shape]`
- `"use client"` at the top of `layout.tsx` "to make the theme toggle work" — wrap only the toggle. `[client-boundary]`
- An 886-line `OrdersTable.tsx`, or inline row markup 3 levels deep inside `.map()`. `[god-component]`
- `components/organisms/index.ts`, or a `lib/` file re-exporting an organism to launder the import. `[barrel]`

**Review-only — no tool catches these, so a human must:**

- Pasting a shadcn block into `page.tsx` and calling it done.
- An atoms folder that is 30 one-line re-exports of shadcn primitives.
- A "section" that is really an organism with an `await` bolted on, or one per route with no `<Suspense>` in sight.
- An organism named after where it sits (`LeftColumnThing`) rather than what it is.

## 11. Migrating an existing codebase

1. Run the validator to get the violation inventory. Do not fix anything yet.
2. `npx shadcn@latest init -d` if `components.json` is missing; `npx shadcn@latest add` every primitive the codebase hand-rolled.
3. Replace hand-rolled primitives with `ui/` imports — highest-traffic first.
4. Create the layer folders. Move files by the decision tree (§3). Move, do not rewrite.
5. Delete barrels and `lib/` re-export shims first — they hide everything else.
6. Break god components with the 3-node rule, bottom-up.
7. Extract page grids into templates last — this is where pages shrink.
8. Re-run the validator; it must exit 0 before the refactor is called done.

Never mix a layer move and a behaviour change in the same commit.

## 12. Escape hatches

```
// atomic-ignore <rule-id> — why        (on the violating line or the line above)
// atomic-ignore-file <rule-id> — why   (anywhere in the file)
```

**A real rule id is required.** The accepted ids are exactly:

`structure` · `layer-unknown` · `barrel` · `naming` · `same-layer-import` · `import-direction` · `data-fetch` · `raw-html` · `atom-spacing` · `client-boundary` · `page-shape` · `god-component` · `ignore-blanket`

`all` is **not** a rule id. `// atomic-ignore-file all` is itself an error (`ignore-blanket`) unless the run explicitly passes `--allow-blanket-ignore`, and every fully-ignored file is printed on every run regardless of severity. An unknown id is reported as a warning and ignores nothing.

Every use requires a one-line justification in the same comment and must be reported to the user. An unexplained ignore is a failure, not a pass.
