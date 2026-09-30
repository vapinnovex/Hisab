# Development Start Commands

Run each command in a separate PowerShell window, in this order.

## 1. MongoDB

From the repository root:

```powershell
New-Item -ItemType Directory -Force .local\mongo
& 'C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe' --dbpath (Resolve-Path .local\mongo) --bind_ip 127.0.0.1 --port 27018
```

## 2. Backend API

From the repository root:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
```

API health check: http://localhost:8000/health

## 3. Frontend (web)

From the repository root:

```powershell
cd mobile
npm run web -- --port 8081
```

Web app: http://localhost:8081

## Stop

Press `Ctrl+C` in each PowerShell window.
