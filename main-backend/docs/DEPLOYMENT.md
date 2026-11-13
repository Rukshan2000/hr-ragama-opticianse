# Deployment

## Image

`Dockerfile` is multi-stage:

1. `build` compiles TypeScript.
2. `prod-deps` runs `npm ci --omit=dev`.
3. `runtime` is `node:22-alpine` with only `dist/` and production `node_modules`, running as `node`. It has a `HEALTHCHECK` on `/health` and handles `SIGTERM` (server drains, then the pool closes, 10 s hard timeout).

There are no secrets in the image. Configuration comes from the environment at runtime.

```bash
docker build -t backend-api:1.0.0 .
```

## Docker Compose

```bash
cp .env.example .env    # set secrets and DB_PASSWORD
docker compose up -d --build
docker compose logs -f api
```

Services:

- `postgres`: PostgreSQL 16 with a named volume `pgdata` and a `pg_isready` health check
- `migrate`: one-off `node dist/scripts/db.js migrate`. It runs after Postgres is healthy and must succeed before the API starts.
- `api`: starts after migrations and runs with `init: true` for correct signal handling

Development with hot reload: `docker compose -f docker-compose.dev.yml up` (Postgres on host port 5433).

Seed reference data on a fresh production DB (idempotent; demo data is never created in production):

```bash
docker compose run --rm migrate node dist/scripts/db.js seed
```

Then create your first super admin, for example from a one-off psql session or a small script, using an Argon2id hash.

## Linux VPS with Nginx

### 1. Server

```bash
# Ubuntu 22.04/24.04
sudo apt update && sudo apt install -y ca-certificates curl nginx ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 2. App

```bash
git clone <repo> /opt/api && cd /opt/api
cp .env.example .env && chmod 600 .env   # NODE_ENV=production, TRUST_PROXY=true, real secrets
```

Bind the API to localhost only, so it is reachable only through Nginx. In `docker-compose.yml`, change the API's ports entry to `"127.0.0.1:5000:5000"`. Don't publish Postgres.

```bash
docker compose up -d --build
curl -s localhost:5000/api/v1/health/ready
```

### 3. Nginx (`/etc/nginx/sites-available/api`)

```nginx
upstream api_upstream {
    server 127.0.0.1:5000;
    keepalive 32;
}

server {
    listen 80;
    server_name api.example.com;

    client_max_body_size 1m;          # keep in sync with BODY_LIMIT_BYTES

    location / {
        proxy_pass http://api_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d api.example.com
```

### 4. Releasing a new version

```bash
cd /opt/api
docker compose exec postgres pg_dump -U postgres -Fc app_db > ~/backups/pre-$(date +%F-%H%M).dump
git pull
docker compose run --rm migrate node dist/scripts/db.js status   # review pending migrations
docker compose up -d --build                                     # migrate job runs, then api restarts
docker compose ps && curl -fsS localhost:5000/api/v1/health/ready
```

Rollback: check out the previous tag and run `docker compose up -d --build`. Roll back the schema only for reversible migrations: `docker compose run --rm migrate node dist/scripts/db.js rollback --force`. See [MIGRATIONS.md](MIGRATIONS.md).

### 5. Operations

- Logs are JSON on stdout: `docker compose logs api`. Ship them with your log agent (Loki, ELK, CloudWatch…). Filter by `reqId`.
- Probes: liveness `GET /api/v1/health`, readiness `GET /api/v1/health/ready` (checks the DB, returns 503 if it is down).
- Backups: run a nightly `pg_dump -Fc` cron to off-site storage, and test restores.
- Scaling out: run several `api` replicas behind Nginx, and switch rate limiting to Redis. Sessions need no sticky routing.
