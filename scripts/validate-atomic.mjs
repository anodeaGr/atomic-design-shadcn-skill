#!/usr/bin/env node
/**
 * validate-atomic.mjs — enforce Atomic Design + shadcn/ui layering.
 *
 *   node validate-atomic.mjs [rootDir] [--app <dir>] [--json] [--warn-only] [--allow-blanket-ignore]
 *
 * Exit 0 = no errors. Exit 1 = at least one error. No dependencies.
 *
 *   --app <dir>              validate only the app whose components.json lives in <dir>
 *   --json                   machine-readable output
 *   --warn-only              always exit 0. Diagnostic only — NEVER use it as a gate.
 *   --allow-blanket-ignore   permit `// atomic-ignore-file all` (an error otherwise)
 *
 * Escape hatches (rule id required — `all` is not a rule id):
 *   // atomic-ignore <rule-id> — why        (on the violating line or the line above)
 *   // atomic-ignore-file <rule-id> — why   (anywhere in the file)
 */

import fs from "node:fs"
import path from "node:path"

/* --------------------------------------------------------------------- args */

const argv = process.argv.slice(2)
const AS_JSON = argv.includes("--json")
const WARN_ONLY = argv.includes("--warn-only")
const ALLOW_BLANKET = argv.includes("--allow-blanket-ignore")
const appIdx = argv.indexOf("--app")
const APP_FILTER = appIdx !== -1 ? argv[appIdx + 1] : null
const positional = argv.filter((a, i) => !a.startsWith("--") && !(appIdx !== -1 && i === appIdx + 1))
const ROOT = path.resolve(positional[0] ?? ".")

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "out", "coverage",
  ".turbo", ".vercel", "storybook-static", ".cache", "public",
  "e2e", "cypress", "playwright", "playwright-report", "test-results",
  "__tests__", "__mocks__", "__snapshots__",
])

const SCAN_EXT = new Set([".tsx", ".jsx", ".ts", ".mts", ".cts"])
const MARKUP_EXT = new Set([".tsx", ".jsx"])
const RESOLVE_EXT = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"]

/* ------------------------------------------------------------------- layers */

/**
 * THE LAYER MODEL. This map is the single source of truth and is reproduced
 * verbatim in SKILL.md ("The layer model") and REFERENCE.md §2.
 */
const ALLOWED = {
  ui:          new Set(["ui"]),                                          // layer 0 composes freely — that is how shadcn ships
  atoms:       new Set(["ui"]),
  molecules:   new Set(["ui", "atoms"]),
  organisms:   new Set(["ui", "atoms", "molecules"]),
  sections:    new Set(["ui", "atoms", "molecules", "organisms"]),
  templates:   new Set([]),                                              // react + cn only; every region arrives as a slot
  providers:   new Set(["ui"]),
  pages:       new Set(["templates", "organisms", "sections"]),
  shell:       new Set(["templates", "organisms", "sections", "providers", "ui"]),
  boundary:    new Set(["organisms", "templates"]),
  "route-asset": null,                                                   // null = no direction check (build-time asset, not a component tree)
}

const RANK = {
  ui: 0, atoms: 1, molecules: 2, organisms: 3, sections: 3.5,
  templates: 4, providers: 4, shell: 5, boundary: 5, pages: 6, "route-asset": 6,
}

/** which layers may import which server module family */
const SERVER_ALLOWED = {
  "server-shared": null,                                                  // null = everyone (types, zod schemas — pure values)
  "server-data": new Set(["pages", "shell", "sections", "route-asset"]),  // queries, db
  "server-actions": new Set(["pages", "shell", "sections", "organisms", "route-asset"]),
}

const LABEL = {
  ui: "ui primitive (layer 0)", atoms: "atom", molecules: "molecule", organisms: "organism",
  sections: "server section", templates: "template", providers: "provider",
  shell: "layout shell", boundary: "error boundary", pages: "page", "route-asset": "route asset",
}
const say = (l) => LABEL[l] ?? l
const an = (l) => `${/^[aeiou]/i.test(say(l)) ? "an" : "a"} ${say(l)}`
const An = (l) => { const s = an(l); return s[0].toUpperCase() + s.slice(1) }

/** soft caps. Hard ceiling = 2x (error). `ui` is vendored shadcn source — uncapped. */
const MAX_LINES = {
  atoms: 80, molecules: 130, organisms: 220, sections: 60,
  templates: 90, providers: 60, pages: 60, shell: 80, boundary: 40,
  "route-asset": 120,
}

/** Interactive/structural HTML shadcn already ships. Value = layers permitted to write it raw. */
const RAW_TAGS = {
  button: ["ui"], input: ["ui"], select: ["ui"], textarea: ["ui"],
  dialog: ["ui"], table: ["ui"], img: ["ui"], a: ["ui"],
  form: ["ui", "organisms"], // the organism owns the form element; react-hook-form needs it
}

