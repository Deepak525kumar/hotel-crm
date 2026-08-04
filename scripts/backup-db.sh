#!/usr/bin/env bash
# scripts/backup-db.sh
# Weekly PostgreSQL logical export to AWS S3.
# Schedule via cron: 0 3 * * 0  /opt/hotel-crm/scripts/backup-db.sh >> /home/ubuntu/.pm2/logs/backup.log 2>&1
#
# Auth: prefer the EC2 instance role (no static keys). If AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY are present in the env file they are used as a fallback.
# Note: RDS automated snapshots are the primary backup; this is a secondary
# logical export retained in S3 (STANDARD_IA → Glacier via bucket lifecycle).
set -euo pipefail

SECRET_ENV="/etc/hotel-crm/.env"

if [ ! -f "$SECRET_ENV" ]; then
  echo "ERROR: $SECRET_ENV not found." >&2
  exit 1
fi

set -a
source "$SECRET_ENV"
set +a

export AWS_REGION="${AWS_REGION:-eu-central-1}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="weekly/hotelcrm-${TIMESTAMP}.dump"

echo "[$(date -u)] Starting weekly backup → $BACKUP_FILE"

pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-password \
  | aws s3 cp - "s3://${S3_BUCKET_BACKUPS:-hotelcrm-backups}/$BACKUP_FILE" \
      --region "$AWS_REGION" \
      --storage-class STANDARD_IA

echo "[$(date -u)] Backup complete: $BACKUP_FILE"

# Retention/archival is handled by the S3 bucket lifecycle policy.
echo "[$(date -u)] Backup job finished successfully."
