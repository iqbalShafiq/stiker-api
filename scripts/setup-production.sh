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

# Copy example env if .env.production doesn't exist
if [ ! -f .env.production ]; then
    echo "📝 Creating .env.production from template..."
    cp .env.production.example .env.production
    echo "⚠️  Please edit .env.production with your actual values!"
fi

# Generate secure JWT secrets if not set
if grep -q "your-super-secret-jwt-key" .env.production; then
    echo "🔑 Generating secure JWT secrets..."
    JWT_SECRET=$(openssl rand -base64 48)
    JWT_REFRESH_SECRET=$(openssl rand -base64 48)
    
    sed -i "s/your-super-secret-jwt-key-min-32-chars/${JWT_SECRET}/g" .env.production
    sed -i "s/your-super-secret-refresh-key-min-32-chars/${JWT_REFRESH_SECRET}/g" .env.production
    
    echo "✅ JWT secrets generated automatically"
fi

# Pull latest images
echo "🐳 Pulling Docker images..."
docker-compose -f docker-compose.prod.yml pull

# Start database services first
echo "🗄️  Starting database services..."
docker-compose -f docker-compose.prod.yml up -d postgres redis

# Wait for databases to be ready
echo "⏳ Waiting for databases to be ready..."
sleep 10

# Run migrations
echo "🔄 Running database migrations..."
docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy

# Start all services
echo "🚀 Starting all services..."
docker-compose -f docker-compose.prod.yml up -d

# Check health
echo "🏥 Checking health..."
sleep 5
curl -f http://localhost:3000/health || echo "⚠️  Health check failed, but services are starting..."

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update nginx/conf.d/ssl.conf with your domain"
echo "2. Configure SSL certificates with: ./scripts/init-ssl.sh your-domain.com your-email@example.com"
echo "3. Update .env.production with your actual API keys"
echo "4. Configure GitHub Actions secrets for CI/CD"
echo ""
