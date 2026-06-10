#!/usr/bin/env bash
# scripts/setup-droplet.sh
# Run once as root on a fresh Ubuntu 24.04 Droplet.
# Usage: bash setup-droplet.sh [production|staging]
set -euo pipefail

ENV="${1:-production}"
APP_DIR="/opt/hotel-crm"
SECRET_DIR="/etc/hotel-crm"
LOG_DIR="/var/log/hotel-crm"
DEPLOY_USER="deploy"

echo "==> [1/9] System update"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> [2/9] Install system packages"
apt-get install -y -qq \
  curl wget git unzip \
  nginx \
  docker.io docker-compose-plugin \
  ufw fail2ban \
  postgresql-client \
  awscli

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
mkdir -p /etc/ssl/cloudflare
chmod 700 /etc/ssl/cloudflare
# Disable default Nginx site
rm -f /etc/nginx/sites-enabled/default
echo "     -> Copy nginx/hotelcrm.conf to /etc/nginx/sites-available/hotelcrm"
echo "     -> Then: ln -s /etc/nginx/sites-available/hotelcrm /etc/nginx/sites-enabled/"
echo "     -> And install Cloudflare origin cert to /etc/ssl/cloudflare/"

echo "==> [8/9] Configure UFW firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "     -> After adding Cloudflare IPs, restrict 80/443 to Cloudflare ranges only"
echo "     -> See: https://www.cloudflare.com/ips/"

echo "==> [9/9] Create secret file template"
if [ ! -f "$SECRET_DIR/.env" ]; then
  cat > "$SECRET_DIR/.env" <<'EOF'
# /etc/hotel-crm/.env — Production secrets (chmod 600, never committed)
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://user:password@db.hotelcrm.internal:25060/hotelcrm_prod?sslmode=require
REDIS_URL=redis://:REDIS_PASSWORD_HERE@127.0.0.1:6379
REDIS_PASSWORD=CHANGE_ME

JWT_SECRET=GENERATE_WITH__openssl_rand_-base64_48
JWT_REFRESH_SECRET=GENERATE_WITH__openssl_rand_-base64_48
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d

CORS_ORIGIN=https://hotelcrm.app
FRONTEND_URL=https://hotelcrm.app

DO_SPACES_KEY=your-spaces-key
DO_SPACES_SECRET=your-spaces-secret
DO_SPACES_BUCKET=hotelcrm-uploads
DO_SPACES_REGION=fra1
DO_SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com

SENDGRID_API_KEY=SG.xxxxx
EMAIL_SERVICE=sendgrid

APNS_PRIVATE_KEY_BASE64=base64-encoded-p8-key
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.zirove.hotelcrm

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
echo "  Droplet setup complete."
echo "  Next steps:"
echo "  1. Install Cloudflare origin cert to /etc/ssl/cloudflare/"
echo "  2. Copy nginx/hotelcrm.conf → /etc/nginx/sites-available/hotelcrm"
echo "  3. ln -s /etc/nginx/sites-available/hotelcrm /etc/nginx/sites-enabled/"
echo "  4. nginx -t && systemctl enable --now nginx"
echo "  5. Fill in /etc/hotel-crm/.env with real secrets"
echo "  6. Clone repo: git clone <repo> $APP_DIR (as deploy user)"
echo "  7. Run: bash scripts/deploy.sh production (as deploy user)"
echo "============================================================"
