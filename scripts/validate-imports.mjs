import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["src", "test"].map((dir) => path.join(root, dir));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "out", "dist"].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(jsx?|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function parseExports(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const names = new Set();
  if (/export\s+default/.test(src)) names.add("default");
  const re =
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|export\s+const\s+([A-Za-z_$][\w$]*)|export\s+class\s+([A-Za-z_$][\w$]*)|export\s+\{\s*([^}]+)\s*\}(?:\s*from\s*['"][^'"]+['"])?/g;
  let match;
  while ((match = re.exec(src))) {
    for (const name of [match[1], match[2], match[3]].filter(Boolean)) {
      names.add(name);
    }
    if (match[4]) {
      for (const part of match[4].split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        names.add(trimmed.split(/\s+as\s+/).pop().trim());
      }
    }
  }
  return names;
}

function resolveImport(fromFile, spec) {
  if (spec.startsWith("@shared/")) {
    const rel = spec.replace("@shared/", "src/shared/");
    for (const candidate of [rel, `${rel}.js`]) {
      const full = path.join(root, candidate);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }
  if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const candidate of [base, `${base}.js`, `${base}.jsx`, path.join(base, "index.js")]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const files = scanRoots.flatMap((dir) => walk(dir));
const exportCache = new Map();
const importRe =
  /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g;
const issues = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let match;
  while ((match = importRe.exec(src))) {
    const [, named, defaultName, spec] = match;
    if (!spec.startsWith("@shared/") && !spec.startsWith(".")) continue;
    const target = resolveImport(file, spec);
    if (!target) {
      issues.push(`${path.relative(root, file)} -> ${spec}: module not found`);
      continue;
    }
    if (!exportCache.has(target)) exportCache.set(target, parseExports(target));
    const exports = exportCache.get(target);
    if (defaultName && !exports.has("default")) {
      issues.push(`${path.relative(root, file)} -> ${spec}: missing default export`);
    }
    if (named) {
      for (const part of named.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, "");
        if (!name) continue;
        if (!exports.has(name)) {
          issues.push(`${path.relative(root, file)} -> ${spec}: missing export "${name}"`);
        }
      }
    }
  }
}

if (issues.length) {
  console.error("Import validation failed:\n" + issues.map((line) => `- ${line}`).join("\n"));
  process.exit(1);
}

console.log(`Import validation passed (${files.length} files).`);