const RULE_IDS = new Set([
  "structure", "layer-unknown", "barrel", "naming", "same-layer-import",
  "import-direction", "data-fetch", "raw-html", "atom-spacing",
  "client-boundary", "page-shape", "god-component", "ignore-blanket",
])

/** Next.js file conventions that are `.tsx` by necessity and resolve BY PATH. */
const ROUTE_ASSET_STEMS = [
  "opengraph-image", "twitter-image", "icon", "apple-icon",
  "manifest", "robots", "sitemap", "route",
]
/** Conventions that live BESIDE app/ (repo root or src/), never inside a layer. */
const BASE_LEVEL_STEMS = ["middleware", "instrumentation", "instrumentation-client", "mdx-components"]

const norm = (p) => p.split(path.sep).join("/").replace(/^\.\//, "")
const isSkippable = (rel) => /\.(test|spec|stories|story|bench|mdx)\.[jt]sx?$/.test(rel) || /\.d\.ts$/.test(rel)

/* -------------------------------------------------------------------- masks */

/**
 * Build two masked copies of a source file, both offset-identical to the original:
 *   noComments — `//`, block and `{/* *␘/}` comments blanked; string literals intact
 *   full       — the above PLUS string and template-literal contents blanked
 * Offsets and newlines are preserved so every line number stays correct.
 */
function maskSource(src) {
  const n = src.length
  const noComments = src.split("")
  const full = src.split("")
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < n; k++) if (arr[k] !== "\n") arr[k] = " "
  }
  // `'` only opens a string in an expression position — keeps JSX text like `don't` from eating a line
  const QUOTE_KEYWORDS = new Set([
    "import", "from", "return", "typeof", "case", "in", "of", "as", "export",
    "require", "await", "yield", "new", "delete", "void", "do", "else", "default",
  ])
  const opensQuote = (idx) => {
    let k = idx - 1
    while (k >= 0 && /\s/.test(src[k])) k--
    if (k < 0) return true
    const c = src[k]
    if ("=({[,:;+-*/%&|!?<>~^".includes(c)) return true
    if (/[\w$]/.test(c)) {
      let s = k
      while (s >= 0 && /[\w$]/.test(src[s])) s--
      return QUOTE_KEYWORDS.has(src.slice(s + 1, k + 1))
    }
    return false
  }
  let i = 0
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === "/" && d === "/") {
      let j = src.indexOf("\n", i); if (j === -1) j = n
      blank(noComments, i, j); blank(full, i, j); i = j; continue
    }
    if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2); j = j === -1 ? n : j + 2
      blank(noComments, i, j); blank(full, i, j); i = j; continue
    }
    if (c === '"' || (c === "'" && opensQuote(i))) {
      let j = i + 1
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === c || src[j] === "\n") break
        j++
      }
      blank(full, i + 1, j)
      i = Math.min(j + 1, n); continue
    }
    if (c === "`") {
      let j = i + 1
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === "`") break
        j++
      }
      blank(full, i + 1, j)
      i = Math.min(j + 1, n); continue
    }
    i++
  }
  return { noComments: noComments.join(""), full: full.join("") }
}

/* ------------------------------------------------------------- app discovery */

function listDirs(dir, acc = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
    const full = path.join(dir, e.name)
    acc.push(full)
    listDirs(full, acc)
  }
  return acc
}

function findConfigs(root) {
  const out = []
  const candidates = [root, ...listDirs(root)]
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, "components.json"))) out.push(d)
  }
  return out
}

const LAYER_DIRS = ["atoms", "molecules", "organisms", "sections", "templates", "providers"]

function makeApp(appRoot) {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(path.join(appRoot, "components.json"), "utf8")) } catch { /* defaults */ }
  const aliases = cfg.aliases ?? {}
  const seg = (alias, fallback) => String(alias ?? fallback).replace(/^@\//, "").replace(/^~\//, "").replace(/^\.\//, "")
  const compSeg = seg(aliases.components, "components")
  const uiSeg = seg(aliases.ui, `${compSeg}/ui`)

  const bases = [appRoot, path.join(appRoot, "src")]
  const rel = (p) => norm(path.relative(ROOT, p))
  const dirs = { ui: [], app: [], lib: [], server: [] }
  for (const L of LAYER_DIRS) dirs[L] = []

  for (const b of bases) {
    dirs.ui.push(rel(path.join(b, uiSeg)), rel(path.join(b, "components/ui")))
    for (const L of LAYER_DIRS) {
      dirs[L].push(rel(path.join(b, compSeg, L)), rel(path.join(b, "components", L)))
    }
    dirs.app.push(rel(path.join(b, "app")), rel(path.join(b, "pages")))
    dirs.lib.push(rel(path.join(b, "lib")), rel(path.join(b, "hooks")), rel(path.join(b, "utils")), rel(path.join(b, "types")))
    dirs.server.push(rel(path.join(b, "server")))
  }
  for (const k of Object.keys(dirs)) dirs[k] = [...new Set(dirs[k])]

  return { root: rel(appRoot) || ".", absRoot: appRoot, dirs, bases: bases.map((b) => rel(b) || "."), uiSeg, compSeg }
}

