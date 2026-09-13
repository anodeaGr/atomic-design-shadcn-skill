# Worked example — a complex Next.js route, fully atomic

Route: `/orders` — server-fetched, URL-driven filters, sortable table, row actions, a detail sheet, empty/loading/error states, plus a streamed analytics route and a multi-step form. This is deliberately the kind of screen that usually becomes a 600-line god component.

Every code block below is verified against `scripts/validate-atomic.mjs` and exits 0. The first line of each block is the file path it belongs at.

## Step 1 — the inventory (written before any code)

| Layer | Component | Source |
|---|---|---|
| ui | `button` `input` `badge` `table` `select` `sheet` `dropdown-menu` `skeleton` `card` `form` `sidebar` `sonner` | `npx shadcn@latest add …` |
| atoms | `CurrencyAmount` `OrderStatusBadge` `Logo` | project |
| molecules | `orders/OrderRow` `orders/OrderFilterSelect` `SearchField` `EmptyState` `StatCard` `FormFieldRow` | project |
| organisms | `orders/OrdersHeader` `orders/OrdersToolbar` `orders/OrdersTable` `orders/OrderDetailSheet` `orders/NewOrderWizard` `dashboard/StatGrid` | project |
| sections | `dashboard/RevenueSection` | one `await` behind `<Suspense>` |
| templates | `DashboardTemplate` `AppShellTemplate` | shared with `/customers`, `/settings` |
| providers | `AppProviders` | theme + query + tooltip, mounted once |
| pages | `app/(dashboard)/orders/page.tsx` … | data + metadata |

Sourcing happened first: `search_items_in_registries("table")` → `view_items_in_registries` → `get_add_command_for_items`. Nothing hand-rolled that shadcn ships.

---

## Atom — no margin, no position on the root, no state

```tsx
// components/atoms/CurrencyAmount.tsx
import { cn } from "@/lib/utils"

export function CurrencyAmount({
  cents, currency = "EUR", className, ...props
}: { cents: number; currency?: string } & React.ComponentProps<"span">) {
  const value = new Intl.NumberFormat("el-GR", { style: "currency", currency })
    .format(cents / 100)
  return (
    <span className={cn("font-mono text-sm tabular-nums", className)} {...props}>
      {value}
    </span>
  )
}
```

```tsx
// components/atoms/OrderStatusBadge.tsx
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { OrderStatus } from "@/server/types"

const TONE: Record<OrderStatus, string> = {
  pending: "bg-muted-foreground", paid: "bg-primary",
  shipped: "bg-foreground", cancelled: "bg-destructive",
}
const LABEL: Record<OrderStatus, string> = {
  pending: "Pending", paid: "Paid", shipped: "Shipped", cancelled: "Cancelled",
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" />
        <span aria-hidden className={cn("relative inline-flex size-2 rounded-full", TONE[status])} />
      </span>
      {LABEL[status]}
    </Badge>
  )
}
```

Three things to read here:

- **`import type { OrderStatus } from "@/server/types"` is legal from any layer.** A component must be able to type its own props. Type-only imports and `server/types*` / `server/schemas*` are never data fetching.
- **`relative` on the root with `absolute` inside it is legal.** Rule 5 checks the *root* element only, so an atom can still build a ping dot, an icon-in-input or a focus ring out of its own parts. `size-2` and `gap-1.5` are intrinsic size and internal gap — also fine. `mr-2` on the root would not be: the parent supplies external spacing.
- **Why the dot is a `<span>` and not its own atom:** an `OrderStatusDot` atom would force `OrderStatusBadge` to import an atom from an atom — forbidden by rule 2. The dot has no meaning on its own, so it stays inline. Rule 2 is not an obstacle here; it is the thing that stopped a pointless component from being born.

---

## Molecules — first layer allowed to position

```tsx
// components/molecules/orders/OrderRow.tsx
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { CurrencyAmount } from "@/components/atoms/CurrencyAmount"
import { OrderStatusBadge } from "@/components/atoms/OrderStatusBadge"
import type { Order } from "@/server/types"

export function OrderRow({ order, onOpen }: { order: Order; onOpen: (id: string) => void }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{order.reference}</TableCell>
      <TableCell>{order.customerName}</TableCell>
      <TableCell><OrderStatusBadge status={order.status} /></TableCell>
      <TableCell className="text-right"><CurrencyAmount cents={order.totalCents} /></TableCell>
      <TableCell className="w-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Row actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpen(order.id)}>View details</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
```

