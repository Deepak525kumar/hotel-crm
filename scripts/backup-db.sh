#!/usr/bin/env bash
# scripts/backup-db.sh
# Daily PostgreSQL logical export to AWS S3.
# Schedule via cron: 0 3 * * *  /home/ubuntu/apps/hotel-crm/scripts/backup-db.sh >> /home/ubuntu/.pm2/logs/backup.log 2>&1
#
# Auth: prefer the EC2 instance role (no static keys). If AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY are present in the env file they are used as a fallback.
# Note: RDS automated snapshots are the primary backup; this is a secondary
# logical export retained in an immutable S3 bucket for ransomware protection.
set -euo pipefail

SECRET_ENV="/home/ubuntu/apps/hotel-crm/backend/.env"

if [ ! -f "$SECRET_ENV" ]; then
  echo "ERROR: $SECRET_ENV not found." >&2
  exit 1
fi

export DATABASE_URL=$(grep "^DATABASE_URL=" "$SECRET_ENV" | cut -d= -f2-)

export AWS_REGION="${AWS_REGION:-eu-central-1}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="daily/hotelcrm-${TIMESTAMP}.dump"

echo "[$(date -u)] Starting daily backup → $BACKUP_FILE"

CLEAN_URL=$(echo "$DATABASE_URL" | cut -d? -f1)
if ! pg_dump "$CLEAN_URL" \
  --format=custom \
  --compress=9 \
  --no-password \
  | aws s3 cp - "s3://${S3_BUCKET_BACKUPS:-hotelcrm-immutable-backups}/$BACKUP_FILE" \
      --region "$AWS_REGION" \
      --storage-class STANDARD_IA; then
  echo "ERROR: Backup failed!" >&2
  exit 1
fi

echo "[$(date -u)] Backup complete: $BACKUP_FILE"

# Retention/archival is handled by the S3 bucket lifecycle policy / object lock.
echo "[$(date -u)] Backup job finished successfully."
