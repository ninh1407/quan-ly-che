const { MongoClient } = require('mongodb');

async function clearAllData() {
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

clearAllData();