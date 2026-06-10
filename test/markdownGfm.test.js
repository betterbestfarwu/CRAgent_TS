import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mdSrc = readFileSync(join(root, 'public/chat/markdown.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(mdSrc, sandbox);

const render = (md) => sandbox.window.MD.render(md);

test('renders images with safe src', () => {
  const html = render('![alt](https://example.com/a.png)');
  assert.match(html, /<img[^>]+src="https:\/\/example\.com\/a\.png"/);
  assert.match(html, /alt="alt"/);
});

test('blocks javascript: image urls', () => {
  const html = render('![x](javascript:alert(1))');
  assert.match(html, /src="#"/);
});

test('renders strikethrough', () => {
  const html = render('~~removed~~');
  assert.match(html, /<del>removed<\/del>/);
});

test('renders task lists', () => {
  const html = render('- [ ] todo\n- [x] done');
  assert.match(html, /class="task-list"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
});

test('renders nested unordered lists', () => {
  const html = render('- a\n  - b\n    - c');
  assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*<li>[\s\S]*c/);
});

test('autolinks bare https urls', () => {
  const html = render('see https://example.com/path');
  assert.match(html, /<a href="https:\/\/example\.com\/path"/);
});

test('code fences use language- class for highlight.js', () => {
  const html = render('```js\nconst x = 1\n```');
  assert.match(html, /class="language-js"/);
});

test('paragraph single newlines become br', () => {
  const html = render('line one\nline two');
  assert.match(html, /line one<br>line two/);
});

test('renders ==highlight== as mark', () => {
  const html = render('==important==');
  assert.match(html, /<mark>important<\/mark>/);
});

test('renders setext h1 and h2', () => {
  const h1 = render('Title one\n=====');
  assert.match(h1, /<h1>Title one<\/h1>/);
  const h2 = render('Title two\n-----');
  assert.match(h2, /<h2>Title two<\/h2>/);
});

test('renders four-space indented code blocks', () => {
  const html = render('    const a = 1\n    const b = 2');
  assert.match(html, /<pre><code>[\s\S]*const a = 1/);
  assert.match(html, /const b = 2/);
});

test('renders reference-style links', () => {
  const html = render('See [Example][ex].\n\n[ex]: https://example.com');
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*>Example<\/a>/);
});

test('renders reference-style images', () => {
  const html = render('![pic][img]\n\n[img]: https://example.com/p.png');
  assert.match(html, /<img[^>]+src="https:\/\/example\.com\/p\.png"/);
});

test('renders footnotes with backlink', () => {
  const html = render('Text[^note] here.\n\n[^note]: Footnote body.');
  assert.match(html, /class="footnote-ref"/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /Footnote body/);
  assert.match(html, /footnote-backref/);
});

test('renders math-only fenced blocks as display math', () => {
  const html = render('```\n$$a = \\frac{GM}{(R+h)^2}$$\n```');
  assert.doesNotMatch(html, /<pre><code>/);
  assert.match(html, /class="math-block"/);
  assert.match(html, /\$\$a = \\frac\{GM\}\{\(R\+h\)\^2\}\$\$/);
});

test('renders latex fenced blocks as display math', () => {
  const html = render('```latex\nE = mc^2\n```');
  assert.doesNotMatch(html, /<pre><code>/);
  assert.match(html, /\$\$E = mc\^2\$\$/);
});

test('unwraps display math from inline code backticks', () => {
  const html = render('公式 `$$g = \\frac{GM}{R^2}$$` 如下');
  assert.doesNotMatch(html, /<code>/);
  assert.match(html, /\$\$g = \\frac\{GM\}\{R\^2\}\$\$/);
});
