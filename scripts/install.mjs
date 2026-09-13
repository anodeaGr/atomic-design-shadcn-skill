#!/usr/bin/env node
/**
 * atomic-design-shadcn — dependency installer.
 *
 * Executes the process documented in INSTALL.md:
 *   1. register the shadcn MCP server for each requested client
 *   2. allow-list that server in Claude Code settings
 *   3. install the shadcn/ui skills via the `skills` CLI
 *   4. verify and report
 *
 * Every step merges into existing config rather than overwriting it, so re-running
 * repairs a partial install instead of duplicating anything.
 *
 * Works identically on Windows, macOS and Linux. No dependencies, Node 18+.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Where this skill is installed — works for both project and global scope. */
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MCP_SERVER_NAME = 'shadcn';
const MCP_COMMAND = 'npx';
const MCP_ARGS = ['shadcn@latest', 'mcp'];
const SHADCN_SKILLS_SOURCE = 'shadcn/ui';
const SKILL_NAME = 'atomic-design-shadcn';

const PERMISSIONS = [
  'mcp__shadcn',
  'Bash(npx shadcn@latest:*)',
  'Bash(node scripts/validate-atomic.mjs:*)',
];

// --- argument parsing -------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
atomic-design-shadcn installer

  node scripts/install.mjs [options]

Options
  -g, --global          Install to the user directory (~/.claude) instead of the project
  -a, --agent <name>    Target agent for the skills CLI; repeatable. Default: claude-code
                        (claude-code | codex | cursor | ...)
  -c, --client <name>   Client to register the MCP server for; repeatable.
                        Default: claude  (claude | cursor | vscode | codex)
      --copy            Copy skill files instead of symlinking (use on Windows if
                        symlink creation is blocked)
      --project-root    Project root to configure. Default: nearest ancestor with
                        components.json, else the current directory
      --no-init         Do not run \`shadcn init\` when components.json is missing
      --skip-mcp        Skip step 1
      --skip-settings   Skip step 2
      --skip-skills     Skip step 3
  -n, --dry-run         Print what would change; write nothing
  -h, --help            Show this message

Examples
  node scripts/install.mjs
  node scripts/install.mjs -g -a claude-code -a codex
  node scripts/install.mjs --client claude --client vscode --copy
  node scripts/install.mjs --dry-run
`);
  process.exit(0);
}

function takeAll(flags) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (flags.includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      out.push(argv[++i]);
    }
  }
  return out;
}

function takeOne(flags) {
  const i = argv.findIndex((a) => flags.includes(a));
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : null;
}

const opts = {
  global: argv.includes('-g') || argv.includes('--global'),
  copy: argv.includes('--copy'),
  dryRun: argv.includes('-n') || argv.includes('--dry-run'),
  skipMcp: argv.includes('--skip-mcp'),
  skipSettings: argv.includes('--skip-settings'),
  skipSkills: argv.includes('--skip-skills'),
  noInit: argv.includes('--no-init'),
  agents: takeAll(['-a', '--agent']),
  clients: takeAll(['-c', '--client']),
  projectRoot: takeOne(['--project-root']),
};
if (opts.agents.length === 0) opts.agents = ['claude-code'];
if (opts.clients.length === 0) opts.clients = ['claude'];

// --- output helpers ---------------------------------------------------------

const changes = [];
const warnings = [];

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok = (msg) => { console.log(`    ok       ${msg}`); };
const wrote = (msg) => { console.log(`    ${opts.dryRun ? 'would   ' : 'wrote   '} ${msg}`); changes.push(msg); };
const skip = (msg) => console.log(`    skip     ${msg}`);
const warn = (msg) => { console.log(`    warn     ${msg}`); warnings.push(msg); };

function fail(msg) {
  console.error(`\nInstall aborted: ${msg}\n`);
  process.exit(1);
}

// --- fs helpers -------------------------------------------------------------

