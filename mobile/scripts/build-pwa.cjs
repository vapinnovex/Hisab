/* global __dirname */
const { readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const root = resolve(__dirname, '../dist');
// Match Expo export's dotenv mode, including when launched outside mobile/.
require('@expo/env').loadProjectEnv(resolve(__dirname, '..'), { mode: 'production' });
const environment = process.env.EXPO_PUBLIC_APP_ENV || 'production';
if (!['development', 'production'].includes(environment)) {
  throw new Error('EXPO_PUBLIC_APP_ENV must be development or production');
}
if (environment === 'development') {
  const manifestPath = join(root, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.name = 'Hishob Dev';
  manifest.short_name = 'Hishob Dev';
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: icon.src.replace('/hishob-', '/hishob-dev-'),
  }));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const indexPath = join(root, 'index.html');
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8')
      .replace('<title>Hishob</title>', '<title>Hishob Dev</title>')
      .replace('content="Hishob"', 'content="Hishob Dev"')
      .replace('/icons/hishob-192.png', '/icons/hishob-dev-192.png'),
  );
}
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
