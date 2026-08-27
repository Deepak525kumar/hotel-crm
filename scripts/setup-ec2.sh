#!/usr/bin/env bash
# scripts/setup-ec2.sh
# Run once as root on a fresh Ubuntu 24.04 EC2 instance (or via user-data).
# Prefer attaching the EC2 instance role for S3/Secrets Manager/ECR access
# instead of static AWS keys. Usage: bash setup-ec2.sh [production|staging]
set -euo pipefail

ENV="${1:-production}"
APP_DIR="/opt/hotel-crm"
SECRET_DIR="/etc/hotel-crm"
LOG_DIR="/home/ubuntu/.pm2/logs"
DEPLOY_USER="deploy"

echo "==> [1/9] System update"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> [2/9] Install system packages"
apt-get install -y -qq \
  curl wget git unzip \
  nginx \
  docker.io docker-compose-plugin \
  postgresql-client \
  ufw fail2ban

# AWS CLI v2 (for S3 backups, ECR pulls, Secrets Manager)
if ! command -v aws &>/dev/null; then
  curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install
fi

echo "==> [3/9] Create deploy user"
if ! id -u "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
mkdir -p "/home/$DEPLOY_USER/.ssh"
chmod 700 "/home/$DEPLOY_USER/.ssh"
# Copy root's authorized_keys so the provisioner SSH key works for deploy user too
cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys" || true
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> [4/9] Install Node.js 20 via nvm (for deploy user)"
su - "$DEPLOY_USER" -c '
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
  npm install -g pm2
  pm2 startup systemd -u deploy --hp /home/deploy
' 2>&1 | tail -5
# Capture the pm2 startup command output and run it
su - "$DEPLOY_USER" -c 'source ~/.nvm/nvm.sh && pm2 startup systemd -u deploy --hp /home/deploy' | grep "sudo" | bash || true

echo "==> [5/9] Create directories and set permissions"
mkdir -p "$APP_DIR" "$SECRET_DIR" "$LOG_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR" "$LOG_DIR"
chown root:root "$SECRET_DIR"
chmod 750 "$SECRET_DIR"

echo "==> [6/9] Enable Docker for deploy user"
usermod -aG docker "$DEPLOY_USER"

echo "==> [7/9] Configure Nginx"
mkdir -p /etc/ssl/hotelcrm
chmod 700 /etc/ssl/hotelcrm
# Disable default Nginx site
rm -f /etc/nginx/sites-enabled/default
echo "     -> Copy nginx/hotelcrm.conf to /etc/nginx/sites-available/hotelcrm"
echo "     -> Then: ln -s /etc/nginx/sites-available/hotelcrm /etc/nginx/sites-enabled/"
echo "     -> Preferred: terminate TLS at an AWS ALB with an ACM certificate."
echo "     -> No-ALB MVP: issue a cert with certbot --nginx (Let's Encrypt)."

echo "==> [8/9] Configure UFW firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "     -> Primary access control is the EC2 security group (sg-ec2):"
echo "        443/80 from the ALB SG (or 0.0.0.0/0 for the no-ALB MVP),"
echo "        22 restricted to a break-glass IP — prefer SSM Session Manager."

echo "==> [9/9] Create secret file template"
if [ ! -f "$SECRET_DIR/.env" ]; then
  cat > "$SECRET_DIR/.env" <<'EOF'
# /etc/hotel-crm/.env — Production secrets (chmod 600, never committed)
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://hotelcrm_app:CHANGE_ME_PASSWORD@db.xxxxxxxx.eu-central-1.rds.amazonaws.com:5432/hotelcrm?schema=public&sslmode=require
REDIS_URL=redis://:CHANGE_ME_REDIS_PASSWORD@127.0.0.1:6379

JWT_SECRET=GENERATE_WITH__openssl_rand_-base64_48
JWT_REFRESH_SECRET=GENERATE_WITH__openssl_rand_-base64_48
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d

CORS_ORIGIN=https://hotelcrm.app
FRONTEND_URL=https://hotelcrm.app

# AWS S3 — prefer the EC2 instance role over static keys (leave keys unset).
AWS_REGION=eu-central-1
S3_BUCKET=hotelcrm-uploads
S3_BUCKET_BACKUPS=hotelcrm-backups
# AWS_ACCESS_KEY_ID=only-if-not-using-instance-role
# AWS_SECRET_ACCESS_KEY=only-if-not-using-instance-role

SENDGRID_API_KEY=SG.xxxxx
EMAIL_SERVICE=sendgrid
EMAIL_FROM_ADDRESS=noreply@deepcleaninghub.de

APNS_PRIVATE_KEY_BASE64=base64-encoded-p8-key
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID_WORKER=com.hotelcrm.workerapp
APNS_BUNDLE_ID_CHECKER=com.hotelcrm.checkerapp

FIREBASE_PROJECT_ID=hotel-crm-xxxxx

SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
LOG_LEVEL=info
EOF
  chown root:deploy "$SECRET_DIR/.env"
  chmod 640 "$SECRET_DIR/.env"
  echo "     -> SECRET TEMPLATE created at $SECRET_DIR/.env — FILL IN ALL VALUES BEFORE STARTING APP"
else
  echo "     -> $SECRET_DIR/.env already exists, skipping template creation"
fi

echo ""
echo "============================================================"
echo "  EC2 instance setup complete."
echo "  Next steps:"
echo "  1. Attach the EC2 instance role (S3 + Secrets Manager + ECR + logs)."
echo "  2. Provision TLS: ALB + ACM cert (preferred), or certbot --nginx (MVP)."
echo "  3. Copy nginx/hotelcrm.conf → /etc/nginx/sites-available/hotelcrm"
echo "  4. ln -s /etc/nginx/sites-available/hotelcrm /etc/nginx/sites-enabled/"
echo "  5. nginx -t && systemctl enable --now nginx"
echo "  6. Fill in /etc/hotel-crm/.env (or load from Secrets Manager)."
echo "  7. Clone repo: git clone <repo> $APP_DIR (as deploy user)"
echo "  8. Run: bash scripts/deploy.sh production (as deploy user)"
echo "============================================================"
