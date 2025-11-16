# Hướng dẫn triển khai ứng dụng lên Ubuntu Server (public)

Tài liệu này hướng dẫn đưa ứng dụng "Quản lý chè" lên Ubuntu server và chạy public qua Nginx reverse proxy. Nội dung áp dụng cho code hiện tại: backend Node/Express (port 4000) và frontend React/Vite.

## Yêu cầu
- Ubuntu Server có quyền sudo
- SSH truy cập: `ssh <user>@<IP>`
- Mở cổng `80` và `443` trên firewall
- Máy Windows để build frontend và copy mã nguồn (hoặc build trực tiếp trên Ubuntu)

## Kết nối và chuẩn bị hệ thống
```bash
ssh user@IP
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx ufw git curl

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

## Cài Node.js LTS và PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
sudo npm i -g pm2
```

## Chuẩn bị thư mục ứng dụng
```bash
sudo mkdir -p /var/www/che-app/server
sudo mkdir -p /var/www/che-app/client
sudo chown -R $USER:$USER /var/www/che-app
```

## Sao chép mã nguồn từ Windows lên Ubuntu
Trên Windows (PowerShell):
```powershell
# Đẩy backend
scp -r "c:\\Users\\PC_Ninh\\Downloads\\quan ly chè\\quan ly chè\\server" user@IP:/var/www/che-app/

# Build frontend với API base là /api
cd "c:\\Users\\PC_Ninh\\Downloads\\quan ly chè\\quan ly chè\\client"
npm ci
setx VITE_API_BASE /api
# Mở PowerShell mới để biến có hiệu lực
npm run build

# Đẩy thư mục build
scp -r "c:\\Users\\PC_Ninh\\Downloads\\quan ly chè\\quan ly chè\\client\\dist" user@IP:/var/www/che-app/client/dist
```

## Cấu hình biến môi trường cho server
Ứng dụng đọc các biến sau:
- `PORT` (mặc định 4000)
- `JWT_SECRET` (nên đặt chuỗi bí mật mạnh)
- `MONGO_URL`, `MONGO_DB_NAME` (tùy chọn, nếu dùng MongoDB)

Thiết lập nhanh:
```bash
echo 'PORT=4000' | sudo tee -a /etc/environment
echo "JWT_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/environment
# Nếu dùng MongoDB local
echo 'MONGO_URL=mongodb://localhost:27017' | sudo tee -a /etc/environment
echo 'MONGO_DB_NAME=quanlyche' | sudo tee -a /etc/environment
```

Hoặc dùng file cấu hình fallback (cùng thư mục server):
```bash
cd /var/www/che-app/server
echo 'mongodb://localhost:27017' > mongo.url.txt
echo 'quanlyche' > mongo.dbname.txt
```

## Chạy backend bằng PM2
```bash
cd /var/www/che-app/server
npm ci
pm2 start index.js --name che-server --time
pm2 save
pm2 startup systemd
# Chạy lệnh mà PM2 in ra để bật tự khởi động
```

## Cấu hình Nginx reverse proxy và phục vụ frontend
Tạo file cấu hình site:
```bash
sudo tee /etc/nginx/sites-available/che.conf > /dev/null << 'EOF'
server {
  listen 80;
  server_name _;

  root /var/www/che-app/client/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

sudo ln -s /etc/nginx/sites-available/che.conf /etc/nginx/sites-enabled/che.conf
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx
```

## Cấp SSL với Let’s Encrypt (nếu có domain)
```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
# Kiểm tra tự gia hạn
systemctl status certbot.timer
```

## Kiểm tra
```bash
# Backend nội bộ
curl http://127.0.0.1:4000/health

# Qua reverse proxy
curl http://IP/api/health

# Trình duyệt
http://IP

# PM2
pm2 status
pm2 logs che-server --lines 50

# Firewall
sudo ufw status
```

## Tuỳ chọn MongoDB
### MongoDB local
```bash
sudo apt -y install gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -sc)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt -y install mongodb-org
sudo systemctl enable --now mongod

# Biến môi trường
echo 'MONGO_URL=mongodb://localhost:27017' | sudo tee -a /etc/environment
echo 'MONGO_DB_NAME=quanlyche' | sudo tee -a /etc/environment
pm2 restart che-server --update-env
```

### MongoDB Atlas
- Thêm IP server vào Atlas Network Access
- Đặt `MONGO_URL='mongodb+srv://<user>:<pass>@<cluster-url>/'` và `MONGO_DB_NAME='quanlyche'`
- Khởi động lại tiến trình: `pm2 restart che-server --update-env`

## Ghi chú bảo mật
- Không commit hoặc lưu thông tin đăng nhập (JWT secret, Mongo URI) vào repo
- Giới hạn IP truy cập Atlas thay vì mở `0.0.0.0/0`
- Sao lưu `data.db` nếu dùng SQLite

## Khắc phục sự cố
- Nginx lỗi cấu hình: `sudo nginx -t` và kiểm tra log `/var/log/nginx/error.log`
- Backend không chạy: `pm2 logs che-server` để xem lỗi Node
- Health trả về `mongo: false`: kiểm tra `MONGO_URL/MONGO_DB_NAME` và mạng
- 403 khi gọi API: cần token JWT; đăng nhập để lấy token

## Cập nhật ứng dụng (triển khai lại nhanh)
```bash
# Backend
scp -r server user@IP:/var/www/che-app/
ssh user@IP "cd /var/www/che-app/server && npm ci && pm2 restart che-server"

# Frontend
npm run build
scp -r client/dist user@IP:/var/www/che-app/client/dist
sudo systemctl reload nginx
```

