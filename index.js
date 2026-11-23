/**
 * dsh-prompt-manager —— 多套系统提示词管理，切换即生效。
 *
 * Host 半区只做两件事：
 *   1. 注册一个系统提示词段，正文 = 当前选中模板的 text（每回合求值）。
 *   2. 注册 prompt_manager 工具，让 agent 自己列模板、切模板、加模板。
 *
 * 模板库分两层：
 *   - 全局库 `templates` / `active`：所有会话都用。
 *   - 项目库 `projects`：按会话工作目录归属，命中的项目盖过全局。
 * 两层都靠每回合求值的 text 回调决定实际注入什么，设置页与工具写同一份数据。
 */

export const name = 'dsh-prompt-manager'

/** systemPrompt 是硬依赖：没有提示词注册表就无处可注入。 */
export const inject = ['systemPrompt']

/** 段名。全局层唯一，重名会抛错。 */
const SECTION_NAME = 'prompt-manager:user'

/** 默认插在 DSH 自带段之后（自带最大的是部署人格后缀 10200）。 */
const DEFAULT_ORDER = 10300

const EMPTY_LIBRARY = '[]'

/**
 * schemastery：优先用宿主自带的那份，字段才能被设置页识别。
 * 解析不到就不声明 Config，插件照常工作，只是设置页没有通用表单。
 */
async function loadSchema() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    const schema = mod?.default ?? mod
    if (typeof schema === 'function' && typeof schema.object === 'function') return schema
  } catch {
    // 落空
  }
  return undefined
}

/** defineTool 是可选依赖，解析不到就只跳过工具。 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return mod?.defineTool ?? mod?.default?.defineTool
  } catch {
    return undefined
  }
}

const z = await loadSchema()

export const Config = z?.object
  ? z.object({
      enabled: z.boolean().default(true).volatile()
        .description('总开关。关掉后不注入任何模板，模板库保留。'),
      active: z.string().default('').volatile()
        .description('当前启用的模板名。为空或找不到时用模板库的第一条。'),
      templates: z.string().default(EMPTY_LIBRARY).volatile()
        .description('全局提示词库，JSON 数组：[{ "name": "编码", "text": "……" }]'),
      projects: z.string().default('{}').volatile()
        .description('项目提示词库，JSON 对象：{ "D:/某个项目": { "templates": [...], "active": "名字" } }'),
      workspaces: z.string().default('[]').volatile()
        .description('见过的工作目录，JSON 数组，最新在前。设置页用它列出「已有工作区」，插件自动收集。'),
      order: z.number().default(DEFAULT_ORDER)
        .description('插入位置，越大越靠后。10300 = 系统提示词最下面。'),
      complete: z.boolean().default(false)
        .description('true = 用模板正文取代整份系统提示词（会吃掉工具说明，慎用）。'),
    })
  : undefined

/* ---------- 纯函数层：解析、挑选、增删 ---------- */

/**
 * volatile 字段在运行时是个带 get() 的盒子，不拆开就永远拿不到字符串。
 * 普通值原样返回。
 */
function unwrap(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

const asText = (value, fallback = '') => {
  const plain = unwrap(value)
  if (typeof plain === 'string') return plain
  if (plain === undefined || plain === null) return fallback
  return String(plain)
}

const asBool = (value, fallback) => {
  const plain = unwrap(value)
  return typeof plain === 'boolean' ? plain : fallback
}

const asNumber = (value, fallback) => {
  const plain = Number(unwrap(value))
  return Number.isFinite(plain) ? plain : fallback
}

/**
 * 解析模板库。坏 JSON 不抛错，当作空库——插件坏掉不能拖垮整个回合。
 * @returns {{ name: string, text: string }[]}
 */
export function parseTemplates(raw) {
  const plain = unwrap(raw)
  let list
  if (Array.isArray(plain)) {
    // 项目库里的 templates 已经是数组，不用再过一遍 JSON。
    list = plain
  } else {
    try {
      list = JSON.parse(asText(raw, EMPTY_LIBRARY))
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ name: asText(item.name).trim(), text: asText(item.text) }))
    .filter((item) => item.name !== '')
}