### The same-layer question — how to resolve it every time

The first draft had `OrderStatusBadge` as a molecule, and `OrderRow` (also a molecule) importing it. Rule 2 forbids that. There are exactly two legal resolutions, and you must pick one and move the file — never leave the sideways import:

- **Demote the dependency.** The badge is one `ui` primitive plus inert markup and it positions nothing external. It is an **atom**. ✅ chosen here.
- **Promote the importer.** If the badge had genuinely been a molecule, then `OrderRow` is doing more than one small job — it becomes an **organism**, and `OrdersTable` renders rows through a slot instead of importing them.

The row's dropdown is `ui` primitives only, so it stays inline in `OrderRow` rather than becoming a second molecule.

---

## Organisms — interaction state, no data fetching, no page grid

```tsx
// components/organisms/orders/OrdersToolbar.tsx
"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { SearchField } from "@/components/molecules/SearchField"
import { OrderFilterSelect } from "@/components/molecules/orders/OrderFilterSelect"
import type { OrderStatus } from "@/server/types"

export function OrdersToolbar({ query, status }: { query: string; status: OrderStatus | "all" }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    value && value !== "all" ? next.set(key, value) : next.delete(key)
    router.replace(pathname + "?" + next, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <SearchField defaultValue={query} placeholder="Search orders" onSubmit={(v) => set("q", v)} />
      <OrderFilterSelect value={status} onChange={(v) => set("status", v)} />
    </div>
  )
}
```

**What it renders (`query`, `status`) arrives as props from the page.** `useSearchParams()` appears for one reason only: to preserve the params it is *not* changing while it writes the one it is. That is the sanctioned use (REFERENCE §6). Deriving displayed data from `useSearchParams()` instead of props is not.

```tsx
// components/organisms/orders/OrdersTable.tsx
"use client"

import { useRouter } from "next/navigation"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { OrderRow } from "@/components/molecules/orders/OrderRow"
import { EmptyState } from "@/components/molecules/EmptyState"
import type { Order } from "@/server/types"

export function OrdersTable({ orders }: { orders: Order[] }) {
  const router = useRouter()
  const openOrder = (id: string) => router.replace("?order=" + id, { scroll: false })

  if (orders.length === 0) {
    return <EmptyState title="No orders match these filters" hint="Clear the search or pick another status." />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead><TableHead>Customer</TableHead>
          <TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => <OrderRow key={o.id} order={o} onOpen={openOrder} />)}
      </TableBody>
    </Table>
  )
}
```

**The mistake this file is built to avoid:** importing `OrderDetailSheet` here. That would be an organism importing an organism. The sheet is a **sibling**, mounted into a separate template slot by the page. The two communicate through the URL (`?order=<id>`): the table writes it, the page reads it and hands the resulting order to the sheet.

That keeps both organisms independent and portable, removes `useState` entirely, and makes the detail view linkable and back-button-correct. Lifting shared state to the URL is the standard fix whenever two organisms seem to need each other.

Note the map: `{orders.map((o) => <OrderRow …/>)}` is one level deep. Inline row markup here — `<div className="rounded-lg border p-4">` with a header row and two spans inside — would be three levels deep and is a hard `god-component` error. The row *is* the molecule.

Colocated tests and stories sit next to the component (`OrdersTable.test.tsx`, `OrdersTable.stories.tsx`) and import it directly. Those filenames are skipped by the validator, so the same-layer and naming rules do not apply to them.

---

## Section — the only component below a page that may `await`

```tsx
// components/sections/dashboard/RevenueSection.tsx
import { StatGrid } from "@/components/organisms/dashboard/StatGrid"
import { getRevenueByMonth } from "@/server/queries"

export async function RevenueSection() {
  const stats = await getRevenueByMonth()
  return <StatGrid stats={stats} />
}
```

Five lines: one `await`, one organism. That is the whole contract. It exists so the streaming pattern has a legal home — without it, the async `<Suspense>` child ends up declared inside `page.tsx`, which rule 8 forbids. It is never a client component and never lays anything out.

---

## Template — grid only. No `ui`, no atoms, no organisms, no content

```tsx
// components/templates/DashboardTemplate.tsx
import type { ReactNode } from "react"

export function DashboardTemplate({
  title, toolbar, content, aside, overlay,
}: {
  title: ReactNode
  toolbar?: ReactNode
  content: ReactNode
  aside?: ReactNode
  overlay?: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-4">
        {title}
        {toolbar}
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <main className="min-w-0">{content}</main>
        {aside ? <aside className="hidden lg:block">{aside}</aside> : null}
      </div>
      {overlay}
    </div>
  )
}
```

