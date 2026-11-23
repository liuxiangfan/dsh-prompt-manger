<div align="center">

# DSH Prompt Manager

**为 DeepSeek Harness 提供可切换的系统提示词库：全局一份，每个工作区一份。**

[简体中文](README.md) · [English](README.en.md)

[![DSH Web Plugin](https://img.shields.io/badge/DSH-Web%20Plugin-0f766e.svg)](https://github.com/liuxiangfan/dsh-prompt-manger)
[![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.1.0-2563eb.svg)](https://github.com/liuxiangfan/dsh-prompt-manger/releases)
[![注入位置](https://img.shields.io/badge/order-10300-7c3aed.svg)](#实现原理)
[![许可证：MIT](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-22c55e.svg)](LICENSE)

</div>

> DSH Prompt Manager 是社区维护的 DeepSeek Harness（DSH）插件，并非 DeepSeek AI 官方产品。

## 功能概览

将分散于不同任务场景的系统提示词集中管理，无需在切换任务时反复改写同一份文本。

- **多套提示词并存**：每套提示词拥有独立的名称与正文，互不覆盖。新增、编辑与删除均可在设置页完成，无需手工编辑配置文件。
- **全局与工作区两级归属**：全局提示词对所有会话生效；工作区提示词仅在对应目录下生效。切换工作区时自动选用该工作区的提示词。
- **工作区选择器**：下拉列表读取宿主的工区登记表（`~/.dsh/storages/workspace.json`），列出已创建的工作区，同时允许手工填写任意目录。
- **前缀匹配**：同一目录及其任意子目录均视为命中；多个工作区同时命中时，路径最长者优先，`D:/code/site/web` 优先于 `D:/code/site`。
- **卡片式管理**：每套提示词对应一张卡片，标注「已应用」状态，支持展开查看全文、就地修改名称与正文、删除前二次确认。
- **即时切换**：点击「应用」后于下一回合生效，无需重启 DSH。
- **Agent 工具接口**：注册 `prompt_manager` 工具，可直接由 Agent 完成切换、增删与查询。
- **总开关**：关闭后两级提示词均不注入，模板内容保留不变。

## 安装

需要可正常运行的 DeepSeek Harness。以下命令使用 `web` profile，请按实际环境替换。

插件以 bundle 形式分发：`package.json` 声明 `dsh.bundle`，安装后由 `dsh` 自动挂载配置层，无需手工编辑 `cordis.patch.yml`。项目为纯 JavaScript 实现，无构建步骤，因此支持直接从 Git 仓库安装。

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

固定到特定提交：

```bash
dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger#<sha>
```

若机器上未全局安装 `dsh`，可通过 `npx` 调用：

```bash
npx @deepseek-ai/dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
```

### 从本地目录安装

pnpm 以软链接方式安装目录而非复制文件，修改源码即时生效：

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
dsh plugin --profile web add ./dsh-prompt-manger
```

### 从分发包安装

```bash
git clone https://github.com/liuxiangfan/dsh-prompt-manger.git
cd dsh-prompt-manger
pnpm pack
dsh plugin --profile web add ./dsh-prompt-manager-0.1.0.tgz
```

### 通过界面安装

在 DSH 的「插件」页选择「安装」，指定克隆后的目录，效果等同于本地目录安装。

### 由 Agent 代为安装

将以下内容发送给可操作本机终端的 Agent：

```text
请把 DSH 插件安装到我的 web profile：dsh plugin --profile web add github:liuxiangfan/dsh-prompt-manger
安装完成后确认其出现在插件列表中，并说明如何重新加载界面。
```

安装完成后需重启 DSH。宿主侧插件仅在启动时挂载；重启后可在「设置」中找到「提示词管理」。

## 使用

1. 打开「设置 → 提示词管理」。
2. 点击「+ 添加全局提示词」，填写名称与正文。
3. 在对应卡片上点击「应用」。
4. 自下一回合起，该文本进入系统提示词。

为单个工作区配置独立提示词：切换到「项目提示词」页签，从下拉列表选择一个工作区，点击「+ 新建分组」，在分组内添加提示词并点击「应用」。

## 提示词归属规则

每个回合按以下顺序决定注入内容：

1. 总开关关闭时，不注入任何内容。
2. 读取当前会话的工作目录，与项目库中登记的路径比较。
3. 存在命中（同目录或子目录，取最长前缀）且该分组含有有效模板时，使用该分组的 `active` 模板。
4. 分组建有但未配置模板时，回退至全局提示词。
5. 未命中任何分组时，使用全局的 `active` 模板。
6. 对应层级不存在 `active`（或所选模板已被删除）时，该回合不注入。

无法获取工作目录的场景（如后台任务）按全局提示词处理。

## 配置项

配置存放于 profile 的 `cordis.patch.yml`，通常无需手工修改。

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。关闭后两级提示词均不注入 |
| `active` | string | `''` | 全局当前应用的模板名称 |
| `templates` | JSON 字符串 | `'[]'` | 全局模板库，结构为 `[{ name, text }]` |
| `projects` | JSON 字符串 | `'{}'` | 工作区路径到 `{ templates, active }` 的映射 |
| `workspaces` | JSON 字符串 | `'[]'` | 已知工作区路径，供下拉列表使用 |
| `order` | number | `10300` | 注入序号，数值越大越靠后 |
| `complete` | boolean | `false` | 为 `true` 时替换整段系统提示词，而非追加 |

`order` 默认值为 `10300`，与宿主自带的提示词段落位于同一区间，并排在层级末尾，使插件内容处于系统提示词的靠后位置。

## Agent 工具

插件注册 `prompt_manager` 工具，支持以下动作：

| 动作 | 参数 | 作用 |
| --- | --- | --- |
| `read` | — | 查看当前回合实际注入的内容 |
| `list` | — | 列出全局模板与当前应用项 |
| `use` | `name` | 切换全局模板 |
| `add` | `name`, `text` | 新增一套模板 |
| `set` | `name`, `text` | 修改指定模板的正文 |
| `remove` | `name` | 删除指定模板 |
| `on` / `off` | — | 开启或关闭总开关 |
| `project-list` | `path` | 查看指定工作区的模板 |
| `project-use` | `path`, `name` | 切换指定工作区应用的模板 |
| `project-add` | `path`, `name`, `text` | 为工作区新增模板 |
| `project-remove` | `path`, `name` | 删除工作区中的指定模板 |

## 实现原理

插件通过宿主的 `systemPrompt` 服务注册一个提示词段：

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'prompt-manager:user',
  order,
  complete,
  text: (context) => sectionText(context),
}))
```

`text` 接收函数，于每个回合求值。求值时从当前 `agent` 读取工作目录：

```js
const cwd = context.agent?.session?.header?.cwd
```

路径在比较前统一归一化处理：反斜杠转为正斜杠、合并重复斜杠、去除尾部斜杠、统一转为小写。因此 `D:\code\site` 与 `d:/CODE/SITE/` 视为同一工作区。

宿主启动后的首次注入会将当前目录补入 `workspaces`，下拉列表中的选项仅增不减。

## 数据位置

全部数据位于 profile 配置：`~/.dsh/profiles/web/cordis.patch.yml`，对应节点为 `- id: prompt-manager`。

插件不维护独立数据库，也不向用户的项目目录写入任何文件。备份该 YAML 文件即可完整保存配置。

## 兼容性

- 需要具备设置页的 DSH Web profile。
- 支持 DSH `0.3.0` 以下版本。依赖 `systemPrompt`、`configForms` 与 `slots` 三个服务，宿主大版本更新时可能需要同步调整。
- 不依赖任何宿主私有包。界面控件均为原生 DOM 与 React 元素，宿主内部重命名不会导致设置页整块失效。

## 反馈与贡献

使用中遇到问题或希望增加功能，可在 [Issues](https://github.com/liuxiangfan/dsh-prompt-manger/issues) 提交。为便于定位，请附上错误信息与 DSH 版本号。

## 许可证

[MIT](LICENSE)
