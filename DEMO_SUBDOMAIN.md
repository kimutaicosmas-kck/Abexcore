# Demo subdomain (`demo.abexcore.co.ke`) on the same VPS

Production stays in **`~/Abexcore`**. Demo runs in a **separate folder**, **separate Docker project**, **separate MySQL volume**, and **separate upload files**. The only shared resource is the **server** (and production **Caddy** routes HTTPS to demo on port **8081**).

## DNS (Hostnali)

| Type | Host | Value |
|------|------|--------|
| A | `demo` | Same public IP as `@` / `www` (e.g. `169.58.111.250`) |

Nameservers must remain **ns1.hostnali.net** / **ns2.hostnali.net**.

## One-time: production Caddy (safe for live data)

From **`~/Abexcore`** after `git pull` (includes `demo.abexcore.co.ke` in `docker/Caddyfile`):

```bash
cd ~/Abexcore
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d caddy
```

This **reloads Caddy config only**; it does not rebuild the production app or MySQL.

## Demo stack (new clone)

```bash
cd ~
git clone <your-repo-url> Abexcore-demo
cd Abexcore-demo
cp .env.demo.example .env
```

Edit **`.env`**: replace every `CHANGE_ME_*` with new secrets (never copy production JWT/DB passwords).

Start demo ( **never** use `docker-compose.prod.yml` here):

```bash
docker compose -p abexcore-demo \
  -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file .env up -d --build
```

Check locally on the server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/
```

Open **https://demo.abexcore.co.ke** after DNS propagates.

## What is isolated

| Resource | Production | Demo |
|----------|------------|------|
| Folder | `~/Abexcore` | `~/Abexcore-demo` |
| Compose project | default / `erp-*` containers | `-p abexcore-demo` / `erp-demo-*` |
| MySQL volume | `mysql_data` (prod project) | `abexcore-demo_mysql_data` |
| DB name | `filter_erp` (typical) | `filter_erp_demo` |
| App port (localhost) | `8080` | `8081` |
| MySQL port (localhost) | `3307` | `3308` |

## Commands to avoid on production

- Do **not** run `docker compose down -v` in `~/Abexcore`.
- Do **not** point demo `.env` at production `MYSQL_DATABASE` or prod DB password on the prod MySQL container.

## Update demo after code changes

```bash
cd ~/Abexcore-demo
git pull origin main
docker compose -p abexcore-demo \
  -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file .env up -d --build
```

Production deploy remains unchanged in `~/Abexcore`.