/* ---------------------------------------------------------------- classifier */

const under = (p, prefix) => prefix === "." ? true : p === prefix || p.startsWith(prefix + "/")

/** Classify a repo-relative path into a layer, or null. */
function classify(app, rel) {
  const p = norm(rel)
  const base = path.basename(p)
  const stem = base.replace(/\.[jt]sx?$/, "").replace(/\.[mc]ts$/, "")

  for (const d of app.dirs.ui) if (under(p, d)) return "ui"
  for (const L of LAYER_DIRS) for (const d of app.dirs[L]) if (under(p, d)) return L

  // Next.js file conventions resolve BY PATH and cannot be moved. They are recognised
  // ONLY where Next.js actually resolves them — inside app/, or directly beside it.
  // Matching the stem anywhere on disk would turn `components/x/route.tsx` into an
  // unchecked dumping ground; the layer dirs above also win, so components/atoms/Icon.tsx
  // is never mistaken for app/icon.tsx.
  if (BASE_LEVEL_STEMS.includes(stem)) {
    const dir = path.dirname(p)
    for (const b of app.bases) if (dir === norm(b) || (norm(b) === "." && dir === ".")) return "route-asset"
  }

  for (const d of app.dirs.app) {
    if (!under(p, d)) continue
    if (ROUTE_ASSET_STEMS.includes(stem)) return "route-asset"
    if (stem === "error" || stem === "global-error") return "boundary"
    if (stem === "page") return "pages"
    if (stem === "layout" || stem === "template" || stem === "default") return "shell"
    if (stem === "loading" || stem === "not-found" || stem === "forbidden" || stem === "unauthorized") return "pages"
    return "app-stray"
  }

  for (const d of app.dirs.server) if (under(p, d)) return "server"
  for (const d of app.dirs.lib) if (under(p, d)) return "lib"

  // a components/ subtree that is not one of the layers
  for (const b of app.bases) if (under(p, `${b}/${app.compSeg}`) || under(p, `${b}/components`)) return "components-stray"

  if (/\.(config|setup)\.[jt]sx?$/.test(base) || /^next-env\./.test(base)) return "config"
  return null
}

/** Which server family a specifier or path belongs to. */
function serverFamily(spec) {
  const tail = spec.replace(/^.*?(?:^|\/)server\//, "")
  if (/^(types|schema|schemas|validation|validators|constants|dto)/.test(tail)) return "server-shared"
  if (/^(actions|mutations)/.test(tail)) return "server-actions"
  return "server-data"
}

const ASSET_EXT = /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|json|ya?ml|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|txt|md|mdx)$/i

