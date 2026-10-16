# NAGARSETU 3.1 — Vercel Backend Deployment Guide

This guide provides step-by-step instructions for deploying the **NAGARSETU 3.1 Express Backend API** to Vercel (`nagarsetu-api`) as a serverless application integrated with Supabase PostgreSQL and Supabase Storage.

---

## Architecture Overview

```
Frontend (Netlify / Vercel)
    ↓ HTTPS API Requests
Vercel Serverless Function (backend/api/index.js)
    ↓
NAGARSETU Express App Engine (backend/src/app.js)
    ↓
Supabase
    ├── PostgreSQL Database (Database Queries & Auth)
    ├── Authentication (JWT & User Profiles)
    └── Storage ('issues' Bucket for Permanent Images)
```

---

## 1. Vercel Project Creation

1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** → **Project**.
3. Import your **NAGARSETU 3.1** repository (GitHub / GitLab / Bitbucket).
4. Configure project settings:
   - **Project Name**: `nagarsetu-api`
   - **Framework Preset**: `Other` (or `Express`)
   - **Root Directory**: Select `backend`

---

## 2. Required Vercel Environment Variables

In Vercel **Project Settings** → **Environment Variables**, add the following environment variables:

| Environment Variable Key | Description | Example / Note |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `5000` |
| `JWT_SECRET` | Secret key for signing JWT tokens | `your_secure_jwt_secret_key` |
| `DATABASE_URL` | Supabase / PostgreSQL Connection String | `postgres://postgres:[PASSWORD]@db.[PROJECT_ID].supabase.co:5432/postgres` |
| `DB_TYPE` | Database driver selection | `postgres` |
| `SUPABASE_URL` | Supabase Project HTTPS URL | `https://[PROJECT_ID].supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key (Backend Only) | `your_supabase_service_role_key` |
| `SUPABASE_ANON_KEY` | Supabase Anonymous Key | `your_supabase_anon_key` |
| `FRONTEND_URL` | Deployed Frontend Origin URL for CORS | `https://your-frontend-site.netlify.app` |
| `PYTHON_AI_URL` | Deployed Python AI Vision Service URL (Must NOT be localhost in production) | `https://your-ai-service.onrender.com/analyze` |
| `GOOGLE_MAPS_API_KEY` | Google Maps API Key | `your_google_maps_api_key` |

> [!CAUTION]
> **SECURITY NOTICE**: NEVER expose `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` in frontend variables (`VITE_*`). Keep service keys restricted strictly to backend environment variables.

---

## 3. Vercel Configuration Files

The project contains the serverless adapter configuration:

- **[`backend/api/index.js`](file:///d:/NAGARSETU/NAGARSETU%203.1/backend/api/index.js)**: Wraps Express `app` for Vercel serverless function execution.
- **[`backend/vercel.json`](file:///d:/NAGARSETU/NAGARSETU%203.1/backend/vercel.json)**:
  ```json
  {
    "version": 2,
    "builds": [
      {
        "src": "api/index.js",
        "use": "@vercel/node"
      }
    ],
    "routes": [
      {
        "src": "/api/(.*)",
        "dest": "/api/index.js"
      },
      {
        "src": "/(.*)",
        "dest": "/api/index.js"
      }
    ]
  }
  ```

---

## 4. Supabase Storage Requirements (Persistent Image Uploads)

Serverless functions on Vercel do not have a persistent local disk. All citizen and field officer photo evidence uploads are uploaded directly to Supabase Storage:

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) → **Storage**.
2. Create a public bucket named: `issues`.
3. Set bucket access to **Public** so uploaded evidence images can be viewed across Citizen, Department Head, Field Staff, and Admin Portals.
4. Set policies allowing authenticated/public inserts if uploading directly.

---

## 5. Configuring Frontend `VITE_API_URL`

After Vercel deploys the backend, obtain your backend domain (e.g., `https://nagarsetu-api.vercel.app`).

In your frontend hosting provider (Netlify or Vercel Frontend), add:

```env
VITE_API_URL=https://nagarsetu-api.vercel.app
```

This routes all frontend REST calls (`/api/auth/login`, `/api/complaints`, `/api/staff`, etc.) directly to your Vercel backend over secure HTTPS.

---

## 6. How to Test Backend Health Endpoint

After deployment, open your browser or run `curl`:

```bash
curl https://nagarsetu-api.vercel.app/api/health
```

Expected JSON Response:

```json
{
  "success": true,
  "message": "NAGARSETU Backend is running",
  "status": "ok",
  "service": "NAGARSETU Express Backend API",
  "version": "1.0.0",
  "timestamp": "2026-08-30T23:15:00.000Z"
}
```

---

## 7. Troubleshooting & Common Errors

| Error | Root Cause | Solution |
| :--- | :--- | :--- |
| **500 Internal Server Error** | Missing `DATABASE_URL` or `SUPABASE_URL` | Verify Environment Variables in Vercel Dashboard. |
| **CORS Error in Browser** | `FRONTEND_URL` mismatch | Add your exact frontend URL (including `https://`) to `FRONTEND_URL` variable. |
| **Upload Failed / 404 Image** | Supabase `issues` bucket missing | Create public `issues` bucket in Supabase Storage. |
| **404 Not Found on API routes** | `vercel.json` routing misconfigured | Ensure `vercel.json` rewrites `/api/(.*)` to `/api/index.js`. |
