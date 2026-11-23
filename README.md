<div align="center">

# DSH Prompt Manager

**多套系统提示词，全局一份，每个工作区各自一份。点一下换过去。**

[简体中文](README.md) · [English](README.en.md)

[![DSH Web Plugin](https://img.shields.io/badge/DSH-Web%20Plugin-0f766e.svg)](https://github.com/liuxiangfan/dsh-prompt-manger)
[![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.0-2563eb.svg)](https://github.com/liuxiangfan/dsh-prompt-manger/releases)
[![注入位置](https://img.shields.io/badge/order-10300-7c3aed.svg)](#工作原理)
[![许可证：MIT](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-22c55e.svg)](LICENSE)

</div>

> DSH Prompt Manager 是社区维护的 DeepSeek Harness（DSH）插件，并非 DeepSeek AI 官方产品。

## 为什么

系统提示词只有一份的时候，换个活儿就得改一遍。写小说的人格、审代码的人格、写前端的规矩，全挤在同一个文本框里，改完还得记得改回来。

这个插件把它们拆成一组独立的模板：存着不冲突，用哪个点哪个。

## 功能概览

- **多套提示词并存**：每套有自己的名字和正文，互不覆盖。新增、编辑、删除都在设置页里完成，不用碰配置文件。
- **全局与工作区两层**：全局那份对所有会话生效；工作区那份只在对应目录的项目里生效。打开哪个项目，就自动用哪个项目的提示词。
- **工作区从宿主登记表里读**：下拉框列的是你实际建过的工作区（读 `~/.dsh/storages/workspace.json`），不用手抄路径；也能手填任意目录。
- **匹配规则是前缀**：同一目录、或它的子目录，都算命中。多个工作区同时命中时，路径最长的那个赢 —— `D:/code/site/web` 比 `D:/code/site` 更具体。
- **卡片式管理**：每套一张卡片，带「已应用」徽章。展开看全文，就地改名改正文，删除有二次确认。
- **一键应用**：点卡片上的「应用」，下一回合就换过去。没有生效延迟，也不用重启。
- **Agent 也能切**：注册了 `prompt_manager` 工具，你可以直接跟 Agent 说「换成写小说的那套」。
- **总开关**：关掉之后两层都不注入，模板原样留着。想裸跑一次、排查是不是提示词的问题，用它。

## 安装

需要先有能跑起来的 DeepSeek Harness。命令里的 `web` 是你的 profile 名，按实际情况替换。

插件就是一个 bundle：`package.json` 里声明了 `dsh.bundle`，装进 profile 后会自动挂上，不用手改 `cordis.patch.yml`。纯 JS，没有构建步骤 —— 这也是它能直接从 GitHub 装的原因（git 安装只拉源码、不跑 `build`，带编译步骤的插件会在这里翻车）。

### 从 GitHub 装

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

想锁死版本，带上 commit：

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger#<sha>
```

机器上没有全局 `dsh` 的话，套一层 `npx`：

```bash
npx @deepseek-ai/dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

### 从本地目录装

克隆下来直接指目录。pnpm 做的是软链不是拷贝，改代码即时生效：

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
dsh plugin --profile web add ./dsh-prompt-manger
```

### 从 tarball 装

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
cd dsh-prompt-manger
pnpm pack
dsh plugin --profile web add ./dsh-prompt-manager-0.1.0.tgz
```

### 在界面里装

DSH 的「插件」页 → 安装 → 选本地目录，指向克隆下来的文件夹。

### 让 Agent 帮你装

把这段话发给能操作本机终端的 Agent：

```text
请把 DSH 插件装到我的 web profile：dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
装好后确认它出现在插件列表里，并告诉我怎么重新加载界面。
```

装完重启 DSH —— 宿主那一半只在 boot 时挂载。设置里出现「提示词管理」就成了。

## 快速上手

1. 打开「设置 → 提示词管理」。
2. 点「+ 添加全局提示词」，起个名字，把正文贴进去。
3. 点卡片上的「应用」。
4. 下一回合开始，这段文字就在系统提示词里了。

想给某个项目单独一套：切到「项目提示词」页签，从下拉框选一个工作区，再点「+ 新建分组」。分组里可以放多套，同样点「应用」选中其中一套。

## 两层归属规则

每个回合，插件按这个顺序决定注什么：

1. 总开关关着 → 什么都不注入。
2. 取当前会话的工作目录，跟项目库里登记的路径比。
3. 有命中（同目录或子目录，取最长前缀）→ 用那个项目的 `active` 模板。
4. 没命中 → 用全局的 `active` 模板。
5. 那一层没有 `active`（或者模板已被删掉）→ 这一回合不注入。

工作目录拿不到的情况（比如后台任务）直接走全局。

## 配置项

配置存在 profile 的 `cordis.patch.yml` 里，通常不用手改：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。关掉后两层都不注入 |
| `active` | string | `''` | 全局当前应用的那套的名字 |
| `templates` | JSON 字符串 | `'[]'` | 全局模板库，`[{ name, text }]` |
| `projects` | JSON 字符串 | `'{}'` | 工作区路径 → `{ templates, active }` |
| `workspaces` | JSON 字符串 | `'[]'` | 已知工作区路径，给下拉框用 |
| `order` | number | `10300` | 注入序号，越大越靠后 |
| `complete` | boolean | `false` | 为 `true` 时替换整段系统提示词，而不是追加 |

`order` 默认 `10300`，跟宿主自带的提示词段落排在一起，落在最下面 —— 你的规矩压在最后，比前面的更难被忽略。

## Agent 工具

插件注册了 `prompt_manager`，动作：

| 动作 | 参数 | 作用 |
| --- | --- | --- |
| `read` | — | 看这一回合实际注入了什么 |
| `list` | — | 列出全局的模板和当前选中的那套 |
| `use` | `name` | 切换全局模板 |
| `add` | `name`, `text` | 新增一套 |
| `set` | `name`, `text` | 改某套的正文 |
| `remove` | `name` | 删掉某套 |
| `on` / `off` | — | 开总开关 |
| `project-list` | `path` | 看某个工作区的模板 |
| `project-use` | `path`, `name` | 切换某个工作区用的模板 |
| `project-add` | `path`, `name`, `text` | 给工作区加一套 |
| `project-remove` | `path`, `name` | 删掉工作区的某套 |

## 工作原理

宿主有个 `systemPrompt` 服务，插件往里塞一段：

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'prompt-manager:user',
  order,
  complete,
  text: (context) => sectionText(context),
}))
```

`text` 传的是函数，所以每个回合现算。拿得到当前 `agent`，也就拿得到它的工作目录：

```js
const cwd = context.agent?.session?.header?.cwd
```

匹配前路径会归一（反斜杠转正斜杠、压掉重复斜杠、去掉尾部斜杠、转小写），所以 `D:\code\site` 和 `d:/CODE/SITE/` 是同一个项目。

宿主重启后，第一次注入会把当前目录补进 `workspaces`，下拉框里的选项只会越来越多。

## 数据存在哪

全在 profile 的配置里：`~/.dsh/profiles/web/cordis.patch.yml`，节点是 `- id: prompt-manager`。

没有单独的数据库文件，也没有往你的项目目录写任何东西。想备份就备份这个 yml。

## 兼容性

- 需要 DSH 的 Web profile（有设置页，才有地方放这个面板）。
- 宿主 `<0.3.0`。用到的是 `systemPrompt.section`、`configForms`、`slots` 三个服务；宿主大版本改动时可能跟着改。
- 不依赖任何宿主私有包，控件全部是原生 DOM + React 元素，不会因为宿主内部改名而整块白屏。

## 反馈与贡献

用着有问题、或者想要个什么功能，去 [Issues](https://github.com/liuxiangfan/dsh-prompt-manger/issues) 说一声。贴上报错文字和你的 DSH 版本，能省一轮来回。

## 许可证

[MIT](LICENSE)
