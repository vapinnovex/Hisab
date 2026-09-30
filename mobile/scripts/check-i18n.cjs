/* global __dirname */
// Keep translations complete without changing API identifiers or user content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const hi = require('../src/locales/hi.json');
const mr = require('../src/locales/mr.json');
assert.deepEqual(Object.keys(hi).sort(), Object.keys(mr).sort());
const placeholders = (text) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
for (const catalog of [hi, mr]) {
  for (const [source, translated] of Object.entries(catalog)) {
    assert.ok(translated.trim(), `Empty translation: ${source}`);
    assert.deepEqual(placeholders(translated), placeholders(source), `Placeholders: ${source}`);
  }
}
const files = [path.join(root, 'App.tsx')];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file)) files.push(file);
  }
}
walk(path.join(root, 'src'));
const missing = new Set();
const rawText = new Set();
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    if (ts.isJsxText(node)) {
      if (/[a-zA-Z]/.test(node.text))
        rawText.add(`${path.relative(root, file)}: ${node.text.trim()}`);
    }
    if (
      ts.isJsxAttribute(node) &&
      [
        'title',
        'label',
        'placeholder',
        'accessibilityLabel',
        'description',
        'subtitle',
        'helperText',
      ].includes(node.name.getText(source)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      assert.ok(
        !/[a-zA-Z]/.test(node.initializer.text) ||
          ['YYYY-MM-DD', 'YYYY-MM', 'Asia/Kolkata', 'you@example.com'].includes(
            node.initializer.text,
          ),
        `Untranslated attribute in ${file}: ${node.initializer.text}`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 't' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const key = node.arguments[0].text;
      if (!(key in hi)) missing.add(key);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
assert.equal(missing.size, 0, `Missing translations: ${JSON.stringify([...missing])}`);
assert.equal(rawText.size, 0, `Untranslated JSX: ${JSON.stringify([...rawText])}`);
console.log(
  `Translation coverage passed: ${Object.keys(hi).length} messages in Hindi and Marathi.`,
);
