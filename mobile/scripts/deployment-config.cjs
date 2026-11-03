// Project identity is supplied by Vercel, never inferred from NODE_ENV or a default.
const projects = {
  'hisab-mobile': {
    branch: 'dev',
    environment: 'development',
    target: 'https://hishob-dev.onrender.com',
  },
  hishob: {
    branch: 'prod',
    environment: 'production',
    target: 'https://hishob-anuj.onrender.com',
  },
};

function createDeploymentConfig(env) {
  const project = Object.hasOwn(projects, env.VERCEL_PROJECT_NAME)
    ? projects[env.VERCEL_PROJECT_NAME]
    : undefined;
  if (!project) {
    throw new Error(
      'Deployment blocked: VERCEL_PROJECT_NAME must identify a known Hishob project.',
    );
  }
  if (env.VERCEL_GIT_COMMIT_REF !== project.branch) {
    throw new Error('Deployment blocked: Git branch does not match the Vercel project.');
  }
  if (env.APP_ENV !== project.environment || env.EXPO_PUBLIC_APP_ENV !== project.environment) {
    throw new Error(
      'Deployment blocked: APP_ENV and EXPO_PUBLIC_APP_ENV must match the Vercel project.',
    );
  }
  // Exact equality rejects missing URLs, HTTP, credentials, paths, ports, suffix attacks,
  // trailing slashes, whitespace and the other environment. Never normalize or fall back.
  if (env.API_PROXY_TARGET !== project.target) {
    throw new Error(
      'Deployment blocked: API_PROXY_TARGET must be the exact backend origin for this project.',
    );
  }
  if (env.EXPO_PUBLIC_WEB_API_URL !== undefined && env.EXPO_PUBLIC_WEB_API_URL !== '') {
    throw new Error(
      'Deployment blocked: remove EXPO_PUBLIC_WEB_API_URL; exported web apps use /api.',
    );
  }
  const target = env.API_PROXY_TARGET;
  return {
    framework: null,
    buildCommand: 'npm run check:deployment && npm run build:web',
    outputDirectory: 'dist',
    rewrites: [
      {
        source: '/api/face-station/',
        destination: `${target}/api/face-station/`,
      },
      {
        source: '/api/face-station',
        destination: `${target}/api/face-station/`,
      },
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
      {
        source:
          '/((?!api(?:/|$)|_expo/|assets/|icons/|sw\\.js$|manifest\\.webmanifest$|favicon\\.ico$).*)',
        destination: '/index.html',
      },
    ],
    headers: [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/index.html',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache',
          },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
    ],
  };
}

module.exports = { createDeploymentConfig };
