# Deployment branding

Keep both sets of images committed on both branches:

| Use                       | Development                        | Production                     |
| ------------------------- | ---------------------------------- | ------------------------------ |
| App logo, favicon, splash | `assets/brand/hishob-dev-logo.png` | `assets/brand/hishob-logo.png` |
| 192 × 192 PWA icon        | `public/icons/hishob-dev-192.png`  | `public/icons/hishob-192.png`  |
| 512 × 512 PWA icon        | `public/icons/hishob-dev-512.png`  | `public/icons/hishob-512.png`  |

Set `EXPO_PUBLIC_APP_ENV=development` in the dev deployment's **build environment**
and `EXPO_PUBLIC_APP_ENV=production` in the production deployment's build environment.
For local use, add the same variable to `mobile/.env` and restart Expo.
If unset, branding defaults to production. Other values fail the build.

Build web deployments with `npm run build:web` from `mobile/`. This updates the
generated manifest and Apple touch icon before generating the service-worker cache.
Development deployments are named **Hishob Dev** in the manifest and HTML title.
The static files in `public/` retain production defaults; the dev server's manifest
does not undergo this export step. Use the exported build to check installed PWA icons.

Do not use `NODE_ENV` to select branding: Expo web exports use production mode
even for the dev deployment. This variable only controls branding, not API routing.
Changes require rebuilding and redeploying; installed PWAs may need reinstalling
before the operating system shows their updated icon. Native package identifiers
are unchanged, so this does not enable side-by-side native installations.
