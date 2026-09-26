# Session API regression tests

Regression tests for the *Session API surface* used by the `approval/request`
gate, plus the `finish`-chunk contract on the flash-judgment path.

Every test redirects `DSH_HOME` into `test/session-api/.tmp/<test>/dshhome`
**before** importing `src/index.mjs` (`_harness.mjs#initHome`). The plugin reads
`DSH_HOME` at module load time and writes `$DSH_HOME/auto-approve/*`; pointing it
at the real profile would corrupt the user's live DSH data. `initHome` refuses
any path outside this worktree.

Tests 01, 02 and 03 import the **real installed** `@deepseek-ai` packages
(`dsh-session`, `dsh-session-projection`, `cordis`). Resolution order: `$DSH_PKGS`,
then the global `@deepseek-ai/dsh` install, then npx caches. Override with
`DSH_PKGS` when the install lives elsewhere.

| file | what it pins | needs real DSH pkgs |
| --- | --- | --- |
| `01-session-surface.mjs` | `Session` has no `.events` / `.cwd`; it has `snapshotEvents()` / `header.cwd` | yes |
| `02-projection-crash.mjs` | `stateOf(session.events)` throws `reading 'header'`; `stateOf(session)` works | yes |
| `03-gate-session-wiring.mjs` | the gate reads the Session correctly for B-layer files and `baseDir` | yes |
| `04-flash-finish-no-reason.mjs` | a `finish` chunk without `reason` goes to human approval with an audit error | no |
| `05-pr7-skip-audit-probe.mjs` | cost probe for PR #7's `SKIP` audit line (skips without the variant) | no |

Run with node (v24):

```
node test/session-api/01-session-surface.mjs
node test/session-api/02-projection-crash.mjs
node test/session-api/03-gate-session-wiring.mjs
node test/session-api/04-flash-finish-no-reason.mjs
node test/session-api/05-pr7-skip-audit-probe.mjs
```

On `12cd607` (pre-fix), 03 exits non-zero because the gate reads the wrong
Session fields. Test 04 checks that a nonconforming adapter cannot auto-approve.
