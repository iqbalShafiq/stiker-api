# Production Deployment Guide

## Prerequisites

- VPS with Docker and Docker Compose installed
- Domain name pointing to your VPS
- GitHub account with this repository

## VPS Requirements

- Ubuntu 22.04 LTS or newer
- Minimum 2GB RAM, 2 CPU cores
- 20GB disk space
- Docker 24.0+
- Docker Compose 2.0+

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/iqbalShafiq/stiker-api.git
cd stiker-api
```

### 2. Configure Environment

There is a single env file for every environment:

```bash
cp .env.example .env
nano .env
```

The API listens on **7845** (`PORT`), a unique port chosen so it never fights the
generic 3000/8080 used by other projects. In the `prod` profile the port is pinned in
`docker-compose.yml` because the nginx upstream targets it; nginx itself is published on
host ports `8080`/`8443`.

### 3. Run Setup Script

```bash
./scripts/setup-production.sh
```

This generates JWT secrets when missing, starts Postgres/Redis, applies migrations,
seeds the database (roles, billing products, AI model catalog), and starts the full
`prod` profile.

### 4. Configure SSL

```bash
./scripts/init-ssl.sh your-domain.com your-email@example.com
```

### 5. Update Nginx Config

Edit `nginx/conf.d/ssl.conf` and replace `your-domain.com` with your actual domain.

## GitHub Actions Setup

### Required Secrets

Go to Settings > Secrets and variables > Actions, add these secrets:

- `VPS_HOST`: Your VPS IP address or domain
- `VPS_USERNAME`: SSH username (e.g., `root` or `ubuntu`)
- `VPS_SSH_KEY`: Private SSH key for deployment

### Optional: GitHub Container Registry

The pipeline automatically pushes to GHCR. Make sure your repository has package write permissions.

## Compose Profiles

One compose file drives every environment:

```bash
docker compose --profile dev up -d     # local api + postgres + redis
docker compose --profile test up -d    # isolated test stack
docker compose --profile prod up -d    # published image + nginx
```

## Database Migrations

Migrations run automatically during deployment. To run manually:

```bash
docker compose --profile prod run --rm migrate
docker compose --profile prod run --rm seed   # idempotent: roles, billing products, AI catalog
```

## Backups

### Manual Backup

```bash
./scripts/backup.sh
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/stiker-api/scripts/backup.sh >> /path/to/stiker-api/logs/backup.log 2>&1
```

## Monitoring

### Health Check

```bash
curl http://localhost:7845/health     # API directly (VPS-local)
curl https://your-domain.com/health   # through nginx
```

### Logs

```bash
# API logs
docker compose --profile prod logs -f app

# Nginx logs
docker compose --profile prod logs -f nginx

# All logs
docker compose --profile prod logs -f
```

### View Logs File

```bash
tail -f logs/app.log
```

## Updates

### Automatic (CI/CD)

Push to master branch triggers automatic deployment.

### Manual

```bash
# Pull latest code
git pull origin master

# Pull latest image
docker pull ghcr.io/iqbalshafiq/stiker-api:latest

# Restart the API with the new image
docker compose --profile prod up -d app
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose --profile prod logs app

# Check status
docker compose --profile prod ps
```

### Database Connection Issues

```bash
# Check if postgres is running
docker compose --profile prod ps postgres

# Check database logs
docker compose --profile prod logs postgres
```

### SSL Issues

```bash
# Renew certificates manually
docker run --rm \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    certbot/certbot renew

# Restart nginx
docker compose --profile prod restart nginx
```

## Security Checklist

- [ ] Change default passwords
- [ ] Use strong JWT secrets
- [ ] Enable firewall (ufw)
- [ ] Disable root SSH login
- [ ] Use SSH key authentication
- [ ] Keep system updated
- [ ] Regular backups configured
- [ ] SSL/TLS enabled
- [ ] Rate limiting enabled
- [ ] CORS configured properly

## Support

For issues or questions:
1. Check logs first
2. Review health endpoint
3. Check GitHub Actions logs
4. Open an issue on GitHub