/** Classify an import specifier into a layer, "server-*", "lib", or null (external). */
function classifySpecifier(app, spec, fromFileRel) {
  if (ASSET_EXT.test(spec)) return null

  if (spec.startsWith(".")) {
    const resolved = norm(path.join(path.dirname(fromFileRel), spec))
    const c = classify(app, resolved)
    if (c === "server") return serverFamily(resolved)
    return c
  }

  // alias forms: @/…, ~/…, or a bare package path that happens to contain the layer dirs
  const stripped = spec.replace(/^[@~]\//, "")
  const asRepo = [...app.bases.map((b) => (b === "." ? stripped : `${b}/${stripped}`)), stripped]
  for (const candidate of asRepo) {
    for (const d of app.dirs.ui) if (under(candidate, d)) return "ui"
    for (const L of LAYER_DIRS) for (const d of app.dirs[L]) if (under(candidate, d)) return L
    for (const d of app.dirs.app) if (under(candidate, d)) return "app-stray"
    for (const d of app.dirs.server) if (under(candidate, d)) return serverFamily(candidate)
    for (const d of app.dirs.lib) if (under(candidate, d)) return "lib"
  }

  const alias = spec.match(/^@(ui|atoms|molecules|organisms|sections|templates|providers)\//)
  if (alias) return alias[1]
  const m = spec.match(/(?:^|\/)components\/(ui|atoms|molecules|organisms|sections|templates|providers)(?:\/|$)/)
  if (m) return m[1]
  if (/(?:^|\/)server\//.test(spec) && /^[@~.]/.test(spec)) return serverFamily(spec)
  if (/^[@~]\/components\//.test(spec)) return "components-stray"
  return null // external package, next/*, react, …
}

/** Best-effort: resolve a specifier to a repo-relative file we have scanned. */
function resolveToFile(app, spec, fromFileRel, known) {
  const bases = spec.startsWith(".")
    ? [norm(path.join(path.dirname(fromFileRel), spec))]
    : app.bases.map((b) => (b === "." ? spec.replace(/^[@~]\//, "") : `${b}/${spec.replace(/^[@~]\//, "")}`))
  for (const b of bases) {
    if (known.has(b)) return b
    for (const e of RESOLVE_EXT) if (known.has(b + e)) return b + e
    for (const e of RESOLVE_EXT) if (known.has(`${b}/index${e}`)) return `${b}/index${e}`
  }
  return null
}

/* ---------------------------------------------------------------- findings */

const findings = []
const ignoredFiles = new Map() // rel -> Set(rule)
function report(sev, rule, file, line, msg) {
  findings.push({ severity: sev, rule, file, line, message: msg })
}

/* -------------------------------------------------------------------- utils */

function walk(dir, acc = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
      walk(full, acc)
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      acc.push(full)
    }
  }
  return acc
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length

function makeIgnoreChecker(rel, raw) {
  const lines = raw.split("\n")
  const fileIgnores = new Set()
  for (const l of lines) {
    const m = l.match(/atomic-ignore-file\s+([\w-]+)/)
    if (!m) continue
    if (m[1] === "all") {
      if (!ALLOW_BLANKET) {
        report("error", "ignore-blanket", rel, lines.indexOf(l) + 1,
          `"atomic-ignore-file all" disables every rule in this file. "all" is not a rule id — name the specific rule, or re-run with --allow-blanket-ignore if the blanket really is intended.`)
        continue
      }
      fileIgnores.add("all")
      continue
    }
    if (!RULE_IDS.has(m[1])) {
      report("warn", "structure", rel, lines.indexOf(l) + 1,
        `Unknown ignore rule id "${m[1]}". Valid ids: ${[...RULE_IDS].join(", ")}.`)
      continue
    }
    fileIgnores.add(m[1])
  }
  if (fileIgnores.size) ignoredFiles.set(rel, fileIgnores)
  return (rule, lineNo) => {
    if (fileIgnores.has(rule) || fileIgnores.has("all")) return true
    for (const idx of [lineNo - 1, lineNo - 2]) {
      const l = lines[idx]
      if (!l) continue
      const m = l.match(/atomic-ignore\s+([\w-]+)/)
      if (m && m[1] === rule) return true
    }
    return false
  }
}

/** index of the `>` that closes the tag opened at `openIdx`, or -1 */
function tagEnd(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === ">" && depth === 0) return i
  }
  return -1
}

function matchParen(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++
    else if (text[i] === ")") { depth--; if (depth === 0) return i }
  }
  return -1
}

/** deepest JSX nesting inside a fragment of masked source */
function maxJsxDepth(frag) {
  let depth = 0, max = 0
  const re = /<(\/?)([A-Za-z][\w.]*)/g
  let m
  while ((m = re.exec(frag))) {
    const end = tagEnd(frag, m.index)
    if (end === -1) break
    if (m[1] === "/") { depth = Math.max(0, depth - 1); continue }
    const selfClosing = frag[end - 1] === "/"
    if (selfClosing) max = Math.max(max, depth + 1)
    else { depth++; max = Math.max(max, depth) }
    re.lastIndex = end
  }
  return max
}

/** className / class attribute values that belong to the ROOT element of each `return` */
function rootElementAttrs(masked, raw) {
  const out = []
  const re = /(?:\breturn|=>)\s*\(?\s*</g
  let m
  while ((m = re.exec(masked))) {
    const lt = masked.indexOf("<", m.index)
    if (lt === -1) continue
    const end = tagEnd(masked, lt)
    if (end === -1) continue
    out.push({ start: lt, end, text: raw.slice(lt, end + 1) })
  }
  return out
}

/* -------------------------------------------------------------------- rules */

function checkFile(app, fullPath, known, launder) {
  const rel = norm(path.relative(ROOT, fullPath))
  if (isSkippable(rel)) return

  const ext = path.extname(rel)
  const raw = fs.readFileSync(fullPath, "utf8")
  const { noComments, full: masked } = maskSource(raw)
  const layer = classify(app, rel)
  const lineCount = raw.split("\n").length

  const ignored = makeIgnoreChecker(rel, raw)
  const emit = (sev, rule, line, msg) => { if (!ignored(rule, line)) report(sev, rule, rel, line, msg) }

  const hasJsx = /<[A-Za-z][\w.]*[\s/>]/.test(masked)
  const declaresComponent = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Z]\w*\s*[(<]/.test(masked)
    || /\b(?:const|let|var)\s+[A-Z]\w*\s*(?::[^=\n]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=>\n]*)?=>/.test(masked)

  /* --- files that live nowhere ------------------------------------------ */
  if (layer === null) {
    if (MARKUP_EXT.has(ext)) {
      emit("error", "layer-unknown", 1,
        `"${rel}" renders in no layer. Exactly two directories may hold .tsx: app/ (route files only) and components/<layer>/ — ui, atoms, molecules, organisms, sections, templates, providers. Folders like features/, views/, modules/, widgets/ and containers/ are not layers.`)
    }
    return
  }
  if (layer === "config") return

  if (layer === "components-stray") {
    emit("error", "layer-unknown", 1,
      `Component sits inside components/ but outside every layer. Move it into components/{ui,atoms,molecules,organisms,sections,templates,providers}.`)
    return
  }
  if (layer === "app-stray") {
    emit("error", "layer-unknown", 1,
      `app/ holds route files only (page, layout, template, default, loading, error, global-error, not-found, and the Next.js file-convention assets). Move this component into components/<layer>/.`)
    return
  }

  // Any JSX at all — not only a capitalised component. A lowercase `buildRows()` in
  // lib/*.tsx returning markup launders every layering rule just as effectively.
  if ((layer === "lib" || layer === "server") && MARKUP_EXT.has(ext) && hasJsx) {
    emit("error", "layer-unknown", 1,
      `A component is defined in ${layer === "lib" ? "lib/ or hooks/" : "server/"}. Components live in components/<layer>/ — this path is not scanned as a layer and would launder every layering rule.`)
    return
  }

  /* --- barrels ----------------------------------------------------------- */
  const base = path.basename(rel, ext)
  const inLayer = ["ui", "atoms", "molecules", "organisms", "sections", "templates", "providers"].includes(layer)
  if (inLayer && base === "index" && layer !== "ui") {
    emit("error", "barrel", 1,
      `Barrel file inside components/${layer}/. A barrel hides which layer an import crosses — it defeats this validator and every code review. Import the explicit path instead.`)
  }

  const importsOnly = layer === "lib" || layer === "server"

  /* --- naming ------------------------------------------------------------ */
  if (!importsOnly && ["atoms", "molecules", "organisms", "sections", "templates", "providers"].includes(layer)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(base)) {
      emit("error", "naming", 1, `File must be PascalCase and export a component of the same name (got "${base}").`)
    }
    if (layer === "templates" && !/Template$/.test(base)) {
      emit("error", "naming", 1, `Template files must end in "Template" (got "${base}").`)
    }
    if (layer === "sections" && !/Section$/.test(base)) {
      emit("error", "naming", 1, `Server-section files must end in "Section" (got "${base}").`)
    }
  }

  /* --- imports ------------------------------------------------------------ */
  const specs = []
  const typeOnly = new Set()
  const bindings = new Map() // local name -> specifier

  const importRe = /\bimport\s+(type\s+)?([\w$*{},\s]*?)\s*from\s*["']([^"']+)["']/g
  let im
  while ((im = importRe.exec(noComments))) {
    const line = lineOf(noComments, im.index)
    const spec = im[3]
    specs.push({ spec, line })
    const clause = im[2].trim()
    if (im[1]) typeOnly.add(`${spec}@${line}`)
    else if (/^\{[\s\S]*\}$/.test(clause)) {
      const parts = clause.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean)
      if (parts.length && parts.every((p) => /^type\s/.test(p))) typeOnly.add(`${spec}@${line}`)
    }
    for (const part of clause.split(/[{},]/)) {
      const t = part.trim().replace(/^type\s+/, "")
      if (!t || t === "*") continue
      const as = t.match(/^([\w$]+)\s+as\s+([\w$]+)$/)
      if (as) bindings.set(as[2], spec)
      else if (/^[\w$]+$/.test(t)) bindings.set(t, spec)
    }
  }
  for (const re of [
    /^[ \t]*import\s*["']([^"']+)["']/gm,                    // side-effect import
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,                // dynamic import
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g, // re-export
  ]) {
    let m
    while ((m = re.exec(noComments))) specs.push({ spec: m[1], line: lineOf(noComments, m.index) })
  }

  const checkTarget = (target, spec, line, viaNote = "") => {
    if (target === null || target === "config") return
    if (target === "lib") return

    if (typeof target === "string" && target.startsWith("server-")) {
      if (typeOnly.has(`${spec}@${line}`)) return // types are free everywhere
      const allow = SERVER_ALLOWED[target]
      if (allow && !allow.has(layer)) {
        emit("error", "data-fetch", line,
          `${An(layer)} must not import ${target === "server-data" ? "server/queries or server/db" : "server/actions"} ("${spec}")${viaNote}. ${target === "server-data"
            ? "Data is fetched in app/**/page.tsx (or a components/sections/*Section.tsx) and passed down as props."
            : "Server actions reach an organism as props from the page."} Type-only imports (import type …) and server/types|schemas are always allowed.`)
      }
      return
    }
    if (target === "components-stray" || target === "app-stray") {
      emit("error", "layer-unknown", line, `Imports "${spec}", which is not in any layer${viaNote}.`)
      return
    }
    if (target === layer && layer !== "ui") {
      emit("error", "same-layer-import", line,
        `${An(layer)} importing another ${say(layer)} ("${spec}")${viaNote}. Same-layer imports are forbidden above layer 0 — demote the imported component one layer, or promote this one.`)
      return
    }
    if (target === layer) return // ui -> ui is how shadcn ships
    const allowed = ALLOWED[layer]
    if (!allowed) return // route-asset: unrestricted
    if (!allowed.has(target)) {
      const why = allowed.size === 0
        ? `a template imports nothing but react and cn — every region arrives as a ReactNode slot, supplied by the page`
        : RANK[target] > RANK[layer]
          ? `upward import (${say(target)} sits above ${say(layer)})`
          : `${an(layer)} may only import: ${[...allowed].join(", ")}`
      emit("error", "import-direction", line, `${say(layer)} → ${say(target)} ("${spec}")${viaNote} is illegal — ${why}.`)
    }
  }

  if (importsOnly) return
  for (const { spec, line } of specs) {
    const target = classifySpecifier(app, spec, rel)
    checkTarget(target, spec, line)
    if (target === "lib") {
      const file = resolveToFile(app, spec, rel, known)
      const leaked = file ? launder.get(file) : null
      if (leaked) for (const L of leaked) checkTarget(L, spec, line, ` (re-exported from ${file})`)
    }
  }
  if (!MARKUP_EXT.has(ext)) return

  const exempt = layer === "route-asset"

  /* --- raw interactive HTML ------------------------------------------------ */
  if (!exempt) {
    const tagRe = /<(button|input|select|textarea|form|img|table|dialog|a)(?=[\s/>])/g
    let t
    while ((t = tagRe.exec(masked))) {
      const tag = t[1]
      if (RAW_TAGS[tag].includes(layer)) continue
      const fix = tag === "img" ? "next/image" : tag === "a" ? "next/link" : `the shadcn <${tag[0].toUpperCase() + tag.slice(1)}> primitive from components/ui`
      emit("error", "raw-html", lineOf(masked, t.index), `Raw <${tag}> in ${an(layer)}. Use ${fix}.`)
    }
  }

  /* --- atoms: the ROOT element carries no margin, position or grid span ----- */
  if (layer === "atoms") {
    const checks = [
      [/(?<![\w-])-?m[trblxy]?-(?:px|auto|full|\d|\[)/g, "margin"],
      [/(?<![\w-])(?:absolute|fixed|sticky)(?![\w-])/g, "positioning"],
      [/(?<![\w-])(?:col-span|row-span|col-start|row-start)-/g, "grid placement"],
    ]
    for (const root of rootElementAttrs(masked, raw)) {
      for (const [re, what] of checks) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(root.text))) {
          emit("error", "atom-spacing", lineOf(raw, root.start),
            `The root element of this atom uses ${what} ("${m[0]}"). Atoms carry no external spacing — the parent molecule/organism supplies gap-*, the template supplies the grid. (Only the root element is checked: internal parts may position freely.)`)
        }
      }
    }
  }

  /* --- client boundary ----------------------------------------------------- */
  if (/^\s*["']use client["']/m.test(raw)) {
    const line = lineOf(raw, raw.search(/["']use client["']/))
    if (["templates", "pages", "shell", "sections"].includes(layer)) {
      emit("error", "client-boundary", line,
        `"use client" is illegal in ${an(layer)}. Push the directive down to the molecule or organism that actually needs interactivity. (app/**/error.tsx is the one route file that must carry it — it is classified as an error boundary, not a page.)`)
    }
  }

  /* --- data fetching -------------------------------------------------------- */
  if (!["pages", "shell", "sections", "route-asset"].includes(layer)) {
    const hard = [
      [/(?<![\w.])fetch\s*\(/g, "fetch()"],
      [/\baxios\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(/g, "axios"],
    ]
    for (const [re, what] of hard) {
      let m
      while ((m = re.exec(masked))) {
        emit("error", "data-fetch", lineOf(masked, m.index),
          `${what} inside ${an(layer)}. Fetch in app/**/page.tsx or a components/sections/*Section.tsx and pass data down. (Server actions for mutations are fine.)`)
      }
    }
    // useEffect bodies that await or .then(
    const eff = /\buseEffect\s*\(/g
    let e
    while ((e = eff.exec(masked))) {
      const open = masked.indexOf("(", e.index + 8)
      const close = matchParen(masked, open)
      if (close === -1) continue
      const body = masked.slice(open, close)
      if (/\bawait\b/.test(body) || /\.then\s*\(/.test(body)) {
        emit("error", "data-fetch", lineOf(masked, e.index),
          `useEffect in ${an(layer)} performs async data loading. Fetch on the server; a component below the page receives data as props.`)
      }
      eff.lastIndex = close
    }
    // client caches without page-seeded data
    const q = /\buse(?:Query|SWR|SWRInfinite|InfiniteQuery|SuspenseQuery)\s*\(/g
    let qm
    while ((qm = q.exec(masked))) {
      const open = masked.indexOf("(", qm.index)
      const close = matchParen(masked, open)
      if (close === -1) continue
      const argsText = masked.slice(open, close)
      if (!/initialData|initialPageParam|fallbackData|placeholderData/.test(argsText)) {
        emit("error", "data-fetch", lineOf(masked, qm.index),
          `Client-side query in ${an(layer)} with no page-seeded data. Client revalidation is permitted only in an organism and only over data the page seeded via initialData / initialPageParam.`)
      }
      q.lastIndex = close
    }
  }
  if (layer === "templates" && /\basync\s+function\s+[A-Z]/.test(masked)) {
    emit("error", "data-fetch", lineOf(masked, masked.search(/\basync\s+function\s+[A-Z]/)),
      `Templates are synchronous and data-free. Move the await into the page or a components/sections/*Section.tsx.`)
  }

  /* --- page shape ------------------------------------------------------------ */
  if (layer === "pages" && /(?:^|\/)page\.(t|j)sx$/.test(rel)) {
    const parallelOrIntercepted = /\/@[^/]+\//.test("/" + rel) || /\/\(\.{1,3}\)/.test("/" + rel)
    const jsxNames = [...new Set([...masked.matchAll(/<([A-Z][\w.]*)/g)].map((x) => x[1].split(".")[0]))]
    const templateSpecs = new Set()
    for (const nameUsed of jsxNames) {
      const spec = bindings.get(nameUsed)
      if (!spec) continue
      if (classifySpecifier(app, spec, rel) === "templates") templateSpecs.add(spec)
    }
    if (!parallelOrIntercepted && hasJsx) {
      if (templateSpecs.size === 0) {
        emit("error", "page-shape", 1,
          `Page renders no template. A page owns data + metadata and delegates all layout to exactly one component imported from components/templates/.`)
      } else if (templateSpecs.size > 1) {
        emit("error", "page-shape", 1,
          `Page renders ${templateSpecs.size} templates (${[...templateSpecs].join(", ")}). Exactly one.`)
      }
    }
    // no local composition in a page
    const localDecls = new Set()
    for (const m of masked.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Z]\w*)/g)) localDecls.add(m[1])
    for (const m of masked.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let)\s+([A-Z]\w*)\s*(?::[^=\n]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=>\n]*)?=>/g)) localDecls.add(m[1])
    if (localDecls.size > 1) {
      emit("error", "page-shape", 1,
        `Page declares ${localDecls.size} components (${[...localDecls].join(", ")}). A page holds one default export. Async <Suspense> children belong in components/sections/<Feature>Section.tsx; everything else is an organism.`)
    }
    let cm
    const clsRe = /className\s*=/g
    while ((cm = clsRe.exec(masked))) {
      emit("error", "page-shape", lineOf(masked, cm.index),
        `Page carries className — that is layout. Move it into the template.`)
    }
  }

  /* --- god components --------------------------------------------------------- */
  const cap = MAX_LINES[layer]
  if (cap && lineCount > cap * 2) {
    emit("error", "god-component", 1,
      `${lineCount} lines in ${an(layer)} — over the hard ceiling of ${cap * 2} (soft cap ${cap}). Apply the 3-node extraction rule: named JSX blocks 3+ levels deep move to the layer below.`)
  } else if (cap && lineCount > cap) {
    emit("warn", "god-component", 1,
      `${lineCount} lines in ${an(layer)} (soft cap ${cap}, hard ceiling ${cap * 2}). Apply the 3-node extraction rule.`)
  }
  if (!exempt && layer !== "ui") {
    const mapRe = /\.\s*map\s*\(/g
    let mm
    while ((mm = mapRe.exec(masked))) {
      const open = masked.indexOf("(", mm.index)
      const close = matchParen(masked, open)
      if (close === -1) continue
      const depth = maxJsxDepth(masked.slice(open, close))
      if (depth >= 3) {
        emit("error", "god-component", lineOf(masked, mm.index),
          `Inline JSX ${depth} levels deep inside a .map() in ${an(layer)}. A list item you can name is a component one layer down — extract it (rule 6, the 3-node extraction rule).`)
      }
      mapRe.lastIndex = close
    }
  }
}

/* ---------------------------------------------------------------- structure */

function checkStructure(app) {
  const exists = (rels) => rels.some((r) => fs.existsSync(path.join(ROOT, r)))
  const where = app.root === "." ? "" : ` in ${app.root}`
  if (!exists(app.dirs.ui)) {
    report("error", "structure", `${app.root}/components/ui`, 1,
      `No components/ui${where} — shadcn/ui is the required base (layer 0). Run: npx shadcn@latest init -d, then add the primitives you need.`)
  }
  for (const L of ["atoms", "molecules", "organisms", "templates"]) {
    if (!exists(app.dirs[L])) {
      report("warn", "structure", `${app.root}/components/${L}`, 1, `Missing components/${L}/${where} — the layer exists in every atomic project, even if thin.`)
    }
  }
}

/* --------------------------------------------------------------------- run */

let appRoots = findConfigs(ROOT)
if (APP_FILTER) {
  const want = path.resolve(APP_FILTER)
  appRoots = appRoots.filter((r) => path.resolve(r) === want)
  if (appRoots.length === 0) {
    report("error", "structure", norm(path.relative(ROOT, want)) || ".", 1, `--app ${APP_FILTER}: no components.json there.`)
  }
}
if (appRoots.length === 0 && !APP_FILTER) {
  report("error", "structure", "components.json", 1,
    `No components.json found under ${norm(ROOT)}. Run: npx shadcn@latest init -d (never the interactive form). Validating with default paths — layer detection may be incomplete until shadcn is initialised.`)
  appRoots = [ROOT] // still validate, so violations are visible rather than hidden behind one error
}

const apps = appRoots.map(makeApp)
const allFiles = walk(ROOT)
const known = new Set(allFiles.map((f) => norm(path.relative(ROOT, f))))

/** pick the app whose root is the longest prefix of the file */
function appFor(rel) {
  let best = null
  for (const a of apps) {
    if (a.root === "." || under(rel, a.root)) {
      if (!best || a.root.length > best.root.length) best = a
    }
  }
  return best
}

for (const app of apps) checkStructure(app)

/* pre-pass: which layers does each lib/hooks module re-export? (laundering) */
const launder = new Map()
for (let pass = 0; pass < 3; pass++) {
  for (const f of allFiles) {
    const rel = norm(path.relative(ROOT, f))
    if (isSkippable(rel)) continue
    const app = appFor(rel)
    if (!app) continue
    if (classify(app, rel) !== "lib") continue
    const { noComments } = maskSource(fs.readFileSync(f, "utf8"))
    const set = launder.get(rel) ?? new Set()
    const out = []
    for (const re of [
      /\bexport\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
      /\bimport\s+[\s\S]*?\s+from\s*["']([^"']+)["']/g,
    ]) { let m; while ((m = re.exec(noComments))) out.push(m[1]) }
    for (const spec of out) {
      const t = classifySpecifier(app, spec, rel)
      if (t && (["ui", "atoms", "molecules", "organisms", "sections", "templates", "providers"].includes(t) || t.startsWith("server-"))) set.add(t)
      else if (t === "lib") {
        const file = resolveToFile(app, spec, rel, known)
        if (file && launder.has(file)) for (const L of launder.get(file)) set.add(L)
      }
    }
    if (set.size) launder.set(rel, set)
  }
}

for (const f of allFiles) {
  const rel = norm(path.relative(ROOT, f))
  const app = appFor(rel)
  // In a monorepo, a file belonging to no app used to be skipped silently — which put
  // every rule back behind a `mkdir shared/`. It is now an error in its own right.
  if (!app) {
    if (MARKUP_EXT.has(path.extname(rel)) && !isSkippable(rel) && !/\.(config|setup)\.[jt]sx?$/.test(rel)) {
      report("error", "layer-unknown", rel, 1,
        `Renders markup but belongs to no app — no components.json above it. Move it into an app's components/<layer>/, or give this workspace its own components.json.`)
    }
    continue
  }
  checkFile(app, f, known, launder)
}

const errors = findings.filter((f) => f.severity === "error")
const warns = findings.filter((f) => f.severity === "warn")
const ignoreReport = [...ignoredFiles.entries()].map(([f, rules]) => `${f} (${[...rules].join(", ")})`)

if (AS_JSON) {
  console.log(JSON.stringify({
    root: norm(ROOT), apps: apps.map((a) => a.root),
    errors: errors.length, warnings: warns.length,
    fullyIgnored: ignoreReport, findings,
  }, null, 2))
} else {
  const byFile = new Map()
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f)
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`\n${file}`)
    for (const f of list.sort((a, b) => a.line - b.line)) {
      const tag = f.severity === "error" ? "ERROR" : "warn "
      console.log(`  ${tag} ${String(f.line).padStart(4)}  [${f.rule}] ${f.message}`)
    }
  }
  console.log(`\napps: ${apps.map((a) => a.root).join(", ") || "(none)"}`)
  console.log(`${ignoreReport.length} file(s) fully ignored${ignoreReport.length ? ": " + ignoreReport.join("; ") : "."}`)
  console.log(`${errors.length} error(s), ${warns.length} warning(s) in ${byFile.size} file(s).`)
  if (errors.length === 0 && warns.length === 0) console.log("Atomic layering is clean.")
  if (WARN_ONLY && errors.length) console.log("--warn-only: exiting 0 despite errors. Never use this as a gate.")
}

process.exit(errors.length > 0 && !WARN_ONLY ? 1 : 0)
