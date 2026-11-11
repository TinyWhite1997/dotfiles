const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function picker() {
  const all = ['working', 'done', 'idle', 'blocked'].map((status, index) => ({
    address: `t${index}`, tab: 'agents', status, title: `Task ${index}`,
    program: { name: index === 1 ? 'Claude' : 'Copilot' },
  }));
  const calls = [];
  const events = {};
  const world = [
    { id: 's1', name: 'dotfiles', tabs: [{ id: 'agents', name: 'Fix picker' }] },
    { id: 's2', name: 'other', tabs: [{ id: 'shell', name: 'Terminal' }] },
  ];
  const scrolled = [];
  const element = () => new Proxy({ nodes: [], elementId: null }, {
    get(target, key, receiver) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'child') target.nodes.push(args[0]);
        if (key === 'children') target.nodes.push(...args[0]);
        if (key === 'id') target.elementId = args[0];
        if (key === 'when' && args[0]) args[1](receiver);
        return receiver;
      };
    },
  });
  let value = '';
  let focus = 'normal';
  const cx = {
    focus_handle: () => ({ focus() { focus = 'normal'; } }),
    notify() {},
    stop_propagation() {},
  };
  const source = readFileSync(join(__dirname, 'mods', 'modal-picker', 'main.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default class ModalPicker', 'globalThis.ModalPicker = class ModalPicker');
  const context = vm.createContext({
    View: class {},
    div: element, v_flex: element, h_flex: element, svg: element,
    theme: () => ({}),
    shared: () => ({ s1: 'ansi3', s2: '#123456' }),
    ScrollHandle: { new: () => ({ scroll_to_item: index => scrolled.push(index) }) },
    InputState: {
      new: () => ({
        on(name, fn) { events[name] = fn; },
        value: () => value,
        focus() { focus = 'search'; },
      }),
    },
    agents: () => all,
    spaces: () => world,
    props: () => ({ overlay: 'picker-overlay' }),
    closeOverlay: id => calls.push(['close', id]),
    run: (...args) => calls.push(JSON.parse(JSON.stringify(args))),
  });
  vm.runInContext(source, context);
  const view = new context.ModalPicker();
  view.init({}, cx);
  return {
    view, calls, all, world, scrolled,
    focus: () => focus,
    key: (key, modifiers = {}) => view.key({ key, modifiers }, cx),
    type(text) { value = text; events.change({}, cx); },
    submit() { events.submit({}, cx); },
    ids: () => Array.from(view.rows(), row => row.id),
  };
}

test('status filters select individual agents, while all includes ordinary tabs', () => {
  const p = picker();
  assert.deepEqual(p.ids(), ['t0', 't1', 't2', 't3', 'shell']);
  for (const [key, id] of [['w', 't0'], ['d', 't1'], ['i', 't2'], ['b', 't3']]) {
    p.key(key);
    assert.deepEqual(p.ids(), [id]);
  }
  p.key('a');
  assert.equal(p.ids().length, 5);
  p.key('d', { control: true });
  assert.equal(p.view.status, 'all');
  p.key('d');
  p.all[1].status = 'idle';
  assert.deepEqual(p.ids(), []);
  p.key('j');
  p.key('enter');
  assert.deepEqual(p.calls, []);
});

test('j/k navigate and wrap only in normal mode', () => {
  const p = picker();
  assert.equal(p.focus(), 'normal');
  p.key('k');
  assert.equal(p.view.at, 4);
  p.key('j');
  assert.equal(p.view.at, 0);
  p.key('j');
  p.key('enter');
  assert.deepEqual(p.calls, [
    ['close', 'picker-overlay'], ['agent.focus', { terminal: 't1' }],
  ]);
});

test('slash enters search; status letters and j/k remain text; Escape closes', () => {
  const p = picker();
  p.key('/');
  assert.equal(p.focus(), 'search');
  p.key('w');
  p.key('j');
  p.key('k');
  assert.equal(p.view.status, 'all');
  assert.equal(p.view.at, 0);
  p.type('CLAUDE');
  assert.deepEqual(p.ids(), ['t1']);
  p.key('escape');
  assert.deepEqual(p.calls, [['close', 'picker-overlay']]);
});

test('search combines with status and can jump to an ordinary tab', () => {
  const p = picker();
  p.key('w');
  p.key('/');
  p.type('dotfiles');
  assert.deepEqual(p.ids(), ['t0']);
  p.type('Claude');
  assert.deepEqual(p.ids(), []);
  p.submit();
  assert.deepEqual(p.calls, []);
  const other = picker();
  other.key('/');
  other.type('OTHER Terminal');
  assert.deepEqual(other.ids(), ['shell']);
  other.submit();
  assert.deepEqual(other.calls, [
    ['close', 'picker-overlay'], ['tab.select', { id: 'shell' }],
  ]);
});

test('space headings group results without becoming keyboard navigation targets', () => {
  const p = picker();
  p.world[1].name = 'dotfiles';
  const list = p.view.render().nodes.find(node => node.elementId === 'picker-list');
  assert.deepEqual(Array.from(list.nodes, node => node.elementId),
    ['space-s1', 'row-t0', 'row-t1', 'row-t2', 'row-t3', 'space-s2', 'row-shell']);
  p.key('k');
  p.view.render();
  assert.equal(p.scrolled.at(-1), 6);
  p.key('enter');
  assert.deepEqual(p.calls.at(-1), ['tab.select', { id: 'shell' }]);
});

test('status and text filters remove empty space groups', () => {
  const p = picker();
  p.key('w');
  let list = p.view.render().nodes.find(node => node.elementId === 'picker-list');
  assert.deepEqual(Array.from(list.nodes, node => node.elementId), ['space-s1', 'row-t0']);
  p.key('a');
  p.type('OTHER Terminal');
  list = p.view.render().nodes.find(node => node.elementId === 'picker-list');
  assert.deepEqual(Array.from(list.nodes, node => node.elementId), ['space-s2', 'row-shell']);
  assert.equal(p.scrolled.at(-1), 1);
});
