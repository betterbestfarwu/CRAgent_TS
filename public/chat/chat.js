(function () {
  var container = document.getElementById('messages');
  var busyEl = document.getElementById('busy');

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

  function preText(pre) {
    var code = pre.querySelector('code');
    return (code ? code.textContent : pre.textContent) || '';
  }

  function enhanceCodeCopyButtons(root) {
    if (!root) return;
    root.querySelectorAll('pre').forEach(function (pre) {
      if (pre.closest('.code-block')) return;
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

  function collectThinkingItems(msg) {
    var items = [];
    if (msg.role === 'tool') {
      items.push({
        kind: 'tool-result',
        name: msg.name || '',
        content: msg.content || ''
      });
      return items;
    }
    if (msg.role === 'assistant' && msg.tool_calls) {
      msg.tool_calls.forEach(function (call) {
        items.push({
          kind: 'tool-call',
          name: call.name || 'tool',
          arguments: call.arguments || ''
        });
      });
    }
    return items;
  }

  function renderThinkingStep(item) {
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
    if (item.kind === 'tool-result') {
      var label = 'Thinking · tool result' + (item.name ? ' (' + escapeText(item.name) + ')' : '');
      return (
        '<details class="thinking thinking-step">' +
          '<summary>' + label + '</summary>' +
          '<pre class="tool-call">' + escapeText(item.content || '') + '</pre>' +
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

  function renderThinkingBlockHtml(items) {
    if (!items || !items.length) return '';
    var summary =
      'Thinking · ' + items.length + ' step' + (items.length === 1 ? '' : 's');
    var body = items.map(renderThinkingStep).join('');
    return (
      '<div class="thinking-block">' +
        '<details class="thinking-group">' +
          '<summary>' + summary + '</summary>' +
          '<div class="thinking-group-body">' + body + '</div>' +
        '</details>' +
      '</div>'
    );
  }

  function buildAssistantTurn(options) {
    var thinkingItems = options.thinkingItems || [];
    var thinkingIds = options.thinkingIds || [];
    var contentMsg = options.contentMsg || null;
    var startedAt = options.startedAt;
    var endedAt = options.endedAt;

    var wrap = document.createElement('div');
    wrap.className = 'msg assistant assistant-turn';
    if (contentMsg && contentMsg.id) {
      wrap.dataset.id = contentMsg.id;
    }
    if (thinkingIds.length) {
      wrap.dataset.thinkingIds = thinkingIds.join(',');
    }

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderThinkingBlockHtml(thinkingItems);
    if (contentMsg) {
      var contentWrap = document.createElement('div');
      contentWrap.className = 'assistant-turn-content';
      contentWrap.innerHTML = window.MD.render(contentMsg.content || '');
      bubble.appendChild(contentWrap);
      typesetMath(bubble);
      enhanceCodeCopyButtons(bubble);
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
      '<span>Assistant' + (time ? ' · ' + time : '') + '</span>' +
      '<span class="actions">' +
      copyAction +
      '</span>';
    wrap.appendChild(meta);
    return wrap;
  }

  function roleLabel(role, msg) {
    if (role === 'user') return 'You';
    if (role === 'assistant') return 'Assistant';
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

  function appendUserBubbleContent(bubble, msg) {
    if (msg.images && msg.images.length) {
      var gallery = document.createElement('div');
      gallery.className = 'msg-images';
      msg.images.forEach(function (image) {
        var imageEl = document.createElement('img');
        imageEl.className = 'msg-image';
        imageEl.src = image.data_url || image.dataUrl || '';
        imageEl.alt = 'Attached image';
        imageEl.title = '双击查看大图';
        imageEl.loading = 'lazy';
        imageEl.addEventListener('dblclick', function (event) {
          event.preventDefault();
          event.stopPropagation();
          var dataUrl = imageEl.src;
          if (!dataUrl) return;
          notifyHost({
            action: 'openImage',
            dataUrl: dataUrl,
            mimeType: image.mime_type || image.mimeType || '',
          });
        });
        gallery.appendChild(imageEl);
      });
      bubble.appendChild(gallery);
    }
    if (String(msg.content || '').trim()) {
      var text = document.createElement('div');
      text.className = 'msg-text';
      text.innerHTML = window.MD.render(msg.content || '');
      bubble.appendChild(text);
      typesetMath(text);
      enhanceCodeCopyButtons(text);
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
        typesetMath(body);
        enhanceCodeCopyButtons(body);
        setupCollapsibleContent(body);
      } else if (msg.role === 'user') {
        appendUserBubbleContent(bubble, msg);
      } else {
        bubble.innerHTML = window.MD.render(msg.content || '');
        typesetMath(bubble);
        enhanceCodeCopyButtons(bubble);
      }
    }
    wrap.appendChild(bubble);

    var meta = document.createElement('div');
    meta.className = 'meta';
    var time = '';
    try { time = new Date(msg.created_at).toLocaleTimeString(); } catch (_) {}
    meta.innerHTML = '<span>' + roleLabel(msg.role, msg) + (time ? ' · ' + time : '') + '</span>' +
                     '<span class="actions">' +
                       '<button class="icon-btn" data-action="copy" data-id="' + escapeAttr(msg.id) + '" title="复制" aria-label="复制">' + ICON_COPY + '</button>' +
                       '<button class="icon-btn" data-action="delete" data-id="' + escapeAttr(msg.id) + '" title="删除" aria-label="删除">' + ICON_TRASH + '</button>' +
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
    restoreScrollAfterRender(wasNearBottom, prevScrollTop, prevScrollHeight);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        restoreScrollAfterRender(wasNearBottom, prevScrollTop, prevScrollHeight);
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

  function renderMessageList(list) {
    container.innerHTML = '';
    var messages = list || [];
    var index = 0;
    while (index < messages.length) {
      var msg = messages[index];
      if (isContextDivider(msg)) {
        container.appendChild(buildContextDivider(msg));
        index += 1;
        continue;
      }
      if (isProcessMessage(msg)) {
        var items = [];
        var ids = [];
        var contentMessages = [];
        var startedAt = msg.created_at;
        var endedAt = msg.created_at;
        while (index < messages.length && isProcessMessage(messages[index])) {
          var current = messages[index];
          if (hasVisibleAssistantContent(current)) {
            contentMessages.push(Object.assign({}, current, { tool_calls: [] }));
          }
          items = items.concat(collectThinkingItems(current));
          ids.push(current.id);
          endedAt = current.created_at || endedAt;
          if (!startedAt) startedAt = current.created_at;
          index += 1;
        }

        var next = messages[index];
        var finalReply = null;
        if (
          next &&
          next.role === 'assistant' &&
          !isProcessMessage(next) &&
          hasVisibleAssistantContent(next)
        ) {
          finalReply = next;
          index += 1;
        }

        if (finalReply) {
          var turnIds = ids.concat([finalReply.id]);
          container.appendChild(
            buildAssistantTurn({
              thinkingItems: items,
              thinkingIds: turnIds,
              contentMsg: finalReply,
              startedAt: startedAt,
              endedAt: finalReply.created_at || endedAt,
            }),
          );
        } else if (items.length) {
          container.appendChild(
            buildAssistantTurn({
              thinkingItems: items,
              thinkingIds: ids,
              contentMsg: null,
              startedAt: startedAt,
              endedAt: endedAt,
            }),
          );
        }
        contentMessages.forEach(function (contentMsg) {
          container.appendChild(buildBubble(contentMsg));
        });
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
    setBusy: function (b) {
      busyEl.hidden = !b;
    }
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

  window.app = app;
  notifyHost({ action: 'ready' });
})();
