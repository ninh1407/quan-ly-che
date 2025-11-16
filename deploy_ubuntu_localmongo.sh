#!/usr/bin/env bash
set -euo pipefail

USERNAME="${SUDO_USER:-$(whoami)}"
PROJECT_ROOT="${PROJECT_ROOT:-/home/${USERNAME}/quan-ly-che}"
SITE_NAME="${SITE_NAME:-che}"
PORT="${PORT:-4000}"
MONGO_URL="${MONGO_URL:-mongodb://localhost:27017}"
MONGO_DB_NAME="${MONGO_DB_NAME:-quanlyche}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

apt update
apt -y install nginx ufw curl gnupg openssl
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -sc)/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list
apt update
apt -y install mongodb-org
systemctl enable --now mongod

pm2 kill || true
npm rm -g pm2 || true
apt -y remove nodejs || true
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt -y install nodejs
npm i -g pm2

mkdir -p /var/www/che-app/client/dist
chown -R "${USERNAME}:${USERNAME}" /var/www/che-app || true

cd "${PROJECT_ROOT}/server"
npm ci || npm install

cd "${PROJECT_ROOT}/client"
rm -rf dist
npm ci || npm install
VITE_API_BASE=/api npm run build
rm -rf /var/www/che-app/client/dist/*
cp -r "${PROJECT_ROOT}/client/dist/" "/var/www/che-app/client/dist/"

tee "/etc/nginx/sites-available/${SITE_NAME}.conf" > /dev/null << 'EOF'
server {
  listen 80;
  server_name _;
  root /var/www/che-app/client/dist;
  index index.html;
  location / { try_files $uri /index.html; }
  location /api/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
ln -sf "/etc/nginx/sites-available/${SITE_NAME}.conf" "/etc/nginx/sites-enabled/${SITE_NAME}.conf"
nginx -t
systemctl reload nginx
systemctl enable nginx

grep -q '^PORT=' /etc/environment || echo "PORT=${PORT}" >> /etc/environment
grep -q '^JWT_SECRET=' /etc/environment || echo "JWT_SECRET=${JWT_SECRET}" >> /etc/environment
grep -q '^MONGO_URL=' /etc/environment || echo "MONGO_URL=${MONGO_URL}" >> /etc/environment
grep -q '^MONGO_DB_NAME=' /etc/environment || echo "MONGO_DB_NAME=${MONGO_DB_NAME}" >> /etc/environment

cd "${PROJECT_ROOT}/server"
pm2 start index.js --name che-server --time
pm2 save
pm2 startup systemd -u "${USERNAME}" --hp "/home/${USERNAME}"
pm2 restart che-server --update-env

curl -s http://127.0.0.1:4000/health || true

