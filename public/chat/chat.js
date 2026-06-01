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
  var ICON_EXPAND = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';

  var todoRunsById = {};
  var chatUi = window.CRAgentChatUtils || {};
  var verboseThinking = false;

  var MATH_DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false }
  ];

  function typesetMath(el) {
    if (!el || typeof renderMathInElement !== 'function') return;
    renderMathInElement(el, {
      delimiters: MATH_DELIMITERS,
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    });
  }

  var mermaidReady = false;
  var mermaidModalEl = null;

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

  function typesetMermaid(root) {
    if (!root || !window.mermaid) return Promise.resolve();
    ensureMermaid();
    var nodes = root.querySelectorAll('.mermaid:not([data-mermaid-done])');
    if (!nodes.length) return Promise.resolve();
    var result = window.mermaid.run({ nodes: nodes, suppressErrors: true });
    if (result && typeof result.then === 'function') {
      return result.then(function () {
        nodes.forEach(function (node) {
          node.setAttribute('data-mermaid-done', '1');
        });
        enhanceMermaidDiagrams(root);
      }).catch(function () {
        enhanceMermaidDiagrams(root);
      });
    }
    enhanceMermaidDiagrams(root);
    return Promise.resolve();
  }

  function highlightCodeBlocks(root) {
    if (!root || !window.hljs) return;
    root.querySelectorAll('pre code').forEach(function (block) {
      if (block.closest('.mermaid-diagram-card')) return;
      if (block.dataset.hljsDone === '1') return;
      try {
        window.hljs.highlightElement(block);
        block.dataset.hljsDone = '1';
      } catch (_) {}
    });
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
        '<div class="mermaid-modal-backdrop" data-action="close-mermaid-modal"></div>' +
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

  function postProcessRenderedContent(root) {
    if (!root) return;
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

  function setupCollapsibleContent(contentEl) {
    if (!contentEl) return;

    function attach() {
      if (contentEl.closest('.bubble-collapse')) return;
      if (contentEl.scrollHeight <= COLLAPSED_MAX_HEIGHT) return;

      var wrap = document.createElement('div');
      wrap.className = 'bubble-collapse is-collapsed';
      var parent = contentEl.parentNode;
      parent.insertBefore(wrap, contentEl);
      wrap.appendChild(contentEl);
      contentEl.classList.add('bubble-collapse-body');

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'bubble-collapse-toggle';
      toggle.textContent = '展开全文';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        var collapsed = wrap.classList.toggle('is-collapsed');
        toggle.textContent = collapsed ? '展开全文' : '收起';
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
    return String(msg.content || '').trim().length > 0;
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

  function renderThinkingStep(item) {
    if (item.kind === 'assistant-text') {
      return (
        '<details class="thinking thinking-step">' +
          '<summary>Thinking · assistant</summary>' +
          '<div class="thinking-assistant-text">' + window.MD.render(item.content || '') + '</div>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-call') {
      var args = item.arguments || '';
      try { args = JSON.stringify(JSON.parse(args), null, 2); } catch (_) {}
      return (
        '<details class="thinking thinking-step">' +
          '<summary>Thinking · ' + escapeText(item.name) + '</summary>' +
          '<pre class="tool-call">⚙ ' + escapeText(item.name) + '\n' + escapeText(args) + '</pre>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-call-group') {
      var count = item.calls ? item.calls.length : 0;
      var groupBody = (item.calls || []).map(function (call, index) {
        var callArgs = call.arguments || '';
        try { callArgs = JSON.stringify(JSON.parse(callArgs), null, 2); } catch (_) {}
        return (
          '<pre class="tool-call">' +
            escapeText(String(index + 1) + '. ' + (call.name || item.name)) +
            '\n' +
            escapeText(callArgs) +
          '</pre>'
        );
      }).join('');
      return (
        '<details class="thinking thinking-step thinking-step-group">' +
          '<summary>Thinking · ' + escapeText(item.name) + ' × ' + count + '</summary>' +
          '<div class="thinking-group-steps">' + groupBody + '</div>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-result') {
      var label = 'Thinking · tool result' + (item.name ? ' (' + escapeText(item.name) + ')' : '');
      return (
        '<details class="thinking thinking-step">' +
          '<summary>' + label + '</summary>' +
          '<pre class="tool-call">' + escapeText(item.content || '') + '</pre>' +
        '</details>'
      );
    }
    if (item.kind === 'tool-result-group') {
      var resultCount = item.results ? item.results.length : 0;
      var resultsBody = (item.results || []).map(function (content, index) {
        return (
          '<pre class="tool-call">' +
            escapeText(String(index + 1) + '. ' + (item.name || 'tool')) +
            '\n' +
            escapeText(content || '') +
          '</pre>'
        );
      }).join('');
      return (
        '<details class="thinking thinking-step thinking-step-group">' +
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

  function renderThinkingBlockHtml(thinking) {
    var items = thinking && thinking.items ? thinking.items : thinking;
    if (!items || !items.length) return '';
    var summary =
      (thinking && thinking.summaryLine) ||
      ('Thinking · ' + items.length + ' step' + (items.length === 1 ? '' : 's'));
    var body = items.map(renderThinkingStep).join('');
    return (
      '<div class="thinking-block">' +
        '<details class="thinking-group">' +
          '<summary class="thinking-summary-line">' + escapeText(summary) + '</summary>' +
          '<div class="thinking-group-body">' + body + '</div>' +
        '</details>' +
      '</div>'
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
    var modelId = options.modelId || messageModelId(contentMsg);
    var startedAt = options.startedAt;
    var endedAt = options.endedAt;
    var runId = options.runId || '';

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
    bubble.innerHTML = renderTodoBlockHtml(runId) + renderThinkingBlockHtml(thinking);
    if (contentMsg) {
      var contentWrap = document.createElement('div');
      contentWrap.className = 'assistant-turn-content';
      contentWrap.innerHTML = window.MD.render(contentMsg.content || '');
      bubble.appendChild(contentWrap);
      postProcessRenderedContent(bubble);
      setupCollapsibleContent(contentWrap);
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
      ? '<button class="icon-btn" data-action="copy" data-id="' +
        escapeAttr(contentMsg.id) +
        '" title="复制" aria-label="复制">' +
        ICON_COPY +
        '</button>' +
        '<button class="icon-btn" data-action="delete" data-id="' +
        escapeAttr(contentMsg.id) +
        '" title="删除" aria-label="删除">' +
        ICON_TRASH +
        '</button>'
      : '<button class="icon-btn" data-action="copy-thinking" data-thinking-ids="' +
        escapeAttr(thinkingIds.join(',')) +
        '" title="复制" aria-label="复制">' +
        ICON_COPY +
        '</button>';
    meta.innerHTML =
      '<span>' +
      assistantMetaLabel(modelId ? { model_id: modelId } : contentMsg) +
      (time ? ' · ' + time : '') +
      '</span>' +
      '<span class="actions">' +
      copyAction +
      '</span>';
    wrap.appendChild(meta);
    return wrap;
  }

  function messageModelId(msg) {
    return (msg && (msg.model_id || msg.modelId)) || '';
  }

  function assistantMetaLabel(msg) {
    var modelId = messageModelId(msg);
    return modelId ? 'Assistant by ' + escapeText(modelId) : 'Assistant';
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

  function appendUserBubbleContent(bubble, msg) {
    var mentions = msg.at_mentions || [];
    var userText = String(msg.user_text || msg.content || '').trim();

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
        chip.textContent = '@' + (mention.name || '');
        chips.appendChild(chip);
      });
      body.appendChild(chips);
      bubble.appendChild(body);
      return;
    }

    if (userText) {
      var plain = document.createElement('div');
      plain.className = 'msg-text';
      plain.innerHTML = window.MD.render(formatAtMentionsForDisplayInline(userText));
      bubble.appendChild(plain);
      postProcessRenderedContent(plain);
    }
  }

  function buildBubble(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + msg.role;
    wrap.dataset.id = msg.id;

    var bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.role !== 'tool') {
      if (msg.role === 'assistant') {
        var body = document.createElement('div');
        body.className = 'bubble-collapse-body';
        body.innerHTML = window.MD.render(msg.content || '');
        bubble.appendChild(body);
        postProcessRenderedContent(body);
        setupCollapsibleContent(body);
      } else if (msg.role === 'user') {
        appendUserBubbleContent(bubble, msg);
      } else {
        bubble.innerHTML = window.MD.render(msg.content || '');
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
                       '<button class="icon-btn" data-action="copy" data-id="' + escapeAttr(msg.id) + '" title="复制" aria-label="复制">' + ICON_COPY + '</button>' +
                       (msg.role === 'assistant'
                         ? '<button class="icon-btn" data-action="delete" data-id="' + escapeAttr(msg.id) + '" title="删除" aria-label="删除">' + ICON_TRASH + '</button>'
                         : '') +
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

    var thinkingGroup = bubble.querySelector('.thinking-group');
    var wasOpen = Boolean(thinkingGroup && thinkingGroup.open);

    bubble.innerHTML = renderTodoBlockHtml(runId) + renderThinkingBlockHtml(thinking);

    thinkingGroup = bubble.querySelector('.thinking-group');
    if (thinkingGroup && wasOpen) {
      thinkingGroup.open = true;
    }

    postProcessRenderedContent(bubble);

    var metaLabel = turn.querySelector('.meta > span:first-child');
    if (metaLabel) {
      var turnModelId = messageModelId(split.thinkingMessages[split.thinkingMessages.length - 1]);
      var time = formatTimeRange(
        runMessages[0] && runMessages[0].created_at,
        runMessages[runMessages.length - 1] && runMessages[runMessages.length - 1].created_at,
      );
      metaLabel.textContent =
        assistantMetaLabel(turnModelId ? { model_id: turnModelId } : null) + (time ? ' · ' + time : '');
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
      turn.replaceWith(
        buildAssistantTurn({
          thinking: thinking,
          thinkingIds: thinking.ids.concat([split.finalReply.id]),
          contentMsg: split.finalReply,
          modelId: messageModelId(split.finalReply),
          startedAt: collected.runMessages[0] && collected.runMessages[0].created_at,
          endedAt: split.finalReply.created_at,
          runId: collected.runId,
        }),
      );
    } else {
      patchInProgressRunTurn(turn, collected.runId, collected.runMessages);
    }

    afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
  }

  function renderMessageList(payload) {
    container.innerHTML = '';
    var messages = Array.isArray(payload) ? payload : (payload && payload.messages) || [];
    todoRunsById = (!Array.isArray(payload) && payload && payload.todoRuns) || {};
    var index = 0;
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
            var turnModelId = split.finalReply
              ? messageModelId(split.finalReply)
              : messageModelId(split.thinkingMessages[split.thinkingMessages.length - 1]);
            container.appendChild(
              buildAssistantTurn({
                thinking: thinking,
                thinkingIds: thinking.ids.concat(split.finalReply ? [split.finalReply.id] : []),
                contentMsg: split.finalReply,
                modelId: turnModelId,
                startedAt: runMessages[0] && runMessages[0].created_at,
                endedAt: (split.finalReply && split.finalReply.created_at) || (runMessages[runMessages.length - 1] && runMessages[runMessages.length - 1].created_at),
                runId: runId,
              }),
            );
          }
          continue;
        }
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
            modelId: legacyFinal ? messageModelId(legacyFinal) : '',
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
  }

  var app = {
    renderAll: function (list) {
      var anchor = captureScrollAnchor();
      renderMessageList(list);
      afterRenderScroll(anchor.wasNearBottom, anchor.prevScrollTop, anchor.prevScrollHeight);
    },
    appendMessage: function (m) {
      var anchor = captureScrollAnchor();
      container.appendChild(isContextDivider(m) ? buildContextDivider(m) : buildBubble(m));
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
    var btn = e.target.closest && e.target.closest('button[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

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
      if (expandCard) openMermaidModal(expandCard);
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

  window.app = app;
  notifyHost({ action: 'ready' });
})();