function readJson(file) {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (raw === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${file} is not valid JSON. Fix or move it, then re-run — refusing to overwrite it.`);
  }
}

function writeJson(file, data) {
  if (opts.dryRun) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Add missing values to an array without reordering or duplicating. Returns count added. */
function mergeInto(arr, values) {
  let added = 0;
  for (const v of values) {
    if (!arr.includes(v)) { arr.push(v); added++; }
  }
  return added;
}

/**
 * Nearest ancestor that looks like the project to configure.
 * components.json wins — it marks an already-initialised shadcn project. Otherwise
 * fall back to the nearest package.json, so a project that has not run
 * `shadcn init` yet is still found rather than silently configuring the cwd.
 */
function findProjectRoot(start) {
  let dir = resolve(start);
  let pkgFallback = null;
  for (;;) {
    if (existsSync(join(dir, 'components.json'))) return dir;
    if (!pkgFallback && existsSync(join(dir, 'package.json'))) pkgFallback = dir;
    const parent = dirname(dir);
    if (parent === dir) return pkgFallback;
    dir = parent;
  }
}

function run(cmd, args, cwd) {
  if (opts.dryRun) {
    console.log(`    would run ${cmd} ${args.join(' ')}`);
    console.log(`    in        ${cwd}`);
    return { status: 0, dryRun: true };
  }
  console.log(`    run      ${cmd} ${args.join(' ')}`);
  console.log(`    in       ${cwd}`);
  // shell:true so Windows resolves npx.cmd from PATH.
  // cwd matters: `skills add` resolves project scope from the working directory,
  // so it must run in the target project, not in this skill's folder.
  return spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd });
}

// --- preflight --------------------------------------------------------------

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) fail(`Node 18+ required, found ${process.versions.node}.`);

/**
 * A path is a skill install directory if it sits under `<agent>/skills/`.
 * Running the installer from there means the user cd'd into the skill instead of
 * their project — configuring that folder would be useless, so it is never a
 * valid project root.
 */
function isInsideSkillsDir(p) {
  const norm = p.split(sep).join('/');
  return /\/(\.claude|\.agents|\.cursor|\.codex)\/skills\//.test(norm + '/');
}

let projectRoot;
if (opts.projectRoot) {
  projectRoot = resolve(opts.projectRoot);
} else {
  const found = findProjectRoot(process.cwd());
  projectRoot = found ?? process.cwd();
}

const ranFromSkillDir = isInsideSkillsDir(projectRoot);

// Global scope configures ~/.claude only, so a bogus project root is harmless there.
if (ranFromSkillDir && !opts.global) {
  fail(
    `this installer was run from inside the skill folder, so there is no project to configure.\n\n` +
    `  resolved project root: ${projectRoot}\n\n` +
    `Do one of the following instead:\n\n` +
    `  1. cd into the project you want configured, then run the installer by path:\n` +
    `       cd /path/to/your-project\n` +
    `       node "${join(SKILL_DIR, 'scripts', 'install.mjs')}"\n\n` +
    `  2. or name the project explicitly from anywhere:\n` +
    `       node "${join(SKILL_DIR, 'scripts', 'install.mjs')}" --project-root /path/to/your-project\n\n` +
    `  3. or install user-wide instead of per-project:\n` +
    `       node "${join(SKILL_DIR, 'scripts', 'install.mjs')}" --global`
  );
}

const hasComponentsJson = existsSync(join(projectRoot, 'components.json'));

console.log(`atomic-design-shadcn installer`);
console.log(`  node          ${process.versions.node}`);
console.log(`  platform      ${process.platform}`);
console.log(`  skill dir     ${SKILL_DIR}`);
console.log(`  project root  ${opts.global ? '(n/a — global scope)' : projectRoot}`);
console.log(`  scope         ${opts.global ? 'global (user)' : 'project'}`);
console.log(`  agents        ${opts.agents.join(', ')}`);
console.log(`  mcp clients   ${opts.clients.join(', ')}`);
if (opts.dryRun) console.log(`  MODE          dry run — nothing will be written`);

// --- step 0: make sure the target is a real project ------------------------

const hasPackageJson = existsSync(join(projectRoot, 'package.json'));

/**
 * This skill targets Next.js. A project is a Next.js app if it depends on `next`,
 * or if it has a next.config file. Anything else is out of scope, so the install
 * stops rather than writing config that can never work.
 */
function detectNextJs(root) {
  const configs = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];
  const config = configs.find((f) => existsSync(join(root, f)));
  if (config) return { isNext: true, evidence: config };

  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return { isNext: false, evidence: null };
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return { isNext: false, evidence: null };
  }
  const version = pkg.dependencies?.next ?? pkg.devDependencies?.next;
  if (version) return { isNext: true, evidence: `next@${version} in package.json` };

  return { isNext: false, evidence: null };
}
const skipProjectChecks = opts.global && ranFromSkillDir;

if (!skipProjectChecks) {
  step(0, 'Check the target project');

  const next = detectNextJs(projectRoot);

  if (!next.isNext) {
    const reason = hasPackageJson
      ? 'This project does not use Next.js.'
      : 'This folder has no package.json.';

    fail(
      `this skill needs a Next.js app. ${reason}\n\n` +
      `  Folder checked:  ${projectRoot}\n\n` +
      `The installer looked for one of these, and found none:\n` +
      `  - next.config.js, next.config.mjs, next.config.ts, or next.config.cjs\n` +
      `  - "next" in dependencies or devDependencies in package.json\n\n` +
      `Do one of these:\n\n` +
      `  1. Go to your Next.js app. Then run the installer:\n` +
      `       cd /path/to/your-next-app\n` +
      `       node "${join(SKILL_DIR, 'scripts', 'install.mjs')}"\n\n` +
      `  2. Or give the path to your Next.js app:\n` +
      `       node "${join(SKILL_DIR, 'scripts', 'install.mjs')}" --project-root /path/to/your-next-app\n\n` +
      `  3. Or make a new Next.js app first:\n` +
      `       npx create-next-app@latest my-app\n\n` +
      `To write user settings only, with no app, add --global.`
    );
  }
  ok(`Next.js app found (${next.evidence})`);

  if (hasComponentsJson) {
    ok(`components.json found`);
  } else if (opts.noInit) {
    warn(`no components.json — the shadcn MCP server will not start. Run: npx shadcn@latest init -d`);
  } else {
    console.log(`    ...      no components.json — running shadcn init (skip with --no-init)`);
    const initRes = run('npx', ['shadcn@latest', 'init', '-d'], projectRoot);
    if (initRes.dryRun) {
      changes.push('shadcn init (creates components.json)');
    } else if (initRes.status !== 0 || !existsSync(join(projectRoot, 'components.json'))) {
      warn(
        `shadcn init did not produce a components.json (exit ${initRes.status}). ` +
        `The MCP server will not start until it exists — run \`npx shadcn@latest init\` ` +
        `manually and answer its prompts, then re-run this installer.`
      );
    } else {
      ok(`components.json created`);
      changes.push(`components.json in ${projectRoot}`);
    }
  }
}

