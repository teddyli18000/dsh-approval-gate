/**
 * Shared harness for `test/session-api/*`.
 *
 * Two hard rules encoded here:
 *  1. `DSH_HOME` is ALWAYS redirected into this worktree before anything imports
 *     `src/index.mjs`. The plugin reads `DSH_HOME` at module load time and writes
 *     `$DSH_HOME/auto-approve/*` — pointing it at the real `~/.dsh` would corrupt
 *     the user's live profile.
 *  2. Tests only ever resolve the *installed* `@deepseek-ai` packages, read-only.
 *
 * Self-contained: `node: builtins` only, no external deps.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
/** `.../_gh/wt/session` — the worktree these tests belong to. */
export const WORKTREE = resolve(HERE, '..', '..')
export const TMP_ROOT = join(HERE, '.tmp')

/** Candidate roots holding `@deepseek-ai/*`. The globally installed DSH wins:
 *  that is the build the live plugin actually runs against. */
function candidateScopes() {
  const out = []
  if (process.env.DSH_PKGS) out.push(process.env.DSH_PKGS)
  out.push(
    'C:/Users/Teddy/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
    join(dirname(process.execPath), '..', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
  )
  // npx caches (`npx @deepseek-ai/dsh`) — older builds, used only as a fallback.
  const npx = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null
  if (npx && existsSync(npx)) {
    for (const d of readdirSync(npx).sort()) out.push(join(npx, d, 'node_modules', '@deepseek-ai'))
  }
  return out.filter(Boolean)
}

/** Resolve a real `@deepseek-ai` scope containing the requested packages. */
export function resolveScope(required = ['dsh-session']) {
  for (const dir of candidateScopes()) {
    if (required.every((p) => existsSync(join(dir, p, 'package.json')))) return dir
  }
  throw new Error(
    'cannot locate installed @deepseek-ai packages; set DSH_PKGS to a directory containing dsh-session',
  )
}

export function pkgVersion(scope, name) {
  try {
    return JSON.parse(readFileSync(join(scope, name, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

/** Import a file from a real `@deepseek-ai` scope. */
export const importReal = (scope, rel) => import(pathToFileURL(join(scope, rel)).href)

/**
 * Point `DSH_HOME` at a fresh directory inside this worktree and return it.
 * MUST be called before importing `src/index.mjs`.
 */
export function initHome(tag) {
  const abs = resolve(join(TMP_ROOT, tag, 'dshhome'))
  // Guard 1: inside this worktree.
  if (!abs.startsWith(resolve(WORKTREE) + sep)) {
    throw new Error(`refusing to use DSH_HOME outside the worktree: ${abs}`)
  }
  // Guard 2: never the user's real profile.
  const realProfile = resolve(process.env.USERPROFILE || 'C:/Users/Teddy', '.dsh').toLowerCase()
  if (abs.toLowerCase() === realProfile || abs.toLowerCase().startsWith(realProfile + sep)) {
    throw new Error(`refusing to use the live DSH profile as DSH_HOME: ${abs}`)
  }
  rmSync(abs, { recursive: true, force: true })
  mkdirSync(abs, { recursive: true })
  process.env.DSH_HOME = abs
  return abs
}

/** Build a minimal cordis-like context good enough to run `apply(ctx)`. */
export function makeMockCtx({ presetResult = 'auto-approve', onPresetArg, llmCalls } = {}) {
  const handlers = new Map()
  const routes = []
  const effects = []

  const ctx = {
    llm: {
      stream: (...args) => {
        llmCalls?.push(args)
        throw new Error('llm.stream must not be called on the deterministic whitelist path')
      },
    },
    approval: {},
    permissionPresets: {
      current: (arg) => {
        onPresetArg?.(arg)
        return presetResult
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
    },
    timer: {},
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    get: (key) => (key === 'agentDefaultModel' ? ctx.agentDefaultModel : undefined),
    effect: (fn) => {
      effects.push(fn())
      return () => {}
    },
    on: (name, handler, opts) => {
      handlers.set(name, { handler, opts })
      return () => handlers.delete(name)
    },
    timeout: () => new Promise(() => {}),
  }

  return {
    ctx,
    handlers,
    routes,
    effects,
    /** Fire the registered `approval/request` handler. */
    fire: (req, next = async () => 'rejected') => {
      const entry = handlers.get('approval/request')
      if (!entry) throw new Error('plugin did not register an approval/request handler')
      return entry.handler(req, next)
    },
  }
}

/** Tiny assertion recorder; `summary()` sets the process exit code. */
export function makeChecks() {
  let failures = 0
  let passed = 0
  const check = (label, ok, detail) => {
    if (ok) passed += 1
    else failures += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      → ${detail}` : ''}`)
    return ok
  }
  return {
    check,
    summary() {
      console.log(`\n${passed} passed, ${failures} failed`)
      process.exitCode = failures === 0 ? 0 : 1
      return failures === 0
    },
  }
}