Synchronous, no `"use client"`, no data, **and no component imports at all** — only `react` and `cn` are allowed here. Every region is a `ReactNode` the page hands in. `/customers` and `/settings` reuse it unchanged.

---

## Page — data + metadata + one template

```tsx
// app/(dashboard)/orders/page.tsx
import type { Metadata } from "next"
import "./page.module.css"
import { DashboardTemplate } from "@/components/templates/DashboardTemplate"
import { OrdersHeader } from "@/components/organisms/orders/OrdersHeader"
import { OrdersToolbar } from "@/components/organisms/orders/OrdersToolbar"
import { OrdersTable } from "@/components/organisms/orders/OrdersTable"
import { OrderDetailSheet } from "@/components/organisms/orders/OrderDetailSheet"
import { getOrder, listOrders } from "@/server/queries"

export const metadata: Metadata = { title: "Orders" }

export default async function OrdersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; status?: string; order?: string }> }) {
  const { q = "", status = "all", order } = await searchParams
  const [orders, selected] = await Promise.all([
    listOrders({ query: q, status }),
    order ? getOrder(order) : null,
  ])

  return (
    <DashboardTemplate
      title={<OrdersHeader count={orders.length} />}
      toolbar={<OrdersToolbar query={q} status={status as never} />}
      content={<OrdersTable orders={orders} />}
      overlay={<OrderDetailSheet order={selected} />}
    />
  )
}
```

32 lines. No `className`, no JSX layout, no `"use client"`, one template, **one component declared in the file**. Every slot receives an organism — a page composes sections, it never reaches down to molecules or primitives, and it never lays anything out. A route-scoped stylesheet may be side-effect imported; that is not a layer crossing.

```tsx
// app/(dashboard)/orders/loading.tsx
import { DashboardTemplate } from "@/components/templates/DashboardTemplate"
import { OrdersTableSkeleton } from "@/components/organisms/orders/OrdersTableSkeleton"

export default function Loading() {
  return <DashboardTemplate title={null} content={<OrdersTableSkeleton rows={8} />} />
}
```

Loading and error states use the same template. They are designed surfaces, not placeholder text.

---

## Streaming page — `<Suspense>` in the page, `await` in the section

```tsx
// app/(dashboard)/analytics/page.tsx
import type { Metadata } from "next"
import { Suspense } from "react"
import { DashboardTemplate } from "@/components/templates/DashboardTemplate"
import { AnalyticsHeader } from "@/components/organisms/dashboard/AnalyticsHeader"
import { StatGridSkeleton } from "@/components/organisms/dashboard/StatGridSkeleton"
import { RevenueSection } from "@/components/sections/dashboard/RevenueSection"
import { LiveOrderCount } from "@/components/organisms/orders/LiveOrderCount"
import { countOpenOrders } from "@/server/queries"
import { refreshOpenCount } from "@/server/actions"

export const metadata: Metadata = { title: "Analytics" }

export default async function AnalyticsPage() {
  const open = await countOpenOrders()
  return (
    <DashboardTemplate
      title={<AnalyticsHeader />}
      toolbar={<LiveOrderCount initialCount={open} refresh={refreshOpenCount} />}
      content={
        <Suspense fallback={<StatGridSkeleton />}>
          <RevenueSection />
        </Suspense>
      }
    />
  )
}
```

`LiveOrderCount` is the one legal shape for client revalidation: the page seeds it, and the refresh is a server action passed as a prop.

```tsx
// components/organisms/orders/LiveOrderCount.tsx
"use client"

import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"

export function LiveOrderCount({
  initialCount, refresh,
}: { initialCount: number; refresh: () => Promise<number> }) {
  const { data } = useQuery({
    queryKey: ["open-orders"],
    queryFn: refresh,
    initialData: initialCount,
    refetchInterval: 30_000,
  })
  return <Badge variant="outline">{data} open</Badge>
}
```

Drop `initialData` and it becomes a `data-fetch` error: an organism that fetches its own data has taken ownership the page is supposed to hold.

---

## Root layout, providers and the error boundary

```tsx
// app/layout.tsx
import type { Metadata } from "next"
import "./globals.css"
import { AppProviders } from "@/components/providers/AppProviders"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = { title: { default: "Northwind Ops", template: "%s · Northwind" } }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
```

