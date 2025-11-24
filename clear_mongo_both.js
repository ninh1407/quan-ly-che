// Script để xóa MongoDB data thông qua API endpoint
const http = require('http');

const data = JSON.stringify({ confirm: true });

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/admin/clear-mongo',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Response:', body);
  });
});

req.on('error', e => {
  console.error('Error:', e.message);
  console.log('Thử cách khác...');
  // Nếu endpoint không tồn tại, thử dùng MongoDB driver trực tiếp
  clearMongoDirect();
});

req.write(data);
req.end();

function clearMongoDirect() {
  try {
    const { MongoClient } = require('mongodb');
    
    async function clear() {
      const client = new MongoClient('mongodb://localhost:27017');
      
      try {
        await client.connect();
        const db = client.db('quanlyche');
        
        const collections = ['users', 'sales', 'purchases', 'expenses', 'customers', 'suppliers', 'security_logs'];
        
        for (const collection of collections) {
          try {
            const result = await db.collection(collection).deleteMany({});
            console.log('Đã xóa ' + result.deletedCount + ' documents từ collection ' + collection);
          } catch (err) {
            console.log('Collection ' + collection + ' không tồn tại hoặc lỗi: ' + err.message);
          }
        }
        
        console.log('Đã xóa toàn bộ data trong MongoDB!');
      } catch (err) {
        console.error('Lỗi:', err);
      } finally {
        await client.close();
      }
    }
    
    clear();
  } catch (err) {
    console.error('Không thể kết nối MongoDB:', err.message);
  }
}