/** 选中模板：名字精确匹配，否则退回第一条，空库返回空正文。 */
export function pickTemplate(list, active) {
  const wanted = asText(active).trim()
  const hit = wanted ? list.find((item) => item.name === wanted) : undefined
  if (hit) return { name: hit.name, text: hit.text, fallback: false }
  const first = list[0]
  if (first) return { name: first.name, text: first.text, fallback: wanted !== '' }
  return { name: '', text: '', fallback: false }
}

/**
 * 路径归一：Windows 反斜杠、结尾斜杠、大小写都不该影响匹配。
 * 项目提示词的归属判断全走这里，别在别处另写一套。
 */
export function normalizePath(value) {
  const raw = asText(value).trim().replace(/\\/g, '/')
  if (raw === '') return ''
  return raw.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 解析项目库。坏 JSON 当作没有项目，不抛错。
 * @returns {{ path: string, templates: { name: string, text: string }[], active: string }[]}
 */
export function parseProjects(raw) {
  let map
  try {
    map = JSON.parse(asText(raw, '{}'))
  } catch {
    return []
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return []
  const out = []
  for (const [key, value] of Object.entries(map)) {
    const path = asText(key).trim()
    if (!path || !value || typeof value !== 'object') continue
    out.push({
      path,
      templates: parseTemplates(value.templates),
      active: asText(value.active),
    })
  }
  return out
}

/**
 * 按会话工作目录挑项目：同路径或位于其子目录都算，取最长（最具体）的那个。
 * 没命中返回 undefined，调用方退回全局库。
 */
/**
 * 见过的工作目录：设置页拿它当「已有工作区」下拉。
 * 保留用户原本的大小写与分隔符，只按归一化结果去重。
 */
export function parseWorkspaces(raw) {
  let plain
  if (Array.isArray(raw)) {
    plain = raw
  } else {
    try {
      const value = JSON.parse(asText(raw, '[]').trim() || '[]')
      plain = Array.isArray(value) ? value : []
    } catch {
      plain = []
    }
  }
  const seen = new Set()
  const out = []
  for (const item of plain) {
    if (typeof item !== 'string') continue
    const path = item.trim()
    const key = normalizePath(path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(path)
    if (out.length >= 40) break
  }
  return out
}

/** 把一条目录挪到最前，超出 40 条砍尾。 */
export function rememberWorkspace(list, cwd) {
  const path = typeof cwd === 'string' ? cwd.trim() : ''
  const key = normalizePath(path)
  if (!key) return list
  const rest = list.filter((item) => normalizePath(item) !== key)
  return [path, ...rest].slice(0, 40)
}

export function pickProject(list, cwd) {
  const here = normalizePath(cwd)
  if (here === '') return undefined
  let best
  let bestLength = -1
  for (const item of list) {
    const key = normalizePath(item.path)
    if (key === '') continue
    if (here !== key && !here.startsWith(key + '/')) continue
    if (key.length > bestLength) {
      best = item
      bestLength = key.length
    }
  }
  return best
}

/** 从提示词组装上下文里捞当前会话的工作目录；拿不到就返回空串。 */
function cwdOf(context) {
  const agent = context?.agent ?? context?.scope
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

const dump = (list) => JSON.stringify(list.map((i) => ({ name: i.name, text: i.text })))

/** 项目库写回：保持对象形状，过滤掉空项目。 */
const dumpProjects = (list) => JSON.stringify(
  Object.fromEntries(
    list
      .filter((item) => asText(item.path).trim() !== '')
      .map((item) => [item.path, { templates: item.templates.map((t) => ({ name: t.name, text: t.text })), active: item.active }]),
  ),
)

/* ---------- 插件入口 ---------- */

export function apply(ctx, config) {
  const options = config ?? {}

  let logger
  try {
    logger = typeof ctx.logger === 'function' ? ctx.logger('prompt-manager') : ctx.logger
  } catch {
    logger = undefined
  }

  /**
   * 工具写入的内存覆盖层：configEditor.edit 是异步的，这里要保证「说切就切」。
   * 条目被重新加载后配置本身带上新值，覆盖层自然失效。
   */
  let override

  const snapshot = () => ({
    enabled: asBool(options.enabled, true),
    active: asText(options.active),
    templates: asText(options.templates, EMPTY_LIBRARY),
    projects: asText(options.projects, '{}'),
    workspaces: asText(options.workspaces, '[]'),
    order: asNumber(options.order, DEFAULT_ORDER),
    complete: asBool(options.complete, false),
  })

  /** 生效配置：永远是解包后的普通值，再叠工具写入的内存层。 */
  const effective = () => ({ ...snapshot(), ...(override ?? {}) })

  /**
   * 每回合组装时求值。空串会被组装流程丢掉，等于不注入。
   * 组装上下文里带着 agent，agent 带着 session.header.cwd——项目提示词就靠它归属。
   */
  /** 由 save() 之后的代码填充；这里先占位，因为 sectionText 定义在 save 之前。 */
  let noteWorkspace = () => {}

  const sectionText = (context) => {
    const state = effective()
    if (state.enabled === false) return ''
    const cwd = cwdOf(context)
    try {
      noteWorkspace(cwd)
    } catch {
      /* 收集目录只是顺手，绝不影响注入 */
    }
    const project = pickProject(parseProjects(state.projects), cwd)
    if (project) return pickTemplate(project.templates, project.active).text
    return pickTemplate(parseTemplates(state.templates), state.active).text
  }

  const base = snapshot()

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: base.order,
      complete: base.complete,
      text: sectionText,
    }),
    'dsh-prompt-manager: 多模板系统提示词段',
  )

  const startup = pickTemplate(parseTemplates(base.templates), base.active)
  logger?.info?.(
    '[dsh-prompt-manager] 段 ' + SECTION_NAME
    + '（order=' + base.order + '）：'
    + (base.enabled === false
      ? '已停用'
      : startup.text
        ? '注入「' + startup.name + '」，' + startup.text.length + ' 字符'
        : '模板库为空，未注入'),
  )

  /** 写回配置：内存层立即生效，再尽力持久化进 profile。 */
  const save = async (next) => {
    // 先合并再落盘：下一次保存必须带上这一次的改动，否则 /use 这种只改一个字段
    // 的调用会把刚加的模板写丢。
    override = { ...(override ?? snapshot()), ...next }
    const entry = ctx.fiber?.entry
    let editor
    try {
      editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
    } catch {
      editor = undefined
    }
    if (!editor || !entry) {
      logger?.warn?.('[dsh-prompt-manager] 没有 configEditor，改动只在本次运行内生效')
      return false
    }
    try {
      await editor.edit(entry, () => ({ ...override }))
      return true
    } catch (error) {
      logger?.warn?.('[dsh-prompt-manager] 写入配置失败: ' + String(error?.message ?? error))
      return false
    }
  }

  /**
   * 收集会话的工作目录，设置页据此列出「已有工作区」。
   * 每回合注入时调用：只有新目录才动，落盘节流 5 秒，失败静默。
   */
  let lastSeenAt = 0
  noteWorkspace = (cwd) => {
    if (!cwd) return
    const current = effective()
    const known = parseWorkspaces(current.workspaces)
    if (known.some((item) => normalizePath(item) === normalizePath(cwd))) return
    const next = rememberWorkspace(known, cwd)
    override = { ...current, workspaces: JSON.stringify(next) }
    const now = Date.now()
    if (now - lastSeenAt < 5000) return
    lastSeenAt = now
    save({ workspaces: JSON.stringify(next) }).catch(() => {})
  }

  const describe = () => {
    const state = effective()
    const list = parseTemplates(state.templates)
    const picked = pickTemplate(list, state.active)
    const lines = [
      '状态: ' + (state.enabled === false ? '停用' : '启用'),
      '当前模板: ' + (picked.name || '（模板库为空）'),
      '字符数: ' + picked.text.length,
      '模板数: ' + list.length,
      '位置: order ' + state.order + (state.complete ? '（complete：取代整份系统提示词）' : ''),
    ]
    if (picked.fallback) lines.push('提示: 配置里的 active=「' + state.active + '」不存在，已退回第一条')
    if (list.length) {
      lines.push('', '全局模板:')
      for (const item of list) {
        lines.push('  ' + (item.name === picked.name ? '*' : '-') + ' ' + item.name + '（' + item.text.length + ' 字符）')
      }
    }
    const projects = parseProjects(state.projects)
    if (projects.length) {
      lines.push('', '项目模板:')
      for (const project of projects) {
        lines.push('  ' + project.path + '　选中: ' + (project.active || '（未选）'))
        for (const item of project.templates) {
          lines.push('    ' + (item.name === project.active ? '*' : '-') + ' ' + item.name + '（' + item.text.length + ' 字符）')
        }
      }
    }
    if (picked.text) {
      lines.push('', picked.text.length > 3000 ? picked.text.slice(0, 3000) + '\n…（已截断）' : picked.text)
    }
    return lines.join('\n')
  }

  const run = async (args) => {
    const action = asText(args?.action, 'read').trim().toLowerCase()
    const name = asText(args?.name).trim()
    const text = asText(args?.text)
    const path = asText(args?.path).trim()
    const state = effective()
    const list = parseTemplates(state.templates)
    const projects = parseProjects(state.projects)

    if (action === 'read' || action === 'list' || action === 'status' || action === '') {
      return describe()
    }

    if (action === 'use' || action === 'switch') {
      if (!name) return '没有收到 name。先 list 看看有哪些模板。'
      if (!list.some((item) => item.name === name)) {
        return '模板库里没有「' + name + '」。现有：' + (list.map((i) => i.name).join('、') || '（空）')
      }
      const persisted = await save({ active: name, enabled: true })
      return '已切到「' + name + '」' + (persisted ? '，并写入配置。' : '，本次运行内生效。') + '下一条消息起生效。'
    }

    if (action === 'add') {
      if (!name || !text) return 'add 需要 name 和 text。'
      if (list.some((item) => item.name === name)) return '已存在同名模板「' + name + '」，改名或用 set。'
      const next = [...list, { name, text }]
      const persisted = await save({ templates: dump(next), active: name, enabled: true })
      return '已新增并切到「' + name + '」（' + text.length + ' 字符）' + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'set' || action === 'update') {
      if (!name || !text) return 'set 需要 name 和 text。'
      const index = list.findIndex((item) => item.name === name)
      if (index < 0) return '模板库里没有「' + name + '」，用 add 新建。'
      const next = list.slice()
      next[index] = { name, text }
      const persisted = await save({ templates: dump(next) })
      return '已更新「' + name + '」（' + text.length + ' 字符）' + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'remove' || action === 'delete') {
      if (!name) return 'remove 需要 name。'
      const next = list.filter((item) => item.name !== name)
      if (next.length === list.length) return '模板库里没有「' + name + '」。'
      const active = state.active === name ? (next[0]?.name ?? '') : state.active
      const persisted = await save({ templates: dump(next), active })
      return '已删除「' + name + '」，当前模板「' + (active || '（空）') + '」' + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'project-list') {
      if (!projects.length) return '还没有任何项目提示词。用 project-add，path 填项目根目录（例如 D:/code/site）。'
      const lines = ['项目提示词:']
      for (const project of projects) {
        lines.push('', project.path + '　选中: ' + (project.active || '（未选）'))
        for (const item of project.templates) {
          lines.push('  ' + (item.name === project.active ? '*' : '-') + ' ' + item.name + '（' + item.text.length + ' 字符）')
        }
      }
      return lines.join('\n')
    }

    if (action === 'project-use') {
      if (!path || !name) return 'project-use 需要 path 和 name。'
      const key = normalizePath(path)
      const index = projects.findIndex((item) => normalizePath(item.path) === key)
      if (index < 0) return '没有路径为「' + path + '」的项目。先 project-add。'
      const project = projects[index]
      if (!project.templates.some((item) => item.name === name)) {
        return '「' + project.path + '」下没有「' + name + '」。现有：'
          + (project.templates.map((i) => i.name).join('、') || '（空）')
      }
      const next = projects.slice()
      next[index] = { ...project, active: name }
      const persisted = await save({ projects: dumpProjects(next), enabled: true })
      return '「' + project.path + '」已切到「' + name + '」' + (persisted ? '，并写入配置。' : '，本次运行内生效。')
    }

    if (action === 'project-add') {
      if (!path || !name || !text) return 'project-add 需要 path、name 和 text。'
      const key = normalizePath(path)
      const index = projects.findIndex((item) => normalizePath(item.path) === key)
      const next = projects.slice()
      if (index < 0) {
        next.push({ path, templates: [{ name, text }], active: name })
      } else {
        const project = projects[index]
        if (project.templates.some((item) => item.name === name)) {
          return '「' + project.path + '」下已有同名模板「' + name + '」，换个名字。'
        }
        next[index] = { ...project, templates: [...project.templates, { name, text }], active: name }
      }
      const persisted = await save({ projects: dumpProjects(next), enabled: true })
      return '已新增项目模板「' + name + '」@ ' + path + '（' + text.length + ' 字符）'
        + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'project-remove') {
      if (!path || !name) return 'project-remove 需要 path 和 name。'
      const key = normalizePath(path)
      const index = projects.findIndex((item) => normalizePath(item.path) === key)
      if (index < 0) return '没有路径为「' + path + '」的项目。'
      const project = projects[index]
      const rest = project.templates.filter((item) => item.name !== name)
      if (rest.length === project.templates.length) return '「' + project.path + '」下没有「' + name + '」。'
      const next = projects.slice()
      if (rest.length === 0) next.splice(index, 1)
      else next[index] = { ...project, templates: rest, active: project.active === name ? rest[0].name : project.active }
      const persisted = await save({ projects: dumpProjects(next) })
      return '已删除「' + name + '」@ ' + project.path + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'on' || action === 'enable') {
      const persisted = await save({ enabled: true })
      return '已启用' + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'off' || action === 'disable') {
      const persisted = await save({ enabled: false })
      return '已停用' + (persisted ? '，配置已写入。' : '，本次运行内生效。') + '（模板库保留）'
    }

    return '未知 action: ' + action
      + '（可用: read / list / use / add / set / remove / project-list / project-add / project-use / project-remove / on / off）'
  }

  void (async () => {
    const defineTool = await loadDefineTool()
    if (typeof defineTool !== 'function') {
      logger?.warn?.('[dsh-prompt-manager] 找不到 @deepseek-ai/dsh-tools，prompt_manager 工具未注册（注入不受影响）')
      return
    }
    try {
      ctx.inject(['tools'], (tctx) => {
        try {
          tctx.tools.register(defineTool({
            name: 'prompt_manager',
            description:
              'Manage the switchable system-prompt templates owned by the dsh-prompt-manager plugin. '
              + 'Global templates apply to every session; project templates apply only to sessions whose '
              + 'working directory is inside `path`. '
              + 'action=list shows every template and which one is active; '
              + 'action=use switches to `name`; action=add creates a template from `name` and `text`; '
              + 'action=set replaces the `text` of an existing `name`; action=remove deletes `name`; '
              + 'action=project-list, project-add, project-use and project-remove do the same per project root; '
              + 'action=on and action=off toggle injection without touching the library. '
              + 'Changes take effect from the next turn and are persisted when a config editor is present.',
            parameters: {
              action: {
                type: 'string',
                required: true,
                description: 'One of: list, use, add, set, remove, project-list, project-add, project-use, project-remove, on, off.',
              },
              name: {
                type: 'string',
                description: 'Template name for use, add, set, remove and the project actions.',
              },
              text: {
                type: 'string',
                description: 'Prompt body for add and set.',
              },
              path: {
                type: 'string',
                description: 'Project root directory for the project actions, for example D:/code/site.',
              },
            },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            async execute(args) {
              return run(args)
            },
          }))
          logger?.info?.('[dsh-prompt-manager] prompt_manager 工具已注册')
        } catch (error) {
          logger?.warn?.('[dsh-prompt-manager] 工具注册失败: ' + String(error?.message ?? error))
        }
      })
    } catch (error) {
      logger?.warn?.('[dsh-prompt-manager] 无法挂载工具服务: ' + String(error?.message ?? error))
    }
  })()
}