// --- step 1: MCP server -----------------------------------------------------

if (opts.skipMcp) {
  step(1, 'shadcn MCP server — skipped (--skip-mcp)');
} else {
  step(1, 'Register the shadcn MCP server');

  // .mcp.json / .cursor/mcp.json / .vscode/mcp.json are per-project files; there is no
  // global equivalent. With -g and no real project to point at, registration has to go
  // through the CLI at user scope instead.
  const noProjectForMcp = ranFromSkillDir || (opts.global && !opts.projectRoot && !hasComponentsJson);

  for (const client of opts.clients) {
    if (noProjectForMcp && client !== 'codex') {
      warn(
        `${client}: no project to write an MCP config into (these are per-project files). ` +
        `Register the server user-wide instead:\n` +
        `                 claude mcp add shadcn --scope user -- npx shadcn@latest mcp\n` +
        `             or re-run this installer from a project, or with --project-root <dir>.`
      );
      continue;
    }
    if (client === 'claude' || client === 'cursor' || client === 'vscode') {
      const file = client === 'claude'
        ? join(projectRoot, '.mcp.json')
        : client === 'cursor'
          ? join(projectRoot, '.cursor', 'mcp.json')
          : join(projectRoot, '.vscode', 'mcp.json');

      // VS Code uses "servers"; Claude Code and Cursor use "mcpServers".
      const key = client === 'vscode' ? 'servers' : 'mcpServers';

      const cfg = readJson(file);
      cfg[key] ??= {};
      if (cfg[key][MCP_SERVER_NAME]) {
        ok(`${client}: already registered in ${file}`);
      } else {
        cfg[key][MCP_SERVER_NAME] = { command: MCP_COMMAND, args: MCP_ARGS };
        writeJson(file, cfg);
        wrote(`${client}: ${file}`);
      }
    } else if (client === 'codex') {
      const file = join(homedir(), '.codex', 'config.toml');
      const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (existing.includes('[mcp_servers.shadcn]')) {
        ok(`codex: already registered in ${file}`);
      } else {
        const block = `\n[mcp_servers.${MCP_SERVER_NAME}]\ncommand = "${MCP_COMMAND}"\nargs = [${MCP_ARGS.map((a) => `"${a}"`).join(', ')}]\n`;
        if (!opts.dryRun) {
          mkdirSync(dirname(file), { recursive: true });
          appendFileSync(file, block, 'utf8');
        }
        wrote(`codex: ${file}`);
      }
    } else {
      warn(`unknown --client "${client}" — skipped. Known: claude, cursor, vscode, codex.`);
    }
  }
}

