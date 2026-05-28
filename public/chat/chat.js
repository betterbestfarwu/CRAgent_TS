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

  function flashCopied(btn) {
    if (!btn || btn.classList.contains('copied')) return;
    var orig = btn.innerHTML;
    btn.innerHTML = ICON_CHECK;
    btn.classList.add('copied');
    btn.title = '已复制';
    setTimeout(function () {
      btn.innerHTML = orig;
      btn.classList.remove('copied');
      btn.title = '复制';
    }, 1500);
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
    var html = renderThinkingBlockHtml(thinkingItems);
    if (contentMsg) {
      html +=
        '<div class="assistant-turn-content">' +
        window.MD.render(contentMsg.content || '') +
        '</div>';
    }
    bubble.innerHTML = html;
    if (contentMsg) {
      typesetMath(bubble);
      enhanceCodeCopyButtons(bubble);
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
        '" title="Copy" aria-label="Copy">' +
        ICON_COPY +
        '</button>' +
        '<button class="icon-btn" data-action="delete" data-id="' +
        escapeAttr(contentMsg.id) +
        '" title="Delete" aria-label="Delete">' +
        ICON_TRASH +
        '</button>'
      : '<button class="icon-btn" data-action="copy-thinking" data-thinking-ids="' +
        escapeAttr(thinkingIds.join(',')) +
        '" title="Copy" aria-label="Copy">' +
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

  function buildBubble(msg) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + msg.role;
    wrap.dataset.id = msg.id;

    var bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.role !== 'tool') {
      bubble.innerHTML = window.MD.render(msg.content || '');
      typesetMath(bubble);
      enhanceCodeCopyButtons(bubble);
    }
    wrap.appendChild(bubble);

    var meta = document.createElement('div');
    meta.className = 'meta';
    var time = '';
    try { time = new Date(msg.created_at).toLocaleTimeString(); } catch (_) {}
    meta.innerHTML = '<span>' + roleLabel(msg.role, msg) + (time ? ' · ' + time : '') + '</span>' +
                     '<span class="actions">' +
                       '<button class="icon-btn" data-action="copy" data-id="' + escapeAttr(msg.id) + '" title="Copy" aria-label="Copy">' + ICON_COPY + '</button>' +
                       '<button class="icon-btn" data-action="delete" data-id="' + escapeAttr(msg.id) + '" title="Delete" aria-label="Delete">' + ICON_TRASH + '</button>' +
                     '</span>';
    wrap.appendChild(meta);
    return wrap;
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function renderMessageList(list) {
    container.innerHTML = '';
    var messages = list || [];
    var index = 0;
    while (index < messages.length) {
      var msg = messages[index];
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
      renderMessageList(list);
      requestAnimationFrame(scrollToBottom);
    },
    appendMessage: function (m) {
      container.appendChild(buildBubble(m));
      requestAnimationFrame(scrollToBottom);
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
      if (bubbleEl) copyToClipboard(bubbleEl.innerText);
      return;
    }

    var id = btn.dataset.id;
    var msgEl = container.querySelector('.msg[data-id="' + id + '"] .bubble');
    if (action === 'copy' && msgEl) {
      copyToClipboard(msgEl.innerText);
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
