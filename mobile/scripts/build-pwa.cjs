/* global __dirname */
const { readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const root = resolve(__dirname, '../dist');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
const assets = files(root)
  .filter((file) => !file.endsWith('.map') && !file.endsWith('/sw.js'))
  .sort();
const template = readFileSync(join(__dirname, 'worker.template.js'), 'utf8');
const hash = createHash('sha256').update(template);
assets.forEach((file) => hash.update(relative(root, file)).update(readFileSync(file)));
const version = hash.digest('hex').slice(0, 16);
writeFileSync(
  join(root, 'sw.js'),
  template
    .replace(
      'const CACHE = __CACHE_NAME__;',
      `const CACHE = ${JSON.stringify(`hishob-shell-${version}`)};`,
    )
    .replace(
      'const ASSETS = __ASSET_PATHS__;',
      `const ASSETS = ${JSON.stringify(assets.map((file) => `/${relative(root, file)}`))};`,
    ),
);
console.log(`PWA shell ${version}: ${assets.length} static assets. API data is never cached.`);
