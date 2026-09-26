[简体中文](README.md) | **English**

# dsh-approval-gate

**Auto-approval gate for DeepSeek Harness — minimal human intervention: safe operations auto-approve, risky ones go to a human (fail-safe).**

A Flash model pre-judges every sandbox escalation: routine operations auto-approve, hard-risk operations (deletion / credentials / remote / system / bulk) always require human confirmation; learned rules only ever cover operations you confirmed, with an in-app human review UI.

This repository is based on [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) 0.5.2 (commit `8419bc3`). It retains the upstream history and MIT license; `teddyli18000` maintains the changes in this repository.

## ✨ Features

- ⚡ **Flash risk pre-judgment**: every sandbox escalation is judged by a Flash model (`SAFE` / `RISKY:<category>`); recoverable operations auto-approve
- 🛡️ **Hard risks are always human**: deletion, credentials, remote/production, system paths, and bulk irreversible operations go directly to human — no counting, no learning
- 🎯 **Confirmation-based learning**: after N-1 human confirmations of the same operation, it auto-approves; persisted rules carry an **operation fingerprint**, so only operations you confirmed are auto-approved
- 🧠 **Semantic similarity verification**: operations with different wording but the same intent are judged by Flash against your confirmed samples — no keyword dependency
- 📄 **File diff & revert** (v0.5.0+): click a file in an approval record to view a **unified diff** — changed lines with ±5 context lines, multiple changes grouped into hunks separated by gray "N unmodified lines" bars, green additions / red deletions / gray context, dual line numbers; one-click **Revert** sends a command for the AI to restore the file from snapshot
- 🗂️ **Session-scoped snapshots** (v0.5.0+): snapshots belong to the event's session; the approval view shows only the current session's snapshot stats; clearing supports "this session only" vs "clear all" to avoid wiping other sessions' unviewed diffs
- 🔧 **Hot-reloadable config**: `allowlist.json` edits take effect immediately, no restart
- ✅ **Human review UI**: a green notice appears above the composer on auto-approval; the "Approval" view (right of Trajectory) shows the current session's full auto-approval timeline

## 📸 Interface Overview

### ① Approval View

![Approval View](docs/screenshots/approval-view.png)

The "Approval" tab (right of Trace) lists the current session's auto-allowed and manually-approved actions in reverse-chronological order: each record shows the tool (`bash` / `edit`), a verdict tag ("Auto-allowed · Flash safe", "Approved" etc.), timestamp and description. The top bar shows this session's **diff snapshot usage** (`2.9 KB · 3 items`) with two cleanup options: **"This session only"** (removes only the current session's snapshots, never touching other sessions' unviewed diffs) and **"Clear all"** (double-confirmed, clears every session).

### ② File Diff

![Diff Dialog](docs/screenshots/diff-panel.png)

Click a file in an approval record to open the diff dialog: a **unified diff** with green additions (`+`), red deletions (`-`) and gray context lines; dual **old/new line numbers** on the left; multiple changes grouped into **hunks** with gray "`6 unmodified lines`" separators folding unchanged regions. The header shows `+2 / -2 changed · 20 unchanged`. The **Revert** button at the bottom sends an undo command to the conversation so the AI restores the file from the pre-approval snapshot.

### ③ Settings · Auto-approval

![Settings Auto-approval](docs/screenshots/settings-auto-approve.png)

The "Auto-approval" section in Settings provides full configuration: **preset initialization** (one-click write of the `auto-approve` preset into `cordis.patch.yml`), **pipeline overview** (DENY → allowlist → denyRules → Flash → learning), **deny-keyword blacklist** (built-in entries + custom add), and hot-reload notes (changes take effect immediately, no restart).

## 🚀 Quick Start

```sh
dsh plugin --profile web add dsh-approval-gate
```

1. **Add the permission preset**: append the `auto-approve` preset to `~/.dsh/profiles/web/cordis.patch.yml` ([see guide](docs/GUIDE.en.md#%E2%9A%A0%EF%B8%8F-manual-permission-preset-required-after-install))
2. **Restart** `dsh web`
3. **Select the preset**: choose "Auto Approval (Flash)" in the session's permission dropdown

## 📖 Docs

- [Full Guide (pipeline / configuration / security / review UI)](docs/GUIDE.en.md) · [中文指南](docs/GUIDE.md)

## 📄 License

MIT
