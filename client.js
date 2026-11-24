/**
 * 设置页：提示词管理。
 *
 * 两个页签：全局提示词（所有会话）/ 项目提示词（按工作目录归属）。
 * 卡片列表照 Claude Code 的全局提示词面板排：一行摘要在前，点开看全文，
 * 右侧「应用」按钮切换。样式只引用主题 token，不 require 任何宿主客户端包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-manager',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useMemo, useRef } = React
    const h = React.createElement

    const NS = 'prompt-manager'
    const REPO_URL = 'https://github.com/liuxiangfan/dsh-prompt-manger'
    const GITHUB_MARK = 'M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.5-1.8-1.5-1.8-1.2-.8.1-.8.1-.8 1.3.1 2 1.3 2 1.3 1.1 1.9 3 1.4 3.7 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z'
    const ISSUE_MARK = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
    const PREVIEW = 150

    /* ---------------- 配置读写 ---------------- */

    function readForm(ctx) {
      try {
        return ctx.configForms.get(NS)
      } catch {
        return undefined
      }
    }

    function snapshotOf(form) {
      if (!form || typeof form.getSnapshot !== 'function') return undefined
      try {
        return form.getSnapshot()
      } catch {
        return undefined
      }
    }

    function setKey(form, key, value) {
      if (!form || typeof form.set !== 'function') return Promise.resolve(false)
      try {
        return Promise.resolve(form.set(key, value)).then((ok) => ok !== false, () => false)
      } catch {
        return Promise.resolve(false)
      }
    }

    function setPath(form, path, value) {
      if (!form || typeof form.mutate !== 'function') return Promise.resolve(false)
      try {
        return Promise.resolve(form.mutate([{ op: 'set', path, value }])).then((ok) => ok !== false, () => false)
      } catch {
        return Promise.resolve(false)
      }
    }

    /* ---------------- 纯数据 ---------------- */

    function listOf(raw) {
      let value
      try {
        value = JSON.parse(String(raw ?? '[]'))
      } catch {
        return []
      }
      if (!Array.isArray(value)) return []
      return value
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({ name: String(item.name ?? ''), text: String(item.text ?? '') }))
        .filter((item) => item.name !== '')
    }

    function mapOf(raw) {
      let value
      try {
        value = JSON.parse(String(raw ?? '{}'))
      } catch {
        return {}
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      const out = {}
      for (const [key, group] of Object.entries(value)) {
        if (!key || !group || typeof group !== 'object') continue
        out[key] = { templates: listOf(JSON.stringify(group.templates ?? [])), active: String(group.active ?? '') }
      }
      return out
    }

    /** 见过的工作目录：插件在注入时自动收集，这里只负责读。 */
    function pathsOf(raw) {
      let value
      try {
        value = JSON.parse(String(raw ?? '[]'))
      } catch {
        return []
      }
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const out = []
      for (const item of value) {
        if (typeof item !== 'string') continue
        const path = item.trim()
        const key = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(path)
      }
      return out
    }

    const dumpList = (list) => JSON.stringify(list.map((item) => ({ name: item.name, text: item.text })))
    const dumpMap = (map) => JSON.stringify(map)

    /** 路径归一，和后端 normalizePath 保持一致。 */
    const norm = (value) => String(value ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase()

    const summaryOf = (text) => {
      const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
      if (flat === '') return '（空提示词）'
      return flat.length > PREVIEW ? flat.slice(0, PREVIEW) + '…' : flat
    }

    const shortPath = (path) => {
      const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length <= 2) return String(path)
      return '…/' + parts.slice(-2).join('/')
    }

    /* ---------------- 样式 ---------------- */

    const CSS = `
.pm { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; color: inherit; }
.pm-head { display: flex; flex-direction: column; gap: 8px; }
.pm-head-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pm-title { font-size: 15px; font-weight: 600; margin: 0; }
.pm-link { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 1; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(127,127,127,.45); color: inherit; text-decoration: none; opacity: .85; }
.pm-link:hover { opacity: 1; border-color: currentColor; }
.pm-link span { white-space: nowrap; }
.pm-intro { font-size: 12px; line-height: 1.65; opacity: .7; margin: 0; }
.pm-switch { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: inherit; opacity: .75; }
.pm-tabs { display: flex; gap: 4px; border-bottom: 1px solid rgba(127,127,127,.28); }
.pm-tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; margin-bottom: -1px; font: inherit; font-size: 13px; cursor: pointer; color: inherit; opacity: .6; }
.pm-tab.is-on { opacity: 1; border-bottom-color: currentColor; font-weight: 600; }
.pm-note { font-size: 12px; line-height: 1.6; color: inherit; opacity: .7; margin: 0; }
.pm-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pm-grow { flex: 1 1 auto; }
.pm-btn { appearance: none; font: inherit; font-size: 12px; line-height: 1; padding: 7px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(127,127,127,.45); background: transparent; color: inherit; }
.pm-btn:hover { border-color: currentColor; }
.pm-btn.primary { background: rgba(88,116,255,.16); border-color: rgba(88,116,255,.72); color: inherit; font-weight: 600; }
.pm-btn.primary:hover { background: rgba(88,116,255,.28); }
.pm-btn.ghost { border-color: transparent; background: transparent; color: inherit; opacity: .62; padding: 6px 8px; }
.pm-btn.ghost:hover { opacity: 1; }
.pm-btn:disabled { opacity: .4; cursor: default; }
.pm-input, .pm-area { font: inherit; font-size: 13px; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(127,127,127,.45); background: transparent; color: inherit; }
.pm-area { min-height: 190px; resize: vertical; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.pm-input:focus, .pm-area:focus { outline: none; border-color: rgba(88,116,255,.8); }
.pm-list { display: flex; flex-direction: column; gap: 8px; }
.pm-card { border: 1px solid rgba(127,127,127,.3); border-radius: 8px; padding: 10px 12px; background: rgba(127,127,127,.06); }
.pm-card.is-active { border-color: rgba(88,116,255,.85); box-shadow: 0 0 0 1px rgba(88,116,255,.55) inset; }
.pm-card-head { display: flex; align-items: center; gap: 8px; }
.pm-name { font-size: 13px; font-weight: 600; }
.pm-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(40,167,69,.2); border: 1px solid rgba(40,167,69,.45); color: inherit; }
.pm-preview { font-size: 12px; line-height: 1.6; margin: 6px 0 8px; color: inherit; opacity: .68; }
.pm-foot { display: flex; align-items: center; gap: 6px; }
.pm-foot .pm-grow { flex: 1; }
.pm-full { margin: 10px 0 0; padding: 10px; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; border-radius: 6px; background: rgba(127,127,127,.1); color: inherit; }
.pm-group { display: flex; flex-direction: column; gap: 8px; }
.pm-group-head { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.pm-group-path { font-size: 12px; font-weight: 600; }
.pm-group-meta { font-size: 11px; color: inherit; opacity: .62; }
.pm-empty { font-size: 12px; padding: 18px 12px; text-align: center; border: 1px dashed rgba(127,127,127,.45); border-radius: 8px; color: inherit; opacity: .7; }
.pm-warn { font-size: 12px; color: rgba(214,138,0,.95); }
.pm-select { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(127,127,127,.45); background: transparent; color: inherit; max-width: 100%; }
.pm-chip { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(127,127,127,.4); color: inherit; opacity: .8; }
`

    /* ---------------- 卡片 ---------------- */

    function Card({ name, text, active, open, onApply, onToggle, onEdit, onRemove }) {
      return h('div', { className: 'pm-card' + (active ? ' is-active' : '') },
        h('div', { className: 'pm-card-head' },
          h('span', { className: 'pm-name' }, name),
          active ? h('span', { className: 'pm-badge' }, '已应用') : null,
          h('span', { className: 'pm-grow' }),
          h('button', { className: 'pm-btn ghost', title: '编辑', onClick: onEdit }, '编辑'),
          h('button', { className: 'pm-btn ghost', title: '删除', onClick: onRemove }, '删除'),
        ),
        h('div', { className: 'pm-preview' }, summaryOf(text)),
        h('div', { className: 'pm-foot' },
          active
            ? h('span', { className: 'pm-group-meta' }, text.length + ' 字符')
            : h('button', { className: 'pm-btn', onClick: onApply }, '应用'),
          h('span', { className: 'pm-grow' }),
          h('button', { className: 'pm-btn ghost', onClick: onToggle }, open ? '收起' : '展开'),
        ),
        open ? h('pre', { className: 'pm-full' }, text) : null,
      )
    }

    function Editor({ name, text, onName, onText, onSave, onCancel, saveLabel }) {
      return h('div', { className: 'pm-card is-active' },
        h('input', {
          className: 'pm-input',
          placeholder: '提示词名字，例如：代码审查',
          value: name,
          onChange: (event) => onName(event.target.value),
        }),
        h('div', { style: { height: 8 } }),
        h('textarea', {
          className: 'pm-area',
          placeholder: '这里写提示词正文，切换后原样注入系统提示词。',
          value: text,
          onChange: (event) => onText(event.target.value),
        }),
        h('div', { className: 'pm-foot', style: { marginTop: 8 } },
          h('span', { className: 'pm-grow' }),
          h('button', { className: 'pm-btn ghost', onClick: onCancel }, '取消'),
          h('button', { className: 'pm-btn primary', onClick: onSave }, saveLabel),
        ),
      )
    }

    /* ---------------- 面板 ---------------- */

    function Panel({ form, ctx }) {
      const [, bump] = useState(0)
      const rerender = () => bump((n) => n + 1)
      const formRef = useRef(form)
      if (form) formRef.current = form

      const [tab, setTab] = useState('global')
      const [editing, setEditing] = useState(null)
      const [openKey, setOpenKey] = useState('')
      const [newPath, setNewPath] = useState('')
      const [notice, setNotice] = useState('')

      useEffect(() => {
        const current = readForm(ctx)
        if (!current) return undefined
        formRef.current = current
        rerender()
        if (typeof current.subscribe !== 'function') return undefined
        try {
          const off = current.subscribe(rerender)
          return typeof off === 'function' ? off : undefined
        } catch {
          return undefined
        }
      }, [ctx])

      const live = formRef.current ?? form
      const snap = snapshotOf(live)
      const value = snap?.value ?? {}
      const writable = snap ? snap.writable !== false : true
      const enabled = value.enabled !== false
      const list = useMemo(() => listOf(value.templates), [value.templates])
      const projects = useMemo(() => mapOf(value.projects), [value.projects])
      const projectPaths = useMemo(() => Object.keys(projects).sort((a, b) => a.localeCompare(b)), [projects])
      const workspaces = useMemo(() => pathsOf(value.workspaces), [value.workspaces])

      if (!live) {
        return h('div', { className: 'pm' },
          h('style', null, CSS),
          h('div', { className: 'pm-empty' }, '配置服务还没就绪，稍等片刻再打开这一页。'),
        )
      }

      const flash = (message) => {
        setNotice(message)
        window.setTimeout(() => setNotice(''), 2200)
      }
      const guard = () => {
        if (!writable) {
          flash('当前配置是只读的，改不了。')
          return false
        }
        return true
      }

      /* ----- 全局 ----- */

      const applyGlobal = (name) => {
        if (!guard()) return
        setPath(live, ['active'], name)
        setPath(live, ['enabled'], true)
        flash('已切换到「' + name + '」')
        rerender()
      }

      const saveGlobal = () => {
        if (!guard() || !editing) return
        const name = editing.name.trim()
        if (!name) return flash('先起个名字')
        const next = list.filter((item) => item.name !== editing.oldName).slice()
        const index = list.findIndex((item) => item.name === editing.oldName)
        next.splice(index < 0 ? next.length : index, 0, { name, text: editing.text })
        setPath(live, ['templates'], dumpList(next))
        if (editing.isNew || editing.oldName === value.active) setPath(live, ['active'], name)
        setEditing(null)
        flash('已保存「' + name + '」')
        rerender()
      }

      const removeGlobal = (name) => {
        if (!guard()) return
        if (!window.confirm('删掉「' + name + '」？')) return
        const next = list.filter((item) => item.name !== name)
        setPath(live, ['templates'], dumpList(next))
        if (value.active === name) setPath(live, ['active'], next[0]?.name ?? '')
        flash('已删除「' + name + '」')
        rerender()
      }

      /* ----- 项目 ----- */

      const applyProject = (path, name) => {
        if (!guard()) return
        const key = Object.keys(projects).find((item) => norm(item) === norm(path))
        if (!key) return
        const next = { ...projects, [key]: { ...projects[key], active: name } }
        setPath(live, ['projects'], dumpMap(next))
        setPath(live, ['enabled'], true)
        flash('「' + shortPath(key) + '」已切到「' + name + '」')
        rerender()
      }

      const saveProject = () => {
        if (!guard() || !editing) return
        const name = editing.name.trim()
        if (!name) return flash('先起个名字')
        const key = Object.keys(projects).find((item) => norm(item) === norm(editing.path))
        if (!key) return flash('项目目录不见了，重新打开这一页')
        const group = projects[key]
        const kept = group.templates.filter((item) => item.name !== editing.oldName)
        const index = group.templates.findIndex((item) => item.name === editing.oldName)
        kept.splice(index < 0 ? kept.length : index, 0, { name, text: editing.text })
        const next = { ...projects, [key]: { templates: kept, active: editing.isNew ? name : group.active } }
        setPath(live, ['projects'], dumpMap(next))
        setEditing(null)
        flash('已保存「' + name + '」')
        rerender()
      }

      const removeProject = (path, name) => {
        if (!guard()) return
        if (!window.confirm('删掉「' + name + '」？')) return
        const key = Object.keys(projects).find((item) => norm(item) === norm(path))
        if (!key) return
        const group = projects[key]
        const kept = group.templates.filter((item) => item.name !== name)
        const next = { ...projects }
        const active = group.active === name ? (kept[0]?.name ?? '') : group.active
        next[key] = { templates: kept, active }
        setPath(live, ['projects'], dumpMap(next))
        flash('已删除「' + name + '」')
        rerender()
      }

      const addProject = () => {
        if (!guard()) return
        const path = newPath.trim()
        if (!path) return flash('填一个项目根目录，例如 D:/code/site')
        const key = Object.keys(projects).find((item) => norm(item) === norm(path))
        if (key) {
          flash('这个目录已经在列表里了')
          setNewPath('')
          return
        }
        const next = { ...projects, [path]: { templates: [], active: '' } }
        setPath(live, ['projects'], dumpMap(next))
        setNewPath('')
        rerender()
      }

      const removeProjectGroup = (path) => {
        if (!guard()) return
        if (!window.confirm('移掉「' + shortPath(path) + '」这个分组？里面的提示词会一起删。')) return
        const key = Object.keys(projects).find((item) => norm(item) === norm(path))
        if (!key) return
        const next = { ...projects }
        delete next[key]
        setPath(live, ['projects'], dumpMap(next))
        rerender()
      }

      /* ----- 渲染 ----- */

      const icon = (d) => h('svg', {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'currentColor',
        'aria-hidden': 'true',
      }, h('path', { d }))

      const repoLink = (href, label, d) => h('a', {
        className: 'pm-link',
        href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: href,
      }, icon(d), h('span', null, label))

      const head = h('div', { className: 'pm-head' },
        h('div', { className: 'pm-head-row' },
          h('h3', { className: 'pm-title' }, '提示词管理'),
          repoLink(REPO_URL, 'GitHub', GITHUB_MARK),
          repoLink(REPO_URL + '/issues', '问题反馈', ISSUE_MARK),
          h('span', { className: 'pm-grow' }),
          h('label', { className: 'pm-switch' },
            h('input', {
              type: 'checkbox',
              checked: enabled,
              onChange: (event) => {
                if (!guard()) return
                const wanted = event.target.checked
                setKey(live, 'enabled', wanted).then((ok) => {
                  if (!ok) flash('没写进去：配置可能是只读的，看下当前模式')
                  rerender()
                })
              },
            }),
            enabled ? '注入中' : '已停用',
          ),
        ),
        h('p', { className: 'pm-intro' }, '多套系统提示词：全局一份，每个工作区各自一份。点「应用」换过去，下一回合生效。'),
      )

      const tabs = h('div', { className: 'pm-tabs' },
        h('button', {
          className: 'pm-tab' + (tab === 'global' ? ' is-on' : ''),
          onClick: () => { setTab('global'); setEditing(null); setOpenKey('') },
        }, '全局提示词'),
        h('button', {
          className: 'pm-tab' + (tab === 'project' ? ' is-on' : ''),
          onClick: () => { setTab('project'); setEditing(null); setOpenKey('') },
        }, '项目提示词'),
      )

      let body
      if (tab === 'global') {
        const cards = list.map((item) => {
          const key = 'global::' + item.name
          if (editing && editing.scope === 'global' && editing.oldName === item.name) {
            return h(Editor, {
              key,
              name: editing.name,
              text: editing.text,
              saveLabel: '保存',
              onName: (next) => setEditing({ ...editing, name: next }),
              onText: (next) => setEditing({ ...editing, text: next }),
              onSave: saveGlobal,
              onCancel: () => setEditing(null),
            })
          }
          return h(Card, {
            key,
            name: item.name,
            text: item.text,
            active: value.active === item.name,
            open: openKey === key,
            onApply: () => applyGlobal(item.name),
            onToggle: () => setOpenKey(openKey === key ? '' : key),
            onEdit: () => setEditing({ scope: 'global', oldName: item.name, name: item.name, text: item.text }),
            onRemove: () => removeGlobal(item.name),
          })
        })

        if (editing && editing.scope === 'global' && editing.isNew) {
          cards.push(h(Editor, {
            key: 'global::__new__',
            name: editing.name,
            text: editing.text,
            saveLabel: '保存',
            onName: (next) => setEditing({ ...editing, name: next }),
            onText: (next) => setEditing({ ...editing, text: next }),
            onSave: saveGlobal,
            onCancel: () => setEditing(null),
          }))
        }

        body = h(React.Fragment, null,
          h('p', { className: 'pm-note' }, '全局提示词对所有会话生效。选一套点「应用」，下一条消息起按它注入。'),
          h('div', { className: 'pm-bar' },
            h('span', { className: 'pm-grow' }),
            h('button', {
              className: 'pm-btn primary',
              disabled: !!editing,
              onClick: () => setEditing({ scope: 'global', oldName: '', name: '', text: '', isNew: true }),
            }, '+ 添加全局提示词'),
          ),
          cards.length
            ? h('div', { className: 'pm-list' }, cards)
            : h('div', { className: 'pm-empty' }, '还没有全局提示词。点右上角加一套，或者切到项目提示词。'),
        )
      } else {
        const groups = projectPaths.map((path) => {
          const group = projects[path]
          const cards = group.templates.map((item) => {
            const key = path + '::' + item.name
            if (editing && editing.scope === 'project' && norm(editing.path) === norm(path) && editing.oldName === item.name) {
              return h(Editor, {
                key,
                name: editing.name,
                text: editing.text,
                saveLabel: '保存',
                onName: (next) => setEditing({ ...editing, name: next }),
                onText: (next) => setEditing({ ...editing, text: next }),
                onSave: saveProject,
                onCancel: () => setEditing(null),
              })
            }
            return h(Card, {
              key,
              name: item.name,
              text: item.text,
              active: group.active === item.name,
              open: openKey === key,
              onApply: () => applyProject(path, item.name),
              onToggle: () => setOpenKey(openKey === key ? '' : key),
              onEdit: () => setEditing({ scope: 'project', path, oldName: item.name, name: item.name, text: item.text }),
              onRemove: () => removeProject(path, item.name),
            })
          })

          if (editing && editing.scope === 'project' && editing.isNew && norm(editing.path) === norm(path)) {
            cards.push(h(Editor, {
              key: path + '::__new__',
              name: editing.name,
              text: editing.text,
              saveLabel: '保存',
              onName: (next) => setEditing({ ...editing, name: next }),
              onText: (next) => setEditing({ ...editing, text: next }),
              onSave: saveProject,
              onCancel: () => setEditing(null),
            }))
          }

          return h('div', { className: 'pm-group', key: path },
            h('div', { className: 'pm-group-head' },
              h('span', { className: 'pm-group-path', title: path }, shortPath(path)),
              h('span', { className: 'pm-group-meta' }, group.templates.length + ' 套' + (group.active ? '　当前: ' + group.active : '　未选')),
              h('span', { className: 'pm-grow' }),
              h('button', {
                className: 'pm-btn ghost',
                disabled: !!editing,
                onClick: () => setEditing({ scope: 'project', path, oldName: '', name: '', text: '', isNew: true }),
              }, '+ 添加'),
              h('button', { className: 'pm-btn ghost', onClick: () => removeProjectGroup(path) }, '移掉分组'),
            ),
            cards.length
              ? h('div', { className: 'pm-list' }, cards)
              : h('div', { className: 'pm-empty' }, '这个项目还没有提示词。点「+ 添加」写一套。'),
          )
        })

        const reusable = workspaces.filter((path) => !projects[path])

        body = h(React.Fragment, null,
          h('p', { className: 'pm-note' }, '项目提示词只在工作目录落在这个项目里的会话生效，优先于全局。'),
          h('div', { className: 'pm-bar' },
            reusable.length
              ? h('select', {
                  className: 'pm-select',
                  title: '插件在注入时收集到的工作目录',
                  value: reusable.includes(newPath) ? newPath : '',
                  onChange: (event) => { if (event.target.value) setNewPath(event.target.value) },
                },
                h('option', { value: '' }, '选择已有工作区…'),
                reusable.map((path) => h('option', { key: path, value: path }, path)),
              )
              : h('span', { className: 'pm-chip' }, '没见过工作区——先开一个会话，这里就会出现'),
            h('input', {
              className: 'pm-input',
              style: { flex: '1 1 220px', width: 'auto' },
              placeholder: '或手填项目根目录，例如 D:/code/site',
              value: newPath,
              onChange: (event) => setNewPath(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') addProject() },
            }),
            h('button', { className: 'pm-btn', onClick: addProject }, '+ 新建分组'),
          ),
          groups.length
            ? h('div', { className: 'pm-list' }, groups)
            : h('div', { className: 'pm-empty' }, '还没有项目分组。从上面选一个工作区（或手填目录），再点「+ 新建分组」。'),
        )
      }

      return h('div', { className: 'pm' },
        h('style', null, CSS),
        head,
        tabs,
        body,
        notice ? h('div', { className: 'pm-warn' }, notice) : null,
      )
    }

    return {
      inject: ['slots', 'configForms'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'prompt-manager',
          order: 61,
          label: () => '提示词管理',
          inject: () => ({ form: readForm(ctx), ctx }),
        }, (props) => h(Panel, props)))
      },
    }
  },
})
