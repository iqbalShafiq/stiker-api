#!/bin/bash
set -e

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="stiker-postgres"
DB_NAME="sticker_api"
DB_USER="postgres"
RETENTION_DAYS=7

echo "💾 Starting backup at ${DATE}..."

# Create backup directory
mkdir -p ${BACKUP_DIR}

# Backup database
echo "🗄️  Backing up database..."
docker exec ${DB_CONTAINER} pg_dump -U ${DB_USER} -d ${DB_NAME} | gzip > ${BACKUP_DIR}/db_backup_${DATE}.sql.gz

# Backup uploads
echo "📁 Backing up uploads..."
tar -czf ${BACKUP_DIR}/uploads_backup_${DATE}.tar.gz uploads/

# Cleanup old backups
echo "🧹 Cleaning up old backups..."
find ${BACKUP_DIR} -name "db_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find ${BACKUP_DIR} -name "uploads_backup_*.tar.gz" -mtime +${RETENTION_DAYS} -delete

echo "✅ Backup complete!"
echo "📊 Database: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
echo "📊 Uploads: ${BACKUP_DIR}/uploads_backup_${DATE}.tar.gz"
