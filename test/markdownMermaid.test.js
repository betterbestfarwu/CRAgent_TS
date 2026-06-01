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

test('renders ```mermaid fences as diagram cards', () => {
  const html = render('```mermaid\ngraph TD\n  A-->B\n```');
  assert.match(html, /class="mermaid-diagram-card"/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /mermaid-source/);
  assert.match(html, /graph TD/);
  assert.doesNotMatch(html, /<pre><code/);
});

test('renders unlabeled graph blocks as mermaid', () => {
  const html = render('```\nflowchart LR\n  X-->Y\n```');
  assert.match(html, /class="mermaid-diagram-card"/);
});
