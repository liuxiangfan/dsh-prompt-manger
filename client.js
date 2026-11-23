/* dsh-prompt-manager —— 客户端半区
 *
 * 设置 → 「提示词管理」：
 *   - 模板下拉（切换就是切系统提示词，下一回合生效）
 *   - 正文编辑框（改选中的那套）
 *   - 新建 / 删除 / 保存
 *
 * 读写走 ctx.configForms.get('prompt-manager')：改的是插件配置里
 * templates（JSON 字符串）与 active 两个字段，Host 侧每回合求值一次。
 *
 * 手写 bundle：不经打包器，只 require 平台模块表里的 react。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-manager',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var h = React.createElement;

    /** 设置命名空间 = cordis.patch.yml 里的 id。 */
    var NS = 'prompt-manager';

    var S = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '4px 2px 24px',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '1.6',
        color: 'inherit',
      },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      title: { margin: '0', fontSize: '15px', fontWeight: '600' },
      hint: { margin: '0', opacity: '0.7', fontSize: '12px' },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid rgba(127,127,127,0.3)',
        fontSize: '12px',
      },
      dot: { width: '7px', height: '7px', borderRadius: '50%', background: 'currentColor', opacity: '0.75' },
      select: {
        padding: '5px 8px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.3)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
      },
      area: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '280px',
        resize: 'vertical',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.28)',
        background: 'rgba(127,127,127,0.06)',
        color: 'inherit',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12.5px',
        lineHeight: '1.6',
        outline: 'none',
      },
      input: {
        padding: '5px 8px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.3)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        minWidth: '180px',
      },
      button: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.32)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        cursor: 'pointer',
      },
      primary: {
        padding: '6px 16px',
        borderRadius: '6px',
        border: '1px solid rgba(59,130,246,0.5)',
        background: 'rgba(59,130,246,0.16)',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        fontWeight: '600',
        cursor: 'pointer',
      },
      disabled: { opacity: '0.45', cursor: 'not-allowed' },
      note: { margin: '0', fontSize: '12px', minHeight: '16px', opacity: '0.85' },
      warn: {
        margin: '0',
        fontSize: '12px',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid rgba(234,179,8,0.35)',
        background: 'rgba(234,179,8,0.08)',
      },
      meta: { fontSize: '12px', opacity: '0.7' },
    };

    var EMPTY = {};

    /** 解析 Host 传来的模板库；坏 JSON 当空库。 */
    function parse(raw) {
      try {
        var list = JSON.parse(typeof raw === 'string' && raw ? raw : '[]');
        if (!Array.isArray(list)) return [];
        return list
          .filter(function (item) { return item && typeof item === 'object'; })
          .map(function (item) {
            return {
              name: typeof item.name === 'string' ? item.name : '',
              text: typeof item.text === 'string' ? item.text : '',
            };
          })
          .filter(function (item) { return item.name !== ''; });
      } catch (error) {
        return [];
      }
    }

    function dump(list) {
      return JSON.stringify(
        list.map(function (item) { return { name: item.name, text: item.text }; }),
      );
    }

    /** 订阅共享配置表单的草稿/已接受值。 */
    function useFormSnapshot(form) {
      var useSync = React.useSyncExternalStore;
      var subscribe = React.useCallback(
        function (listener) { return form.subscribe(listener); },
        [form],
      );
      var read = React.useCallback(function () { return form.getSnapshot(); }, [form]);
      if (typeof useSync === 'function') return useSync(subscribe, read);
      var state = React.useState(read());
      var value = state[0];
      var setValue = state[1];
      React.useEffect(function () {
        return subscribe(function () { setValue(read()); });
      }, [subscribe]);
      React.useEffect(function () { setValue(read()); });
      return value;
    }

    function PromptSwitchSection(props) {
      var form = props.form || currentForm;
      if (!form) {
        return h('div', { style: S.root },
          h('h2', { style: S.title }, '提示词管理'),
          h('p', { style: S.warn }, '配置服务还没就绪（configForms 不可用），稍后再打开这个页面试试。'));
      }

      var snap = useFormSnapshot(form) || EMPTY;
      var value = snap.value || EMPTY;
      var ready = Boolean(snap.value);
      var writable = snap.writable !== false;

      var listState = React.useState([]);
      var list = listState[0];
      var setList = listState[1];

      var indexState = React.useState(0);
      var index = indexState[0];
      var setIndex = indexState[1];

      var draftState = React.useState('');
      var draft = draftState[0];
      var setDraft = draftState[1];

      var dirtyState = React.useState(false);
      var dirty = dirtyState[0];
      var setDirty = dirtyState[1];

      var nameState = React.useState('');
      var newName = nameState[0];
      var setNewName = nameState[1];

      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var noteState = React.useState('');
      var note = noteState[0];
      var setNote = noteState[1];

      var initedRef = React.useRef(false);

      var hostRaw = typeof value.templates === 'string' ? value.templates : '[]';
      var hostActive = typeof value.active === 'string' ? value.active : '';
      var enabled = value.enabled !== false;

      // Host 值落进本地草稿：首次必填，之后只在没脏改动时跟随
      React.useEffect(function () {
        if (!ready) return;
        if (!initedRef.current) {
          initedRef.current = true;
          var first = parse(hostRaw);
          setList(first);
          var found = -1;
          for (var i = 0; i < first.length; i += 1) {
            if (first[i].name === hostActive) { found = i; break; }
          }
          var start = found >= 0 ? found : 0;
          setIndex(start);
          setDraft(first[start] ? first[start].text : '');
          return;
        }
        if (!dirty) {
          var next = parse(hostRaw);
          setList(next);
          var hit = -1;
          for (var j = 0; j < next.length; j += 1) {
            if (next[j].name === hostActive) { hit = j; break; }
          }
          var pickIndex = hit >= 0 ? hit : 0;
          setIndex(pickIndex);
          setDraft(next[pickIndex] ? next[pickIndex].text : '');
        }
      }, [ready, hostRaw, hostActive, dirty]);

      var current = list[index];

      function run(action, label) {
        if (busy || !writable) return Promise.resolve(false);
        setBusy(true);
        setNote('正在' + label + '…');
        return Promise.resolve()
          .then(action)
          .then(function (ok) {
            setNote(ok ? label + '成功，下一回合生效' : label + '被 Host 拒绝');
            return ok === true;
          })
          .catch(function (error) {
            setNote(label + '失败：' + String((error && error.message) || error));
            return false;
          })
          .then(function (ok) {
            setBusy(false);
            return ok;
          });
      }

      /** 把草稿合并回列表，再落盘。 */
      function saveList(nextList, nextActive, label) {
        return run(function () {
          return form.mutate([
            { op: 'set', path: ['templates'], value: dump(nextList) },
            { op: 'set', path: ['active'], value: nextActive },
          ]);
        }, label).then(function (ok) {
          if (ok) {
            setList(nextList);
            setDirty(false);
          }
          return ok;
        });
      }

      function handleSelect(event) {
        var at = Number(event.target.value);
        if (!Number.isFinite(at)) return;
        var picked = list[at];
        if (!picked) return;
        setIndex(at);
        setDraft(picked.text);
        setDirty(false);
        // 切换本身就是全部目的：立刻写入 active
        run(function () {
          return form.mutate([{ op: 'set', path: ['active'], value: picked.name }]);
        }, '切换到「' + picked.name + '」');
      }

      function handleSaveText() {
        if (!current) return;
        var next = list.slice();
        next[index] = { name: current.name, text: draft };
        saveList(next, current.name, '保存「' + current.name + '」');
      }

      function handleCreate() {
        var legal = newName.trim();
        if (!legal) {
          setNote('先给新模板起个名字');
          return;
        }
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].name === legal) {
            setNote('已经有同名模板「' + legal + '」');
            return;
          }
        }
        var next = list.concat([{ name: legal, text: draft }]);
        saveList(next, legal, '新建「' + legal + '」').then(function (ok) {
          if (ok) {
            setIndex(next.length - 1);
            setNewName('');
          }
        });
      }

      function handleDelete() {
        if (!current) return;
        var next = list.filter(function (item) { return item.name !== current.name; });
        var nextActive = next[0] ? next[0].name : '';
        saveList(next, nextActive, '删除「' + current.name + '」').then(function (ok) {
          if (ok) {
            setIndex(0);
            setDraft(next[0] ? next[0].text : '');
          }
        });
      }

      function handleToggle() {
        var next = !enabled;
        run(function () { return form.set('enabled', next); }, next ? '启用' : '停用');
      }

      var options = list.map(function (item, at) {
        return h('option', { key: item.name, value: String(at) }, item.name);
      });

      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('h2', { style: S.title }, '提示词管理'),
          h('span', { style: S.pill },
            h('span', { style: S.dot, 'aria-hidden': 'true' }),
            enabled ? '已启用' : '已停用'),
          ready ? null : h('span', { style: S.meta }, '（正在读取配置…）')),
        h('p', { style: S.hint },
          '每套模板是一段系统提示词，插在 Harness 自带段之后。',
          '下拉切换即时生效——不用重启，改完下一条消息就带上新模板。'),

        !writable
          ? h('p', { style: S.warn }, '这项配置被上层 patch 覆盖，界面里改不动。')
          : null,

        list.length === 0
          ? h('p', { style: S.hint }, '模板库还是空的：在下面输入名字点「另存为新模板」，正文就用编辑框里的内容。')
          : h('div', { style: S.row },
            h('span', { style: S.meta }, '当前模板'),
            h('select', {
              style: S.select,
              value: String(index),
              disabled: busy || !writable,
              onChange: handleSelect,
            }, options),
            h('span', { style: S.meta }, (current ? current.text.length : 0) + ' 字符')),

        h('textarea', {
          style: S.area,
          value: draft,
          spellCheck: false,
          disabled: !writable || !current,
          placeholder: current
            ? '这套模板的正文……'
            : '模板库为空。先写正文，再给它起个名字另存。',
          onChange: function (event) {
            setDraft(event.target.value);
            setDirty(true);
            setNote('');
          },
        }),

        h('div', { style: S.row },
          h('button', {
            type: 'button',
            style: busy || !writable || !current ? Object.assign({}, S.primary, S.disabled) : S.primary,
            disabled: busy || !writable || !current,
            onClick: handleSaveText,
          }, dirty ? '保存修改' : '保存'),
          h('input', {
            style: S.input,
            value: newName,
            placeholder: '新模板名字',
            disabled: busy || !writable,
            onChange: function (event) { setNewName(event.target.value); },
          }),
          h('button', {
            type: 'button',
            style: busy || !writable ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy || !writable,
            onClick: handleCreate,
          }, '另存为新模板'),
          h('button', {
            type: 'button',
            style: busy || !writable || !current ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy || !writable || !current,
            onClick: handleDelete,
          }, '删除这套'),
          h('button', {
            type: 'button',
            style: busy || !writable ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy || !writable,
            onClick: handleToggle,
          }, enabled ? '停用注入' : '启用注入')),

        h('p', { style: S.note }, note),
        h('p', { style: S.hint },
          '模板库存在 profile 的 cordis.patch.yml（条目 prompt-manager 的 config.templates）。',
          '也可以直接对 agent 说「切到 XX 模板」，走 prompt_manager 工具。'));
    }

    var inject = ['slots', 'configForms'];

    /** 槽位渲染器没把 inject props 传下来时的兜底。 */
    var currentForm = null;

    function apply(ctx) {
      currentForm = ctx.configForms.get(NS);
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'prompt-manager',
          order: 61,
          label: function () { return '提示词管理'; },
          inject: function () { return { form: currentForm }; },
        }, PromptSwitchSection);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
