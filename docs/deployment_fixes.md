# Deployment Fixes

Issues encountered and resolved during the first EC2 deployment.

---

## 1. Backend crashed on startup — `MONGODB_URI not set`

`server.js` was calling `connectDB()` at startup, which required a MongoDB URI. Since the backend was migrated to DynamoDB, this call was removed entirely.

## 2. `.env` not loaded — wrong dotenv path

`server.js` loaded dotenv with `path.resolve(__dirname, '../.env')`, which was correct in the original project layout (`.env` sat above the `backend/` folder). After packaging the backend alone into a zip, the `.env` file sits alongside `server.js` at the same level. Fixed to `path.resolve(__dirname, '.env')`.

## 3. CORS rejected all browser requests

`CORS_ORIGIN=*` was set in the `.env` but the middleware checked `origin === process.env.CORS_ORIGIN`, which tests whether the browser's origin header literally equals the string `"*"` — no browser ever sends that. Added a special case: if `CORS_ORIGIN === '*'`, allow all origins.

## 4. Frontend build calling `localhost:3001` in production

The frontend `src/config/api.js` falls back to `http://localhost:3001` if `VITE_API_BASE_URL` is set in the local `.env` file. That value was being baked into the production build. Added `.env.production` with `VITE_API_BASE_URL=/api` so production builds always use the relative path, which nginx proxies to the backend.

## 5. nginx serving its own 404 instead of proxying `/api/`

Amazon Linux 2023's default `nginx.conf` includes a server block with `listen 80; server_name _;` in the main config file (not in `conf.d/`). The UserData script only removed `conf.d/default.conf`, which doesn't exist on AL2023 — the default block stayed active and intercepted all requests. Fixed by adding `default_server` to both the IPv4 and IPv6 listeners in `commie.conf`:

```nginx
listen 80 default_server;
listen [::]:80 default_server;
```

## 6. nginx stripping `/api/` prefix — wrong `proxy_pass` format

nginx's `proxy_pass` behavior depends on whether a URI is present:
- `proxy_pass http://host:port;` — forwards the full original path (e.g. `/api/auth/register`)
- `proxy_pass http://host:port/;` — replaces the matched location prefix, stripping `/api/`

The backend has no `/api/` prefix on its routes, so the trailing slash is required. It was mistakenly removed during an earlier edit and restored.

## 7. PM2 process list not persisting across reboots

During EC2 UserData execution, the `HOME` environment variable is not set. PM2 defaulted to `/etc/.pm2` as its home directory and saved the process list there. However, `pm2 startup` generated a systemd service with `PM2_HOME=/root/.pm2`. On reboot, the service looked in the wrong directory and started with no processes. Fixed by adding `export HOME=/root` at the top of the backend UserData script.
