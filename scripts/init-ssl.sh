#!/bin/bash
set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: $0 <domain> <email>"
    echo "Example: $0 api.example.com admin@example.com"
    exit 1
fi

echo "🔒 Initializing SSL for $DOMAIN..."

# Update nginx config with domain
sed -i "s/your-domain.com/${DOMAIN}/g" nginx/conf.d/ssl.conf

# Start nginx for certbot challenge
docker-compose -f docker-compose.prod.yml up -d nginx

# Get certificate
docker run -it --rm \
    -v $(pwd)/certbot/conf:/etc/letsencrypt \
    -v $(pwd)/certbot/www:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN

# Restart nginx with SSL
docker-compose -f docker-compose.prod.yml restart nginx

echo "✅ SSL certificate installed for $DOMAIN"
