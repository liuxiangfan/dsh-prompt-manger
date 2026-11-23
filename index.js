/**
 * dsh-prompt-manager —— 多套系统提示词管理，切换即生效。
 *
 * Host 半区只做两件事：
 *   1. 注册一个系统提示词段，正文 = 当前选中模板的 text（每回合求值）。
 *   2. 注册 prompt_manager 工具，让 agent 自己列模板、切模板、加模板。
 *
 * 模板库存在插件配置的 `templates` 字段里（JSON 字符串），
 * 设置页与工具写的是同一份数据，谁改都通。
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
        .description('模板库，JSON 数组：[{ "name": "编码", "text": "……" }]'),
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
  let list
  try {
    list = JSON.parse(asText(raw, EMPTY_LIBRARY))
  } catch {
    return []
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

const dump = (list) => JSON.stringify(list.map((i) => ({ name: i.name, text: i.text })))

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
    order: asNumber(options.order, DEFAULT_ORDER),
    complete: asBool(options.complete, false),
  })

  /** 生效配置：永远是解包后的普通值，再叠工具写入的内存层。 */
  const effective = () => ({ ...snapshot(), ...(override ?? {}) })

  /** 每回合组装时求值。空串会被组装流程丢掉，等于不注入。 */
  const sectionText = () => {
    const state = effective()
    if (state.enabled === false) return ''
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
      lines.push('', '模板:')
      for (const item of list) {
        lines.push('  ' + (item.name === picked.name ? '*' : '-') + ' ' + item.name + '（' + item.text.length + ' 字符）')
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
    const state = effective()
    const list = parseTemplates(state.templates)

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

    if (action === 'on' || action === 'enable') {
      const persisted = await save({ enabled: true })
      return '已启用' + (persisted ? '，配置已写入。' : '，本次运行内生效。')
    }

    if (action === 'off' || action === 'disable') {
      const persisted = await save({ enabled: false })
      return '已停用' + (persisted ? '，配置已写入。' : '，本次运行内生效。') + '（模板库保留）'
    }

    return '未知 action: ' + action + '（可用: read / list / use / add / set / remove / on / off）'
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
              + 'action=list shows every template and which one is active; '
              + 'action=use switches to `name`; action=add creates a template from `name` and `text`; '
              + 'action=set replaces the `text` of an existing `name`; action=remove deletes `name`; '
              + 'action=on and action=off toggle injection without touching the library. '
              + 'Changes take effect from the next turn and are persisted when a config editor is present.',
            parameters: {
              action: {
                type: 'string',
                required: true,
                description: 'One of: list, use, add, set, remove, on, off.',
              },
              name: {
                type: 'string',
                description: 'Template name for use, add, set and remove.',
              },
              text: {
                type: 'string',
                description: 'Prompt body for add and set.',
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
