/**
 * Browser-bundle contract: evaluate lib/client.js against a fake window.__ModuleLoader__ and
 * a fake `require`, then check the loader call, the module shape, the registered section,
 * and the dictionaries.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const CLIENT_FILE = new URL('../lib/client.js', import.meta.url);
const code = readFileSync(CLIENT_FILE, 'utf8');

/** Collect the __ModuleLoader__.load calls of one evaluation. */
function evaluate() {
  const calls = [];
  const window = {
    __ModuleLoader__: {
      load(info) {
        calls.push(info);
      },
    },
  };
  const context = vm.createContext({ window, console, fetch: () => Promise.reject(new Error('no network in tests')) });
  vm.runInContext(code, context, { filename: 'lib/client.js' });
  return calls;
}

/** The platform seed modules this bundle is allowed to require. */
function fakeRequire(name) {
  if (name === 'react') {
    return {
      useState(initial) {
        return [initial, () => {}];
      },
      useEffect() {},
      useCallback(fn) {
        return fn;
      },
    };
  }
  if (name === 'react/jsx-runtime') {
    return {
      jsx(type, props) {
        return { type, props };
      },
    };
  }
  throw new Error('client bundle required an undeclared module: ' + name);
}

/** A context that records registrations and translates like the locale service. */
function fakeContext(language = 'en') {
  const dictionaries = {};
  const sections = [];
  const injected = [];
  let activeLanguage = language;

  const locale = {
    register(namespace, dictionary) {
      dictionaries[namespace] = dictionary;
      return () => {};
    },
    bind(namespace) {
      return (key) => {
        const dictionary = dictionaries[namespace] ?? {};
        const table = dictionary[activeLanguage] ?? dictionary.en ?? {};
        return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
      };
    },
  };

  const ctx = {
    locale,
    dictionaries,
    sections,
    injected,
    setLanguage(next) {
      activeLanguage = next;
    },
    effect(factory) {
      const disposer = factory();
      return () => (typeof disposer === 'function' ? disposer() : undefined);
    },
    slots: {
      inject(slotName, generator) {
        injected.push(slotName);
        const iterator = generator();
        const step = iterator.next();
        assert.equal(step.done, false, 'the generator must yield one registration');
        iterator.next();
        return () => {};
      },
      register(meta, component) {
        sections.push({ meta, component });
        return () => {};
      },
    },
  };
  return ctx;
}

test('client.js is a plain side-effect script: no top-level ESM statements', () => {
  const offenders = code
    .split('\n')
    .map((line, index) => ({ line: line.trim(), no: index + 1 }))
    .filter((entry) => /^(import|export)\s/.test(entry.line) || /^export\s*\{/.test(entry.line));
  assert.deepEqual(offenders, [], 'found top-level ESM statements');
});

test('client.js calls __ModuleLoader__.load exactly once, with the plugin id', () => {
  const calls = evaluate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'dsh-proxy-settings');
  assert.equal(typeof calls[0].factory, 'function');
});

test('factory(require) returns {name, inject, apply}; inject names slots and locale', () => {
  const module = evaluate()[0].factory(fakeRequire);
  assert.equal(module.name, 'dsh-proxy-settings');
  // The module comes from another realm, so compare the values rather than the array itself.
  assert.equal([...module.inject].sort().join(','), 'locale,slots');
  assert.equal(typeof module.apply, 'function');
});

test('apply(ctx) registers the dictionaries and one settings section', () => {
  const module = evaluate()[0].factory(fakeRequire);
  const ctx = fakeContext('en');
  module.apply(ctx);

  assert.deepEqual(ctx.injected, ['settings.section']);
  assert.equal(ctx.sections.length, 1);
  const { meta, component } = ctx.sections[0];
  assert.equal(meta.name, 'settings.section');
  assert.equal(meta.id, 'dsh-proxy-settings');
  assert.equal(typeof meta.order, 'number');
  assert.equal(meta.label(), 'Network proxy');
  assert.equal(typeof meta.inject, 'function');
  assert.deepEqual(Object.keys(meta.inject()), []);
  assert.equal(typeof component, 'function');
});

test('the en and zh dictionaries share one key set', () => {
  const module = evaluate()[0].factory(fakeRequire);
  const ctx = fakeContext('en');
  module.apply(ctx);

  const dictionary = ctx.dictionaries['dsh-proxy-settings'];
  assert.ok(dictionary.en, 'missing en dictionary');
  assert.ok(dictionary.zh, 'missing zh dictionary');
  const enKeys = Object.keys(dictionary.en).sort();
  const zhKeys = Object.keys(dictionary.zh).sort();
  assert.deepEqual(zhKeys, enKeys, 'zh must translate every en key');
  for (const key of enKeys) {
    assert.equal(typeof dictionary.en[key], 'string', 'en.' + key + ' must be a string');
    assert.ok(dictionary.en[key].length > 0, 'en.' + key + ' must not be empty');
    assert.ok(dictionary.zh[key].length > 0, 'zh.' + key + ' must not be empty');
  }
});

test('the section renders its title from the active locale', () => {
  const module = evaluate()[0].factory(fakeRequire);

  const english = fakeContext('en');
  module.apply(english);
  const enTree = english.sections[0].component({});
  assert.equal(enTree.type, 'div');
  assert.equal(enTree.props.children[0].type, 'h3');
  assert.equal(enTree.props.children[0].props.children, 'Network proxy');

  const chinese = fakeContext('zh');
  module.apply(chinese);
  const zhTree = chinese.sections[0].component({});
  assert.equal(zhTree.props.children[0].props.children, '网络代理');
  assert.equal(chinese.sections[0].meta.label(), '网络代理');
});