// --- step 2: settings allow-list -------------------------------------------

if (opts.skipSettings) {
  step(2, 'Settings allow-list — skipped (--skip-settings)');
} else {
  step(2, 'Allow-list the server in Claude Code settings');

  // enabledMcpjsonServers is only honoured in a file that is NOT committed, so
  // project scope targets settings.local.json rather than settings.json.
  const settingsFile = opts.global
    ? join(homedir(), '.claude', 'settings.json')
    : join(projectRoot, '.claude', 'settings.local.json');

  const settings = readJson(settingsFile);

  settings.enabledMcpjsonServers ??= [];
  const serversAdded = mergeInto(settings.enabledMcpjsonServers, [MCP_SERVER_NAME]);

  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  const permsAdded = mergeInto(settings.permissions.allow, PERMISSIONS);

  if (serversAdded === 0 && permsAdded === 0) {
    ok(`already configured: ${settingsFile}`);
  } else {
    writeJson(settingsFile, settings);
    wrote(`${settingsFile} (+${serversAdded} server, +${permsAdded} permission${permsAdded === 1 ? '' : 's'})`);
  }

  // A committed settings.json carrying this key silently does nothing — flag it.
  const committed = join(projectRoot, '.claude', 'settings.json');
  if (!opts.global && existsSync(committed)) {
    const c = readJson(committed);
    if (Array.isArray(c.enabledMcpjsonServers) || c.enableAllProjectMcpServers) {
      warn(`${committed} sets enabledMcpjsonServers / enableAllProjectMcpServers. That key has no effect in a committed settings file — remove it there; it is now set in ${settingsFile}.`);
    }
  }
}

// --- step 3: shadcn/ui skills ----------------------------------------------

if (opts.skipSkills) {
  step(3, 'shadcn/ui skills — skipped (--skip-skills)');
} else {
  step(3, 'Install the shadcn/ui skills');

  const args = ['skills', 'add', SHADCN_SKILLS_SOURCE, '-y'];
  for (const a of opts.agents) args.push('-a', a);
  if (opts.global) args.push('-g');
  if (opts.copy) args.push('--copy');

  // Global installs must not run inside the skill folder, or the CLI drops a
  // skills-lock.json there. Home is the correct working directory for -g.
  const skillsCwd = opts.global ? homedir() : projectRoot;
  const res = run('npx', args, skillsCwd);
  if (res.dryRun) {
    changes.push(`shadcn/ui skills for ${opts.agents.join(', ')}`);
  } else if (res.status !== 0) {
    warn(
      `\`npx skills add ${SHADCN_SKILLS_SOURCE}\` exited with ${res.status}. ` +
      (process.platform === 'win32'
        ? 'On Windows this is usually blocked symlink creation — re-run this installer with --copy.'
        : 'Re-run manually to see the error, or install per INSTALL.md step 3.')
    );
  } else {
    ok(`shadcn/ui skills installed for ${opts.agents.join(', ')}`);
    changes.push(`shadcn/ui skills for ${opts.agents.join(', ')} (${opts.global ? 'global' : skillsCwd})`);
  }
}

// --- step 4: report ---------------------------------------------------------

step(4, 'Summary');

if (opts.dryRun) {
  console.log(`    dry run — ${changes.length} change(s) would be made, nothing written.`);
} else if (changes.length === 0) {
  console.log('    Nothing to do — already installed.');
} else {
  for (const c of changes) console.log(`    changed  ${c}`);
}

if (warnings.length) {
  console.log(`\n    ${warnings.length} warning(s) above need your attention.`);
}

console.log(`
Next:
  1. Restart your client — MCP servers are read at startup.
  2. Run /mcp in Claude Code and confirm "${MCP_SERVER_NAME}" is connected.
  3. Run: npx skills list
  4. Full process, verification checklist and troubleshooting: INSTALL.md
`);

process.exit(0);
