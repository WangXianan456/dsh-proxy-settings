/**
 * dsh-proxy-settings — browser half (a plain classic script, no build step).
 *
 * Contract, matching the client bundles DSH ships:
 *   - This file is a side-effect script: at load time it only calls
 *     window.__ModuleLoader__.load({ id, factory }). No top-level import/export, and react
 *     comes from the `require` the factory receives.
 *   - factory(require) returns module.exports = { name, inject, apply }.
 *   - apply(ctx) registers one `settings.section` and its dictionary on `ctx.locale`.
 *   - The data plane is same-origin fetch against the Host routes; no Remote needed.
 */
;(function () {
  'use strict';

  var ROUTE = '/dsh-proxy-settings';
  var PLUGIN_ID = 'dsh-proxy-settings';
  var NS = PLUGIN_ID;

  /** Dictionaries; `register` requires both baseline locales. */
  var DICT = {
    en: {
      nav: 'Network proxy',
      title: 'Network proxy',
      intro:
        'Route the outbound HTTP(S) requests DSH makes — model calls, web search, and other tools — through a proxy. Saving applies it to this process immediately and writes it to $DSH_HOME/.env so the next start keeps it. Only http:// and https:// are accepted; SOCKS is not supported.',
      enable: 'Enable HTTP(S) proxy',
      addressLabel: 'Proxy address (http:// or https://)',
      addressPlaceholder: 'http://127.0.0.1:7890',
      noProxyLabel: 'NO_PROXY (optional; comma or space separated; loopback is always direct)',
      noProxyPlaceholder: 'localhost,127.0.0.1,::1,.internal',
      save: 'Save and apply',
      saving: 'Applying…',
      reload: 'Reload',
      fileConfigured: 'File: proxy configured',
      fileNone: 'File: no proxy entry',
      fileMissing: 'File: not created yet (created on save)',
      statusTitle: 'Live proxy state in this process',
      layerOn: 'Layer: on (already active in this process)',
      layerOff: 'Layer: off (already active in this process)',
      layerBaseline: 'Layer: as at startup (not changed on this page yet)',
      layerUnavailable: 'Layer: proxy library unavailable, no live switch',
      layerError: 'Layer: failed — ',
      routeProxied: 'Route: through the proxy at ',
      routeDirect: 'Route: direct',
      routeSample: ' (sample https://example.com/)',
      routeUnavailable: 'The proxy library is unavailable, so the route cannot be probed.',
      writeLocation: 'Written to $DSH_HOME/.env',
      libLabel: 'Proxy library: @deepseek-ai/dsh-http-proxy',
      libMissing: 'Proxy library unavailable. Tried: ',
      diagnostics: 'Proxy library diagnostics:',
      readFailed: 'Could not read the state',
      readFailedHint: ' (is the Host route running?)',
      saveOn: 'Proxy enabled and written to .env; it stays on after a restart.',
      saveOff: 'Proxy disabled and removed from .env.',
      warnLibMissing:
        'The proxy library is not available in this process, so the switch cannot apply live; the configuration was written to .env and takes effect at the next start.',
      warnLayerError: 'Installing the proxy policy failed.',
      'error.proxy.empty': 'A proxy address is required.',
      'error.proxy.newline': 'A proxy address must not contain a line break.',
      'error.proxy.hash': 'A proxy address must not contain "#".',
      'error.proxy.url': 'Not a valid URL.',
      'error.proxy.socks': 'SOCKS is not supported. Use an HTTP proxy port, for example http://127.0.0.1:7890.',
      'error.proxy.scheme': 'A proxy address must start with http:// or https://.',
      'error.proxy.host': 'A proxy address needs a host name.',
      'error.noproxy.newline': 'NO_PROXY must not contain a line break.',
      'error.noproxy.hash': 'NO_PROXY must not contain "#".',
      'error.write-failed': 'Writing .env failed.',
      'error.cross-origin': 'Cross-origin requests are not accepted.',
      'error.invalid-json': 'The request body is not valid JSON.',
      'error.invalid-request': 'The request body must be a JSON object.',
    },
    zh: {
      nav: '网络代理',
      title: '网络代理',
      intro:
        '为 DSH 的出站 HTTP(S) 请求（模型调用、联网搜索等工具）配置代理。保存后立刻在当前进程内生效，同时写入 $DSH_HOME/.env，下次启动继续生效。只接受 http:// 与 https://，不支持 socks。',
      enable: '启用 HTTP(S) 代理',
      addressLabel: '代理地址（http:// 或 https://）',
      addressPlaceholder: 'http://127.0.0.1:7890',
      noProxyLabel: 'NO_PROXY（可选，逗号或空格分隔；本机地址永远直连）',
      noProxyPlaceholder: 'localhost,127.0.0.1,::1,.internal',
      save: '保存并立即生效',
      saving: '应用中…',
      reload: '重新读取',
      fileConfigured: '文件：已配置代理',
      fileNone: '文件：无代理配置',
      fileMissing: '文件：尚不存在（保存后自动创建）',
      statusTitle: '当前进程内的实时代理状态',
      layerOn: '切换层：已开启（本进程内已实时生效）',
      layerOff: '切换层：已关闭（本进程内已实时生效）',
      layerBaseline: '切换层：与启动时一致（尚未在本页调整过）',
      layerUnavailable: '切换层：代理库不可用，无法实时切换',
      layerError: '切换层：出错 —— ',
      routeProxied: '实际路由：经代理 ',
      routeDirect: '实际路由：直连',
      routeSample: '（示例 https://example.com/）',
      routeUnavailable: '代理库不可用，无法探测当前路由。',
      writeLocation: '写入位置：$DSH_HOME/.env',
      libLabel: '代理库：@deepseek-ai/dsh-http-proxy',
      libMissing: '代理库不可用。已尝试：',
      diagnostics: '代理库诊断：',
      readFailed: '读取状态失败',
      readFailedHint: '（后端路由未就绪？）',
      saveOn: '已开启代理，并已写入 .env（下次启动仍然生效）。',
      saveOff: '已关闭代理，并已从 .env 移除代理配置。',
      warnLibMissing: '当前进程内找不到代理库，实时切换不可用；配置已写入 .env，下次启动 DSH 时生效。',
      warnLayerError: '安装代理策略失败。',
      'error.proxy.empty': '代理地址不能为空。',
      'error.proxy.newline': '代理地址不能包含换行。',
      'error.proxy.hash': '代理地址不能包含 #。',
      'error.proxy.url': '代理地址不是合法 URL。',
      'error.proxy.socks': '不支持 socks 代理。请改用 HTTP 代理端口，例如 http://127.0.0.1:7890。',
      'error.proxy.scheme': '代理地址必须以 http:// 或 https:// 开头。',
      'error.proxy.host': '代理地址缺少主机名。',
      'error.noproxy.newline': 'NO_PROXY 不能包含换行。',
      'error.noproxy.hash': 'NO_PROXY 不能包含 #。',
      'error.write-failed': '写入 .env 失败。',
      'error.cross-origin': '不接受跨源请求。',
      'error.invalid-json': '请求体不是合法 JSON。',
      'error.invalid-request': '请求体必须是 JSON 对象。',
    },
  };

  /** require('react') / require('react/jsx-runtime') come from the platform seed modules. */
  function makeFactory(require) {
    var React = require('react');
    var jsx = require('react/jsx-runtime').jsx;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    var inputStyle = {
      boxSizing: 'border-box',
      width: '100%',
      minHeight: 28,
      padding: '4px 10px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
      outline: 'none',
    };
    var labelStyle = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' };
    var cardStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '12px 14px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 12,
    };
    var primaryButton = {
      border: '1px solid var(--dsw-alias-button-info-fill)',
      background: 'var(--dsw-alias-button-info-fill)',
      color: '#fff',
      borderRadius: 8,
      padding: '4px 14px',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '20px',
      cursor: 'pointer',
    };
    var secondaryButton = {
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: 8,
      padding: '4px 14px',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '20px',
      cursor: 'pointer',
    };
    var mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';

    /** JSON request wrapper: a non-2xx answer surfaces its code and message. */
    function request(path, options) {
      return fetch(ROUTE + path, options).then(function (response) {
        return response.json().then(
          function (body) {
            if (!response.ok || body.ok === false) {
              var error = new Error(body.message || 'HTTP ' + response.status);
              error.body = body;
              throw error;
            }
            return body;
          },
          function () {
            throw new Error('HTTP ' + response.status);
          },
        );
      });
    }

    /** Localized text for a structured error, falling back to the server message. */
    function errorText(t, error) {
      var body = error && error.body ? error.body : {};
      var key = 'error.' + (body.reason || body.code || '');
      var text = t(key);
      if (text !== key) return text;
      return body.message || error.message;
    }

    /** Live layer → a sentence. */
    function layerText(t, live) {
      if (!live) return t('layerUnavailable');
      if (live.layer === 'on') return t('layerOn');
      if (live.layer === 'off') return t('layerOff');
      if (live.layer === 'baseline') return t('layerBaseline');
      if (live.layer === 'unavailable') return t('layerUnavailable');
      if (live.layer === 'error') return t('layerError') + (live.error || '');
      return String(live.layer);
    }

    /** The "Network proxy" settings section. */
    function ProxySection() {
      var stateBox = useState({ loading: true, error: null, data: null });
      var loaded = stateBox[0];
      var setLoaded = stateBox[1];

      var draftBox = useState({ enabled: false, proxyUrl: '', noProxy: '' });
      var draft = draftBox[0];
      var setDraft = draftBox[1];

      var busyBox = useState(false);
      var busy = busyBox[0];
      var setBusy = busyBox[1];

      var messageBox = useState(null);
      var message = messageBox[0];
      var setMessage = messageBox[1];

      var t = boundT;

      var refresh = useCallback(function () {
        setLoaded(function (previous) {
          return { loading: true, error: previous.error, data: previous.data };
        });
        request('/state')
          .then(function (data) {
            setLoaded({ loading: false, error: null, data: data });
            setDraft({
              enabled: data.envFile.enabled === true,
              proxyUrl: data.envFile.proxyUrl || '',
              noProxy: data.envFile.noProxy || '',
            });
          })
          .catch(function (error) {
            setLoaded({ loading: false, error: error.message, data: null });
          });
      }, []);

      useEffect(function () {
        refresh();
      }, [refresh]);

      var submit = useCallback(
        function () {
          setBusy(true);
          setMessage(null);
          request('/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: draft.enabled, proxyUrl: draft.proxyUrl, noProxy: draft.noProxy }),
          })
            .then(function (data) {
              setLoaded({ loading: false, error: null, data: data });
              var warnings = data.warnings || [];
              var warnText = warnings
                .map(function (code) {
                  return code === 'proxy-lib-missing' ? t('warnLibMissing') : t('warnLayerError');
                })
                .join(' ');
              setMessage({
                kind: warnings.length === 0 ? 'ok' : 'warn',
                text: (draft.enabled ? t('saveOn') : t('saveOff')) + (warnText === '' ? '' : ' ' + warnText),
              });
            })
            .catch(function (error) {
              setMessage({ kind: 'error', text: errorText(t, error) });
            })
            .then(function () {
              setBusy(false);
            });
        },
        [draft],
      );

      var data = loaded.data;
      var live = data ? data.live : null;
      var file = data ? data.envFile : null;
      var effective = live && live.effective ? live.effective : null;

      return jsx('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxWidth: 720,
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13,
          lineHeight: '20px',
        },
        children: [
          jsx('h3', { key: 'title', style: { margin: 0, fontSize: 16, fontWeight: 500 }, children: t('title') }),
          jsx('p', {
            key: 'intro',
            style: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
            children: t('intro'),
          }),
          loaded.error
            ? jsx('div', {
                key: 'loaderr',
                style: {
                  ...cardStyle,
                  borderColor: 'var(--dsw-alias-state-error-secondary)',
                  color: 'var(--dsw-alias-state-error-primary)',
                },
                children: [t('readFailed') + '：' + loaded.error + t('readFailedHint')],
              })
            : null,
          jsx('div', {
            key: 'form',
            style: cardStyle,
            children: [
              jsx('label', {
                key: 'toggle',
                style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
                children: [
                  jsx('input', {
                    key: 'cb',
                    type: 'checkbox',
                    checked: draft.enabled === true,
                    disabled: busy,
                    style: {
                      width: 16,
                      height: 16,
                      accentColor: 'var(--dsw-alias-state-business-primary)',
                      cursor: 'pointer',
                    },
                    onChange: function (event) {
                      setDraft({ enabled: event.target.checked, proxyUrl: draft.proxyUrl, noProxy: draft.noProxy });
                    },
                  }),
                  jsx('span', { key: 'txt', children: t('enable') }),
                ],
              }),
              jsx('div', {
                key: 'url',
                style: { display: 'flex', flexDirection: 'column', gap: 4 },
                children: [
                  jsx('span', { key: 'l', style: labelStyle, children: t('addressLabel') }),
                  jsx('input', {
                    key: 'i',
                    type: 'text',
                    value: draft.proxyUrl,
                    disabled: busy || draft.enabled !== true,
                    placeholder: t('addressPlaceholder'),
                    spellCheck: false,
                    style: inputStyle,
                    onChange: function (event) {
                      setDraft({ enabled: draft.enabled, proxyUrl: event.target.value, noProxy: draft.noProxy });
                    },
                  }),
                ],
              }),
              jsx('div', {
                key: 'nop',
                style: { display: 'flex', flexDirection: 'column', gap: 4 },
                children: [
                  jsx('span', { key: 'l', style: labelStyle, children: t('noProxyLabel') }),
                  jsx('input', {
                    key: 'i',
                    type: 'text',
                    value: draft.noProxy,
                    disabled: busy || draft.enabled !== true,
                    placeholder: t('noProxyPlaceholder'),
                    spellCheck: false,
                    style: inputStyle,
                    onChange: function (event) {
                      setDraft({ enabled: draft.enabled, proxyUrl: draft.proxyUrl, noProxy: event.target.value });
                    },
                  }),
                ],
              }),
              jsx('div', {
                key: 'actions',
                style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 },
                children: [
                  jsx('button', {
                    key: 'save',
                    type: 'button',
                    disabled: busy,
                    style: busy ? { ...primaryButton, opacity: 0.5, cursor: 'default' } : primaryButton,
                    onClick: submit,
                    children: busy ? t('saving') : t('save'),
                  }),
                  jsx('button', {
                    key: 'reload',
                    type: 'button',
                    disabled: busy,
                    style: secondaryButton,
                    onClick: refresh,
                    children: t('reload'),
                  }),
                  data
                    ? jsx('span', {
                        key: 'file',
                        style: { marginLeft: 4, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
                        children: file.exists ? (file.enabled ? t('fileConfigured') : t('fileNone')) : t('fileMissing'),
                      })
                    : null,
                ],
              }),
              message
                ? jsx('p', {
                    key: 'msg',
                    style: {
                      margin: 0,
                      fontSize: 12,
                      lineHeight: '18px',
                      color:
                        message.kind === 'error'
                          ? 'var(--dsw-alias-state-error-primary)'
                          : message.kind === 'warn'
                            ? 'var(--dsw-alias-label-primary)'
                            : 'var(--dsw-alias-state-success-primary)',
                    },
                    children: message.text,
                  })
                : null,
            ],
          }),
          data
            ? jsx('div', {
                key: 'status',
                style: cardStyle,
                children: [
                  jsx('div', { key: 'h', style: { fontSize: 13, fontWeight: 500 }, children: t('statusTitle') }),
                  jsx('div', { key: 'layer', style: { fontSize: 12, lineHeight: '18px' }, children: layerText(t, live) }),
                  jsx('div', {
                    key: 'effective',
                    style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
                    children:
                      effective === null
                        ? t('routeUnavailable')
                        : effective.proxied
                          ? t('routeProxied') + effective.proxy + t('routeSample')
                          : t('routeDirect') + t('routeSample') + (effective.error ? '; ' + effective.error : ''),
                  }),
                  data.home
                    ? jsx('div', {
                        key: 'home',
                        style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
                        children: t('writeLocation'),
                      })
                    : null,
                  data.lib && data.lib.available
                    ? jsx('div', {
                        key: 'lib',
                        style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', wordBreak: 'break-all' },
                        children: t('libLabel') + (data.lib.version ? '@' + data.lib.version : ''),
                      })
                    : jsx('div', {
                        key: 'libbad',
                        style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-all' },
                        children: t('libMissing') + ((data.lib && data.lib.tried) || []).join(' / '),
                      }),
                  live && (live.diagnostics || []).length > 0
                    ? jsx('div', {
                        key: 'diag',
                        style: {
                          fontSize: 12,
                          lineHeight: '18px',
                          color: 'var(--dsw-alias-state-error-primary)',
                          whiteSpace: 'pre-wrap',
                          fontFamily: mono,
                        },
                        children: t('diagnostics') + '\n' + live.diagnostics.join('\n'),
                      })
                    : null,
                  live && live.error
                    ? jsx('div', {
                        key: 'liveerr',
                        style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
                        children: live.error,
                      })
                    : null,
                ],
              })
            : null,
        ],
      });
    }

    /** Bound translator, created when the plugin applies. */
    var boundT = null;

    function applyPlugin(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, DICT);
      }, 'dsh-proxy-settings: locale');
      var t = ctx.locale.bind(NS);
      boundT = t;
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.section',
            id: PLUGIN_ID,
            order: 60,
            label: function () {
              return t('nav');
            },
            inject: function () {
              return {};
            },
          },
          ProxySection,
        );
      });
    }

    return { name: PLUGIN_ID, inject: ['slots', 'locale'], apply: applyPlugin };
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({ id: PLUGIN_ID, factory: makeFactory });
  }
})();
