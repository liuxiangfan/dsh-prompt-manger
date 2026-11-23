<div align="center">

# DSH Prompt Manager

**Multiple system prompts — one global, one per workspace. Click to switch.**

[简体中文](README.md) · [English](README.en.md)

[![DSH Web Plugin](https://img.shields.io/badge/DSH-Web%20Plugin-0f766e.svg)](https://github.com/liuxiangfan/dsh-prompt-manger)
[![version](https://img.shields.io/badge/version-0.1.0-2563eb.svg)](https://github.com/liuxiangfan/dsh-prompt-manger/releases)

</div>

> DSH Prompt Manager is a community-maintained plugin for DeepSeek Harness (DSH). It is not an official DeepSeek AI product.

## Why

One system prompt means rewriting it every time you switch tasks — the novel-writing persona, the code-review persona, the frontend rules, all fighting over the same text box.

This plugin splits them into a library of independent templates: they coexist, and you apply whichever one you need.

## Features

- **Many prompts at once** — each template has its own name and body. Add, edit, delete in the settings page.
- **Two layers** — the global one applies everywhere; the per-project one applies only inside that workspace. Open a project, its prompt takes over.
- **Workspaces come from the host registry** — the dropdown lists the workspaces you actually created (read from `~/.dsh/storages/workspace.json`), with a manual path field for anything else.
- **Prefix matching** — same directory or any subdirectory counts. When several match, the longest path wins: `D:/code/site/web` beats `D:/code/site`.
- **Card list UI** — one card per template, with an "Applied" badge, inline expansion, in-place editing, and confirm-before-delete.
- **Instant switch** — hit Apply and the next turn uses it. No restart.
- **Agents can switch too** — a `prompt_manager` tool is registered, so you can just ask.
- **Master switch** — turn injection off entirely while keeping the library intact.

## Install

Requires a working DeepSeek Harness install. Commands below use the `web` profile.

```powershell
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
```

Then open DSH's Plugins page → Install → pick the cloned folder. Restart DSH and "提示词管理" shows up in settings.

No build step: `index.js` and `client.js` are the runnable artifacts.

## Usage

1. Settings → 提示词管理.
2. Click "+ 添加全局提示词", name it, paste the body.
3. Click Apply on the card.
4. Next turn, it's in the system prompt.

For a project-specific prompt: switch to the project tab, pick a workspace, click "+ 新建分组", add a template, apply it.

## Resolution order

1. Master switch off → nothing injected.
2. Take the session's working directory, compare against the project registry.
3. Match (same dir or subdir, longest prefix) → that project's `active` template.
4. No match → the global `active` template.
5. No `active` in that layer → nothing this turn.

## Config

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch |
| `active` | string | `''` | Currently applied global template |
| `templates` | JSON string | `'[]'` | Global library, `[{ name, text }]` |
| `projects` | JSON string | `'{}'` | Workspace path → `{ templates, active }` |
| `workspaces` | JSON string | `'[]'` | Known workspace paths for the dropdown |
| `order` | number | `10300` | Injection order; higher lands later |
| `complete` | boolean | `false` | Replace the whole system prompt instead of appending |

## How it works

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'prompt-manager:user',
  order,
  complete,
  text: (context) => sectionText(context),
}))
```

`text` is a function, evaluated every turn. The current agent exposes its working directory at `context.agent?.session?.header?.cwd`. Paths are normalized (backslashes, duplicate and trailing slashes, case) before matching.

## Compatibility

- DSH Web profile (the settings page hosts the panel).
- Host `<0.3.0`. Uses `systemPrompt`, `configForms`, and `slots`.
- No private host packages — controls are plain DOM + React elements, so an internal host rename can't blank the slot.

## Feedback

Open an [issue](https://github.com/liuxiangfan/dsh-prompt-manger/issues). Include the error text and your DSH version.

## License

Not specified yet. Ask in Issues before redistributing.
