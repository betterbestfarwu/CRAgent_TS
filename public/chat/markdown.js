// Minimal Markdown renderer. Supports headers, code fences, inline code,
// bold/italic, links, lists, blockquotes, tables, hr, and paragraphs.
// Not a full CommonMark impl — adequate for chat output.
(function (root) {
  function escapeHTML(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function protectMath(text) {
    var segments = [];
    // Block math $$ ... $$ (multiline)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (match) {
      segments.push(match);
      return '\u0002M' + (segments.length - 1) + '\u0002';
    });
    // Inline math $ ... $ (single line; not $$)
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

  function inline(text) {
    var math = protectMath(text);
    text = math.text;
    // Inline code first to protect contents.
    var codePlaceholders = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, c) {
      codePlaceholders.push('<code>' + escapeHTML(c) + '</code>');
      return '\u0001CODE' + (codePlaceholders.length - 1) + '\u0001';
    });
    text = escapeHTML(text);
    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      return '<a href="' + u + '" target="_blank">' + t + '</a>';
    });
    // Bold **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text* or _text_
    text = text.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    // Restore inline code
    text = text.replace(/\u0001CODE(\d+)\u0001/g, function (_, i) {
      return codePlaceholders[parseInt(i, 10)];
    });
    return restoreMath(text, math.segments);
  }

  function parseCells(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) { return c.trim(); });
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

  function renderTable(header, aligns, rows) {
    var html = '<div class="table-wrap"><table><thead><tr>';
    for (var c = 0; c < header.length; c++) {
      var align = aligns[c] || 'left';
      var style = align !== 'left' ? ' style="text-align:' + align + '"' : '';
      html += '<th' + style + '>' + inline(header[c]) + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < header.length; c++) {
        var cell = rows[r][c] !== undefined ? rows[r][c] : '';
        var align = aligns[c] || 'left';
        var style = align !== 'left' ? ' style="text-align:' + align + '"' : '';
        html += '<td' + style + '>' + inline(cell) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function render(md) {
    if (!md) return '';
    var lines = md.replace(/\r\n/g, '\n').split('\n');
    var html = '';
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      // Code fence
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
        html += '<pre><code' + (lang ? ' class="lang-' + lang + '"' : '') + '>' +
                escapeHTML(buf.join('\n')) + '</code></pre>';
        continue;
      }

      // Heading
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length;
        html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>';
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
        html += '<hr>';
        i++;
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html += '<blockquote>' + render(qbuf.join('\n')) + '</blockquote>';
        continue;
      }

      // Unordered list
      if (/^[-*+]\s+/.test(line)) {
        var ubuf = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          ubuf.push('<li>' + inline(lines[i].replace(/^[-*+]\s+/, '')) + '</li>');
          i++;
        }
        html += '<ul>' + ubuf.join('') + '</ul>';
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(line)) {
        var obuf = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          obuf.push('<li>' + inline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
          i++;
        }
        html += '<ol>' + obuf.join('') + '</ol>';
        continue;
      }

      // GFM table (header + separator + body rows)
      if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        var header = parseCells(line);
        var aligns = parseAlignments(lines[i + 1]);
        i += 2;
        var rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(parseCells(lines[i]));
          i++;
        }
        html += renderTable(header, aligns, rows);
        continue;
      }

      // Blank line -> paragraph break
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // Paragraph (combine until blank/heading/etc.)
      var pbuf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s|(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
             !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
        pbuf.push(lines[i]);
        i++;
      }
      html += '<p>' + inline(pbuf.join('\n')) + '</p>';
    }
    return html;
  }

  root.MD = { render: render };
})(window);
