# 🚀 Hướng dẫn Setup Ubuntu Server cho Tea Management System

## Kết nối SSH vào server2

```bash
ssh fgfff@20.212.168.189
```

## Các bước setup chi tiết

### 1. Cài đặt dependencies
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm sqlite3 nginx ufw
```

### 2. Tạo thư mục project
```bash
mkdir -p ~/quan-ly-che
cd ~/quan-ly-che
```

### 3. Upload project files
Từ máy local của bạn, upload files:
```bash
# Từ máy local
scp -r c:\Users\PC_Ninh\Downloads\quan ly chè\quan ly chè\* fgfff@20.212.168.189:~/quan-ly-che/
```

### 4. Setup environment files
```bash
# Tạo server .env
cat > server/.env << 'EOF'
PORT=4000
HOST=0.0.0.0
DB_PATH=/home/fgfff/quan-ly-che/server/data.db
DISABLE_MONGO=true
JWT_SECRET=tea-management-secret-key-2024
CORS_ORIGIN=*
EOF

# Tạo client .env
cat > client/.env << 'EOF'
VITE_API_BASE=http://20.212.168.189:4000
EOF
```

### 5. Install dependencies
```bash
cd ~/quan-ly-che/server
npm install

cd ~/quan-ly-che/client
npm install
npm run build
```

### 6. Configure firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 4000/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 7. Install và setup PM2
```bash
sudo npm install -g pm2

cd ~/quan-ly-che
pm2 start server/index.js --name "tea-server" --env production
pm2 startup
pm2 save
```

### 8. Setup nginx (optional)
```bash
# Tạo nginx config
sudo tee /etc/nginx/sites-available/tea-management << 'EOF'
server {
    listen 80;
    server_name 20.212.168.189;

    location /api/ {
        proxy_pass http://localhost:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS headers
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization";
        
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }

    location / {
        root /home/fgfff/quan-ly-che/client/dist;
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/tea-management /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 9. Kiểm tra trạng thái
```bash
# Kiểm tra PM2
pm2 status
pm2 logs tea-server

# Kiểm tra port
sudo netstat -tlnp | grep :4000

# Test API
curl http://localhost:4000/api/sales?month=11&year=2024
```

## 🔑 Login Credentials
- **Username:** admin
- **Password:** admin123

## 🌐 Access URLs
- **API Server:** http://20.212.168.189:4000
- **Web Client:** http://20.212.168.189:8080 (hoặc :80 nếu dùng nginx)

## 🛠️ Troubleshooting

### Nếu không vào được database:
```bash
# Kiểm tra quyền file
ls -la ~/quan-ly-che/server/data.db
chmod 644 ~/quan-ly-che/server/data.db
```

### Nếu bị lỗi CORS:
```bash
# Kiểm tra CORS config trong server/.env
cat server/.env | grep CORS
```

### Nếu server không start:
```bash
# Xem logs
pm2 logs tea-server --lines 50
```

### Restart services:
```bash
pm2 restart tea-server
sudo systemctl restart nginx
```

## ✅ Test sau khi setup
1. Mở browser: http://20.212.168.189:8080
2. Login với admin/admin123
3. Test các chức năng: Sales, Purchases, Expenses, Season
4. Kiểm tra Balance Sheet và Reports

Chúc bạn setup thành công! 🎉