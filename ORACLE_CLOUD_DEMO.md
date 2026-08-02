# AbexCore ERP — Oracle Cloud Always Free Client Demo

Deploy the same Docker stack you use locally on an **Oracle Cloud Always Free** VM, then share one public link with your client for testing.

---

## What you get

| Item | Detail |
|------|--------|
| App URL | `http://YOUR_PUBLIC_IP` (HTTPS optional if you add a domain) |
| Stack | Docker Compose: MySQL 8 + Node API + Nginx/React |
| Login | Company slug + email + password (seeded on first boot) |
| Cost | Always Free (within Oracle free-tier limits) |

---

## Critical: pick the right VM shape

Do **not** use `VM.Standard.E2.1.Micro` (1 GB RAM) — MySQL + Node will crash.

Use **Ampere ARM** free tier:

| Setting | Recommended |
|---------|-------------|
| Image | Canonical Ubuntu 22.04 (aarch64) |
| Shape | **VM.Standard.A1.Flex** |
| OCPUs | **2** |
| Memory | **12 GB** (or at least **6 GB**) |
| Boot volume | 50–100 GB |
| Networking | Assign public IPv4 |
| SSH key | Add your public key |

---

## Part A — Create the Oracle VM (console)

1. Sign in: [https://cloud.oracle.com](https://cloud.oracle.com)
2. **Compute → Instances → Create instance**
3. Name: `AbexCore-demo`
4. Image: **Ubuntu 22.04** (aarch64 for A1.Flex)
5. Shape: **VM.Standard.A1.Flex** → 2 OCPU / 12 GB
6. Networking: use default VCN; ensure **Assign a public IPv4 address**
7. Add your SSH public key
8. Create instance → wait until **RUNNING**
9. Copy the **Public IP** (example: `129.146.x.x`)

### Open ports in Oracle (required)

**VCN → Subnet → Security List → Ingress Rules** (or Network Security Group):

| Source | Protocol | Port |
|--------|----------|------|
| `0.0.0.0/0` | TCP | 22 |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 (optional, for later SSL) |

Without the port **80** rule, clients cannot open the app.

---

## Part B — Deploy the app on the VM

From your PC (PowerShell or Terminal), SSH in:

```bash
ssh ubuntu@YOUR_PUBLIC_IP
```

On the VM:

```bash
# 1) Tools
sudo apt-get update -y
sudo apt-get install -y git curl openssl

# 2) Clone your repo (public or with a deploy token)
git clone https://github.com/kimutaicosmas-kck/ApexCore-Erp.git
cd ApexCore-Erp

# 3) One-shot demo setup (Docker + build + seed + firewall)
chmod +x scripts/oracle-demo-setup.sh
./scripts/oracle-demo-setup.sh
```

First build can take **5–15 minutes** on free ARM.

When it finishes, the script prints:

- **Client URL** — share this  
- **Company slug**  
- **Email / password**

### Manual alternative (if the script is not used)

```bash
cp .env.demo.example .env
nano .env   # set PUBLIC_URL / FRONTEND_URL to http://YOUR_PUBLIC_IP and replace CHANGE_ME secrets

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in, then:
sudo docker compose --env-file .env up -d --build
```

---

## Part C — What to send the client

```
AbexCore ERP — preview
URL:     http://YOUR_PUBLIC_IP
Company: owner
Email:   demo@AbexCore.co.ke
Password: DemoClient@2026!     (or whatever you set in .env)
```

Ask them to change the password after first login.

Health check (you):

```bash
curl http://YOUR_PUBLIC_IP/api/health
```

Expect `"status":"ok"` and `"database":"connected"`.

---

## Useful commands on the VM

```bash
cd ~/ApexCore-Erp

# Status
sudo docker compose ps
sudo docker compose logs -f backend

# Restart after git pull
git pull
sudo docker compose --env-file .env up -d --build

# Backup MySQL
sudo docker compose exec -T mysql mysqldump -u erp_user -p"$MYSQL_PASSWORD" filter_erp \
  | gzip > ~/AbexCore-backup-$(date +%F).sql.gz
```

After the first successful seed, `.env` should have `SEED_ON_START=false` so restarts do not wipe/reseed.

---

## Optional: HTTPS with a domain (recommended before wider sharing)

1. Point DNS **A record** of `demo.yourdomain.com` → VM public IP  
2. Install Caddy (or Certbot + Nginx) for automatic Let's Encrypt  
3. Set in `.env`:

```env
PUBLIC_URL=https://demo.yourdomain.com
FRONTEND_URL=https://demo.yourdomain.com
```

4. Rebuild/restart: `sudo docker compose --env-file .env up -d`

Until you have a domain, **HTTP on the public IP is fine** for a closed client preview.

---

## Security notes for a demo

- Change all `CHANGE_ME` / default passwords before sharing widely  
- MySQL is bound to `127.0.0.1` only (not public)  
- Backend port `3001` is not exposed publicly — only Nginx `:80`  
- Do not put real M-Pesa / SMTP secrets on a shared demo unless required  
- This is a **preview environment**, not final production hardening  

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Browser times out | Open TCP **80** in OCI Security List + `sudo ufw allow 80` |
| `database: disconnected` | `sudo docker compose logs mysql backend` — wait for healthy MySQL |
| Login fails | Confirm company slug `owner` and seeded email/password from script output |
| Out of memory / killed | Upgrade to ≥6 GB RAM A1.Flex; stop unused containers |
| Old UI after deploy | `sudo docker compose build --no-cache frontend && sudo docker compose up -d` |

---

## Checklist

- [ ] Always Free **A1.Flex** VM created (not 1 GB micro)  
- [ ] Public IP assigned  
- [ ] Ingress TCP 22 + 80 open  
- [ ] Repo cloned on VM  
- [ ] `./scripts/oracle-demo-setup.sh` completed  
- [ ] `/api/health` returns ok  
- [ ] You can log in from your phone on cellular data  
- [ ] Client link + credentials sent  

When the client is satisfied, plan a separate production deployment (dedicated domain, HTTPS, backups, stronger secrets, no demo seed).
