// Script để xóa MongoDB data bằng cách dùng server MongoDB connection
const path = require('path');

// Thử import từ server directory
let mongoDb = null;
let MONGO_READY = false;

try {
  // Thử kết nối đến MongoDB giống như server
  const { MongoClient } = require('mongodb');
  
  const MONGO_URL = 'mongodb://localhost:27017';
  const MONGO_DB_NAME = 'quanlyche';
  
  async function clearAllData() {
    console.log('Đang kết nối đến MongoDB...');
    const client = new MongoClient(MONGO_URL);
    
    try {
      await client.connect();
      console.log('Đã kết nối MongoDB thành công');
      
      const db = client.db(MONGO_DB_NAME);
      
      const collections = ['users', 'sales', 'purchases', 'expenses', 'customers', 'suppliers', 'security_logs'];
      
      for (const collection of collections) {
        try {
          const result = await db.collection(collection).deleteMany({});
          console.log(`Đã xóa ${result.deletedCount} documents từ collection ${collection}`);
        } catch (err) {
          console.log(`Collection ${collection} không tồn tại hoặc lỗi: ${err.message}`);
        }
      }
      
      console.log('Đã xóa toàn bộ data trong MongoDB!');
      
      // Kiểm tra xem còn data không
      const userCount = await db.collection('users').countDocuments();
      console.log(`Còn ${userCount} users trong database`);
      
    } catch (err) {
      console.error('Lỗi kết nối MongoDB:', err);
    } finally {
      await client.close();
    }
  }
  
  clearAllData();
  
} catch (err) {
  console.error('Không thể import MongoDB driver:', err.message);
  console.log('Hãy chạy script này từ server directory');
}