<div align="center">

# DSH Prompt Manager

**A switchable system-prompt library for DeepSeek Harness: one global prompt, one per workspace.**

[简体中文](README.md) · [English](README.en.md)

[![DSH Web Plugin](https://img.shields.io/badge/DSH-Web%20Plugin-0f766e.svg)](https://github.com/liuxiangfan/dsh-prompt-manger)
[![version](https://img.shields.io/badge/version-0.1.0-2563eb.svg)](https://github.com/liuxiangfan/dsh-prompt-manger/releases)
[![order](https://img.shields.io/badge/order-10300-7c3aed.svg)](#how-it-works)
[![license: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)

</div>

> DSH Prompt Manager is a community-maintained plugin for DeepSeek Harness (DSH). It is not an official DeepSeek AI product.

## Overview

Manages system prompts for different task contexts in one place, removing the need to rewrite a single prompt when switching tasks.

- **Multiple prompts** — every prompt has its own name and body, and none overwrites another. Creation, editing, and deletion are handled in the settings page without manual configuration edits.
- **Two scopes** — a global prompt applies to all sessions; a workspace prompt applies only within its own directory. The active prompt is selected automatically when a workspace is opened.
- **Workspace selector** — the dropdown reads the host workspace registry (`~/.dsh/storages/workspace.json`) and lists existing workspaces. An arbitrary directory may also be entered manually.
- **Prefix matching** — a directory and any of its subdirectories both match. When several workspaces match, the longest path takes precedence: `D:/code/site/web` over `D:/code/site`.
- **Card-based management** — each prompt is a card with an "Applied" badge, supporting inline expansion, in-place renaming and editing, and confirmation before deletion.
- **Immediate switching** — applying a prompt takes effect on the next turn. No restart required.
- **Agent tool** — a `prompt_manager` tool exposes listing, switching, adding, editing, and removing to agents.
- **Master switch** — when disabled, neither scope is injected and all templates are preserved.

## Install

Requires a working DeepSeek Harness installation. The commands below use the `web` profile; substitute the profile in use.

The plugin ships as a bundle: `package.json` declares `dsh.bundle`, and `dsh` mounts the configuration layer automatically on install. No manual edit of `cordis.patch.yml` is needed. The implementation is plain JavaScript with no build step, which allows installation directly from a Git repository.

### From GitHub

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

To pin a specific commit:

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger#<sha>
```

If `dsh` is not installed globally, invoke it through `npx`:

```bash
npx @deepseek-ai/dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

### From a local checkout

pnpm installs the directory as a symlink rather than a copy, so source edits take effect immediately:

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
dsh plugin --profile web add ./dsh-prompt-manger
```

### From a package tarball

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
cd dsh-prompt-manger
pnpm pack
dsh plugin --profile web add ./dsh-prompt-manager-0.1.0.tgz
```

### From the UI

Open the Plugins page in DSH, choose Install, and select the cloned directory. This is equivalent to the local checkout method.

### Installed by an agent

Send the following to an agent with terminal access:

```text
Install the DSH plugin into my web profile: dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
Confirm it appears in the plugin list afterwards, and explain how to reload the interface.
```

DSH must be restarted after installation. Host-side plugins are mounted at startup only; once restarted, "提示词管理" appears in Settings.

## Usage

1. Open Settings → 提示词管理.
2. Select "+ 添加全局提示词" and fill in a name and body.
3. Select Apply on the corresponding card.
4. From the next turn onward, the text is part of the system prompt.

To configure a prompt for a single workspace: switch to the project tab, choose a workspace from the dropdown, select "+ 新建分组", add a prompt inside the group, and select Apply.

## Resolution order

Each turn resolves the injected content in the following order:

1. The master switch is off: nothing is injected.
2. The working directory of the current session is read and compared against registered project paths.
3. A group matches (same directory or subdirectory, longest prefix) and contains a valid template: its `active` template is used.
4. A group matches but holds no templates: resolution falls back to the global prompt.
5. No group matches: the global `active` template is used.
6. The relevant scope has no `active` (or the selected template was deleted): nothing is injected for that turn.

Sessions without a working directory, such as background tasks, resolve against the global prompt.

## Configuration

Configuration is stored in the profile's `cordis.patch.yml` and normally requires no manual edits.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; disabling skips both scopes |
| `active` | string | `''` | Name of the applied global template |
| `templates` | JSON string | `'[]'` | Global template library, shaped `[{ name, text }]` |
| `projects` | JSON string | `'{}'` | Map of workspace path to `{ templates, active }` |
| `workspaces` | JSON string | `'[]'` | Known workspace paths used by the dropdown |
| `order` | number | `10300` | Section order; higher values land later |
| `complete` | boolean | `false` | Replace the entire system prompt instead of appending |

The default `order` of `10300` places the section in the same range as the host's own prompt sections, at the end of the sequence.

## Agent tool

The plugin registers a `prompt_manager` tool with the following actions:

| Action | Parameters | Effect |
| --- | --- | --- |
| `read` | — | Show the content injected for the current turn |
| `list` | — | List global templates and the applied one |
| `use` | `name` | Switch the global template |
| `add` | `name`, `text` | Add a template |
| `set` | `name`, `text` | Replace the body of a template |
| `remove` | `name` | Delete a template |
| `on` / `off` | — | Enable or disable the master switch |
| `project-list` | `path` | List templates of a workspace |
| `project-use` | `path`, `name` | Switch the template applied by a workspace |
| `project-add` | `path`, `name`, `text` | Add a template to a workspace |
| `project-remove` | `path`, `name` | Delete a template from a workspace |

## How it works

The plugin registers a prompt section through the host's `systemPrompt` service:

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'prompt-manager:user',
  order,
  complete,
  text: (context) => sectionText(context),
}))
```

`text` receives a function evaluated once per turn. The evaluation reads the working directory from the current `agent`:

```js
const cwd = context.agent?.session?.header?.cwd
```

Paths are normalized before comparison: backslashes become forward slashes, duplicate and trailing slashes are removed, and case is folded. `D:\code\site` and `d:/CODE/SITE/` therefore identify the same workspace.

The first injection after startup adds the current directory to `workspaces`; entries in the dropdown are only ever added.

## Data location

All data lives in the profile configuration at `~/.dsh/profiles/web/cordis.patch.yml`, under the `- id: prompt-manager` entry.

The plugin maintains no separate database and writes nothing into project directories. Backing up that YAML file preserves the full configuration.

## Compatibility

- Requires a DSH Web profile, which provides the settings page.
- Supports DSH versions below `0.3.0`. Depends on the `systemPrompt`, `configForms`, and `slots` services, which may require adjustment in a major host release.
- Depends on no private host packages. Interface controls are plain DOM and React elements, so internal host renames cannot break the settings page.

## Feedback

Report problems or request features in [Issues](https://github.com/liuxiangfan/dsh-prompt-manger/issues). Include the error text and the DSH version to speed up triage.

## License

[MIT](LICENSE)
