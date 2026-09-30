# Backend Run Guide

This guide starts the FastAPI backend locally on Windows using the project virtual environment and a local MongoDB server.

## Prerequisites

- Python 3.9 or newer (Python 3.12 is recommended; Python 3.10 also works).
- MongoDB installed locally, or Docker Desktop.
- A configured `backend/.env` file. Copy `.env.example` to `.env` if it does not exist, then set the required values.

## First-time setup

Open PowerShell in the repository root, then run:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Use `requirements.txt` on Windows. The checked-in lockfile currently includes `uvloop`, which is not supported on Windows.

## Start MongoDB

The backend expects MongoDB at `mongodb://127.0.0.1:27018` unless `MONGODB_URI` in `.env` says otherwise.

With the MongoDB server installed locally:

```powershell
New-Item -ItemType Directory -Force ..\.local\mongo
& 'C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe' --dbpath (Resolve-Path ..\.local\mongo) --bind_ip 127.0.0.1 --port 27018
```

Keep that PowerShell window open. If Docker is installed, this is an alternative:

```powershell
docker compose up -d mongo
```

## Start the API

In a second PowerShell window:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
```

The API is available at:

- Health check: http://localhost:8000/health
- Interactive API docs: http://localhost:8000/docs

Expected health response:

```json
{"status":"ok"}
```

## Development reload

Normally, add `--reload` while developing:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000
```

If Windows reports a named-pipe permission error from the watcher, leave off `--reload` and use the standard start command above.

## Stop services

Press `Ctrl+C` in the API window to stop FastAPI. Press `Ctrl+C` in the MongoDB window to stop the local database. For Docker-based MongoDB, run this from the repository root:

```powershell
docker compose stop mongo
```
