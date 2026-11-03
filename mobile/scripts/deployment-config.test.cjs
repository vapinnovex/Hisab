/* global __dirname */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { getTransformedRoutes } = require('@vercel/routing-utils');
const { createDeploymentConfig } = require('./deployment-config.cjs');

const root = resolve(__dirname, '..');
const environments = [
  {
    VERCEL_PROJECT_NAME: 'hisab-mobile',
    VERCEL_GIT_COMMIT_REF: 'dev',
    APP_ENV: 'development',
    EXPO_PUBLIC_APP_ENV: 'development',
    API_PROXY_TARGET: 'https://hishob-dev.onrender.com',
  },
  {
    VERCEL_PROJECT_NAME: 'hishob',
    VERCEL_GIT_COMMIT_REF: 'prod',
    APP_ENV: 'production',
    EXPO_PUBLIC_APP_ENV: 'production',
    API_PROXY_TARGET: 'https://hishob-anuj.onrender.com',
  },
];

function compiledRoutes(env) {
  const result = getTransformedRoutes(createDeploymentConfig(env));
  assert.equal(result.error, null);
  return result.routes;
}

function destination(routes, path) {
  const route = routes.find((rule) => rule.dest && new RegExp(rule.src).test(path));
  return route ? path.replace(new RegExp(route.src), route.dest) : undefined;
}

