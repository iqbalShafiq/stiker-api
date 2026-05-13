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

```bash
# Copy production environment template
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

### 3. Run Setup Script

```bash
./scripts/setup-production.sh
```

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

## Database Migrations

Migrations run automatically during deployment. To run manually:

```bash
docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
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
curl https://your-domain.com/health
```

### Logs

```bash
# API logs
docker-compose -f docker-compose.prod.yml logs -f api

# Nginx logs
docker-compose -f docker-compose.prod.yml logs -f nginx

# All logs
docker-compose -f docker-compose.prod.yml logs -f
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
git pull origin main

# Pull latest image
docker pull ghcr.io/iqbalShafiq/stiker-api:latest

# Restart services
docker-compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs api

# Check health
docker-compose -f docker-compose.prod.yml ps
```

### Database Connection Issues

```bash
# Check if postgres is running
docker-compose -f docker-compose.prod.yml ps postgres

# Check database logs
docker-compose -f docker-compose.prod.yml logs postgres
```

### SSL Issues

```bash
# Renew certificates manually
docker-compose -f docker-compose.prod.yml run --rm certbot certbot renew

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
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
