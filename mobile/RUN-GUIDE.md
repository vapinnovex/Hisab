# Frontend Run Guide

This guide starts the Expo frontend in a web browser and connects it to the local backend API.

## Prerequisites

- Node.js 22.13+ (Node 22 LTS is recommended).
- npm, included with Node.js.
- The backend API running locally. See [`../backend/RUN-GUIDE.md`](../backend/RUN-GUIDE.md).

## Configure the API URL

The browser frontend uses `http://localhost:8000` by default. Create `mobile/.env` from the example if it does not already exist:

```powershell
cd mobile
Copy-Item .env.example .env
```

For local browser development, the default value is correct:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:8000
```

If needed, `EXPO_PUBLIC_WEB_API_URL` overrides the browser-only API URL.

## First-time setup

From the repository root, install the locked dependencies:

```powershell
cd mobile
npm ci
```

## Start in web mode

Ensure the backend is running on port 8000, then run:

```powershell
cd mobile
npm run web -- --port 8081
```

Open the URL shown by Expo, normally http://localhost:8081.

## Verify the local services

The frontend should load at:

- Web app: http://localhost:8081
- Backend health check: http://localhost:8000/health
- Backend API docs: http://localhost:8000/docs

The backend health endpoint should return:

```json
{ "status": "ok" }
```

## Stop the frontend

Press `Ctrl+C` in the PowerShell window running Expo.

## Troubleshooting

- If the browser cannot connect to the API, confirm the backend is running and `EXPO_PUBLIC_API_URL` in `.env` uses `http://localhost:8000`.
- After changing a value in `.env`, stop Expo and start it again so the updated environment variables are loaded.
- If port 8081 is already in use, choose another port, for example: `npm run web -- --port 8082`.
- A Windows `spawn EPERM` warning while Expo tries to install React Native DevTools does not prevent the web server from starting. The app can still be opened at the Expo URL.
