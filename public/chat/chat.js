(function () {
  var container = document.getElementById('messages');

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function escapeText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Feather-style icons; stroke inherits color so they pick up text color.
  var ICON_COPY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
  var ICON_FORK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 17h-8l-3.5-5h-6.5"></path><path d="M21 7h-8l-3.495 5"></path><path d="M18 10l3-3-3-3"></path><path d="M18 20l3-3-3-3"></path></svg>';
  var ICON_EXPAND = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';

  var ICON_CHEVRON_UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>';

  var todoRunsById = {};
  var chatUi = window.CRAgentChatUtils || {};
  var verboseThinking = false;
  var currentSessionId = '';
  var currentSessionModelId = '';
  var pendingSessionSwitch = false;
  var thinkingOpenState = {};
  var messageExpandState = {};
  var planContext = { active: false };
  var planPreviewTarget = { messageId: null, runId: null };
  var PLAN_PREVIEW_MAX_HEIGHT = 280;

  function planPreviewMessage(msg) {
    return {
      plan_file_path: (msg && msg.plan_file_path) || planContext.displayPath || '',
      plan_session_id: (msg && msg.plan_session_id) || planContext.sessionId || '',
    };
  }

  function hasPlanPreviewContent() {
    return Boolean(planContext.active && planContext.content && String(planContext.content).trim());
  }

  function shouldShowPlanPreview(msg, runId) {
    if (!hasPlanPreviewContent()) return false;
    if (msg && msg.plan_file_path) {
      if (planPreviewTarget.messageId && msg.id === planPreviewTarget.messageId) return true;
    }
    if (runId && planPreviewTarget.runId && runId === planPreviewTarget.runId) return true;
    return false;
  }

  function renderPlanFileBannerElement(msg) {
    if (!msg || !msg.plan_file_path) {
      return null;
    }
    var wrap = document.createElement('div');
    wrap.className = 'plan-file-banner';
    wrap.innerHTML =
      '<span class="plan-file-banner-label">Plan</span>' +
      '<button type="button" class="plan-file-link" data-action="open-plan" data-session-id="' +
      escapeAttr(msg.plan_session_id || '') +
      '" title="在编辑器中打开计划文件">' +
      escapeText(msg.plan_file_path) +
      '</button>';
    return wrap;
  }

  function setupPlanPreviewTruncation(card) {
    if (!card || card.classList.contains('is-card-collapsed')) return;
    var bodyWrap = card.querySelector('.plan-preview-body-wrap');
    var body = card.querySelector('.plan-preview-body');
    var expandBtn = card.querySelector('.plan-preview-expand-btn');
    if (!bodyWrap || !body || !expandBtn) return;

    bodyWrap.classList.remove('is-truncated');
    expandBtn.hidden = true;
    if (body.scrollHeight > PLAN_PREVIEW_MAX_HEIGHT) {
      bodyWrap.classList.add('is-truncated');
      expandBtn.hidden = false;
    }
  }

  function buildPlanPreviewCard(msg, content) {
    var planMsg = planPreviewMessage(msg);
    var wrap = document.createElement('div');
    wrap.className = 'plan-preview-card';
    wrap.dataset.planSession = planMsg.plan_session_id || '';

    var header = document.createElement('div');
    header.className = 'plan-preview-header';
    header.innerHTML =
      '<span class="plan-preview-title">编写计划</span>' +
      '<div class="plan-preview-header-actions">' +
        (planMsg.plan_file_path
          ? '<button type="button" class="plan-preview-file-link" data-action="open-plan" data-session-id="' +
            escapeAttr(planMsg.plan_session_id || '') +
            '" title="在编辑器中打开计划文件">' +
            escapeText(planMsg.plan_file_path) +
            '</button>'
          : '') +
        '<button type="button" class="plan-preview-collapse-btn" aria-expanded="true" aria-label="收起计划">' +
          ICON_CHEVRON_UP +
        '</button>' +
      '</div>';

    var bodyWrap = document.createElement('div');
    bodyWrap.className = 'plan-preview-body-wrap';

    var body = document.createElement('div');
    body.className = 'plan-preview-body';
    body.innerHTML = window.MD.render(content || '');
    bodyWrap.appendChild(body);

    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'plan-preview-expand-btn';
    expandBtn.textContent = '展开计划';
    expandBtn.hidden = true;
    bodyWrap.appendChild(expandBtn);

    wrap.appendChild(header);
    wrap.appendChild(bodyWrap);

    header.querySelector('.plan-preview-collapse-btn').addEventListener('click', function () {
      var collapsed = wrap.classList.toggle('is-card-collapsed');
      var btn = header.querySelector('.plan-preview-collapse-btn');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? '展开计划卡片' : '收起计划');
    });

    expandBtn.addEventListener('click', function () {
      bodyWrap.classList.remove('is-truncated');
      expandBtn.hidden = true;
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setupPlanPreviewTruncation(wrap);
      });
    });

    return wrap;
  }

  function prependPlanSection(bubble, msg, options) {
    options = options || {};
    var showPreview = options.showPreview && hasPlanPreviewContent();
    if (showPreview) {
      bubble.insertBefore(buildPlanPreviewCard(msg, planContext.content), bubble.firstChild);
      return;
    }
    var banner = renderPlanFileBannerElement(msg);
    if (banner) {
      bubble.insertBefore(banner, bubble.firstChild);
    }
  }

  function prependPlanBanner(bubble, msg) {
    prependPlanSection(bubble, msg, { showPreview: false });
  }

  function findPlanPreviewTarget(messages) {
    var lastUserRunIndex = findLastActiveRunUserIndex(messages);
    if (lastUserRunIndex >= 0) {
      var collected = collectRunMessagesForUser(messages, lastUserRunIndex);
      var split = splitRunMessages(collected.runMessages);
      return {
        messageId: split.finalReply && split.finalReply.id ? split.finalReply.id : null,
        runId: collected.runId || null,
      };
    }
    for (var i = messages.length - 1; i >= 0; i -= 1) {
      var msg = messages[i];
      if (
        msg.role === 'assistant' &&
        msg.plan_file_path &&
        String(msg.content || '').trim()
      ) {
        return { messageId: msg.id, runId: msg.run_id || null };
      }
    }
    return { messageId: null, runId: null };
  }

  function refreshPlanPreviewCards() {
    if (!hasPlanPreviewContent()) {
      container.querySelectorAll('.plan-preview-card').forEach(function (card) {
        card.remove();
      });
      return;
    }

    var cards = container.querySelectorAll('.plan-preview-card');
    if (cards.length) {
      cards.forEach(function (card) {
        var body = card.querySelector('.plan-preview-body');
        if (body) {
          body.innerHTML = window.MD.render(planContext.content || '');
          postProcessRenderedContent(body);
        }
        setupPlanPreviewTruncation(card);
      });
      return;
    }

    var turns = container.querySelectorAll('.assistant-turn');
    if (!turns.length) return;
    var turn = turns[turns.length - 1];
    var bubble = turn.querySelector('.bubble');
    if (!bubble) return;

    var banner = bubble.querySelector('.plan-file-banner');
    if (banner) banner.remove();

    bubble.insertBefore(
      buildPlanPreviewCard(planPreviewMessage(null), planContext.content),
      bubble.firstChild,
    );
    postProcessRenderedContent(bubble);
  }
  var hljsLoadPromise = null;
  var katexLoadPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.body.appendChild(script);
    });
  }

  function loadHighlightScript() {
    if (window.hljs) {
      return Promise.resolve();
    }
    if (hljsLoadPromise) {
      return hljsLoadPromise;
    }
    hljsLoadPromise = loadScript('highlight/highlight.min.js').catch(function () {
      hljsLoadPromise = null;
    });
    return hljsLoadPromise;
  }

  function loadKatexScripts() {
    if (typeof renderMathInElement === 'function') {
      return Promise.resolve();
    }
    if (katexLoadPromise) {
      return katexLoadPromise;
    }
    katexLoadPromise = loadScript('katex/katex.min.js')
      .then(function () {
        return loadScript('katex/auto-render.min.js');
      })
      .catch(function () {
        katexLoadPromise = null;
      });
    return katexLoadPromise;
  }

  var MATH_DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false }
  ];

  function typesetMath(el) {
    if (!el) return;
    if (typeof renderMathInElement !== 'function') {
      if (!/\$|\\\(|\\\[/.test(el.textContent || '')) return;
      loadKatexScripts()
        .then(function () {
          typesetMath(el);
        })
        .catch(function () {});
      return;
    }
    renderMathInElement(el, {
      delimiters: MATH_DELIMITERS,
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    });
  }

  var mermaidReady = false;
  var mermaidModalEl = null;
  var mermaidLoadPromise = null;

  function loadMermaidScript() {
    if (window.mermaid) {
      return Promise.resolve();
    }
    if (mermaidLoadPromise) {
      return mermaidLoadPromise;
    }
    mermaidLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'mermaid/mermaid.min.js';
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        mermaidLoadPromise = null;
        reject(new Error('Failed to load mermaid'));
      };
      document.body.appendChild(script);
    });
    return mermaidLoadPromise;
  }

  function mermaidIsDark() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function mermaidThemeConfig() {
    if (mermaidIsDark()) {
      return {
        theme: 'base',
        themeVariables: {
          primaryColor: '#262626',
          primaryTextColor: '#e4e4e4',
          primaryBorderColor: '#555',
          lineColor: '#888',
          secondaryColor: '#1e1e1e',
          tertiaryColor: '#181818',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px'
        }
      };
    }
    return {
      theme: 'base',
      themeVariables: {
        primaryColor: '#f3f3f3',
        primaryTextColor: '#141414',
        primaryBorderColor: '#d4d4d4',
        lineColor: '#888',
        secondaryColor: '#fafafa',
        tertiaryColor: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px'
      }
    };
  }

  function ensureMermaid() {
    if (!window.mermaid || mermaidReady) return;
    var cfg = mermaidThemeConfig();
    window.mermaid.initialize({
      startOnLoad: false,
      theme: cfg.theme,
      themeVariables: cfg.themeVariables,
      flowchart: { curve: 'basis', padding: 16 },
      securityLevel: 'strict'
    });
    mermaidReady = true;
  }

  var mermaidLazyObserver = null;
  var mermaidLazyPending = new Set();
  var mermaidLazyFlushScheduled = false;
  var MERMAID_LAZY_ROOT_MARGIN = '240px 0px';
  var MERMAID_LAZY_BATCH_SIZE = 2;

  function markMermaidRendered(nodes) {
    nodes.forEach(function (node) {
      node.setAttribute('data-mermaid-done', '1');
      node.removeAttribute('data-mermaid-lazy');
      var card = node.closest('.mermaid-diagram-card');
      if (card) {
        card.classList.remove('mermaid-lazy-pending');
      }
    });
  }

  function typesetMermaidNodes(nodes) {
    if (!nodes.length) return Promise.resolve();
    return loadMermaidScript()
      .then(function () {
        if (!window.mermaid) return;
        ensureMermaid();
        var result = window.mermaid.run({ nodes: nodes, suppressErrors: true });
        var finish = function () {
          markMermaidRendered(nodes);
          enhanceMermaidDiagrams(container);
        };
        if (result && typeof result.then === 'function') {
          return result.then(finish).catch(finish);
        }
        finish();
      })
      .catch(function () {});
  }

  function disconnectLazyMermaid() {
    if (mermaidLazyObserver) {
      mermaidLazyObserver.disconnect();
      mermaidLazyObserver = null;
    }
    mermaidLazyPending.clear();
    mermaidLazyFlushScheduled = false;
  }

  function flushLazyMermaidBatch() {
    mermaidLazyFlushScheduled = false;
    if (!mermaidLazyPending.size) return;
    var pending = Array.from(mermaidLazyPending);
    mermaidLazyPending.clear();
    var batch = pending.slice(0, MERMAID_LAZY_BATCH_SIZE);
    var remainder = pending.slice(MERMAID_LAZY_BATCH_SIZE);
    remainder.forEach(function (node) {
      mermaidLazyPending.add(node);
    });
    typesetMermaidNodes(batch).finally(function () {
      if (mermaidLazyPending.size) {
        scheduleLazyMermaidFlush();
      }
    });
  }

  function scheduleLazyMermaidFlush() {
    if (mermaidLazyFlushScheduled) return;
    mermaidLazyFlushScheduled = true;
    var run = function () {
      flushLazyMermaidBatch();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 120 });
    } else {
      setTimeout(run, 0);
    }
  }

  function ensureLazyMermaidObserver() {
    if (mermaidLazyObserver) return;
    mermaidLazyObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var node = entry.target;
          mermaidLazyObserver.unobserve(node);
          mermaidLazyPending.add(node);
        });
        if (mermaidLazyPending.size) {
          scheduleLazyMermaidFlush();
        }
      },
      { root: null, rootMargin: MERMAID_LAZY_ROOT_MARGIN, threshold: 0 },
    );
  }

  function observeMermaidLazy(root) {
    if (!root) return Promise.resolve();
    if (typeof IntersectionObserver !== 'function') {
      return typesetMermaidNodes(
        Array.from(root.querySelectorAll('.mermaid:not([data-mermaid-done])')),
      );
    }
    var nodes = root.querySelectorAll('.mermaid:not([data-mermaid-done]):not([data-mermaid-lazy])');
    if (!nodes.length) return;
    ensureLazyMermaidObserver();
    nodes.forEach(function (node) {
      node.setAttribute('data-mermaid-lazy', '1');
      var card = node.closest('.mermaid-diagram-card');
      if (card) {
        card.classList.add('mermaid-lazy-pending');
      }
      mermaidLazyObserver.observe(node);
    });
  }

  function typesetMermaid(root) {
    observeMermaidLazy(root);
  }

  function highlightCodeBlocks(root) {
    if (!root || !root.querySelector('pre code')) return;
    loadHighlightScript()
      .then(function () {
        if (!window.hljs) return;
        root.querySelectorAll('pre code').forEach(function (block) {
          if (block.closest('.mermaid-diagram-card')) return;
          if (block.dataset.hljsDone === '1') return;
          try {
            window.hljs.highlightElement(block);
            block.dataset.hljsDone = '1';
          } catch (_) {}
        });
      })
      .catch(function () {});
  }

  function enhanceMermaidDiagrams(root) {
    if (!root) return;
    root.querySelectorAll('.mermaid-diagram-card').forEach(function (card) {
      if (card.querySelector('.mermaid-diagram-toolbar')) return;
      var toolbar = document.createElement('div');
      toolbar.className = 'mermaid-diagram-toolbar';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'icon-btn mermaid-diagram-btn';
      copyBtn.dataset.action = 'copy-mermaid';
      copyBtn.title = '复制 Mermaid 源码';
      copyBtn.setAttribute('aria-label', '复制 Mermaid 源码');
      copyBtn.innerHTML = ICON_COPY;
      var expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'icon-btn mermaid-diagram-btn';
      expandBtn.dataset.action = 'expand-mermaid';
      expandBtn.title = '放大查看';
      expandBtn.setAttribute('aria-label', '放大查看');
      expandBtn.innerHTML = ICON_EXPAND;
      toolbar.appendChild(copyBtn);
      toolbar.appendChild(expandBtn);
      card.insertBefore(toolbar, card.firstChild);
    });
  }

  function mermaidSourceFromCard(card) {
    var pre = card && card.querySelector('.mermaid-source');
    return (pre && pre.textContent) || '';
  }

  function openMermaidModal(card) {
    var svg = card && card.querySelector('.mermaid svg');
    if (!svg) return;
    if (!mermaidModalEl) {
      mermaidModalEl = document.createElement('div');
      mermaidModalEl.className = 'mermaid-modal';
      mermaidModalEl.innerHTML =
        '<div class="mermaid-modal-backdrop"></div>' +
        '<div class="mermaid-modal-panel" role="dialog" aria-modal="true">' +
          '<button type="button" class="mermaid-modal-close icon-btn" data-action="close-mermaid-modal" aria-label="关闭">×</button>' +
          '<div class="mermaid-modal-body"></div>' +
        '</div>';
      document.body.appendChild(mermaidModalEl);
    }
    var body = mermaidModalEl.querySelector('.mermaid-modal-body');
    body.innerHTML = '';
    body.appendChild(svg.cloneNode(true));
    mermaidModalEl.classList.add('is-open');
  }

  function closeMermaidModal() {
    if (mermaidModalEl) mermaidModalEl.classList.remove('is-open');
  }

  var batchPostProcess = false;

  function postProcessRenderedContent(root) {
    if (!root || batchPostProcess) return;
    typesetMath(root);
    highlightCodeBlocks(root);
    enhanceCodeCopyButtons(root);
    typesetMermaid(root);
  }

  function preText(pre) {
    var code = pre.querySelector('code');
    return (code ? code.textContent : pre.textContent) || '';
  }

  function enhanceCodeCopyButtons(root) {
    if (!root) return;
    root.querySelectorAll('pre').forEach(function (pre) {
      if (pre.closest('.code-block') || pre.closest('.mermaid-diagram-card')) return;
      var wrap = document.createElement('div');
      wrap.className = 'code-block';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn icon-btn';
      btn.dataset.action = 'copy-code';
      btn.title = '复制';
      btn.setAttribute('aria-label', '复制代码');
      btn.innerHTML = ICON_COPY;
      wrap.appendChild(btn);
    });
  }

  function flashCopied(btn, durationMs) {
    if (!btn || btn.classList.contains('copied')) return;
    var origHtml = btn.innerHTML;
    var origTitle = btn.title;
    var origAria = btn.getAttribute('aria-label');
    btn.innerHTML = ICON_CHECK;
    btn.classList.add('copied');
    btn.title = '已复制';
    btn.setAttribute('aria-label', '已复制');
    setTimeout(function () {
      btn.innerHTML = origHtml;
      btn.classList.remove('copied');
      btn.title = origTitle || '复制';
      btn.setAttribute('aria-label', origAria || '复制');
    }, durationMs == null ? 1500 : durationMs);
  }

  function getCopyableTextFromBubble(bubbleEl) {
    if (!bubbleEl) return '';
    var turnContent = bubbleEl.querySelector('.assistant-turn-content');
    if (turnContent) return turnContent.innerText.trim();
    var body = bubbleEl.querySelector('.bubble-collapse-body');
    if (body) return body.innerText.trim();
    var userBody = bubbleEl.querySelector('.msg-user-body');
    if (userBody) return userBody.innerText.trim();
    var msgText = bubbleEl.querySelector('.msg-text');
    if (msgText) return msgText.innerText.trim();
    var clone = bubbleEl.cloneNode(true);
    clone.querySelectorAll('.thinking-block, .thinking, .bubble-collapse-toggle').forEach(function (node) {
      node.remove();
    });
    return clone.innerText.trim();
  }

  var COLLAPSED_MAX_HEIGHT = 320;

  function messageExpandStateStorageKey() {
    return 'cragent:message-expanded:v2:' + (currentSessionId || 'default');
  }

  function loadMessageExpandState() {
    try {
      var raw = sessionStorage.getItem(messageExpandStateStorageKey());
      var parsed = raw ? JSON.parse(raw) : {};
      messageExpandState = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      messageExpandState = {};
    }
  }

  function saveMessageExpandState() {
    try {
      sessionStorage.setItem(messageExpandStateStorageKey(), JSON.stringify(messageExpandState));
    } catch (_) {}
  }

  function messageContentKey(msgEl) {
    if (!msgEl) return '';
    if (msgEl.dataset.id) return 'msg:' + msgEl.dataset.id;
    if (msgEl.dataset.runId) return 'run:' + msgEl.dataset.runId;
    return '';
  }

  function hasOwnStateValue(state, key) {
    return Boolean(key && Object.prototype.hasOwnProperty.call(state, key));
  }

  function shouldExpandMessageContent(msgEl) {
    var key = messageContentKey(msgEl);
    if (hasOwnStateValue(messageExpandState, key)) {
      return Boolean(messageExpandState[key]);
    }
    return Boolean(msgEl && msgEl.dataset.expandContent === '1');
  }

  function setMessageContentExpanded(msgEl, expanded) {
    var key = messageContentKey(msgEl);
    if (!key) return;
    messageExpandState[key] = Boolean(expanded);
    saveMessageExpandState();
  }

  function setBubbleCollapseExpanded(wrap, expanded) {
    if (!wrap) return;
    if (expanded) {
      wrap.classList.remove('is-collapsed');
    } else {
      wrap.classList.add('is-collapsed');
    }
    var toggle = wrap.querySelector('.bubble-collapse-toggle');
    if (toggle) {
      toggle.textContent = expanded ? '收起' : '展开全文';
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  function applyDefaultExpandToLastMessage() {
    var allMsgs = container.querySelectorAll('.msg');
    allMsgs.forEach(function (el) {
      delete el.dataset.expandContent;
    });
    var last = allMsgs[allMsgs.length - 1];
    if (!last) return;
    last.dataset.expandContent = '1';
    setBubbleCollapseExpanded(last.querySelector('.bubble-collapse'), shouldExpandMessageContent(last));
  }

  function setupCollapsibleContent(contentEl) {
    if (!contentEl) return;

    function attach() {
      if (contentEl.closest('.bubble-collapse')) return;
      if (contentEl.scrollHeight <= COLLAPSED_MAX_HEIGHT) return;

      var msgEl = contentEl.closest('.msg');
      var expandByDefault = shouldExpandMessageContent(msgEl);

      var wrap = document.createElement('div');
      wrap.className = 'bubble-collapse' + (expandByDefault ? '' : ' is-collapsed');
      var parent = contentEl.parentNode;
      parent.insertBefore(wrap, contentEl);
      wrap.appendChild(contentEl);
      contentEl.classList.add('bubble-collapse-body');

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'bubble-collapse-toggle';
      toggle.textContent = expandByDefault ? '收起' : '展开全文';
      toggle.setAttribute('aria-expanded', expandByDefault ? 'true' : 'false');
      toggle.addEventListener('click', function () {
        var collapsed = wrap.classList.toggle('is-collapsed');
        toggle.textContent = collapsed ? '展开全文' : '收起';
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        setMessageContentExpanded(msgEl, !collapsed);
      });
      wrap.appendChild(toggle);
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(attach);
    });
  }

  function isProcessMessage(msg) {
    if (!msg) return false;
    if (msg.role === 'tool') return true;
    return msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0;
  }

  function hasVisibleAssistantContent(msg) {
    if (!msg || msg.role !== 'assistant') return false;
    return String(msg.content || '').trim().length > 0 || Boolean(msg.images && msg.images.length);
  }

  function thinkingStateStorageKey() {
    return 'cragent:thinking-open:' + (currentSessionId || 'default');
  }

  function loadThinkingOpenState() {
    try {
      var raw = sessionStorage.getItem(thinkingStateStorageKey());
      var parsed = raw ? JSON.parse(raw) : {};
      thinkingOpenState = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      thinkingOpenState = {};
    }
  }

  function saveThinkingOpenState() {
    try {
      sessionStorage.setItem(thinkingStateStorageKey(), JSON.stringify(thinkingOpenState));
    } catch (_) {}
  }

  function thinkingGroupKey(scopeId) {
    return String(scopeId || 'unknown') + ':group';
  }

  function thinkingStepKey(scopeId, index, item) {
    var base = String(scopeId || 'unknown') + ':step:' + index;
    if (item && item.kind) {
      base += ':' + item.kind;
    }
    if (item && item.name) {
      base += ':' + item.name;
    }
    return base;
  }

  function isThinkingOpen(key) {
    return Boolean(thinkingOpenState[key]);
  }

  function setThinkingOpen(key, open) {
    if (!key) return;
    if (open) {
      thinkingOpenState[key] = true;
    } else {
      delete thinkingOpenState[key];
    }
    saveThinkingOpenState();
  }

  function applyThinkingOpenState(root) {
    var scope = root || container;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('details.thinking-group, details.thinking-step').forEach(function (el) {
      var key = el.dataset.thinkingKey;
      if (key && isThinkingOpen(key)) {
        el.open = true;
      }
    });
  }

  function resolveThinkingScopeId(runId, thinkingIds) {
    if (runId) return runId;
    if (thinkingIds && thinkingIds.length) return thinkingIds.join(',');
    return 'unknown';
  }

  function buildRunThinking(messages) {
    if (chatUi.buildThinkingSummary) {
      return chatUi.buildThinkingSummary(messages, { verbose: verboseThinking });
    }
    var items = [];
    var ids = [];
    (messages || []).forEach(function (msg) {
      if (msg && msg.id) ids.push(msg.id);
      if (msg.role === 'tool') {
        items.push({ kind: 'tool-result', name: msg.name || '', content: msg.content || '' });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.forEach(function (call) {
          items.push({
            kind: 'tool-call',
            name: call.name || 'tool',
            arguments: call.arguments || ''
          });
        });
      }
    });
    var stepCount = items.length;
    return {
      summaryLine: 'Thinking · ' + stepCount + ' step' + (stepCount === 1 ? '' : 's'),
      items: items,
      ids: ids,
      stepCount: stepCount
    };
  }

  function renderTodoBlockHtml(runId) {
    var entry = todoRunsById[runId];
    var todos = entry && entry.todos ? entry.todos : [];
    var sorted = chatUi.sortTodosForDisplay
      ? chatUi.sortTodosForDisplay(todos)
      : todos.filter(function (item) {
          return item.status !== 'cancelled';
        });
    if (!sorted.length) return '';
    var maxDisplay = chatUi.MAX_TODO_INLINE_DISPLAY || 12;
    var visible = sorted.slice(0, maxDisplay);
    var hiddenCount = sorted.length - visible.length;
    var items = visible.map(function (item) {
      var mark = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '→' : '○';
      var label = chatUi.todoDisplayLabel ? chatUi.todoDisplayLabel(item) : item.content;
      return (
        '<li class="todo-inline-item todo-inline-' + escapeAttr(item.status) + '">' +
          '<span class="todo-inline-mark">' + mark + '</span>' +
          '<span class="todo-inline-content">' + escapeText(label) + '</span>' +
        '</li>'
      );
    }).join('');
    var moreHtml = hiddenCount > 0
      ? '<li class="todo-inline-more">+' + hiddenCount + ' more</li>'
      : '';
    return (
      '<div class="todo-inline-block">' +
        '<div class="todo-inline-header">Tasks</div>' +
        '<ul class="todo-inline-list">' + items + moreHtml + '</ul>' +
      '</div>'
    );
  }

  function splitRunMessages(runMessages) {
    var finalIndex = -1;
    for (var j = runMessages.length - 1; j >= 0; j -= 1) {
      var candidate = runMessages[j];
      if (
        candidate.role === 'assistant' &&
        !isProcessMessage(candidate) &&
        hasVisibleAssistantContent(candidate)
      ) {
        finalIndex = j;
        break;
      }
    }
    return {
      thinkingMessages: finalIndex >= 0 ? runMessages.slice(0, finalIndex) : runMessages,
      finalReply: finalIndex >= 0 ? runMessages[finalIndex] : null,
    };
  }

  function renderThinkingStep(item, scopeId, index) {
    var stepKey = thinkingStepKey(scopeId, index, item);
    var openAttr = isThinkingOpen(stepKey) ? ' open' : '';
    var keyAttr = ' data-thinking-key="' + escapeAttr(stepKey) + '"';
    if (item.kind === 'assistant-text') {
      return (
        '<details class="thinking thinking-step"' + openAttr + keyAttr + '>' +
          '<summary>Thinking · assistant</summary>' +
          '<div class="thinking-assistant-text">' + window.MD.render(item.content || '') + '</div>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-call') {
      var args = item.arguments || '';
      try { args = JSON.stringify(JSON.parse(args), null, 2); } catch (_) {}
      return (
        '<details class="thinking thinking-step"' + openAttr + keyAttr + '>' +
          '<summary>Thinking · ' + escapeText(item.name) + '</summary>' +
          '<pre class="tool-call">⚙ ' + escapeText(item.name) + '\n' + escapeText(args) + '</pre>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-call-group') {
      var count = item.calls ? item.calls.length : 0;
      var groupBody = (item.calls || []).map(function (call, callIndex) {
        var callArgs = call.arguments || '';
        try { callArgs = JSON.stringify(JSON.parse(callArgs), null, 2); } catch (_) {}
        return (
          '<pre class="tool-call">' +
            escapeText(String(callIndex + 1) + '. ' + (call.name || item.name)) +
            '\n' +
            escapeText(callArgs) +
          '</pre>'
        );
      }).join('');
      return (
        '<details class="thinking thinking-step thinking-step-group"' + openAttr + keyAttr + '>' +
          '<summary>Thinking · ' + escapeText(item.name) + ' × ' + count + '</summary>' +
          '<div class="thinking-group-steps">' + groupBody + '</div>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-result') {
      var label = 'Thinking · tool result' + (item.name ? ' (' + escapeText(item.name) + ')' : '');
      return (
        '<details class="thinking thinking-step"' + openAttr + keyAttr + '>' +
          '<summary>' + label + '</summary>' +
          '<pre class="tool-call">' + escapeText(item.content || '') + '</pre>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-result-group') {
      var resultCount = item.results ? item.results.length : 0;
      var resultsBody = (item.results || []).map(function (content, resultIndex) {
        return (
          '<pre class="tool-call">' +
            escapeText(String(resultIndex + 1) + '. ' + (item.name || 'tool')) +
            '\n' +
            escapeText(content || '') +
          '</pre>'
        );
      }).join('');
      return (
        '<details class="thinking thinking-step thinking-step-group"' + openAttr + keyAttr + '>' +
          '<summary>Thinking · ' + escapeText(item.name) + ' results × ' + resultCount + '</summary>' +
          '<div class="thinking-group-steps">' + resultsBody + '</div>' +
        '</details>'
      );
    }
    return '';
  }

  function formatTimeRange(start, end) {
    try {
      var startText = new Date(start).toLocaleTimeString();
      if (!end || end === start) return startText;
      return startText + ' – ' + new Date(end).toLocaleTimeString();
    } catch (_) {
      return '';
    }
  }

  function renderThinkingBlockHtml(thinking, scopeId) {
    var items = thinking && thinking.items ? thinking.items : thinking;
    if (!items || !items.length) return '';
    var summary =
      (thinking && thinking.summaryLine) ||
      ('Thinking · ' + items.length + ' step' + (items.length === 1 ? '' : 's'));
    var groupKey = thinkingGroupKey(scopeId);
    var groupOpenAttr = isThinkingOpen(groupKey) ? ' open' : '';
    var body = items.map(function (item, index) {
      return renderThinkingStep(item, scopeId, index);
    }).join('');
    return (
      '<div class="thinking-block">' +
        '<details class="thinking-group"' + groupOpenAttr + ' data-thinking-key="' + escapeAttr(groupKey) + '">' +
          '<summary class="thinking-summary-line">' + escapeText(summary) + '</summary>' +
          '<div class="thinking-group-body">' + body + '</div>' +
        '</details>' +
      '</div>'
    );
  }

  function buildCompletedAssistantActions(messageId) {
    return (
      '<button class="icon-btn" data-action="copy" data-id="' +
      escapeAttr(messageId) +
      '" title="复制" aria-label="复制">' +
      ICON_COPY +
      '</button>' +
      '<button class="icon-btn" data-action="fork" data-id="' +
      escapeAttr(messageId) +
      '" title="分叉" aria-label="分叉">' +
      ICON_FORK +
      '</button>' +
      '<button class="icon-btn" data-action="delete" data-id="' +
      escapeAttr(messageId) +
      '" title="删除" aria-label="删除">' +
      ICON_TRASH +
      '</button>'
    );
  }

  function buildAssistantTurn(options) {
    var thinking = options.thinking;
    if (!thinking) {
      thinking = {
        items: options.thinkingItems || [],
        ids: options.thinkingIds || [],
        summaryLine: null,
        stepCount: (options.thinkingItems || []).length,
      };
    }
    var thinkingIds = options.thinkingIds || thinking.ids || [];
    var contentMsg = options.contentMsg || null;
    var modelId = resolveAssistantModelId(
      options.modelId || messageModelId(contentMsg),
      options.runMessages,
    );
    var startedAt = options.startedAt;
    var endedAt = options.endedAt;
    var runId = options.runId || '';
    var thinkingScopeId = resolveThinkingScopeId(runId, thinkingIds);

    var wrap = document.createElement('div');
    wrap.className = 'msg assistant assistant-turn';
    if (runId) {
      wrap.dataset.runId = runId;
    }
    if (contentMsg && contentMsg.id) {
      wrap.dataset.id = contentMsg.id;
    }
    if (thinkingIds.length) {
      wrap.dataset.thinkingIds = thinkingIds.join(',');
    }

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderTodoBlockHtml(runId) + renderThinkingBlockHtml(thinking, thinkingScopeId);
    if (contentMsg) {
      prependPlanSection(bubble, contentMsg, {
        showPreview: shouldShowPlanPreview(contentMsg, runId),
      });
      var contentWrap = document.createElement('div');
      contentWrap.className = 'assistant-turn-content';
      contentWrap.innerHTML = window.MD.render(contentMsg.content || '');
      bubble.appendChild(contentWrap);
      appendMessageImages(bubble, contentMsg);
      postProcessRenderedContent(bubble);
      setupCollapsibleContent(contentWrap);
    } else if (shouldShowPlanPreview(null, runId)) {
      prependPlanSection(bubble, null, { showPreview: true });
    }
    wrap.appendChild(bubble);

    var meta = document.createElement('div');
    meta.className = 'meta';
    var time = '';
    if (contentMsg && contentMsg.created_at) {
      try { time = new Date(contentMsg.created_at).toLocaleTimeString(); } catch (_) {}
    } else {
      time = formatTimeRange(startedAt, endedAt);
    }
    var copyAction = contentMsg
      ? buildCompletedAssistantActions(contentMsg.id)
      : '<button class="icon-btn" data-action="copy-thinking" data-thinking-ids="' +
        escapeAttr(thinkingIds.join(',')) +
        '" title="复制" aria-label="复制">' +
        ICON_COPY +
        '</button>';
    meta.innerHTML =
      '<span>' +
      assistantMetaLabel(modelId ? { model_id: modelId } : contentMsg, modelId) +
      (time ? ' · ' + time : '') +
      '</span>' +
      '<span class="actions">' +
      copyAction +
      '</span>';
    wrap.appendChild(meta);
    return wrap;
  }

  function patchAssistantTurnNode(turn, nextTurn) {
    var currentBubble = turn && turn.querySelector('.bubble');
    var currentMeta = turn && turn.querySelector('.meta');
    var nextBubble = nextTurn && nextTurn.querySelector('.bubble');
    var nextMeta = nextTurn && nextTurn.querySelector('.meta');
    if (!turn || !currentBubble || !currentMeta || !nextBubble || !nextMeta) {
      if (turn && nextTurn) turn.replaceWith(nextTurn);
      return nextTurn;
    }

    if (nextTurn.dataset.runId) {
      turn.dataset.runId = nextTurn.dataset.runId;
    } else {
      delete turn.dataset.runId;
    }
    if (nextTurn.dataset.id) {
      turn.dataset.id = nextTurn.dataset.id;
    } else {
      delete turn.dataset.id;
    }
    if (nextTurn.dataset.thinkingIds) {
      turn.dataset.thinkingIds = nextTurn.dataset.thinkingIds;
    } else {
      delete turn.dataset.thinkingIds;
    }

    currentBubble.replaceWith(nextBubble);
    currentMeta.replaceWith(nextMeta);
    return turn;
  }

  function messageModelId(msg) {
    return (msg && (msg.model_id || msg.modelId)) || '';
  }

  function resolveRunModelId(runMessages) {
    if (!runMessages || !runMessages.length) return '';
    for (var i = runMessages.length - 1; i >= 0; i -= 1) {
      var id = messageModelId(runMessages[i]);
      if (id) return id;
    }
    return '';
  }

  function resolveAssistantModelId(explicitModelId, runMessages) {
    return explicitModelId || resolveRunModelId(runMessages) || currentSessionModelId || '';
  }

  function assistantMetaLabel(msg, fallbackModelId) {
    var modelId = messageModelId(msg) || fallbackModelId || currentSessionModelId || '';
    return modelId ? 'Answered by ' + escapeText(modelId) : 'Answered by';
  }

  function roleLabel(role, msg) {
    if (role === 'user') return 'You';
    if (role === 'assistant') return assistantMetaLabel(msg);
    if (role === 'tool') return 'Tool · ' + (msg.name || '');
    if (role === 'system') return 'System';
    return role;
  }

  function isContextDivider(msg) {
    return msg && msg.role === 'context_divider';
  }

  function buildContextDivider(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg context_divider';
    wrap.dataset.id = msg.id;
    wrap.setAttribute('role', 'separator');
    wrap.setAttribute('aria-label', msg.content || 'Context divider');

    var row = document.createElement('div');
    row.className = 'context-divider';
    row.innerHTML =
      '<span class="context-divider-line" aria-hidden="true"></span>' +
      '<span class="context-divider-label">' +
      escapeText(msg.content || '') +
      '</span>' +
      '<span class="context-divider-line" aria-hidden="true"></span>';
    wrap.appendChild(row);
    return wrap;
  }

  function formatAtMentionsForDisplayInline(text) {
    return String(text || '').replace(/@([^\s@]+)/g, function (full, mentionPath) {
      var raw = String(mentionPath || '').trim();
      if (!raw) return full;
      var parts = raw.split(/[/\\]/);
      var name = parts[parts.length - 1] || raw;
      return '@' + name;
    });
  }

  function appendSystemHintBlock(bubble, systemHint) {
    var hintText = String(systemHint || '').trim();
    if (!hintText) return;
    var bodyText = hintText.replace(/^系统提示[：:]\s*/, '');
    var hint = document.createElement('div');
    hint.className = 'msg-system-hint';
    hint.innerHTML =
      '<div class="msg-system-hint-label">系统提示</div>' +
      '<div class="msg-system-hint-body">' + escapeText(bodyText) + '</div>';
    bubble.appendChild(hint);
  }

  function buildMessageImagesElement(msg) {
    var images = msg && Array.isArray(msg.images) ? msg.images : [];
    if (!images.length) return null;

    var wrap = document.createElement('div');
    wrap.className = 'msg-images';
    images.forEach(function (image, index) {
      if (image && image.data_url) {
        var img = document.createElement('img');
        img.className = 'msg-image';
        img.src = image.data_url;
        img.alt = 'image';
        img.loading = 'lazy';
        img.dataset.mimeType = image.mime_type || '';
        img.dataset.dataUrl = image.data_url;
        img.dataset.index = String(image.index == null ? index : image.index);
        wrap.appendChild(img);
        return;
      }
      var placeholder = document.createElement('div');
      placeholder.className = 'msg-image-placeholder';
      placeholder.textContent = 'Image';
      wrap.appendChild(placeholder);
    });
    return wrap;
  }

  function appendMessageImages(bubble, msg) {
    var images = buildMessageImagesElement(msg);
    if (images) {
      bubble.appendChild(images);
    }
  }

  function appendUserBubbleContent(bubble, msg) {
    var mentions = msg.at_mentions || [];
    var userText = String(msg.user_text || msg.content || '').trim();
    var systemHint = String(msg.system_hint || '').trim();

    if (mentions.length) {
      var body = document.createElement('div');
      body.className = 'msg-user-body';
      if (userText) {
        var text = document.createElement('div');
        text.className = 'msg-text';
        text.textContent = userText;
        body.appendChild(text);
      }
      var chips = document.createElement('div');
      chips.className = 'msg-at-chips';
      mentions.forEach(function (mention) {
        var chip = document.createElement('span');
        chip.className = 'msg-at-chip';
        chip.title = mention.relative_path || mention.name || '';
        chip.textContent = String(mention.name || '').replace(/^@+/, '');
        chips.appendChild(chip);
      });
      body.appendChild(chips);
      bubble.appendChild(body);
      appendSystemHintBlock(bubble, systemHint);
      appendMessageImages(bubble, msg);
      return;
    }

    if (userText) {
      var plain = document.createElement('div');
      plain.className = 'msg-text';
      plain.innerHTML = window.MD.render(formatAtMentionsForDisplayInline(userText));
      bubble.appendChild(plain);
      postProcessRenderedContent(plain);
    }
    appendSystemHintBlock(bubble, systemHint);
    appendMessageImages(bubble, msg);
  }

  function buildBubble(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + msg.role;
    wrap.dataset.id = msg.id;

    var bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.role !== 'tool') {
      if (msg.role === 'assistant') {
        prependPlanSection(bubble, msg, {
          showPreview: shouldShowPlanPreview(msg, msg.run_id || ''),
        });
        var body = document.createElement('div');
        body.className = 'bubble-collapse-body';
        body.innerHTML = window.MD.render(msg.content || '');
        bubble.appendChild(body);
        appendMessageImages(bubble, msg);
        postProcessRenderedContent(body);
        setupCollapsibleContent(body);
      } else if (msg.role === 'user' && msg.plan_rejection) {
        var rejectionBody = document.createElement('div');
        rejectionBody.className = 'plan-rejection-body';
        var rejectionTitle = document.createElement('div');
        rejectionTitle.className = 'plan-rejection-title';
        rejectionTitle.textContent = '计划未批准 · 继续规划';
        rejectionBody.appendChild(rejectionTitle);
        var planEl = document.createElement('div');
        planEl.className = 'plan-rejection-plan';
        planEl.innerHTML = window.MD.render(msg.plan_rejection_plan || msg.content || '');
        rejectionBody.appendChild(planEl);
        postProcessRenderedContent(planEl);
        if (msg.plan_rejection_feedback) {
          var feedbackLabel = document.createElement('div');
          feedbackLabel.className = 'plan-rejection-feedback-label';
          feedbackLabel.textContent = '你的反馈';
          rejectionBody.appendChild(feedbackLabel);
          var feedbackEl = document.createElement('div');
          feedbackEl.className = 'plan-rejection-feedback';
          feedbackEl.innerHTML = window.MD.render(msg.plan_rejection_feedback);
          rejectionBody.appendChild(feedbackEl);
          postProcessRenderedContent(feedbackEl);
        }
        bubble.appendChild(rejectionBody);
        appendMessageImages(bubble, msg);
      } else if (msg.role === 'user') {
        appendUserBubbleContent(bubble, msg);
      } else {
        bubble.innerHTML = window.MD.render(msg.content || '');
        appendMessageImages(bubble, msg);
        postProcessRenderedContent(bubble);
      }
    }
    wrap.appendChild(bubble);

    if (msg.role === 'user') {
      var userActions = document.createElement('div');
      userActions.className = 'meta user-actions-only';
      userActions.innerHTML =
        '<span class="actions">' +
          '<button class="icon-btn" data-action="copy" data-id="' + escapeAttr(msg.id) + '" title="复制" aria-label="复制">' + ICON_COPY + '</button>' +
        '</span>';
      wrap.appendChild(userActions);
      return wrap;
    }

    var meta = document.createElement('div');
    meta.className = 'meta';
    var time = '';
    try { time = new Date(msg.created_at).toLocaleTimeString(); } catch (_) {}
    meta.innerHTML = '<span>' + roleLabel(msg.role, msg) + (time ? ' · ' + time : '') + '</span>' +
                     '<span class="actions">' +
                       (msg.role === 'assistant'
                         ? buildCompletedAssistantActions(msg.id)
                         : '<button class="icon-btn" data-action="copy" data-id="' + escapeAttr(msg.id) + '" title="复制" aria-label="复制">' + ICON_COPY + '</button>') +
                     '</span>';
    wrap.appendChild(meta);
    return wrap;
  }

  var SCROLL_NEAR_BOTTOM_PX = 80;

  function isNearBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - SCROLL_NEAR_BOTTOM_PX;
  }

  function restoreScrollAfterRender(wasNearBottom, prevScrollTop, prevScrollHeight) {
    var doc = document.documentElement;
    if (wasNearBottom) {
      window.scrollTo({ top: doc.scrollHeight, behavior: 'auto' });
      return;
    }
    var delta = doc.scrollHeight - prevScrollHeight;
    window.scrollTo({ top: Math.max(0, prevScrollTop + delta), behavior: 'auto' });
  }

  function afterRenderScroll(wasNearBottom, prevScrollTop, prevScrollHeight) {
    requestAnimationFrame(function () {
      restoreScrollAfterRender(wasNearBottom, prevScrollTop, prevScrollHeight);
      if (wasNearBottom) {
        requestAnimationFrame(function () {
          restoreScrollAfterRender(true, prevScrollTop, prevScrollHeight);
        });
      }
    });
  }

  function scrollToBottomImmediate() {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
  }

  function stabilizeSessionSwitchScroll() {
    document.documentElement.classList.add('session-switch-rendering');
    scrollToBottomImmediate();
    requestAnimationFrame(function () {
      scrollToBottomImmediate();
      requestAnimationFrame(function () {
        scrollToBottomImmediate();
        document.documentElement.classList.remove('session-switch-rendering');
      });
    });
  }

  function captureScrollAnchor() {
    return {
      wasNearBottom: isNearBottom(),
      prevScrollTop: window.scrollY,
      prevScrollHeight: document.documentElement.scrollHeight,
    };
  }

  function collectRunMessagesForUser(messages, userIndex) {
    var runId = messages[userIndex].run_id;
    var runMessages = [];
    var index = userIndex + 1;
    while (index < messages.length && messages[index].run_id === runId) {
      runMessages.push(messages[index]);
      index += 1;
    }
    return { runMessages: runMessages, runId: runId, nextIndex: index };
  }

  function findLastActiveRunUserIndex(messages) {
    for (var i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user' && messages[i].run_id) {
        return i;
      }
    }
    return -1;
  }

  function patchInProgressRunTurn(turn, runId, runMessages) {
    var split = splitRunMessages(runMessages);
    var thinking = buildRunThinking(split.thinkingMessages);
    var bubble = turn.querySelector('.bubble');
    if (!bubble) return;

    var thinkingScopeId = resolveThinkingScopeId(runId, thinking.ids);
    bubble.innerHTML = renderTodoBlockHtml(runId) + renderThinkingBlockHtml(thinking, thinkingScopeId);

    if (shouldShowPlanPreview(null, runId)) {
      bubble.insertBefore(
        buildPlanPreviewCard(planPreviewMessage(null), planContext.content),
        bubble.firstChild,
      );
    }

    applyThinkingOpenState(turn);

    postProcessRenderedContent(bubble);

    var metaLabel = turn.querySelector('.meta > span:first-child');
    if (metaLabel) {
      var turnModelId = resolveAssistantModelId(messageModelId(split.finalReply), runMessages);
      var time = formatTimeRange(
        runMessages[0] && runMessages[0].created_at,
        runMessages[runMessages.length - 1] && runMessages[runMessages.length - 1].created_at,
      );
      metaLabel.textContent =
        assistantMetaLabel(turnModelId ? { model_id: turnModelId } : null, turnModelId) +
        (time ? ' · ' + time : '');
    }
  }

  function updateTodoRuns(todoRuns) {
    todoRunsById = todoRuns || {};
    var anchor = captureScrollAnchor();
    container.querySelectorAll('.assistant-turn[data-run-id]').forEach(function (turn) {
      var runId = turn.dataset.runId;
      if (!runId) return;
      var bubble = turn.querySelector('.bubble');
      if (!bubble) return;
      var todoBlock = bubble.querySelector('.todo-inline-block');
      var todoHtml = renderTodoBlockHtml(runId);
      if (todoHtml) {
        if (todoBlock) {
          todoBlock.outerHTML = todoHtml;
        } else {
          bubble.insertAdjacentHTML('afterbegin', todoHtml);
        }
      } else if (todoBlock) {
        todoBlock.remove();
      }
    });
    afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
  }

  function patchActiveRun(payload) {
    var messages = payload && payload.messages ? payload.messages : [];
    planPreviewTarget = findPlanPreviewTarget(messages);
    todoRunsById = (payload && payload.todoRuns) || {};
    var anchor = captureScrollAnchor();
    var userIndex = findLastActiveRunUserIndex(messages);
    if (userIndex < 0) {
      renderMessageList(payload);
      afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
      return;
    }

    var collected = collectRunMessagesForUser(messages, userIndex);
    var turn = container.querySelector('.assistant-turn[data-run-id="' + collected.runId + '"]');
    if (!turn) {
      renderMessageList(payload);
      afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
      return;
    }

    var split = splitRunMessages(collected.runMessages);
    if (split.finalReply) {
      var thinking = buildRunThinking(split.thinkingMessages);
      var nextTurn = buildAssistantTurn({
        thinking: thinking,
        thinkingIds: thinking.ids.concat([split.finalReply.id]),
        contentMsg: split.finalReply,
        modelId: resolveAssistantModelId(messageModelId(split.finalReply), collected.runMessages),
        runMessages: collected.runMessages,
        startedAt: collected.runMessages[0] && collected.runMessages[0].created_at,
        endedAt: split.finalReply.created_at,
        runId: collected.runId,
      });
      var patchedTurn = patchAssistantTurnNode(turn, nextTurn);
      applyThinkingOpenState(patchedTurn);
    } else {
      patchInProgressRunTurn(turn, collected.runId, collected.runMessages);
    }

    applyDefaultExpandToLastMessage();
    afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
  }

  function renderMessageList(payload, onPostProcessComplete) {
    disconnectLazyMermaid();
    batchPostProcess = true;
    container.innerHTML = '';
    var messages = Array.isArray(payload) ? payload : (payload && payload.messages) || [];
    todoRunsById = (!Array.isArray(payload) && payload && payload.todoRuns) || {};
    planPreviewTarget = findPlanPreviewTarget(messages);
    var index = 0;
    try {
    while (index < messages.length) {
      var msg = messages[index];
      if (isContextDivider(msg)) {
        container.appendChild(buildContextDivider(msg));
        index += 1;
        continue;
      }
      if (msg.role === 'user') {
        container.appendChild(buildBubble(msg));
        var runId = msg.run_id;
        if (runId) {
          var collected = collectRunMessagesForUser(messages, index);
          var runMessages = collected.runMessages;
          index = collected.nextIndex;
          if (runMessages.length) {
            var split = splitRunMessages(runMessages);
            var thinking = buildRunThinking(split.thinkingMessages);
            var turnModelId = resolveAssistantModelId(
              split.finalReply ? messageModelId(split.finalReply) : '',
              runMessages,
            );
            container.appendChild(
              buildAssistantTurn({
                thinking: thinking,
                thinkingIds: thinking.ids.concat(split.finalReply ? [split.finalReply.id] : []),
                contentMsg: split.finalReply,
                modelId: turnModelId,
                runMessages: runMessages,
                startedAt: runMessages[0] && runMessages[0].created_at,
                endedAt: (split.finalReply && split.finalReply.created_at) || (runMessages[runMessages.length - 1] && runMessages[runMessages.length - 1].created_at),
                runId: runId,
              }),
            );
          }
          continue;
        }
        index += 1;
        continue;
      }
      if (isProcessMessage(msg)) {
        var legacyMessages = [];
        var legacyStartedAt = msg.created_at;
        var legacyEndedAt = msg.created_at;
        while (index < messages.length && isProcessMessage(messages[index])) {
          var current = messages[index];
          legacyMessages.push(current);
          legacyEndedAt = current.created_at || legacyEndedAt;
          if (!legacyStartedAt) legacyStartedAt = current.created_at;
          index += 1;
        }
        var legacyThinking = buildRunThinking(legacyMessages);
        var legacyNext = messages[index];
        var legacyFinal = null;
        if (
          legacyNext &&
          legacyNext.role === 'assistant' &&
          !isProcessMessage(legacyNext) &&
          hasVisibleAssistantContent(legacyNext)
        ) {
          legacyFinal = legacyNext;
          index += 1;
        }
        container.appendChild(
          buildAssistantTurn({
            thinking: legacyThinking,
            thinkingIds: legacyThinking.ids.concat(legacyFinal ? [legacyFinal.id] : []),
            contentMsg: legacyFinal,
            modelId: resolveAssistantModelId(
              legacyFinal ? messageModelId(legacyFinal) : '',
              legacyMessages,
            ),
            runMessages: legacyMessages,
            startedAt: legacyStartedAt,
            endedAt: legacyFinal ? legacyFinal.created_at : legacyEndedAt,
            runId: legacyFinal && legacyFinal.run_id ? legacyFinal.run_id : '',
          }),
        );
        continue;
      }
      container.appendChild(buildBubble(msg));
      index += 1;
    }
    applyDefaultExpandToLastMessage();
    applyThinkingOpenState(container);
    } finally {
      batchPostProcess = false;
      requestAnimationFrame(function () {
        postProcessRenderedContent(container);
        if (onPostProcessComplete) onPostProcessComplete();
      });
    }
  }

  var app = {
    renderAll: function (list) {
      var isSessionSwitch = pendingSessionSwitch;
      if (isSessionSwitch) {
        pendingSessionSwitch = false;
      }
      if (isSessionSwitch) {
        renderMessageList(list);
        stabilizeSessionSwitchScroll();
        return;
      }
      var anchor = captureScrollAnchor();
      renderMessageList(list);
      afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
    },
    appendMessage: function (m) {
      var anchor = captureScrollAnchor();
      container.appendChild(isContextDivider(m) ? buildContextDivider(m) : buildBubble(m));
      applyDefaultExpandToLastMessage();
      afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
    },
    removeMessage: function (id) {
      var el = container.querySelector('.msg[data-id="' + id + '"]');
      if (el) {
        el.remove();
        return;
      }
      container.querySelectorAll('[data-thinking-ids]').forEach(function (group) {
        var ids = (group.dataset.thinkingIds || '').split(',').filter(Boolean);
        if (ids.indexOf(id) >= 0) group.remove();
      });
    },
    updateTodoRuns: updateTodoRuns,
    patchActiveRun: patchActiveRun,
    setBusy: function () {},
    setVerboseThinking: function (value) {
      verboseThinking = Boolean(value);
    },
    setPlanContext: function (value) {
      var prevContent = planContext && planContext.content;
      planContext = value && typeof value === 'object' ? value : { active: false };
      if (planContext.content !== prevContent) {
        refreshPlanPreviewCards();
      }
    },
    setSessionId: function (sessionId) {
      var nextId = sessionId ? String(sessionId) : '';
      if (nextId === currentSessionId) return;
      pendingSessionSwitch = true;
      disconnectLazyMermaid();
      currentSessionId = nextId;
      loadThinkingOpenState();
      loadMessageExpandState();
    },
    setSessionModel: function (modelId) {
      currentSessionModelId = modelId ? String(modelId) : '';
    },
  };

  function copyToClipboard(text) {
    if (!navigator.clipboard) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
      return;
    }
    navigator.clipboard.writeText(text).catch(function () {});
  }

  document.addEventListener('click', function (e) {
    var imageEl = e.target.closest && e.target.closest('.msg-image[data-data-url]');
    if (imageEl) {
      notifyHost({
        action: 'openImage',
        dataUrl: imageEl.dataset.dataUrl,
        mimeType: imageEl.dataset.mimeType || '',
      });
      return;
    }

    var btn = e.target.closest && e.target.closest('button[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'open-plan') {
      var planSessionId = btn.dataset.sessionId;
      if (planSessionId) {
        window.parent.postMessage({ action: 'openPlan', sessionId: planSessionId }, '*');
      }
      return;
    }

    if (action === 'copy-code') {
      var block = btn.closest('.code-block');
      var pre = block && block.querySelector('pre');
      if (pre) {
        copyToClipboard(preText(pre));
        flashCopied(btn);
      }
      return;
    }

    if (action === 'copy-mermaid') {
      var card = btn.closest('.mermaid-diagram-card');
      if (card) {
        copyToClipboard(mermaidSourceFromCard(card));
        flashCopied(btn);
      }
      return;
    }

    if (action === 'expand-mermaid') {
      var expandCard = btn.closest('.mermaid-diagram-card');
      if (!expandCard) return;
      var mermaidEl = expandCard.querySelector('.mermaid');
      if (mermaidEl && !mermaidEl.getAttribute('data-mermaid-done')) {
        if (mermaidLazyObserver) {
          mermaidLazyObserver.unobserve(mermaidEl);
        }
        mermaidLazyPending.delete(mermaidEl);
        typesetMermaidNodes([mermaidEl]).then(function () {
          openMermaidModal(expandCard);
        });
        return;
      }
      openMermaidModal(expandCard);
      return;
    }

    if (action === 'close-mermaid-modal') {
      closeMermaidModal();
      return;
    }

    if (action === 'copy-thinking') {
      var group = btn.closest('.assistant-turn, .thinking-group-msg');
      var bubbleEl = group && group.querySelector('.bubble');
      if (bubbleEl) {
        copyToClipboard(getCopyableTextFromBubble(bubbleEl));
        flashCopied(btn, 3000);
      }
      return;
    }

    var id = btn.dataset.id;
    var msgEl = container.querySelector('.msg[data-id="' + id + '"] .bubble');
    if (action === 'copy' && msgEl) {
      copyToClipboard(getCopyableTextFromBubble(msgEl));
      flashCopied(btn, 3000);
      return;
    }
    if (action === 'fork' && id) {
      notifyHost({ action: 'fork', id: id });
      return;
    }
    if (id) notifyHost({ action: action, id: id });
  });

  function notifyHost(payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.host) {
      window.webkit.messageHandlers.host.postMessage(payload);
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMermaidModal();
  });

  container.addEventListener('toggle', function (e) {
    var details = e.target;
    if (!details || !details.matches || !details.matches('details.thinking-group, details.thinking-step')) {
      return;
    }
    var key = details.dataset.thinkingKey;
    if (key) {
      setThinkingOpen(key, details.open);
    }
  }, true);

  loadThinkingOpenState();
  loadMessageExpandState();
  window.app = app;
  notifyHost({ action: 'ready' });
})();
