// Minimal Markdown renderer for chat: GFM-ish blocks + inline, Mermaid fences.
// Math delimiters are preserved for KaTeX post-processing in chat.js.
(function (root) {
  function escapeHTML(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function slugId(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function safeUrl(url) {
    var u = String(url || '').trim();
    if (/^(https?:|mailto:|#|\/)/i.test(u)) return u;
    return '#';
  }

  function preprocess(md) {
    var lines = md.replace(/\r\n/g, '\n').split('\n');
    var footnotes = {};
    var linkRefs = {};
    var body = [];
    var i = 0;
    while (i < lines.length) {
      var fn = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
      if (fn) {
        var parts = [fn[2]];
        i++;
        while (i < lines.length && /^ {4}/.test(lines[i])) {
          parts.push(lines[i].replace(/^ {4}/, ''));
          i++;
        }
        footnotes[fn[1]] = parts.join('\n').trim();
        continue;
      }
      var ref = lines[i].match(/^\[([^\]]+)\]:\s+(\S+)(?:\s+"([^"]*)")?\s*$/);
      if (ref) {
        linkRefs[ref[1].toLowerCase()] = { url: ref[2], title: ref[3] || '' };
        i++;
        continue;
      }
      body.push(lines[i]);
      i++;
    }
    return { text: body.join('\n'), footnotes: footnotes, linkRefs: linkRefs };
  }

  function protectMath(text) {
    var segments = [];
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (match) {
      segments.push(match);
      return '\u0002M' + (segments.length - 1) + '\u0002';
    });
    text = text.replace(/(^|[^\\$])\$([^\$\n]+?)\$(?!\$)/g, function (full, prefix, body) {
      segments.push('$' + body + '$');
      return prefix + '\u0002M' + (segments.length - 1) + '\u0002';
    });
    return { text: text, segments: segments };
  }

  function restoreMath(text, segments) {
    return text.replace(/\u0002M(\d+)\u0002/g, function (_, i) {
      return segments[parseInt(i, 10)] || '';
    });
  }

  function linkFromRef(ctx, label, text) {
    var key = (label || text || '').toLowerCase();
    var def = ctx.linkRefs[key];
    if (!def) return null;
    var title = def.title ? ' title="' + escapeHTML(def.title) + '"' : '';
    return (
      '<a href="' +
      escapeHTML(safeUrl(def.url)) +
      '"' +
      title +
      ' target="_blank" rel="noopener noreferrer">' +
      escapeHTML(text) +
      '</a>'
    );
  }

  function noteFootnoteUse(ctx, id) {
    if (ctx.usedFootnotes.indexOf(id) < 0) ctx.usedFootnotes.push(id);
    return ctx.usedFootnotes.indexOf(id) + 1;
  }

  function autolinkEscaped(text) {
    return text.replace(/(^|[\s(])((https?:\/\/)[^\s<>"')]+)/gi, function (full, prefix, url) {
      return prefix + '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }

  function inline(text, ctx) {
    ctx = ctx || { footnotes: {}, linkRefs: {}, usedFootnotes: [] };
    var math = protectMath(text);
    text = math.text;
    var codePlaceholders = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, c) {
      codePlaceholders.push('<code>' + escapeHTML(c) + '</code>');
      return '\u0001CODE' + (codePlaceholders.length - 1) + '\u0001';
    });
    var imagePlaceholders = [];
    text = text.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, function (_, alt, ref) {
      var key = (ref || alt).toLowerCase();
      var def = ctx.linkRefs[key];
      if (!def) return '![' + alt + '][' + ref + ']';
      var title = def.title ? ' title="' + escapeHTML(def.title) + '"' : '';
      imagePlaceholders.push(
        '<img src="' +
          escapeHTML(safeUrl(def.url)) +
          '" alt="' +
          escapeHTML(alt) +
          '"' +
          title +
          ' loading="lazy" decoding="async">',
      );
      return '\u0001IMG' + (imagePlaceholders.length - 1) + '\u0001';
    });
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, alt, src) {
      imagePlaceholders.push(
        '<img src="' +
          escapeHTML(safeUrl(src)) +
          '" alt="' +
          escapeHTML(alt) +
          '" loading="lazy" decoding="async">',
      );
      return '\u0001IMG' + (imagePlaceholders.length - 1) + '\u0001';
    });
    var linkPlaceholders = [];
    text = text.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, function (_, t, ref) {
      var html = linkFromRef(ctx, ref, t);
      if (!html) return '[' + t + '][' + ref + ']';
      linkPlaceholders.push(html);
      return '\u0001LNK' + (linkPlaceholders.length - 1) + '\u0001';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, t, u) {
      linkPlaceholders.push(
        '<a href="' +
          escapeHTML(safeUrl(u)) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHTML(t) +
          '</a>',
      );
      return '\u0001LNK' + (linkPlaceholders.length - 1) + '\u0001';
    });
    var fnPlaceholders = [];
    text = text.replace(/\[\^([^\]]+)\]/g, function (_, id) {
      if (!ctx.footnotes[id]) return '[^' + id + ']';
      var n = noteFootnoteUse(ctx, id);
      var sid = slugId(id);
      fnPlaceholders.push(
        '<sup class="footnote-ref"><a href="#fn-' +
          sid +
          '" id="fnref-' +
          sid +
          '">' +
          n +
          '</a></sup>',
      );
      return '\u0001FN' + (fnPlaceholders.length - 1) + '\u0001';
    });
    text = escapeHTML(text);
    text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    text = text.replace(/\u0001CODE(\d+)\u0001/g, function (_, i) {
      return codePlaceholders[parseInt(i, 10)];
    });
    text = text.replace(/\u0001IMG(\d+)\u0001/g, function (_, i) {
      return imagePlaceholders[parseInt(i, 10)];
    });
    text = text.replace(/\u0001LNK(\d+)\u0001/g, function (_, i) {
      return linkPlaceholders[parseInt(i, 10)];
    });
    text = text.replace(/\u0001FN(\d+)\u0001/g, function (_, i) {
      return fnPlaceholders[parseInt(i, 10)];
    });
    text = autolinkEscaped(text);
    return restoreMath(text, math.segments);
  }

  function inlineParagraph(text, ctx) {
    var parts = text.split('\n');
    var out = [];
    for (var p = 0; p < parts.length; p++) {
      if (p > 0) out.push('<br>');
      out.push(inline(parts[p], ctx));
    }
    return out.join('');
  }

  function parseCells(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) {
      return c.trim();
    });
  }

  function isTableSeparator(line) {
    var cells = parseCells(line);
    if (!cells.length) return false;
    return cells.every(function (c) {
      return /^:?-{3,}:?$/.test(c.replace(/\s/g, ''));
    });
  }

  function isTableRow(line) {
    var t = line.trim();
    if (t.indexOf('|') < 0) return false;
    return !isTableSeparator(t);
  }

  function parseAlignments(separatorLine) {
    return parseCells(separatorLine).map(function (cell) {
      var c = cell.replace(/\s/g, '');
      if (/^:-+:$/.test(c)) return 'center';
      if (/^-+:$/.test(c)) return 'right';
      return 'left';
    });
  }

  function isMermaidLang(lang) {
    return /^mermaid$/i.test(lang || '');
  }

  function isMermaidSource(lines) {
    var first = (lines[0] || '').trim();
    return /^(graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie\s|gitGraph|mindmap|timeline|journey|C4Context)/i.test(
      first,
    );
  }

  function renderMermaidBlock(source) {
    return (
      '<div class="mermaid-diagram-card">' +
      '<pre class="mermaid-source" hidden>' +
      escapeHTML(source) +
      '</pre>' +
      '<div class="mermaid-diagram-body"><div class="mermaid">' +
      escapeHTML(source) +
      '</div></div>' +
      '</div>'
    );
  }

  function renderTable(header, aligns, rows, ctx) {
    var html = '<div class="table-wrap"><table><thead><tr>';
    for (var c = 0; c < header.length; c++) {
      var align = aligns[c] || 'left';
      var style = align !== 'left' ? ' style="text-align:' + align + '"' : '';
      html += '<th' + style + '>' + inline(header[c], ctx) + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < header.length; c++) {
        var cell = rows[r][c] !== undefined ? rows[r][c] : '';
        var align = aligns[c] || 'left';
        var style = align !== 'left' ? ' style="text-align:' + align + '"' : '';
        html += '<td' + style + '>' + inline(cell, ctx) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function lineIndent(line) {
    var m = line.match(/^(\s*)/);
    if (!m) return 0;
    return m[1].replace(/\t/g, '  ').length;
  }

  function parseListLine(line) {
    var task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      return {
        indent: lineIndent(line),
        ordered: false,
        task: true,
        checked: task[2].toLowerCase() === 'x',
        text: task[3],
      };
    }
    var ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      return { indent: lineIndent(line), ordered: false, task: false, text: ul[2] };
    }
    var ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ol) {
      return { indent: lineIndent(line), ordered: true, task: false, text: ol[2] };
    }
    return null;
  }

  function isListLine(line) {
    return parseListLine(line) !== null;
  }

  function isIndentedCodeLine(line) {
    return /^ {4}/.test(line) || /^\t/.test(line);
  }

  function renderListTree(items, start, end, baseIndent, ordered, ctx) {
    var tag = ordered ? 'ol' : 'ul';
    var cls = items[start] && items[start].task ? ' class="task-list"' : '';
    var html = '<' + tag + cls + '>';
    var i = start;
    while (i < end) {
      var item = items[i];
      if (item.indent !== baseIndent) break;
      var li = '<li>';
      if (item.task) {
        li +=
          '<input type="checkbox" disabled' +
          (item.checked ? ' checked' : '') +
          '> ';
      }
      li += inline(item.text, ctx);
      i++;
      if (i < end && items[i].indent > baseIndent) {
        var subOrdered = items[i].ordered;
        var subEnd = i;
        while (subEnd < end && items[subEnd].indent > baseIndent) subEnd++;
        li += renderListTree(items, i, subEnd, items[i].indent, subOrdered, ctx);
        i = subEnd;
      }
      html += li + '</li>';
    }
    html += '</' + tag + '>';
    return html;
  }

  function renderListBlock(lines, startIndex, ctx) {
    var items = [];
    var i = startIndex;
    while (i < lines.length && isListLine(lines[i])) {
      items.push(parseListLine(lines[i]));
      i++;
    }
    if (!items.length) return { html: '', next: startIndex };
    var baseIndent = items[0].indent;
    var ordered = items[0].ordered;
    return { html: renderListTree(items, 0, items.length, baseIndent, ordered, ctx), next: i };
  }

  function renderFootnotesSection(ctx) {
    if (!ctx.usedFootnotes.length) return '';
    var html = '<section class="footnotes"><ol>';
    for (var f = 0; f < ctx.usedFootnotes.length; f++) {
      var id = ctx.usedFootnotes[f];
      var sid = slugId(id);
      html +=
        '<li id="fn-' +
        sid +
        '">' +
        inline(ctx.footnotes[id], ctx) +
        ' <a href="#fnref-' +
        sid +
        '" class="footnote-backref" aria-label="返回">↩</a></li>';
    }
    html += '</ol></section>';
    return html;
  }

  function isSetextUnderline(line, ch) {
    var t = line.trim();
    if (!t || t.charAt(0) !== ch) return false;
    for (var u = 0; u < t.length; u++) {
      if (t.charAt(u) !== ch) return false;
    }
    return true;
  }

  function renderBlocks(md, ctx, isRoot) {
    if (!md) return '';
    var lines = md.split('\n');
    var html = '';
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      var fence = line.match(/^```(\S*)\s*$/);
      if (fence) {
        var lang = fence[1] || '';
        i++;
        var buf = [];
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        var body = buf.join('\n');
        if (isMermaidLang(lang) || (!lang && isMermaidSource(buf))) {
          html += renderMermaidBlock(body);
        } else {
          var langClass = lang ? ' class="language-' + escapeHTML(lang.split(/\s+/)[0]) + '"' : '';
          html += '<pre><code' + langClass + '>' + escapeHTML(body) + '</code></pre>';
        }
        continue;
      }

      if (isIndentedCodeLine(line)) {
        var codeLines = [];
        while (i < lines.length) {
          if (lines[i] === '') {
            if (i + 1 < lines.length && isIndentedCodeLine(lines[i + 1])) {
              codeLines.push('');
              i++;
              continue;
            }
            break;
          }
          if (!isIndentedCodeLine(lines[i])) break;
          var stripped = lines[i].replace(/^\t/, '    ').replace(/^ {4}/, '');
          codeLines.push(stripped);
          i++;
        }
        html += '<pre><code>' + escapeHTML(codeLines.join('\n')) + '</code></pre>';
        continue;
      }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length;
        html += '<h' + lvl + '>' + inline(h[2], ctx) + '</h' + lvl + '>';
        i++;
        continue;
      }

      if (line.trim() && i + 1 < lines.length) {
        if (isSetextUnderline(lines[i + 1], '=')) {
          html += '<h1>' + inline(line.trim(), ctx) + '</h1>';
          i += 2;
          continue;
        }
        if (isSetextUnderline(lines[i + 1], '-') && lines[i + 1].trim().length >= 1) {
          html += '<h2>' + inline(line.trim(), ctx) + '</h2>';
          i += 2;
          continue;
        }
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += '<hr>';
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + renderBlocks(qbuf.join('\n'), ctx, false) + '</blockquote>';
        continue;
      }

      if (isListLine(line)) {
        var listResult = renderListBlock(lines, i, ctx);
        html += listResult.html;
        i = listResult.next;
        continue;
      }

      if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var header = parseCells(line);
        var aligns = parseAlignments(lines[i + 1]);
        i += 2;
        var rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(parseCells(lines[i]));
          i++;
        }
        html += renderTable(header, aligns, rows, ctx);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      var pbuf = [line];
      i++;
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i]) &&
        !isListLine(lines[i]) &&
        !isIndentedCodeLine(lines[i]) &&
        !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) &&
        !(
          lines[i].trim() &&
          i + 1 < lines.length &&
          (isSetextUnderline(lines[i + 1], '=') || isSetextUnderline(lines[i + 1], '-'))
        )
      ) {
        pbuf.push(lines[i]);
        i++;
      }
      html += '<p>' + inlineParagraph(pbuf.join('\n'), ctx) + '</p>';
    }
    if (isRoot) html += renderFootnotesSection(ctx);
    return html;
  }

  function render(md) {
    if (!md) return '';
    var prep = preprocess(md);
    var ctx = {
      footnotes: prep.footnotes,
      linkRefs: prep.linkRefs,
      usedFootnotes: [],
    };
    return renderBlocks(prep.text, ctx, true);
  }

  root.MD = { render: render };
})(window);