`<Toaster/>` mounts straight from `components/ui/` — that is shadcn's own documented install step, and the shell is allowed to import `ui` for exactly this. The three providers that must nest are composed once:

```tsx
// components/providers/AppProviders.tsx
"use client"

import { useState, type ReactNode } from "react"
import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient())
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
```

```tsx
// app/error.tsx
"use client"

import { ErrorPanel } from "@/components/organisms/ErrorPanel"

export default function AppError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel message={error.message} onRetry={reset} />
}
```

`error.tsx` is the **one** route file that must carry `"use client"` — `reset` is a function prop and cannot cross the server boundary. It is classified as a boundary, not a page: no template requirement, ≤ 40 lines, and the actual UI is an organism.

---

## The authenticated shell, and a modal via parallel + intercepting routes

```tsx
// app/(dashboard)/layout.tsx
import { AppShellTemplate } from "@/components/templates/AppShellTemplate"
import { SiteSidebar } from "@/components/organisms/SiteSidebar"
import { SiteHeader } from "@/components/organisms/SiteHeader"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppShellTemplate sidebar={<SiteSidebar />} header={<SiteHeader />}>
        {children}
      </AppShellTemplate>
    </SidebarProvider>
  )
}
```

`SiteSidebar` is one organism serving `/orders`, `/orders/new` and `/analytics` — sharing across routes is what the shell is for, not a reason to duplicate.

```tsx
// app/(dashboard)/orders/layout.tsx
import type { ReactNode } from "react"

export default function OrdersLayout({
  children, modal,
}: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
```

```tsx
// app/(dashboard)/orders/@modal/(.)orders/[id]/page.tsx
import { OrderDetailSheet } from "@/components/organisms/orders/OrderDetailSheet"
import { getOrder } from "@/server/queries"

export default async function InterceptedOrderPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getOrder(id)
  return <OrderDetailSheet order={order} />
}
```

The parallel slot arrives at the layout as the named prop `modal` and is forwarded into a template slot. The intercepted page renders **one organism, not a template** — a modal has no page grid, and inventing a `fixed inset-0 ModalTemplate` would put a positioning decision in the layer forbidden to make them. `@modal/default.tsx` returning `null` completes the slot.

---

## The multi-step form — still one organism

```tsx
// app/(dashboard)/orders/new/page.tsx
import type { Metadata } from "next"
import { DashboardTemplate } from "@/components/templates/DashboardTemplate"
import { NewOrderHeader } from "@/components/organisms/orders/NewOrderHeader"
import { NewOrderWizard } from "@/components/organisms/orders/NewOrderWizard"
import { createOrder } from "@/server/actions"

export const metadata: Metadata = { title: "New order" }

export default function NewOrderPage() {
  return (
    <DashboardTemplate
      title={<NewOrderHeader />}
      content={<NewOrderWizard submit={createOrder} />}
    />
  )
}
```

The wizard holds `useForm`, the zod resolver and the step index — all interaction state, all one organism. The schema lives in `server/schemas.ts` so the client form and the server action validate against the same object; `server/schemas*` is importable from every layer precisely for this. Each labelled field is the `FormFieldRow` molecule.

```tsx
// components/molecules/FormFieldRow.tsx
import type { ReactNode } from "react"
import { FormControl, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

export function FormFieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <FormControl>{children}</FormControl>
      <FormMessage />
    </FormItem>
  )
}
```

`<form>` itself is legal inside the organism that owns it — that one exception exists because react-hook-form needs the element.

---

## What complexity added — and what it did not

Adding bulk selection, CSV export, column visibility and inline editing to `/orders` adds: 2 molecules, 1 organism, 0 changes to the template, ~6 lines to the page. The page does not grow with the feature set. That is the test the architecture has to pass, and the reason rules 2, 6 and 8 are not negotiable.

## Landing page variant (same rules, different shapes)

| Layer | Components |
|---|---|
| atoms | `Logo` `EyebrowLabel` |
| molecules | `FeatureCard` `TestimonialCard` `PricingTier` `FaqItem` |
| organisms | `SiteHeader` `Hero` `FeatureGrid` `PricingSection` `FaqSection` `SiteFooter` |
| sections | `marketing/TestimonialsSection` — awaits the CMS behind a `<Suspense>` |
| template | `MarketingTemplate` — vertical rhythm + section slots |
| page | `app/page.tsx` — metadata, one template |

`Hero` is an organism, not a template: it is a section of interface, not a grid. `FeatureGrid` maps over `FeatureCard`; it never inlines the card markup.
