#!/bin/bash
# Setup script for Ubuntu server 20.212.168.189

echo "🚀 Setting up Tea Management System on Ubuntu Server..."

# 1. Cài đặt dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm sqlite3 nginx ufw

# 2. Tạo thư mục project
mkdir -p ~/quan-ly-che
cd ~/quan-ly-che

# 3. Tạo server .env file
cat > server.env << 'EOF'
# Server Configuration
PORT=4000
HOST=0.0.0.0

# Database - SQLite
DB_PATH=/home/fgfff/quan-ly-che/server/data.db

# MongoDB Configuration (disabled)
DISABLE_MONGO=true

# JWT Configuration
JWT_SECRET=tea-management-secret-key-2024

# CORS Configuration - Allow all origins for now
CORS_ORIGIN=*

# API Configuration
API_BASE_URL=http://20.212.168.189:4000
EOF

# 4. Tạo client .env file
cat > client.env << 'EOF'
VITE_API_BASE=http://20.212.168.189:4000
EOF

# 5. Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 4000/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 6. Tạo PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'tea-server',
    script: 'server/index.js',
    cwd: '/home/fgfff/quan-ly-che',
    env: {
      PORT: 4000,
      HOST: '0.0.0.0',
      NODE_ENV: 'production'
    },
    error_file: './logs/server-error.log',
    out_file: './logs/server-out.log',
    log_file: './logs/server-combined.log',
    time: true
  }]
};
EOF

# 7. Tạo nginx configuration
cat > tea-management.conf << 'EOF'
server {
    listen 80;
    server_name 20.212.168.189;

    # API Proxy
    location /api/ {
        proxy_pass http://localhost:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # CORS headers
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization";
        
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }

    # Static files (if you build the client)
    location / {
        root /home/fgfff/quan-ly-che/client/dist;
        try_files $uri $uri/ /index.html;
        add_header Access-Control-Allow-Origin *;
    }
}
EOF

echo "✅ Setup script created!"
echo "📋 Next steps:"
echo "1. Upload your project files to ~/quan-ly-che"
echo "2. Run: npm install in both server and client directories"
echo "3. Run: npm run build in client directory"
echo "4. Copy server.env to server/.env and client.env to client/.env"
echo "5. Install PM2: npm install -g pm2"
echo "6. Start server: pm2 start ecosystem.config.js"
echo "7. Copy nginx config: sudo cp tea-management.conf /etc/nginx/sites-available/"
echo "8. Enable nginx site: sudo ln -s /etc/nginx/sites-available/tea-management.conf /etc/nginx/sites-enabled/"
echo "9. Restart nginx: sudo systemctl restart nginx"