function headersFor(routes, path) {
  return Object.fromEntries(
    routes
      .filter((rule) => rule.headers && new RegExp(rule.src).test(path))
      .flatMap((rule) => Object.entries(rule.headers))
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
}

for (const env of environments) {
  const label = env.APP_ENV;
  test(`${label}: Vercel compiles all API rewrites to the correct backend`, () => {
    const routes = compiledRoutes(env);
    for (const [path, upstream] of [
      ['/api/face-station', '/api/face-station/'],
      ['/api/face-station/', '/api/face-station/'],
      ['/api/face-station/assets/camera.js', '/api/face-station/assets/camera.js'],
      ['/api/auth/password/options', '/api/auth/password/options'],
      ['/api/shops/shop-1', '/api/shops/shop-1'],
      ['/api/unknown', '/api/unknown'],
    ]) {
      assert.equal(destination(routes, path), env.API_PROXY_TARGET + upstream);
    }
  });

  test(`${label}: SPA routes work without swallowing static assets or API`, () => {
    const routes = compiledRoutes(env);
    for (const path of ['/', '/login', '/shops/123', '/apiary']) {
      assert.equal(destination(routes, path), '/index.html');
    }
    for (const path of [
      '/_expo/static/js/web/index.js',
      '/assets/font.ttf',
      '/icons/hishob-192.png',
      '/sw.js',
      '/manifest.webmanifest',
      '/favicon.ico',
    ]) {
      // No rewrite: Vercel serves the file, or returns 404 if it is missing.
      assert.equal(destination(routes, path), undefined);
    }
  });

  test(`${label}: caching and security headers are preserved`, () => {
    const routes = compiledRoutes(env);
    for (const path of ['/', '/login', '/api/auth/me', '/assets/image.png', '/sw.js']) {
      const headers = headersFor(routes, path);
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.equal(headers['x-frame-options'], 'DENY');
    }
    assert.equal(headersFor(routes, '/api/auth/me')['cache-control'], 'no-store');
    assert.equal(headersFor(routes, '/index.html')['cache-control'], 'no-cache');
    assert.equal(headersFor(routes, '/manifest.webmanifest')['cache-control'], 'no-cache');
    assert.equal(
      headersFor(routes, '/sw.js')['cache-control'],
      'no-cache, no-store, must-revalidate',
    );
    assert.equal(headersFor(routes, '/sw.js')['service-worker-allowed'], '/');
  });

  test(`${label}: actual programmatic entry point exports the validated config`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { config } from './vercel.mjs'; console.log(JSON.stringify(config));",
      ],
      { cwd: root, env, encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), createDeploymentConfig(env));
    assert.equal(
      JSON.parse(result.stdout).buildCommand,
      'npm run check:deployment && npm run build:web',
    );
    assert.equal(JSON.parse(result.stdout).outputDirectory, 'dist');
  });

  test(`${label}: Vercel deployment scope never selects the backend`, () => {
    for (const scope of ['production', 'preview', 'development']) {
      assert.deepEqual(
        createDeploymentConfig({ ...env, VERCEL_ENV: scope, NODE_ENV: 'production' }),
        createDeploymentConfig(env),
      );
    }
  });

  for (const key of Object.keys(env)) {
    test(`${label}: missing ${key} fails closed`, () => {
      const missing = { ...env };
      delete missing[key];
      assert.throws(() => createDeploymentConfig(missing), /Deployment blocked/);
    });
  }

  for (const target of [
    '',
    'http://hishob-dev.onrender.com',
    env.API_PROXY_TARGET + '/',
    env.API_PROXY_TARGET + ':443',
    env.API_PROXY_TARGET + '/api',
    env.API_PROXY_TARGET + '?backend=other',
    env.API_PROXY_TARGET + '#fragment',
    env.API_PROXY_TARGET + '.evil.example',
    env.API_PROXY_TARGET + '@evil.example',
    ' ' + env.API_PROXY_TARGET,
    'https://secret:password@hishob-dev.onrender.com',
    'not a URL',
    environments.find((other) => other !== env).API_PROXY_TARGET,
  ]) {
    test(`${label}: rejects invalid or cross-environment target ${target}`, () => {
      assert.throws(
        () => createDeploymentConfig({ ...env, API_PROXY_TARGET: target }),
        /API_PROXY_TARGET/,
      );
    });
  }

  test(`${label}: wrong branch, branding or app environment fails closed`, () => {
    for (const key of ['VERCEL_GIT_COMMIT_REF', 'APP_ENV', 'EXPO_PUBLIC_APP_ENV']) {
      assert.throws(() => createDeploymentConfig({ ...env, [key]: 'wrong' }), /Deployment blocked/);
    }
    const other = environments.find((candidate) => candidate !== env);
    assert.throws(
      () => createDeploymentConfig({ ...other, VERCEL_PROJECT_NAME: env.VERCEL_PROJECT_NAME }),
      /Deployment blocked/,
    );
  });

  test(`${label}: browser URL override is forbidden; empty is allowed`, () => {
    assert.deepEqual(
      createDeploymentConfig({ ...env, EXPO_PUBLIC_WEB_API_URL: '' }),
      createDeploymentConfig(env),
    );
    for (const value of [' ', env.API_PROXY_TARGET, '/api']) {
      assert.throws(
        () => createDeploymentConfig({ ...env, EXPO_PUBLIC_WEB_API_URL: value }),
        /EXPO_PUBLIC_WEB_API_URL/,
      );
    }
  });
}

test('unknown project and prototype names fail closed', () => {
  for (const name of ['other-project', 'constructor', '__proto__', '']) {
    assert.throws(
      () => createDeploymentConfig({ ...environments[0], VERCEL_PROJECT_NAME: name }),
      /VERCEL_PROJECT_NAME/,
    );
  }
});

test('invalid deployment stops at the entry point without revealing input values', () => {
  const result = spawnSync(process.execPath, ['scripts/check-deployment.cjs'], {
    cwd: root,
    env: { ...environments[0], API_PROXY_TARGET: 'https://private-secret@example.com' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Deployment blocked/);
  assert.ok(!result.stderr.includes('private-secret'));
});

test('only one supported Vercel configuration exists after branch merges', () => {
  assert.deepEqual(
    readdirSync(root).filter((file) => /^vercel\.(json|toml|js|mjs|cjs|ts|mts)$/.test(file)),
    ['vercel.mjs'],
  );
});
