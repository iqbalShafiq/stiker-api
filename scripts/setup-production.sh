#!/bin/bash
set -e

echo "🚀 Setting up Stiker API for production..."

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "❌ Please do not run as root"
   exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p uploads
mkdir -p logs
mkdir -p backups
mkdir -p certbot/conf
mkdir -p certbot/www
mkdir -p nginx/conf.d

# Copy example env if .env doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your actual values!"
fi

# Generate secure JWT secrets if not set
if grep -q "^JWT_SECRET=$" .env; then
    echo "🔑 Generating secure JWT secrets..."
    JWT_SECRET=$(openssl rand -base64 48)
    JWT_REFRESH_SECRET=$(openssl rand -base64 48)
    
    sed -i "s|^JWT_SECRET=$|JWT_SECRET=${JWT_SECRET}|" .env
    sed -i "s|^JWT_REFRESH_SECRET=$|JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}|" .env
    
    echo "✅ JWT secrets generated automatically"
fi

# Pull latest images
echo "🐳 Pulling Docker images..."
docker compose --profile prod pull

# Start database services first
echo "🗄️  Starting database services..."
docker compose --profile prod up -d postgres redis

# Wait for databases to be ready
echo "⏳ Waiting for databases to be ready..."
sleep 10

# Run migrations
echo "🔄 Running database migrations..."
docker compose --profile prod run --rm migrate

# Seed the database (roles, billing products, AI model catalog)
echo "🌱 Seeding database..."
docker compose --profile prod run --rm seed

# Start all services
echo "🚀 Starting all services..."
docker compose --profile prod up -d

# Check health
echo "🏥 Checking health..."
sleep 5
curl -f http://localhost:7845/health || echo "⚠️  Health check failed, but services are starting..."

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update nginx/conf.d/ssl.conf with your domain"
echo "2. Configure SSL certificates with: ./scripts/init-ssl.sh your-domain.com your-email@example.com"
echo "3. Update .env with your actual API keys"
echo "4. Configure GitHub Actions secrets for CI/CD"
echo ""
