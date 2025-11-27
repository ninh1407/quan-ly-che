const express = require('express');
const cors = require('cors');
let sqlite3 = null;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, 'backups');
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || ''
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGIN) {
    if (origin && origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  } else if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  next()
})
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
try { if (!fs.existsSync('uploads')) fs.mkdirSync('uploads'); } catch {}
app.use('/uploads', express.static('uploads'));
try { if (!fs.existsSync('uploads_enc')) fs.mkdirSync('uploads_enc'); } catch {}
try { if (!fs.existsSync(path.join(__dirname,'public'))) fs.mkdirSync(path.join(__dirname,'public')); } catch {}
app.use('/public', express.static(path.join(__dirname,'public')));

let db = null;
let SQLITE_READY = false;
const dbPathEnv = process.env.DB_PATH;
const dbPath = dbPathEnv ? (path.isAbsolute(dbPathEnv) ? dbPathEnv : path.join(__dirname, dbPathEnv)) : path.join(__dirname, 'data.db');
const SQLITE_SKIP = String(process.env.DISABLE_SQLITE||'').toLowerCase() === 'true' || String(process.env.DISABLE_SQLITE||'') === '1'
try {
  if (!SQLITE_SKIP) {
    sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(dbPath);
    SQLITE_READY = true;
    console.log('SQLite connected to:', dbPath);
  }
} catch (e) {
  console.warn('SQLite disabled:', e.message);
}
let SALES_HAS_TOTAL_AMOUNT = false;
let PURCHASES_HAS_TOTAL_COST = false;
if (SQLITE_READY) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  try {
    db.serialize(() => {
      db.run("CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)")
      db.run("CREATE INDEX IF NOT EXISTS idx_sales_payment ON sales(payment_status)")
      db.run("CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_no)")
      db.run("CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date)")
      db.run("CREATE INDEX IF NOT EXISTS idx_purchases_payment ON purchases(payment_status)")
      db.run("CREATE INDEX IF NOT EXISTS idx_purchases_invoice ON purchases(invoice_no)")
      db.run("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, user TEXT, entity TEXT, entity_id INTEGER, action TEXT, changes TEXT, ip TEXT, ua TEXT, city TEXT)")
    })
  } catch {}
}

function ensureBackupDir() {
  try { 
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true }) 
  } catch {}
}
function timestamp() {
  const d = new Date();
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0'); const mm = String(d.getMinutes()).padStart(2,'0'); const ss = String(d.getSeconds()).padStart(2,'0');
  return `${y}${m}${day}-${hh}${mm}${ss}`
}
function pruneBackupsByDays(days) {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.startsWith('sqlite-') && f.endsWith('.db'))
    const keepSet = new Set();
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - i * 24*3600*1000);
      const key = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      keepSet.add(key);
    }
    files.forEach(f => {
      const m = f.match(/^sqlite-(\d{8})-/);
      const dayStr = m && m[1] ? m[1] : null;
      if (!dayStr) return;
      if (!keepSet.has(dayStr)) {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, f)) } catch {}
      }
    })
  } catch {}
}
function pruneBackupsByCount(count) {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.db') || f.endsWith('.json'))
      .sort((a,b)=> b.localeCompare(a));
    for (let i = count; i < files.length; i++) {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, files[i])) } catch {}
    }
  } catch {}
}
function backupSqliteNow() {
  ensureBackupDir();
  const name = `sqlite-${timestamp()}.db`;
  const src = dbPath; const dest = path.join(BACKUPS_DIR, name);
  fs.copyFileSync(src, dest);
  pruneBackupsByCount(3);
  return name;
}
function backupSqliteList() {
  ensureBackupDir();
  return fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.db') || f.endsWith('.json')).sort((a,b)=> b.localeCompare(a));
}
function restoreSqlite(name, cb) {
  try {
    const src = path.join(BACKUPS_DIR, name);
    if (!fs.existsSync(src)) return cb(new Error('Backup not found'));
    if (SQLITE_READY) {
      try { db.close(); } catch {}
    }
    fs.copyFileSync(src, dbPath);
    if (SQLITE_READY) {
      db = new sqlite3.Database(dbPath);
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA busy_timeout = 3000');
    }
    cb(null);
  } catch (e) {
    cb(e);
  }
}
async function backupMongoNow() {
  ensureBackupDir();
  const name = `mongo-${timestamp()}.json`;
  const dest = path.join(BACKUPS_DIR, name);
  const cols = await mongoDb.listCollections().toArray();
  const out = {};
  for (const c of cols) {
    try { out[c.name] = await mongoDb.collection(c.name).find({}).toArray(); }
    catch { out[c.name] = []; }
  }
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  pruneBackupsByCount(3);
  return name;
}
function restoreMongo(name) {
  return new Promise(async (resolve, reject) => {
    try {
      const src = path.join(BACKUPS_DIR, name);
      if (!fs.existsSync(src)) return reject(new Error('Backup not found'));
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      const cols = Object.keys(data||{});
      const existing = await mongoDb.listCollections().toArray();
      await Promise.all(existing.map(c => mongoDb.collection(c.name).deleteMany({})));
      for (const col of cols) {
        const arr = Array.isArray(data[col]) ? data[col] : [];
        if (arr.length) await mongoDb.collection(col).insertMany(arr);
      }
      resolve();
    } catch (e) { reject(e); }
  })
}
setTimeout(() => { try { if (MONGO_READY) { backupMongoNow(); } else if (SQLITE_READY) { backupSqliteNow(); } } catch {} }, 5_000);
setInterval(() => { try { if (MONGO_READY) { backupMongoNow(); } else if (SQLITE_READY) { backupSqliteNow(); } } catch {} }, 24*3600*1000);

let MONGO_READY = false;
let mongoDb = null;
let MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
let MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'quanlyche';
const MONGO_SKIP = String(process.env.DISABLE_MONGO||'').toLowerCase() === 'true' || String(process.env.DISABLE_MONGO||'') === '1';
try {
  if (!process.env.MONGO_URL && fs.existsSync('mongo.url.txt')) {
    const u = fs.readFileSync('mongo.url.txt', 'utf8').trim();
    if (u) MONGO_URL = u;
  }
  if (!process.env.MONGO_DB_NAME && fs.existsSync('mongo.dbname.txt')) {
    const d = fs.readFileSync('mongo.dbname.txt', 'utf8').trim();
    if (d) MONGO_DB_NAME = d;
  }
} catch {}

const VARIABLE_EXPENSE_CATEGORIES = [
  // English
  'Utility','Electricity','Fuel','Wood','Coal','Gas','Wage','Salary','Labor',
  // Vietnamese
  'Tiện ích','Điện','Nhiên liệu','Củi','Than','Gas','Lương','Tiền lương','Nhân công'
];
const FIXED_EXPENSE_CATEGORIES = [
  // English
  'Depreciation','Interest','Loan Interest','Bank Interest','Amortization','Repair',
  // Vietnamese
  'Khấu hao','Lãi','Lãi vay','Lãi ngân hàng','Phân bổ','Sửa chữa'
];

async function nextId(coll) {
  try {
    const r = await mongoDb.collection('__counters').findOneAndUpdate(
      { _id: coll },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    )
    return Number(r.value?.seq || 1)
  } catch {
    return Number(Date.now())
  }
}
const JWT_SECRET = process.env.JWT_SECRET || 'changeme-secret';
const RATE = new Map();
const ENC_DIR = 'uploads_enc';
function fileKeys() {
  const primary = String(process.env.FILES_SECRET || JWT_SECRET || '');
  const keys = [];
  try { keys.push(crypto.createHash('sha256').update(primary).digest()) } catch { keys.push(Buffer.alloc(32,0)) }
  const alt = String(JWT_SECRET||'');
  if (primary !== alt) { try { keys.push(crypto.createHash('sha256').update(alt).digest()) } catch {} }
  return keys;
}
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const key = fileKeys()[0];
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('ENC1'), iv, tag, ct]);
}
function decryptBuffer(data) {
  try {
    const magic = data.slice(0, 4).toString('utf8');
    if (magic !== 'ENC1') return null;
    const iv = data.slice(4, 16);
    const tag = data.slice(16, 32);
    const ct = data.slice(32);
    const keys = fileKeys();
    for (let i=0;i<keys.length;i++) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', keys[i], iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}
function contentTypeFromName(name) {
  const ext = (String(name||'').replace(/\.enc$/,'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1].toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return 'image/jpeg';
}
function contentDispositionInline(name) {
  const base = String(name||'').replace(/^.*\//,'').replace(/\.enc$/,'');
  return `inline; filename="${base}"`;
}
function rateLimit(windowMs, max, bucket) {
  return function (req, res, next) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    let arr = RATE.get(key) || [];
    arr = arr.filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ message: 'Too many requests' });
    arr.push(now);
    RATE.set(key, arr);
    next();
  }
}
let OPENAI_API_KEY_RUNTIME = process.env.OPENAI_API_KEY || ''
let OPENAI_MODEL_RUNTIME = process.env.OPENAI_MODEL || 'gpt-4o-mini'
function openaiTools(){ return [
  { type:'function', function:{ name:'create_sale', parameters:{ type:'object', properties:{ sale_date:{type:'string'}, customer_name:{type:'string'}, tea_type:{type:'string'}, price_per_kg:{type:'number'}, weight:{type:'number'}, payment_status:{type:'string'}, ticket_name:{type:'string'}, invoice_no:{type:'string'}, contract:{type:'string'}, issued_by:{type:'string'}, export_type:{type:'string'}, country:{type:'string'} }, required:['sale_date','customer_name','price_per_kg','weight'] } } },
  { type:'function', function:{ name:'update_sale', parameters:{ type:'object', properties:{ id:{type:'number'}, sale_date:{type:'string'}, customer_name:{type:'string'}, tea_type:{type:'string'}, price_per_kg:{type:'number'}, weight:{type:'number'}, payment_status:{type:'string'}, ticket_name:{type:'string'}, invoice_no:{type:'string'}, contract:{type:'string'}, created_by:{type:'string'}, issued_by:{type:'string'}, export_type:{type:'string'}, country:{type:'string'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{ name:'delete_sale', parameters:{ type:'object', properties:{ id:{type:'number'} }, required:['id'] } } },
  { type:'function', function:{ name:'mark_sale_paid', parameters:{ type:'object', properties:{ id:{type:'number'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{ name:'create_purchase', parameters:{ type:'object', properties:{ purchase_date:{type:'string'}, supplier_name:{type:'string'}, weight:{type:'number'}, unit_price:{type:'number'}, payment_status:{type:'string'}, water_percent:{type:'number'}, net_weight:{type:'number'}, ticket_name:{type:'string'}, invoice_no:{type:'string'}, weigh_ticket_code:{type:'string'}, vehicle_plate:{type:'string'} }, required:['purchase_date','supplier_name','weight','unit_price'] } } },
  { type:'function', function:{ name:'update_purchase', parameters:{ type:'object', properties:{ id:{type:'number'}, purchase_date:{type:'string'}, supplier_name:{type:'string'}, weight:{type:'number'}, unit_price:{type:'number'}, payment_status:{type:'string'}, water_percent:{type:'number'}, net_weight:{type:'number'}, ticket_name:{type:'string'}, invoice_no:{type:'string'}, weigh_ticket_code:{type:'string'}, vehicle_plate:{type:'string'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{ name:'delete_purchase', parameters:{ type:'object', properties:{ id:{type:'number'} }, required:['id'] } } },
  { type:'function', function:{ name:'mark_purchase_paid', parameters:{ type:'object', properties:{ id:{type:'number'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{ name:'create_expense', parameters:{ type:'object', properties:{ expense_date:{type:'string'}, description:{type:'string'}, amount:{type:'number'}, category:{type:'string'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['expense_date','description','amount'] } } },
  { type:'function', function:{ name:'update_expense', parameters:{ type:'object', properties:{ id:{type:'number'}, expense_date:{type:'string'}, description:{type:'string'}, amount:{type:'number'}, category:{type:'string'}, receipt_data:{type:'string'}, receipt_name:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{ name:'delete_expense', parameters:{ type:'object', properties:{ id:{type:'number'} }, required:['id'] } } },
  { type:'function', function:{ name:'find_receipts', parameters:{ type:'object', properties:{ q:{type:'string'}, type:{type:'string'}, month:{type:'number'}, year:{type:'number'} } } } },
  { type:'function', function:{ name:'kpi_month', parameters:{ type:'object', properties:{ month:{type:'number'}, year:{type:'number'} } } } },
  { type:'function', function:{ name:'top_customers_month', parameters:{ type:'object', properties:{ month:{type:'number'}, year:{type:'number'} } } } },
  { type:'function', function:{ name:'top_suppliers_month', parameters:{ type:'object', properties:{ month:{type:'number'}, year:{type:'number'} } } } }
] }
async function chatgptReply(message){
  try {
    if (!OPENAI_API_KEY_RUNTIME) return null
    const body = {
      model: OPENAI_MODEL_RUNTIME,
      messages: [
        { role:'system', content:'Bạn là trợ lý cho hệ thống thu mua chè. Trả lời tiếng Việt. Khi người dùng yêu cầu thao tác, hãy gọi function tương ứng với tham số chuẩn.' },
        { role:'user', content:String(message||'') }
      ],
      tools: openaiTools(),
      tool_choice: 'auto'
    }
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+OPENAI_API_KEY_RUNTIME }, body: JSON.stringify(body) })
    const data = await r.json()
    const c = Array.isArray(data.choices) ? data.choices[0] : null
    const msg = c && c.message ? c.message : {}
    const out = { reply: msg.content || '', actions: [] }
    const tc = msg.tool_calls || []
    if (Array.isArray(tc) && tc.length){
      tc.forEach(t => {
        let args = {}
        try { args = t.function && t.function.arguments ? JSON.parse(t.function.arguments) : {} } catch {}
        out.actions.push({ type:'function_call', name: String(t.function?.name||''), args, label:'Thực hiện' })
      })
      if (!out.reply) {
        const labels = out.actions.map(a => {
          const n = String(a.name||'')
          if (n==='create_sale') return 'Tạo đơn bán'
          if (n==='update_sale') return 'Sửa đơn bán'
          if (n==='delete_sale') return 'Xóa đơn bán'
          if (n==='mark_sale_paid') return 'Đánh dấu đã thanh toán đơn bán'
          if (n==='create_purchase') return 'Tạo đơn nhập'
          if (n==='update_purchase') return 'Sửa đơn nhập'
          if (n==='delete_purchase') return 'Xóa đơn nhập'
          if (n==='mark_purchase_paid') return 'Đánh dấu đã thanh toán đơn nhập'
          if (n==='create_expense') return 'Tạo chi phí'
          if (n==='update_expense') return 'Sửa chi phí'
          if (n==='delete_expense') return 'Xóa chi phí'
          if (n==='find_receipts') return 'Tìm ảnh hóa đơn'
          if (n==='kpi_month') return 'Báo cáo KPI tháng'
          if (n==='top_customers_month') return 'Top khách hàng tháng'
          if (n==='top_suppliers_month') return 'Top nhà cung cấp tháng'
          return 'Hành động'
        })
        out.reply = `Đã sinh ${out.actions.length} hành động: ${labels.join(' • ')}`
      }
    }
    if (!out.reply) out.reply = 'OK'
    return out
  } catch { return null }
}
if (!MONGO_SKIP) {
  try {
    const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 2000 });
    client.connect().then(() => {
      mongoDb = client.db(MONGO_DB_NAME);
      MONGO_READY = true;
      console.log('Mongo connected:', MONGO_URL, MONGO_DB_NAME);
      mongoDb.collection('users').findOne({ username: 'admin' }).then(u => {
        if (!u) {
          nextId('users').then(id => {
            const hash = bcrypt.hashSync('admin123', 10);
            mongoDb.collection('users').insertOne({ id, username: 'admin', password_hash: hash, role: 'admin' }).catch(() => {});
          });
        }
      }).catch(() => {});
    }).catch((e) => {
      console.warn('Mongo disabled:', e.message);
    });
  } catch (e) {
    console.warn('Mongo init error:', e.message);
  }
} else {
  console.log('Mongo skipped: DISABLE_MONGO is set');
}

// Create tables if not exist
if (SQLITE_READY) db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date TEXT,
    customer_name TEXT,
    tea_type TEXT,
    price_per_kg REAL,
    weight REAL,
    payment_status TEXT DEFAULT 'pending'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_date TEXT,
    supplier_name TEXT,
    weight REAL,
    unit_price REAL,
    payment_status TEXT DEFAULT 'pending'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT,
    description TEXT,
    amount REAL,
    category TEXT,
    receipt_path TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS expense_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT DEFAULT 'Định phí',
    day_of_month INTEGER,
    owner TEXT,
    active INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    note TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    note TEXT,
    country TEXT,
    export_type TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    phone TEXT,
    note TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    user TEXT,
    entity TEXT,
    entity_id INTEGER,
    action TEXT,
    changes TEXT,
    ip TEXT,
    ua TEXT,
    city TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    username TEXT,
    success INTEGER,
    ip TEXT,
    ua TEXT,
    city TEXT,
    note TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    from_user TEXT,
    to_role TEXT,
    to_users TEXT,
    text TEXT,
    ref_type TEXT,
    ref_id INTEGER
  )`);
  db.all(`PRAGMA table_info(chat_messages)`, [], (e, cols) => {
    if (!e) {
      const hasToUsers = cols?.some(r => r.name === 'to_users');
      if (!hasToUsers) db.run(`ALTER TABLE chat_messages ADD COLUMN to_users TEXT`, [], () => {});
    }
  });

  // Ensure columns exist for legacy users table
  db.all(`PRAGMA table_info(users)`, [], (err, rows) => {
    if (!err) {
      const required = ['username','password_hash','role'];
      const hasAll = required.every(c => rows?.some(r => r.name === c));
      if (!hasAll) {
        console.log('Migrating users table to standard schema');
        db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'user'
          )`);
          const cols = rows?.map(r => r.name) || [];
          const hasUsername = cols.includes('username');
          const hasPwd = cols.includes('password_hash');
          const hasRole = cols.includes('role');
          const selectCols = [
            hasUsername ? 'username' : `NULL AS username`,
            hasPwd ? 'password_hash' : `NULL AS password_hash`,
            hasRole ? 'role' : `'user' AS role`
          ].join(', ');
          db.run(`INSERT INTO users_new (username, password_hash, role)
                  SELECT ${selectCols} FROM users`, [], (e) => {
            if (e) console.warn('Users data copy warning:', e.message);
            db.run(`DROP TABLE users`, [], () => {
              db.run(`CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password_hash TEXT,
                role TEXT DEFAULT 'user'
              )`, [], () => {
                db.run(`INSERT INTO users (id, username, password_hash, role)
                        SELECT id, username, password_hash, role FROM users_new`, [], (e2) => {
                  if (e2) console.warn('Users migrate copy warning:', e2.message)
                  db.run(`DROP TABLE users_new`, [], () => {
                    console.log('Users table migrated');
                  })
                })
              })
            });
          });
        });
      }
    }
    // Ensure session_id exists for single-session enforcement
    db.all(`PRAGMA table_info(users)`, [], (e2, cols2) => {
      if (!e2) {
        const hasSession = cols2?.some(r => r.name === 'session_id');
        if (!hasSession) db.run(`ALTER TABLE users ADD COLUMN session_id TEXT`, [], () => {});
      }
    });
    // Seed admin if not exists
    db.get(`SELECT id FROM users WHERE username = ?`, ['admin'], (e, u) => {
      if (!e && !u) {
        const hash = bcrypt.hashSync('admin123', 10);
        db.run(`INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`, ['admin', hash, 'admin']);
        console.log('Seeded default admin: admin/admin123');
      }
    });
  });

  // Ensure category column exists for legacy DBs
  db.all(`PRAGMA table_info(expenses)`, [], (err, rows) => {
    if (!err) {
      const hasCategory = rows?.some(r => r.name === 'category');
      if (!hasCategory) {
        db.run(`ALTER TABLE expenses ADD COLUMN category TEXT`, [], () => {});
      }
      const hasReceipt = rows?.some(r => r.name === 'receipt_path');
      if (!hasReceipt) {
        db.run(`ALTER TABLE expenses ADD COLUMN receipt_path TEXT`, [], () => {});
      }
      const hasOwner = rows?.some(r => r.name === 'owner');
      if (!hasOwner) {
        db.run(`ALTER TABLE expenses ADD COLUMN owner TEXT`, [], () => {});
      }
      const hasTemplateId = rows?.some(r => r.name === 'template_id');
      if (!hasTemplateId) {
        db.run(`ALTER TABLE expenses ADD COLUMN template_id INTEGER`, [], () => {});
      }
      const hasPaidBy = rows?.some(r => r.name === 'paid_by');
      if (!hasPaidBy) {
        db.run(`ALTER TABLE expenses ADD COLUMN paid_by TEXT`, [], () => {});
      }
    }
  });

  // Ensure tea_type exists for legacy sales table
  db.all(`PRAGMA table_info(sales)`, [], (err, rows) => {
    if (!err) {
      console.log('sales columns:', rows);
      SALES_HAS_TOTAL_AMOUNT = rows?.some(r => r.name === 'total_amount');
      const totalCol = rows?.find(r => r.name === 'total_amount');
      const ensureCol = (name, defSql) => {
        const has = rows?.some(r => r.name === name);
        if (!has) db.run(defSql, [], () => {});
      };
      ensureCol('tea_type', `ALTER TABLE sales ADD COLUMN tea_type TEXT`);
      ensureCol('payment_status', `ALTER TABLE sales ADD COLUMN payment_status TEXT DEFAULT 'pending'`);
      ensureCol('customer_name', `ALTER TABLE sales ADD COLUMN customer_name TEXT`);
      ensureCol('price_per_kg', `ALTER TABLE sales ADD COLUMN price_per_kg REAL`);
      ensureCol('weight', `ALTER TABLE sales ADD COLUMN weight REAL`);
      ensureCol('ticket_name', `ALTER TABLE sales ADD COLUMN ticket_name TEXT`);
      ensureCol('invoice_no', `ALTER TABLE sales ADD COLUMN invoice_no TEXT`);
      ensureCol('contract', `ALTER TABLE sales ADD COLUMN contract TEXT`);
      ensureCol('created_by', `ALTER TABLE sales ADD COLUMN created_by TEXT`);
      ensureCol('issued_by', `ALTER TABLE sales ADD COLUMN issued_by TEXT`);
      ensureCol('export_type', `ALTER TABLE sales ADD COLUMN export_type TEXT`);
      ensureCol('country', `ALTER TABLE sales ADD COLUMN country TEXT`);
      ensureCol('receipt_path', `ALTER TABLE sales ADD COLUMN receipt_path TEXT`);
      ensureCol('owner', `ALTER TABLE sales ADD COLUMN owner TEXT`);
      ensureCol('paid_by', `ALTER TABLE sales ADD COLUMN paid_by TEXT`);

      // If legacy schema has NOT NULL total_amount, rebuild table to remove the constraint
      if (totalCol && totalCol.notnull === 1) {
        console.log('Migrating sales table: removing NOT NULL from total_amount by rebuilding table');
        db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS sales_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_date TEXT NOT NULL,
            customer_name TEXT,
            tea_type TEXT,
            price_per_kg REAL NOT NULL,
            weight REAL NOT NULL,
            payment_status TEXT DEFAULT 'pending'
          )`);
          db.run(`INSERT INTO sales_new (id, sale_date, customer_name, tea_type, price_per_kg, weight, payment_status)
                  SELECT id, sale_date, customer_name, tea_type, price_per_kg, weight, payment_status FROM sales`, [], (e) => {
            if (e) console.error('Data copy error:', e.message);
            db.run(`DROP TABLE sales`, [], () => {
              db.run(`CREATE TABLE sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_date TEXT,
                customer_name TEXT,
                tea_type TEXT,
                price_per_kg REAL NOT NULL,
                weight REAL NOT NULL,
                payment_status TEXT DEFAULT 'pending'
              )`, [], () => {
                db.run(`INSERT INTO sales (id, sale_date, customer_name, tea_type, price_per_kg, weight, payment_status)
                        SELECT id, sale_date, customer_name, tea_type, price_per_kg, weight, payment_status FROM sales_new`, [], (e2) => {
                  if (e2) console.error('Sales migrate copy warning:', e2.message)
                  db.run(`DROP TABLE sales_new`, [], () => {
                    console.log('Sales table migrated successfully');
                    SALES_HAS_TOTAL_AMOUNT = false;
                    db.run(`ALTER TABLE sales ADD COLUMN receipt_path TEXT`, [], () => {});
                  })
                })
              })
            });
          });
        });
      }
    }
  });

  // Detect legacy schema for purchases table and adapt
  db.all(`PRAGMA table_info(purchases)`, [], (err, rows) => {
    if (!err) {
      const totalCol = rows?.find(r => r.name === 'total_cost');
      PURCHASES_HAS_TOTAL_COST = !!totalCol;
      // Ensure required columns exist (for very old DBs)
      const ensureCol = (name, defSql) => {
        const has = rows?.some(r => r.name === name);
        if (!has) db.run(defSql, [], () => {});
      };
      ensureCol('purchase_date', `ALTER TABLE purchases ADD COLUMN purchase_date TEXT`);
      ensureCol('supplier_name', `ALTER TABLE purchases ADD COLUMN supplier_name TEXT`);
      ensureCol('weight', `ALTER TABLE purchases ADD COLUMN weight REAL`);
      ensureCol('unit_price', `ALTER TABLE purchases ADD COLUMN unit_price REAL`);
      ensureCol('payment_status', `ALTER TABLE purchases ADD COLUMN payment_status TEXT DEFAULT 'pending'`);
      ensureCol('water_percent', `ALTER TABLE purchases ADD COLUMN water_percent REAL`);
      ensureCol('net_weight', `ALTER TABLE purchases ADD COLUMN net_weight REAL`);
      ensureCol('ticket_name', `ALTER TABLE purchases ADD COLUMN ticket_name TEXT`);
      ensureCol('invoice_no', `ALTER TABLE purchases ADD COLUMN invoice_no TEXT`);
      ensureCol('weigh_ticket_code', `ALTER TABLE purchases ADD COLUMN weigh_ticket_code TEXT`);
      ensureCol('vehicle_plate', `ALTER TABLE purchases ADD COLUMN vehicle_plate TEXT`);
      ensureCol('receipt_path', `ALTER TABLE purchases ADD COLUMN receipt_path TEXT`);
      ensureCol('owner', `ALTER TABLE purchases ADD COLUMN owner TEXT`);
      ensureCol('paid_by', `ALTER TABLE purchases ADD COLUMN paid_by TEXT`);

      // If legacy schema has NOT NULL total_cost, we can rebuild table to remove constraint
      if (totalCol && totalCol.notnull === 1) {
        console.log('Migrating purchases table: removing NOT NULL from total_cost by rebuilding table');
        db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS purchases_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_date TEXT,
            supplier_name TEXT,
            weight REAL,
            unit_price REAL,
            payment_status TEXT DEFAULT 'pending'
          )`);
          db.run(`INSERT INTO purchases_new (id, purchase_date, supplier_name, weight, unit_price, payment_status)
                  SELECT id, purchase_date, supplier_name, weight, unit_price, payment_status FROM purchases`, [], (e) => {
            if (e) console.error('Purchases data copy error:', e.message);
            db.run(`DROP TABLE purchases`, [], () => {
              db.run(`CREATE TABLE purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purchase_date TEXT,
                supplier_name TEXT,
                weight REAL,
                unit_price REAL,
                payment_status TEXT DEFAULT 'pending'
              )`, [], () => {
                db.run(`INSERT INTO purchases (id, purchase_date, supplier_name, weight, unit_price, payment_status)
                        SELECT id, purchase_date, supplier_name, weight, unit_price, payment_status FROM purchases_new`, [], (e2) => {
                  if (e2) console.error('Purchases migrate copy warning:', e2.message)
                  db.run(`DROP TABLE purchases_new`, [], () => {
                    console.log('Purchases table migrated successfully');
                    PURCHASES_HAS_TOTAL_COST = false;
                    db.run(`ALTER TABLE purchases ADD COLUMN receipt_path TEXT`, [], () => {});
                  })
                })
              })
            });
          });
        });
      }
    }
  });

  db.all(`PRAGMA table_info(customers)`, [], (err, rows) => {
    if (!err) {
      const ensureCol = (name, defSql) => {
        const has = rows?.some(r => r.name === name);
        if (!has) db.run(defSql, [], () => {});
      };
      ensureCol('country', `ALTER TABLE customers ADD COLUMN country TEXT`);
      ensureCol('export_type', `ALTER TABLE customers ADD COLUMN export_type TEXT`);
    }
  });
  db.run(`CREATE TABLE IF NOT EXISTS finished_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT,
    tea_type TEXT,
    weight REAL,
    unit_cost REAL,
    note TEXT
  )`);
});

function pad2(n) { return String(n).padStart(2, '0'); }
 

function detectMonthYear(msg){
  const now = new Date(); let m = now.getMonth()+1; let y = now.getFullYear();
  const mm = String(msg||'').match(/tháng\s*(\d{1,2})/i); if (mm) m = Number(mm[1]);
  const yy = String(msg||'').match(/năm\s*(\d{4})/i); if (yy) y = Number(yy[1]);
  const m2 = String(msg||'').match(/(\d{4})[-/](\d{1,2})/); if (m2){ y = Number(m2[1]); m = Number(m2[2]); }
  return { m, y }
}
async function kpiReply(msg){
  const { m, y } = detectMonthYear(msg)
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const mm = pad2(m); const yy = String(y)
  const p1 = new Promise((resolve)=> db.get(`SELECT SUM(price_per_kg * weight) AS s FROM sales WHERE strftime('%m', sale_date) = ? AND strftime('%Y', sale_date) = ?`, [mm, yy], (e,row)=> resolve(Number(row?.s||0))))
  const p2 = new Promise((resolve)=> db.get(`SELECT SUM(unit_price * COALESCE(net_weight, weight)) AS s FROM purchases WHERE strftime('%m', purchase_date) = ? AND strftime('%Y', purchase_date) = ?`, [mm, yy], (e,row)=> resolve(Number(row?.s||0))))
  const p3 = new Promise((resolve)=> db.get(`SELECT SUM(amount) AS s FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ?`, [mm, yy], (e,row)=> resolve(Number(row?.s||0))))
  const pRecv = new Promise((resolve)=> db.get(`SELECT SUM(price_per_kg * weight) AS s FROM sales WHERE payment_status != 'paid'`, [], (e,row)=> resolve(Number(row?.s||0))))
  const pPay = new Promise((resolve)=> db.get(`SELECT SUM(unit_price * COALESCE(net_weight, weight)) AS s FROM purchases WHERE payment_status != 'paid'`, [], (e,row)=> resolve(Number(row?.s||0))))
  const [sumSales, sumPurch, sumExp, recv, pay] = await Promise.all([p1,p2,p3,pRecv,pPay])
  const profit = sumSales - sumPurch - sumExp
  const reply = `Tháng ${m}/${y} — Thu: ${sumSales.toLocaleString()} • Chi nhập: ${sumPurch.toLocaleString()} • Chi phí: ${sumExp.toLocaleString()} • Lãi/Lỗ: ${profit.toLocaleString()} • Phải thu: ${recv.toLocaleString()} • Phải trả: ${pay.toLocaleString()}`
  return { reply, actions: [{ type:'navigate', tab:'balanceSheet', label:'Mở Bảng cân đối' }] }
}
async function findReceipt(msg){
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const s = String(msg||'')
  const q = (s.match(/h[đd]\s*([\w-]+)/i)?.[1]) || (s.match(/(\d{4,})/)?.[1]) || ''
  const wantSales = /\b(thu|bán|sales)\b/i.test(s)
  const wantPurch = /\b(nhập|purchases)\b/i.test(s)
  const { m, y } = detectMonthYear(s)
  const whereLike = `%${q}%`
  return new Promise((resolve)=> {
    const out = []
    const salesSql = `SELECT id, invoice_no, ticket_name, sale_date AS d FROM sales WHERE receipt_path IS NOT NULL ${q? ' AND (invoice_no LIKE ? OR ticket_name LIKE ?)':''} ${m? " AND strftime('%m', sale_date) = ?":''} ${y? " AND strftime('%Y', sale_date) = ?":''} ORDER BY d DESC LIMIT 10`
    const purchSql = `SELECT id, invoice_no, ticket_name, weigh_ticket_code, purchase_date AS d FROM purchases WHERE receipt_path IS NOT NULL ${q? ' AND (invoice_no LIKE ? OR ticket_name LIKE ? OR weigh_ticket_code LIKE ?)':''} ${m? " AND strftime('%m', purchase_date) = ?":''} ${y? " AND strftime('%Y', purchase_date) = ?":''} ORDER BY d DESC LIMIT 10`
    const salesParams = []
    const purchParams = []
    if (q) { salesParams.push(whereLike, whereLike); purchParams.push(whereLike, whereLike, whereLike) }
    if (m) { salesParams.push(pad2(m)); purchParams.push(pad2(m)) }
    if (y) { salesParams.push(String(y)); purchParams.push(String(y)) }
    const doSales = () => db.all(salesSql, salesParams, (e,rows)=>{ (rows||[]).forEach(r=> out.push({ type:'sales', id:r.id, invoice_no:r.invoice_no||r.ticket_name||'' })); doPurch() })
    const doPurch = () => db.all(purchSql, purchParams, (e2,rows2)=>{ (rows2||[]).forEach(r=> out.push({ type:'purchases', id:r.id, invoice_no:r.invoice_no||r.ticket_name||r.weigh_ticket_code||'' })); finish() })
    const finish = () => {
        if (!out.length) return resolve({ reply: 'Không tìm thấy ảnh hóa đơn phù hợp', actions: [] })
        const actions = out.map(x=> ({ type:'open_url', path:`/api/${x.type}/${x.id}/receipt`, label:`Mở ${x.type} • ${x.invoice_no||('#'+x.id)}` }))
        resolve({ reply: `Tìm thấy ${out.length} ảnh${q? ' theo "'+q+'"':''}`, actions })
      }
    if (wantSales && !wantPurch) { db.all(salesSql, salesParams, (e,rows)=>{ (rows||[]).forEach(r=> out.push({ type:'sales', id:r.id, invoice_no:r.invoice_no||r.ticket_name||'' })); finish() }) }
    else if (wantPurch && !wantSales) { db.all(purchSql, purchParams, (e,rows)=>{ (rows||[]).forEach(r=> out.push({ type:'purchases', id:r.id, invoice_no:r.invoice_no||r.ticket_name||r.weigh_ticket_code||'' })); finish() }) }
    else doSales()
  })
}
function parseNumber(s){ const m = (String(s).match(/\d+[\.,]?\d*/) || ['0'])[0].replace(',','.'); return Number(m) }
async function parseCreate(msg){
  const isSale = /\b(bán|đơn bán)\b/i.test(msg)
  const isPurch = /\b(nhập|đơn nhập)\b/i.test(msg)
  const weight = parseNumber((String(msg).match(/(\d+[\.,]?\d*)\s*kg/i)||[])[1])
  const price = parseNumber((String(msg).match(/giá\s*(\d+[\.,]?\d*)/i)||[])[1])
  const dateM = String(msg).match(/(\d{1,2})[\/-](\d{1,2})/)
  const now = new Date(); const y = now.getFullYear(); const dstr = dateM ? `${y}-${pad2(Number(dateM[2]))}-${pad2(Number(dateM[1]))}` : `${y}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
  const name = (String(msg).match(/cho\s+([^\d]+?)(?:\s+ngày|$)/i)||[])[1]?.trim() || ''
  if (isSale) {
    const payload = { sale_date: dstr, customer_name: name, tea_type:'', price_per_kg: price, weight, payment_status:'pending' }
    return { reply:`Tạo đơn bán? Ngày ${dstr}, KH: ${name||'-'}, ${weight}kg x ${price}`,
      actions:[
        { type:'function_call', name:'create_sale', args: payload, label:'Tạo đơn bán' },
        { type:'prefill_sales', payload, label:'Điền form đơn bán' },
        { type:'navigate', tab:'sales', label:'Mở Bán chè' }
      ]
    }
  }
  if (isPurch) {
    const payload = { purchase_date: dstr, supplier_name: name, ticket_name:'', weight, unit_price: price, payment_status:'pending' }
    return { reply:`Tạo đơn nhập? Ngày ${dstr}, NCC: ${name||'-'}, ${weight}kg x ${price}`,
      actions:[
        { type:'function_call', name:'create_purchase', args: payload, label:'Tạo đơn nhập' },
        { type:'prefill_purchases', payload, label:'Điền form đơn nhập' },
        { type:'navigate', tab:'purchases', label:'Mở Nhập chè' }
      ]
    }
  }
  return { reply:'Bạn muốn tạo Đơn bán hay Đơn nhập? Ví dụ: "Thêm đơn bán 20kg giá 100k cho A ngày 25/11"', actions: [] }
}
async function parseCreateExpense(msg){
  const isExpense = /\b(chi phí|thêm chi|tạo chi)\b/i.test(msg)
  if (!isExpense) return null
  const amount = parseNumber((String(msg).match(/(\d+[\.,]?\d*)\s*(đ|vnd|vnđ)/i)||[])[1])
  const dateM = String(msg).match(/(\d{1,2})[\/-](\d{1,2})/)
  const now = new Date(); const y = now.getFullYear(); const dstr = dateM ? `${y}-${pad2(Number(dateM[2]))}-${pad2(Number(dateM[1]))}` : `${y}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
  const desc = (String(msg).match(/cho\s+(.+?)(?:\s+ngày|$)/i)||[])[1]?.trim() || (String(msg).match(/chi phí\s+(.+?)\s+(\d+)/i)||[])[1] || ''
  const payload = { expense_date: dstr, description: desc, amount: amount || '', category: 'Biến phí' }
  return { reply:`Tạo chi phí? Ngày ${dstr}, Mô tả: ${desc||'-'}, Số tiền: ${amount||'-'}`,
    actions:[
      { type:'function_call', name:'create_expense', args: payload, label:'Tạo chi phí' },
      { type:'prefill_expenses', payload, label:'Điền form Chi phí' },
      { type:'navigate', tab:'expenses', label:'Mở Chi phí' }
    ]
  }
}
async function topReply(msg){
  const { m, y } = detectMonthYear(msg)
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const mm = pad2(m); const yy = String(y)
  const wantSupplier = /(ncc|nhà cung cấp|supplier)/i.test(String(msg))
  if (wantSupplier) {
    return new Promise((resolve)=> db.all(`SELECT supplier_name AS name, SUM(unit_price * COALESCE(net_weight, weight)) AS s FROM purchases WHERE strftime('%m', purchase_date)=? AND strftime('%Y', purchase_date)=? GROUP BY supplier_name ORDER BY s DESC LIMIT 5`, [mm, yy], (e, rows)=>{
      const list = (rows||[]).map(r=> `${r.name||'-'}: ${Number(r.s||0).toLocaleString()}`)
      resolve({ reply: `Top NCC tháng ${m}/${y}: ${list.join(' • ')||'Không có dữ liệu'}`, actions:[{ type:'navigate', tab:'purchases', label:'Mở Nhập chè' }] })
    }))
  }
  return new Promise((resolve)=> db.all(`SELECT customer_name AS name, SUM(price_per_kg * weight) AS s FROM sales WHERE strftime('%m', sale_date)=? AND strftime('%Y', sale_date)=? GROUP BY customer_name ORDER BY s DESC LIMIT 5`, [mm, yy], (e, rows)=>{
    const list = (rows||[]).map(r=> `${r.name||'-'}: ${Number(r.s||0).toLocaleString()}`)
    resolve({ reply: `Top khách hàng tháng ${m}/${y}: ${list.join(' • ')||'Không có dữ liệu'}`, actions:[{ type:'navigate', tab:'sales', label:'Mở Bán chè' }] })
  }))
}
async function topYearReply(msg){
  const yMatch = String(msg||'').match(/năm\s*(\d{4})/i); const y = yMatch ? Number(yMatch[1]) : (new Date()).getFullYear()
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const wantSupplier = /(ncc|nhà cung cấp|supplier)/i.test(String(msg))
  if (wantSupplier) {
    return new Promise((resolve)=> db.all(`SELECT supplier_name AS name, SUM(unit_price * COALESCE(net_weight, weight)) AS s FROM purchases WHERE strftime('%Y', purchase_date)=? GROUP BY supplier_name ORDER BY s DESC LIMIT 5`, [String(y)], (e, rows)=>{
      const list = (rows||[]).map(r=> `${r.name||'-'}: ${Number(r.s||0).toLocaleString()}`)
      resolve({ reply: `Top NCC năm ${y}: ${list.join(' • ')||'Không có dữ liệu'}`, actions:[{ type:'navigate', tab:'purchases', label:'Mở Nhập chè' }] })
    }))
  }
  return new Promise((resolve)=> db.all(`SELECT customer_name AS name, SUM(price_per_kg * weight) AS s FROM sales WHERE strftime('%Y', sale_date)=? GROUP BY customer_name ORDER BY s DESC LIMIT 5`, [String(y)], (e, rows)=>{
    const list = (rows||[]).map(r=> `${r.name||'-'}: ${Number(r.s||0).toLocaleString()}`)
    resolve({ reply: `Top khách hàng năm ${y}: ${list.join(' • ')||'Không có dữ liệu'}`, actions:[{ type:'navigate', tab:'sales', label:'Mở Bán chè' }] })
  }))
}
async function expenseBreakdown(msg){
  const { m, y } = detectMonthYear(msg)
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const mm = pad2(m); const yy = String(y)
  return new Promise((resolve)=> db.all(`SELECT category, SUM(amount) AS s FROM expenses WHERE strftime('%m', expense_date)=? AND strftime('%Y', expense_date)=? GROUP BY category ORDER BY s DESC`, [mm, yy], (e, rows)=>{
    const total = (rows||[]).reduce((acc, r)=> acc + Number(r.s||0), 0)
    const fixed = (rows||[]).filter(r=> /định/i.test(String(r.category||''))).reduce((acc,r)=> acc + Number(r.s||0), 0)
    const variable = (rows||[]).filter(r=> /biến|khác|thuế|trả trước/i.test(String(r.category||''))).reduce((acc,r)=> acc + Number(r.s||0), 0)
    const list = (rows||[]).slice(0,5).map(r=> `${r.category||'-'}: ${Number(r.s||0).toLocaleString()}`)
    resolve({ reply: `Chi phí tháng ${m}/${y}: Tổng ${total.toLocaleString()} • Định phí ${fixed.toLocaleString()} • Biến phí ${variable.toLocaleString()} • Top: ${list.join(' • ')||'Không có'}`, actions:[{ type:'navigate', tab:'expenses', label:'Mở Chi phí' }] })
  }))
}
async function debtsDetail(msg){
  if (!SQLITE_READY) return { reply: 'DB chưa sẵn sàng', actions: [] }
  const now = new Date()
  const ageSales = await new Promise((resolve)=> db.all(`SELECT sale_date AS d, price_per_kg * weight AS v FROM sales WHERE payment_status != 'paid'`, [], (e, rows)=> resolve(rows||[])))
  const agePurch = await new Promise((resolve)=> db.all(`SELECT purchase_date AS d, unit_price * COALESCE(net_weight, weight) AS v FROM purchases WHERE payment_status != 'paid'`, [], (e, rows)=> resolve(rows||[])))
  function bucket(arr){
    const b = { le7:0, le30:0, gt30:0 }
    arr.forEach(r=> { const d = new Date(r.d||Date.now()); const diff = Math.floor((now - d)/86400000); const v = Number(r.v||0); if (diff<=7) b.le7+=v; else if (diff<=30) b.le30+=v; else b.gt30+=v })
    return b
  }
  const recv = bucket(ageSales), pay = bucket(agePurch)
  const reply = `Phải thu: ≤7 ngày ${recv.le7.toLocaleString()} • ≤30 ngày ${recv.le30.toLocaleString()} • >30 ngày ${recv.gt30.toLocaleString()} | Phải trả: ≤7 ngày ${pay.le7.toLocaleString()} • ≤30 ngày ${pay.le30.toLocaleString()} • >30 ngày ${pay.gt30.toLocaleString()}`
  return { reply, actions:[{ type:'navigate', tab:'balanceSheet', label:'Mở Bảng cân đối' }] }
}
async function simpleBotReplyFull(text){
  const msg = String(text||'').trim()
  if (!msg) return { reply:'Bạn cần hỏi gì? Ví dụ: "Hướng dẫn nhập đơn"', actions:[] }
  const low = msg.toLowerCase()
  if (/(help|trợ giúp|hướng dẫn)/.test(low)) return { reply:'Các mục chính: Tổng quan, Bán, Nhập, Chi phí, Công nợ, Ảnh hóa đơn. Bạn muốn làm gì?', actions:[] }
  if (/(doanh thu|báo cáo|kpi|lãi|lỗ|phải thu|phải trả|thống kê)/.test(low)) return kpiReply(low)
  if (/(top|xếp hạng).*(khách hàng|ncc|nhà cung cấp)/.test(low)) return topReply(low)
  if (/(top|xếp hạng).*(năm)/.test(low)) return topYearReply(low)
  if (/(chi phí|breakdown|theo loại)/.test(low)) return expenseBreakdown(low)
  if (/(công nợ|chi tiết công nợ|aging)/.test(low)) return debtsDetail(low)
  if (/(gán|set|sửa).*(số\s*hđ|invoice)/.test(low)) { const r = await parseSetInvoice(low); if (r) return r }
  if (/(thiếu|chưa\s*có).*số\s*hđ/.test(low)) { const r = await findMissingInvoice(low); if (r) return r }
  if (/(hđ|hóa đơn|receipt|bill|số hđ|tìm ảnh)/.test(low)) return findReceipt(low)
  if (/(thêm|tạo).*(đơn bán|đơn nhập|bán|nhập)/.test(low)) return parseCreate(low)
  if (/(thêm|tạo).*(chi phí)/.test(low)) { const r = await parseCreateExpense(low); if (r) return r }
  if (/sửa.*(đơn bán|bán)\s*#?\d+/.test(low)) { const r = await parseUpdateSale(low); if (r) return r }
  if (/sửa.*(đơn nhập|nhập)\s*#?\d+/.test(low)) { const r = await parseUpdatePurchase(low); if (r) return r }
  if (/so sánh.*tháng/.test(low)) { const r = await compareMonths(low); if (r) return r }
  if (/(xóa|xoá).*(đơn bán|bán)\s*#?\d+/.test(low)) { const id = Number((low.match(/#?(\d+)/)||[])[1]||0); if (id>0) return { reply:`Xóa đơn bán #${id}?`, actions:[{ type:'function_call', name:'delete_sale', args:{ id }, label:'Xác nhận' }] } }
  if (/(xóa|xoá).*(đơn nhập|nhập)\s*#?\d+/.test(low)) { const id = Number((low.match(/#?(\d+)/)||[])[1]||0); if (id>0) return { reply:`Xóa đơn nhập #${id}?`, actions:[{ type:'function_call', name:'delete_purchase', args:{ id }, label:'Xác nhận' }] } }
  if (/(xóa|xoá).*(chi phí)\s*#?\d+/.test(low)) { const id = Number((low.match(/#?(\d+)/)||[])[1]||0); if (id>0) return { reply:`Xóa chi phí #${id}?`, actions:[{ type:'function_call', name:'delete_expense', args:{ id }, label:'Xác nhận' }] } }
  if (/(bán|đơn bán)/.test(low)) return { reply:'Mở tab Bán chè, điền Ngày/Khách hàng/Giá/kg/Cân nặng và bấm "Thêm đơn bán".', actions:[{ type:'navigate', tab:'sales', label:'Mở Bán chè' }] }
  if (/(nhập|đơn nhập)/.test(low)) return { reply:'Mở tab Nhập chè, điền Ngày/Nhà cung cấp/Giá/kg/Cân nặng và bấm "Thêm đơn nhập".', actions:[{ type:'navigate', tab:'purchases', label:'Mở Nhập chè' }] }
  if (/(chi phí|thêm chi)/.test(low)) return { reply:'Vào tab Chi phí, nhập Ngày/Mô tả/Số tiền/Loại, bấm "Thêm chi phí". Có thể đính kèm ảnh.', actions:[{ type:'navigate', tab:'expenses', label:'Mở Chi phí' }] }
  if (/(ảnh|hóa đơn|bill|receipt)/.test(low)) return { reply:'Mở tab "Ảnh hóa đơn" để xem hoặc tìm theo Số HĐ, tháng/năm.', actions:[{ type:'navigate', tab:'receipts', label:'Mở Ảnh hóa đơn' }] }
  if (/(tổng kết|cuối ngày|hôm nay)/.test(low)) return dailySummaryReply()
  if (/(hướng dẫn.*(thêm đơn bán|đơn bán)|thêm đơn bán)/.test(low)) return { reply:'Các bước thêm đơn bán', actions:[{ type:'navigate', tab:'sales', label:'Mở Bán chè' }], cards:[{ title:'Thêm đơn bán', bullets:['Mở tab Bán chè','Điền Ngày bán','Điền Khách hàng','Điền Giá/kg và Cân nặng','Bấm Thêm đơn bán'] }] }
  if (/(hướng dẫn.*(thêm đơn nhập|đơn nhập)|thêm đơn nhập)/.test(low)) return { reply:'Các bước thêm đơn nhập', actions:[{ type:'navigate', tab:'purchases', label:'Mở Nhập chè' }], cards:[{ title:'Thêm đơn nhập', bullets:['Mở tab Nhập chè','Điền Ngày nhập','Điền Nhà cung cấp','Điền Giá/kg và Cân nặng','Bấm Thêm đơn nhập'] }] }
  return { reply:'Chưa hiểu yêu cầu. Bạn có thể hỏi: "Báo cáo tháng 11", "Tìm HĐ 00123", "Thêm đơn bán 20kg giá 100k".', actions:[] }
}

async function dailySummaryReply(){
  if (!SQLITE_READY) return { reply:'DB chưa sẵn sàng', actions:[] }
  const now = new Date(); const d = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
  const sumSales = await new Promise((resolve)=> db.get(`SELECT SUM(price_per_kg * weight) AS s FROM sales WHERE sale_date = ?`, [d], (e,row)=> resolve(Number(row?.s||0))))
  const sumPurch = await new Promise((resolve)=> db.get(`SELECT SUM(unit_price * COALESCE(net_weight, weight)) AS s FROM purchases WHERE purchase_date = ?`, [d], (e,row)=> resolve(Number(row?.s||0))))
  const sumExp = await new Promise((resolve)=> db.get(`SELECT SUM(amount) AS s FROM expenses WHERE expense_date = ?`, [d], (e,row)=> resolve(Number(row?.s||0))))
  const pendingSales = await new Promise((resolve)=> db.get(`SELECT COUNT(*) AS c FROM sales WHERE payment_status = 'pending'`, [], (e,row)=> resolve(Number(row?.c||0))))
  const pendingPurch = await new Promise((resolve)=> db.get(`SELECT COUNT(*) AS c FROM purchases WHERE payment_status = 'pending'`, [], (e,row)=> resolve(Number(row?.c||0))))
  const receiptsTodayS = await new Promise((resolve)=> db.get(`SELECT COUNT(*) AS c FROM sales WHERE sale_date = ? AND receipt_path IS NOT NULL`, [d], (e,row)=> resolve(Number(row?.c||0))))
  const receiptsTodayP = await new Promise((resolve)=> db.get(`SELECT COUNT(*) AS c FROM purchases WHERE purchase_date = ? AND receipt_path IS NOT NULL`, [d], (e,row)=> resolve(Number(row?.c||0))))
  const profit = sumSales - sumPurch - sumExp
  const reply = `Tổng kết hôm nay (${d}) — Thu: ${sumSales.toLocaleString()} • Chi nhập: ${sumPurch.toLocaleString()} • Chi phí: ${sumExp.toLocaleString()} • Lãi/Lỗ: ${profit.toLocaleString()} • Chưa thanh toán: bán ${pendingSales}, nhập ${pendingPurch} • Ảnh mới: ${receiptsTodayS+receiptsTodayP}`
  return { reply, actions:[{ type:'navigate', tab:'dashboard', label:'Mở Tổng quan' }], cards:[{ title:'Gợi ý', bullets:['Kiểm tra đơn chưa thanh toán','Xem ảnh hóa đơn mới','Cập nhật chi phí phát sinh'] }] }
}

async function parseMarkPaid(text){
  const s = String(text||'').toLowerCase()
  const saleM = s.match(/(đánh dấu|mark).*(đã thanh toán|paid).*(đơn bán|bán)\s*(#?(\d+))/)
  const purchM = s.match(/(đánh dấu|mark).*(đã thanh toán|paid).*(đơn nhập|nhập)\s*(#?(\d+))/)
  if (saleM) {
    const id = Number(saleM[4])
    return { reply:`Đánh dấu đã thanh toán đơn bán #${id}?`, actions:[{ type:'function_call', name:'mark_sale_paid', args:{ id }, label:'Xác nhận' }] }
  }
  if (purchM) {
    const id = Number(purchM[4])
    return { reply:`Đánh dấu đã thanh toán đơn nhập #${id}?`, actions:[{ type:'function_call', name:'mark_purchase_paid', args:{ id }, label:'Xác nhận' }] }
  }
  return null
}

async function botReminders(req, msg){
  try {
    const days = 7; const weightThreshold = 2000;
    const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0')
    const threshold = new Date(now.getTime() - days*24*3600*1000)
    const tStr = `${threshold.getFullYear()}-${String(threshold.getMonth()+1).padStart(2,'0')}-${String(threshold.getDate()).padStart(2,'0')}`
    const out = []
    if (MONGO_READY) {
      const ownerFilter = (String(req.user?.role)==='admin') ? {} : { $or: [{ owner: String(req.user?.username||'') }, { created_by: String(req.user?.username||'') }] }
      const [sOver, pOver, fixedCount, heavyCount] = await Promise.all([
        mongoDb.collection('sales').countDocuments({ payment_status:'pending', sale_date: { $lte: tStr }, ...ownerFilter }),
        mongoDb.collection('purchases').countDocuments({ payment_status:'pending', purchase_date: { $lte: tStr }, ...ownerFilter }),
        mongoDb.collection('expenses').countDocuments({ expense_date: { $regex: `^${y}-${m}` }, category: /định/i, ...(String(req.user?.role)==='admin'?{}:{ owner: String(req.user?.username||'') }) }),
        mongoDb.collection('purchases').countDocuments({ purchase_date: { $regex: `^${y}-${m}` }, weight: { $gt: weightThreshold }, ...ownerFilter })
      ])
      if (sOver) out.push(`Có ${sOver} đơn bán chưa thanh toán >${days} ngày`)
      if (pOver) out.push(`Có ${pOver} đơn nhập chưa thanh toán >${days} ngày`)
      if (!fixedCount) out.push('Định phí tháng này chưa được sinh tự động hoặc chưa có dữ liệu')
      if (heavyCount) out.push(`Có ${heavyCount} đơn nhập vượt hạn mức trọng lượng (> ${weightThreshold} kg) trong tháng`)
    } else if (SQLITE_READY) {
      await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS c FROM sales WHERE payment_status = 'pending' AND sale_date <= ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [tStr].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { if ((r?.c||0)) out.push(`Có ${r.c} đơn bán chưa thanh toán >${days} ngày`); resolve() })
      })
      await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS c FROM purchases WHERE payment_status = 'pending' AND purchase_date <= ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [tStr].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { if ((r?.c||0)) out.push(`Có ${r.c} đơn nhập chưa thanh toán >${days} ngày`); resolve() })
      })
      await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS c FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ? AND LOWER(COALESCE(category,'')) LIKE '%định%' ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [m, String(y)].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { if (!(r?.c||0)) out.push('Định phí tháng này chưa được sinh tự động hoặc chưa có dữ liệu'); resolve() })
      })
      await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) AS c FROM purchases WHERE strftime('%m', purchase_date) = ? AND strftime('%Y', purchase_date) = ? AND weight > ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [m, String(y), weightThreshold].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { if ((r?.c||0)) out.push(`Có ${r.c} đơn nhập vượt hạn mức trọng lượng (> ${weightThreshold} kg) trong tháng`); resolve() })
      })
    } else {
      return { reply: 'DB chưa sẵn sàng', actions: [] }
    }
    const reply = out.length ? out.join(' • ') : 'Không có nhắc việc nào đáng chú ý'
    const actions = [{ type:'navigate', tab:'balanceSheet', label:'Mở Bảng cân đối' }]
    return { reply, actions }
  } catch (e) {
    return { reply: 'Bot nhắc việc lỗi', actions: [] }
  }
}

// Sales endpoints
  app.get('/sales', requireAuth, (req, res) => {
    const { month, year, payment_status, q } = req.query;
    if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const and = [];
    if (month && year) and.push({ sale_date: { $regex: `^${y}-${m}` } });
    if (payment_status && payment_status !== 'all') and.push({ payment_status });
    if (q) and.push({ $or: [
      { customer_name: { $regex: q, $options: 'i' } },
      { tea_type: { $regex: q, $options: 'i' } },
      { ticket_name: { $regex: q, $options: 'i' } },
      { invoice_no: { $regex: q, $options: 'i' } }
    ]});
    if (!hasRole(req, 'admin')) {
      const uname = String(req.user?.username || '')
      and.push({ $or: [{ owner: uname }, { created_by: uname }] })
    }
    const filter = and.length ? { $and: and } : {};
    return mongoDb.collection('sales').find(filter).sort({ sale_date: 1, id: 1 }).toArray()
      .then(rows => res.json(rows.map(r => ({
        id: r.id,
        sale_date: r.sale_date,
        customer_name: r.customer_name || '',
        tea_type: r.tea_type || '',
        price_per_kg: Number(r.price_per_kg || 0),
        weight: Number(r.weight || 0),
        payment_status: r.payment_status || 'pending',
        ticket_name: r.ticket_name || null,
        invoice_no: r.invoice_no || null,
        contract: r.contract || null,
        created_by: r.created_by || null,
        owner: r.owner || r.created_by || null,
        issued_by: r.issued_by || null,
        export_type: r.export_type || null,
        country: r.country || null,
        receipt_path: r.receipt_path || null,
        total_amount: Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg || 0) * Number(r.weight || 0)))
      })))).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
    }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.all(`PRAGMA table_info(sales)`, [], (eCols, cols) => {
    const has = (name) => !eCols && (cols||[]).some(r => r.name === name)
    const where = []
    const params = []
    if (month && year) { where.push("strftime('%m', sale_date) = ?"); params.push(pad2(month)); where.push("strftime('%Y', sale_date) = ?"); params.push(String(year)) }
    if (payment_status && payment_status !== 'all') { where.push('payment_status = ?'); params.push(payment_status) }
    if (q) { where.push('(customer_name LIKE ? OR tea_type LIKE ?'+(has('ticket_name')?' OR ticket_name LIKE ?':'')+(has('invoice_no')?' OR invoice_no LIKE ?':'')+')'); const like = `%${q}%`; params.push(like, like); if (has('ticket_name')) params.push(like); if (has('invoice_no')) params.push(like) }
    if (!hasRole(req, 'admin') && has('owner')) { const u = String(req.user?.username || ''); where.push('owner = ?'); params.push(u) }
    const sel = [
      'id',
      'sale_date',
      has('customer_name') ? 'customer_name' : `NULL AS customer_name`,
      has('tea_type') ? 'tea_type' : `NULL AS tea_type`,
      has('price_per_kg') ? 'price_per_kg' : `0 AS price_per_kg`,
      has('weight') ? 'weight' : `0 AS weight`,
      has('payment_status') ? 'payment_status' : `NULL AS payment_status`,
      has('ticket_name') ? 'ticket_name' : `NULL AS ticket_name`,
      has('invoice_no') ? 'invoice_no' : `NULL AS invoice_no`,
      has('contract') ? 'contract' : `NULL AS contract`,
      has('created_by') ? 'created_by' : `NULL AS created_by`,
      has('owner') ? 'owner' : `NULL AS owner`,
      has('issued_by') ? 'issued_by' : `NULL AS issued_by`,
      has('export_type') ? 'export_type' : `NULL AS export_type`,
      has('country') ? 'country' : `NULL AS country`,
      has('receipt_path') ? 'receipt_path' : `NULL AS receipt_path`,
      (has('price_per_kg') && has('weight')) ? '(price_per_kg * weight) AS total_amount' : '0 AS total_amount'
    ].join(', ')
    const sql = `SELECT ${sel} FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sale_date ASC, id ASC`
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      res.json(rows)
    })
  })
});

app.post('/sales', rateLimit(60_000, 30, 'sales_post'), requireAuth, (req, res) => {
  if (!(hasRole(req, 'admin') || hasRole(req, 'seller'))) return res.status(403).json({ message: 'Forbidden: seller or admin required' });
  const { sale_date, customer_name, tea_type, price_per_kg, weight, payment_status = 'pending', ticket_name = null, invoice_no = null, contract = null, issued_by = null, export_type = null, country = null } = req.body;
  const p = Number(price_per_kg);
  const w = Number(weight);
  if (!sale_date || p <= 0 || w <= 0) return res.status(400).json({ message: 'Missing/invalid sale_date/price_per_kg/weight', detail: 'price_per_kg and weight must be > 0' });
  const total = Number(price_per_kg) * Number(weight);
  const ownerUser = String(req.user?.username || '');
  if (MONGO_READY) {
    nextId('sales').then(id => {
      const doc = { id, sale_date, customer_name: customer_name || '', tea_type: tea_type || '', price_per_kg: p, weight: w, payment_status, ticket_name: ticket_name || null, invoice_no: invoice_no || null, contract: contract || null, created_by: ownerUser || null, owner: ownerUser || null, issued_by: issued_by || null, export_type: export_type || null, country: country || null, total_amount: p * w };
      mongoDb.collection('sales').insertOne(doc).then(() => { auditLog('sales', id, 'create', req, { sale_date, customer_name, tea_type, price_per_kg: p, weight: w, payment_status, ticket_name, contract, created_by: ownerUser, issued_by, export_type, country }); res.json({ id }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
    });
    return;
  }
  const runInsert = (includeTotal) => {
    const sql = includeTotal
      ? `INSERT INTO sales (sale_date, customer_name, tea_type, price_per_kg, weight, payment_status, total_amount) VALUES (?,?,?,?,?,?, (CAST(? AS REAL) * CAST(? AS REAL)))`
      : `INSERT INTO sales (sale_date, customer_name, tea_type, price_per_kg, weight, payment_status) VALUES (?,?,?,?,?,?)`;
    const params = includeTotal
      ? [sale_date, customer_name || '', tea_type || '', Number(price_per_kg), Number(weight), payment_status, Number(price_per_kg), Number(weight)]
      : [sale_date, customer_name || '', tea_type || '', Number(price_per_kg), Number(weight), payment_status];
    console.log('Insert sales includeTotal=', includeTotal, 'params=', params);
      db.run(sql, params, function (err) {
        if (err) {
        const msg = String(err.message || '');
        if (includeTotal && /no such column|has no column named total_amount/i.test(msg)) {
          return runInsert(false);
        }
        if (!includeTotal && /NOT NULL constraint failed: sales\.total_amount/i.test(msg)) {
          return runInsert(true);
        }
        return res.status(500).json({ message: 'DB error', detail: err.message });
      }
      const id = this.lastID;
      db.run(`UPDATE sales SET ticket_name = ?, invoice_no = ?, contract = ?, created_by = ?, owner = ?, issued_by = ?, export_type = ?, country = ? WHERE id = ?`, [ticket_name || null, invoice_no || null, contract || null, ownerUser || null, ownerUser || null, issued_by || null, export_type || null, country || null, id], () => {});
      if (MONGO_READY) {
        const doc = { id, sale_date, customer_name: customer_name || '', tea_type: tea_type || '', price_per_kg: Number(price_per_kg), weight: Number(weight), payment_status, ticket_name: ticket_name || null, contract: contract || null, created_by: created_by || null, issued_by: issued_by || null, export_type: export_type || null, country: country || null, total_amount: Number(price_per_kg) * Number(weight) };
        mongoDb.collection('sales').insertOne(doc).catch(() => {});
      }
      auditLog('sales', id, 'create', req, { sale_date, customer_name, tea_type, price_per_kg: Number(price_per_kg), weight: Number(weight), payment_status, ticket_name, contract, created_by: ownerUser, issued_by, export_type, country });
      res.json({ id });
    });
  };
  runInsert(SALES_HAS_TOTAL_AMOUNT || true);
});


app.put('/sales/:id', rateLimit(60_000, 60, 'sales_put'), requireAuth, (req, res) => {
  const id = req.params.id;
  const { sale_date, customer_name, tea_type, price_per_kg, weight, payment_status, ticket_name, invoice_no, contract, created_by, issued_by, export_type, country, receipt_data, receipt_name } = req.body;
  const isAdmin = hasRole(req, 'admin')
  const isFinance = hasRole(req, 'finance')
  const isSeller = hasRole(req, 'seller')
  if (!isAdmin) {
    if (isFinance) {
      const keys = Object.keys(req.body||{})
      const allowed = new Set(['payment_status','receipt_data','receipt_name'])
      if (keys.some(k => !allowed.has(k))) return res.status(403).json({ message: 'Finance can only update payment_status and receipt image' })
    } else if (!isSeller) {
      return res.status(403).json({ message: 'Forbidden: seller/finance/admin required' })
    }
  }
  if (price_per_kg != null && Number(price_per_kg) <= 0) return res.status(400).json({ message: 'price_per_kg must be > 0' });
  if (weight != null && Number(weight) <= 0) return res.status(400).json({ message: 'weight must be > 0' });
  if (MONGO_READY) {
    const col = mongoDb.collection('sales');
    if (!isAdmin && isSeller) {
      return col.findOne({ id: Number(id) }).then(prev => {
        if (String(prev?.payment_status||'') === 'paid') return res.status(403).json({ message: 'Seller cannot edit paid sales' })
        proceedMongo()
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
    }
    function proceedMongo() {
    const upd = {};
    if (sale_date != null) upd.sale_date = sale_date;
    if (customer_name != null) upd.customer_name = customer_name;
    if (tea_type != null) upd.tea_type = tea_type;
    if (price_per_kg != null) upd.price_per_kg = Number(price_per_kg);
    if (weight != null) upd.weight = Number(weight);
    if (payment_status != null) upd.payment_status = payment_status;
    if (ticket_name != null) upd.ticket_name = ticket_name;
    if (contract != null) upd.contract = contract;
    if (created_by != null) upd.created_by = created_by;
    if (issued_by != null) upd.issued_by = issued_by;
    if (export_type != null) upd.export_type = export_type;
    if (country != null) upd.country = country;
    const needTotal = price_per_kg != null || weight != null;
    if (payment_status === 'paid' && !receipt_data) return res.status(400).json({ message: 'Receipt image required', detail: 'Ảnh giao dịch bắt buộc (<5MB) khi đánh dấu đã thanh toán' });
    if (receipt_data) {
      const m = String(receipt_data).match(/^data:\w+\/\w+;base64,(.+)$/);
      let buf; try { buf = Buffer.from(m ? m[1] : String(receipt_data), 'base64') } catch { return res.status(400).json({ message: 'Invalid image data' }) }
      if (buf.length > 5*1024*1024) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
      const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
      const fname = `sale_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const encName = `${fname}.enc`;
      const encPath = `${ENC_DIR}/${encName}`;
      try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
      upd.receipt_path = `/${encPath}`;
    }
    if (payment_status === 'paid') { upd.paid_by = String(req.user?.username || '') }
    const doUpdate = () => col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => { const changes = { ...upd }; delete changes.receipt_data; auditLog('sales', id, 'update', req, changes); res.json({ changed: 1 }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    if (payment_status === 'pending') {
      return col.findOne({ id: Number(id) }).then(prev => {
        const rel = prev?.receipt_path; if (rel) { try { const safe = String(rel).replace(/^\//,''); const abs = path.join(__dirname, safe); if (fs.existsSync(abs)) fs.unlinkSync(abs) } catch {} }
        upd.receipt_path = null; upd.paid_by = null;
        if (needTotal) {
          const p = price_per_kg != null ? Number(price_per_kg) : Number(prev?.price_per_kg || 0);
          const w = weight != null ? Number(weight) : Number(prev?.weight || 0);
          upd.total_amount = p * w; return doUpdate();
        }
        return doUpdate();
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (needTotal) {
      col.findOne({ id: Number(id) }).then(prev => {
        const p = price_per_kg != null ? Number(price_per_kg) : Number(prev?.price_per_kg || 0);
        const w = weight != null ? Number(weight) : Number(prev?.weight || 0);
        upd.total_amount = p * w; doUpdate();
      }).catch(doUpdate);
    } else doUpdate();
    }
    return;
  }
  function doSqliteUpdate() {
  const fields = [];
  const params = [];
  if (sale_date != null) { fields.push('sale_date = ?'); params.push(sale_date); }
  if (customer_name != null) { fields.push('customer_name = ?'); params.push(customer_name); }
  if (tea_type != null) { fields.push('tea_type = ?'); params.push(tea_type); }
  if (price_per_kg != null) { fields.push('price_per_kg = ?'); params.push(Number(price_per_kg)); }
  if (weight != null) { fields.push('weight = ?'); params.push(Number(weight)); }
  if (payment_status != null) { fields.push('payment_status = ?'); params.push(payment_status); }
  if (ticket_name != null) { fields.push('ticket_name = ?'); params.push(ticket_name); }
  if (invoice_no != null) { fields.push('invoice_no = ?'); params.push(invoice_no); }
  if (contract != null) { fields.push('contract = ?'); params.push(contract); }
  if (created_by != null) { fields.push('created_by = ?'); params.push(created_by); }
  if (issued_by != null) { fields.push('issued_by = ?'); params.push(issued_by); }
  if (payment_status === 'paid' && !receipt_data) return res.status(400).json({ message: 'Receipt image required', detail: 'Ảnh giao dịch bắt buộc (<5MB) khi đánh dấu đã thanh toán' });
  if (receipt_data) {
    const m = String(receipt_data).match(/^data:\w+\/\w+;base64,(.+)$/);
    let buf; try { buf = Buffer.from(m ? m[1] : String(receipt_data), 'base64') } catch { return res.status(400).json({ message: 'Invalid image data' }) }
    if (buf.length > 5*1024*1024) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
    const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
    const fname = `sale_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const encName = `${fname}.enc`;
    const encPath = `${ENC_DIR}/${encName}`;
    try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
    fields.push('receipt_path = ?'); params.push(`/${encPath}`);
  }
  if (payment_status === 'paid') { fields.push('paid_by = ?'); params.push(String(req.user?.username || '')) }
  if (export_type != null) { fields.push('export_type = ?'); params.push(export_type); }
  if (country != null) { fields.push('country = ?'); params.push(country); }
  if (SALES_HAS_TOTAL_AMOUNT && (price_per_kg != null || weight != null)) {
    // Recompute total_amount based on current price_per_kg and weight values
    fields.push('total_amount = (price_per_kg * weight)');
  }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE sales SET ${fields.join(', ')} WHERE id = ?`;
  const run = () => db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) {
      const col = mongoDb.collection('sales');
      const upd = {};
      if (sale_date != null) upd.sale_date = sale_date;
      if (customer_name != null) upd.customer_name = customer_name;
      if (tea_type != null) upd.tea_type = tea_type;
      if (price_per_kg != null) upd.price_per_kg = Number(price_per_kg);
      if (weight != null) upd.weight = Number(weight);
      if (payment_status != null) upd.payment_status = payment_status;
      if (ticket_name != null) upd.ticket_name = ticket_name;
      if (contract != null) upd.contract = contract;
      if (created_by != null) upd.created_by = created_by;
      if (issued_by != null) upd.issued_by = issued_by;
      const needTotal = price_per_kg != null || weight != null;
      if (needTotal) {
        col.findOne({ id: Number(id) }).then(prev => {
          const p = price_per_kg != null ? Number(price_per_kg) : Number(prev?.price_per_kg || 0);
          const w = weight != null ? Number(weight) : Number(prev?.weight || 0);
          upd.total_amount = p * w;
          col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
        }).catch(() => {
          col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
        });
      } else {
        col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
      }
    }
    const changes = {};
    if (sale_date != null) changes.sale_date = sale_date;
    if (customer_name != null) changes.customer_name = customer_name;
    if (tea_type != null) changes.tea_type = tea_type;
    if (price_per_kg != null) changes.price_per_kg = Number(price_per_kg);
    if (weight != null) changes.weight = Number(weight);
    if (payment_status != null) changes.payment_status = payment_status;
    if (ticket_name != null) changes.ticket_name = ticket_name;
    if (contract != null) changes.contract = contract;
    if (created_by != null) changes.created_by = created_by;
    if (issued_by != null) changes.issued_by = issued_by;
    if (export_type != null) changes.export_type = export_type;
    if (country != null) changes.country = country;
    auditLog('sales', id, 'update', req, changes);
    res.json({ changed: this.changes });
  });
  if (payment_status === 'pending') {
    return db.get('SELECT receipt_path FROM sales WHERE id = ?', [Number(id)], (err, row) => {
      if (!err) { const rel = row?.receipt_path; if (rel) { try { const safe = String(rel).replace(/^\//,''); const abs = path.join(__dirname, safe); if (fs.existsSync(abs)) fs.unlinkSync(abs) } catch {} } }
      fields.push('receipt_path = NULL');
      fields.push('paid_by = NULL');
      params.push(id);
      return run();
    })
  }
  params.push(id);
  return run();
  }
  if (!isAdmin && isSeller) {
    return db.get('SELECT payment_status FROM sales WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      if (String(row?.payment_status||'') === 'paid') return res.status(403).json({ message: 'Seller cannot edit paid sales' })
      doSqliteUpdate()
    })
  }
  doSqliteUpdate()
});

app.delete('/sales/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (MONGO_READY) {
    mongoDb.collection('sales').deleteOne({ id: Number(id) }).then(r => res.json({ deleted: r.deletedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  db.run('DELETE FROM sales WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) mongoDb.collection('sales').deleteOne({ id: Number(id) }).catch(() => {});
    auditLog('sales', id, 'delete', req, {});
    res.json({ deleted: this.changes });
  });
});

app.get('/sales/:id/receipt', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const sendFile = (rel) => {
    if (!rel) return res.status(404).json({ message: 'Receipt not found' });
    const safe = String(rel).replace(/^\//, '');
    const abs = path.join(__dirname, safe);
    if (!fs.existsSync(abs)) return res.status(404).json({ message: 'Receipt not found' });
    if (safe.startsWith(`${ENC_DIR}/`)) {
      try {
        const data = fs.readFileSync(abs);
        const dec = decryptBuffer(data);
        if (!dec) return res.status(500).json({ message: 'Decrypt failed' });
        res.setHeader('Content-Type', contentTypeFromName(safe));
        res.setHeader('Content-Disposition', contentDispositionInline(safe));
        return res.send(dec);
      } catch (e) { return res.status(500).json({ message: 'File read error', detail: e.message }) }
    }
    res.setHeader('Content-Disposition', contentDispositionInline(safe));
    return res.sendFile(abs);
  };
  if (MONGO_READY) {
    return mongoDb.collection('sales').findOne({ id }).then(r => sendFile(r?.receipt_path)).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get('SELECT receipt_path FROM sales WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    sendFile(row?.receipt_path);
  });
});

// Purchases endpoints
  app.get('/purchases', requireAuth, (req, res) => {
  const { month, year, payment_status, q } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const and = [];
    if (month && year) and.push({ purchase_date: { $regex: `^${y}-${m}` } });
    if (payment_status && payment_status !== 'all') and.push({ payment_status });
    if (q) and.push({ $or: [
      { supplier_name: { $regex: q, $options: 'i' } },
      { ticket_name: { $regex: q, $options: 'i' } },
      { invoice_no: { $regex: q, $options: 'i' } },
      { vehicle_plate: { $regex: q, $options: 'i' } }
    ]});
    if (String(req.user?.role) !== 'admin') {
      const uname = String(req.user?.username || '')
      and.push({ $or: [{ owner: uname }, { created_by: uname }] })
    }
    const filter = and.length ? { $and: and } : {};
    return mongoDb.collection('purchases').find(filter).sort({ purchase_date: 1, id: 1 }).toArray()
      .then(rows => res.json(rows.map(r => ({
        id: r.id,
        purchase_date: r.purchase_date,
        supplier_name: r.supplier_name || '',
        weight: Number(r.weight || 0),
        unit_price: Number(r.unit_price || 0),
        payment_status: r.payment_status || 'pending',
        water_percent: r.water_percent == null ? null : Number(r.water_percent),
        net_weight: r.net_weight == null ? null : Number(r.net_weight),
        ticket_name: r.ticket_name || null,
        invoice_no: r.invoice_no || null,
        weigh_ticket_code: r.weigh_ticket_code || null,
        vehicle_plate: r.vehicle_plate || null,
        owner: r.owner || r.created_by || null,
        receipt_path: r.receipt_path || null,
        total_cost: Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price || 0) * Number(r.net_weight != null ? r.net_weight : (r.weight || 0))))
      })))).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.all(`PRAGMA table_info(purchases)`, [], (eCols, cols) => {
    const has = (name) => !eCols && (cols||[]).some(r => r.name === name)
    const where = []
    const params = []
    if (month && year) { where.push("strftime('%m', purchase_date) = ?"); params.push(pad2(month)); where.push("strftime('%Y', purchase_date) = ?"); params.push(String(year)) }
    if (payment_status && payment_status !== 'all') { where.push('payment_status = ?'); params.push(payment_status) }
    if (q) {
      const like = `%${q}%`
      const parts = ['supplier_name LIKE ?']
      params.push(like)
      if (has('ticket_name')) { parts.push('ticket_name LIKE ?'); params.push(like) }
      if (has('invoice_no')) { parts.push('invoice_no LIKE ?'); params.push(like) }
      if (has('weigh_ticket_code')) { parts.push('weigh_ticket_code LIKE ?'); params.push(like) }
      if (has('vehicle_plate')) { parts.push('vehicle_plate LIKE ?'); params.push(like) }
      where.push('('+parts.join(' OR ')+')')
    }
    if (!hasRole(req, 'admin') && has('owner')) { where.push('owner = ?'); params.push(String(req.user?.username || '')) }
    const totalExpr = (has('unit_price') && (has('net_weight') || has('weight')))
      ? ' (unit_price * COALESCE(net_weight, weight)) '
      : ' 0 '
    const sel = [
      'id',
      'purchase_date',
      has('supplier_name') ? 'supplier_name' : `NULL AS supplier_name`,
      has('weight') ? 'weight' : `0 AS weight`,
      has('unit_price') ? 'unit_price' : `0 AS unit_price`,
      has('payment_status') ? 'payment_status' : `NULL AS payment_status`,
      has('water_percent') ? 'water_percent' : `NULL AS water_percent`,
      has('net_weight') ? 'net_weight' : (has('weight') ? 'weight AS net_weight' : '0 AS net_weight'),
      has('ticket_name') ? 'ticket_name' : `NULL AS ticket_name`,
      has('invoice_no') ? 'invoice_no' : `NULL AS invoice_no`,
      has('weigh_ticket_code') ? 'weigh_ticket_code' : `NULL AS weigh_ticket_code`,
      has('vehicle_plate') ? 'vehicle_plate' : `NULL AS vehicle_plate`,
      has('owner') ? 'owner' : `NULL AS owner`,
      has('receipt_path') ? 'receipt_path' : `NULL AS receipt_path`,
      (PURCHASES_HAS_TOTAL_COST && has('total_cost')) ? 'COALESCE(total_cost, '+totalExpr+') AS total_cost' : (totalExpr+' AS total_cost')
    ].join(', ')
    const sql = `SELECT ${sel} FROM purchases ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY purchase_date ASC, id ASC`
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      res.json(rows)
    })
  })
});

app.post('/purchases', rateLimit(60_000, 30, 'purchases_post'), requireAuth, (req, res) => {
  const { purchase_date, supplier_name, weight, unit_price, payment_status = 'pending', water_percent = null, net_weight = null, ticket_name = null, invoice_no = null, weigh_ticket_code = null, vehicle_plate = null } = req.body;
  const u = Number(unit_price);
  const w = Number(weight);
  if (!purchase_date || u <= 0 || w <= 0) return res.status(400).json({ message: 'Missing/invalid purchase_date/unit_price/weight', detail: 'unit_price and weight must be > 0' });
  const numericWeight = Number(weight);
  const numericUnit = Number(unit_price);
  const numericWater = water_percent == null ? null : Number(water_percent);
  if (numericWater != null && (numericWater < 0 || numericWater > 100)) return res.status(400).json({ message: 'Invalid water_percent', detail: 'water_percent must be between 0 and 100' });
  const calcNet = net_weight == null
    ? (numericWater == null ? numericWeight : (numericWeight * (numericWater >= 100 ? 0 : (1 - numericWater / 100))))
    : Number(net_weight);
  const ownerUser = String(req.user?.username || '');
  if (MONGO_READY) {
    nextId('purchases').then(id => {
      const doc = { id, purchase_date, supplier_name: supplier_name || '', weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name: ticket_name || null, invoice_no: invoice_no || null, weigh_ticket_code: weigh_ticket_code || null, vehicle_plate: vehicle_plate || null, owner: ownerUser || null, total_cost: numericUnit * calcNet };
      mongoDb.collection('purchases').insertOne(doc).then(() => { auditLog('purchases', id, 'create', req, { purchase_date, supplier_name, weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name, weigh_ticket_code, vehicle_plate }); res.json({ id }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
    });
    return;
  }
  const runInsert = (includeTotal) => {
    const sql = includeTotal
      ? `INSERT INTO purchases (purchase_date, supplier_name, weight, unit_price, payment_status, total_cost) VALUES (?,?,?,?,?, (CAST(? AS REAL) * CAST(? AS REAL)))`
      : `INSERT INTO purchases (purchase_date, supplier_name, weight, unit_price, payment_status) VALUES (?,?,?,?,?)`;
    const params = includeTotal
      ? [purchase_date, supplier_name || '', numericWeight, numericUnit, payment_status, numericUnit, calcNet]
      : [purchase_date, supplier_name || '', numericWeight, numericUnit, payment_status];
    db.run(sql, params, function (err) {
      if (err) {
        const msg = String(err.message || '');
        if (includeTotal && /no such column|has no column named total_cost/i.test(msg)) {
          return runInsert(false);
        }
        if (!includeTotal && /NOT NULL constraint failed: purchases\.total_cost/i.test(msg)) {
          return runInsert(true);
        }
        return res.status(500).json({ message: 'DB error', detail: err.message });
      }
      const id = this.lastID;
  db.run(`UPDATE purchases SET net_weight = ?, water_percent = ?, ticket_name = ?, invoice_no = ?, weigh_ticket_code = ?, vehicle_plate = ?, owner = ? WHERE id = ?`, [calcNet, numericWater, ticket_name || null, invoice_no || null, weigh_ticket_code || null, vehicle_plate || null, ownerUser || null, id], () => {});
  if (MONGO_READY) {
    const doc = { id, purchase_date, supplier_name: supplier_name || '', weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name: ticket_name || null, weigh_ticket_code: weigh_ticket_code || null, vehicle_plate: vehicle_plate || null, total_cost: numericUnit * calcNet };
    mongoDb.collection('purchases').insertOne(doc).catch(() => {});
  }
  auditLog('purchases', id, 'create', req, { purchase_date, supplier_name, weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name, weigh_ticket_code, vehicle_plate });
  res.json({ id });
    });
  };
  runInsert(PURCHASES_HAS_TOTAL_COST || true);
});

app.put('/purchases/:id', rateLimit(60_000, 60, 'purchases_put'), requireAuth, (req, res) => {
  const id = req.params.id;
  const { purchase_date, supplier_name, weight, unit_price, payment_status, water_percent, net_weight, ticket_name, invoice_no, weigh_ticket_code, vehicle_plate, receipt_data, receipt_name } = req.body;
  const isAdmin = hasRole(req, 'admin')
  const isFinance = hasRole(req, 'finance')
  const isWarehouse = hasRole(req, 'warehouse')
  if (!isAdmin) {
    if (isFinance) {
      const keys = Object.keys(req.body||{})
      const allowed = new Set(['payment_status','receipt_data','receipt_name'])
      if (keys.some(k => !allowed.has(k))) return res.status(403).json({ message: 'Finance can only update payment_status and receipt image' })
    } else if (!isWarehouse) {
      return res.status(403).json({ message: 'Forbidden: warehouse/finance/admin required' })
    }
  }
  if (water_percent != null && (Number(water_percent) < 0 || Number(water_percent) > 100)) return res.status(400).json({ message: 'Invalid water_percent', detail: 'water_percent must be between 0 and 100' });
  if (unit_price != null && Number(unit_price) <= 0) return res.status(400).json({ message: 'unit_price must be > 0' });
  if (weight != null && Number(weight) <= 0) return res.status(400).json({ message: 'weight must be > 0' });
  if (MONGO_READY) {
    const col = mongoDb.collection('purchases');
    if (!isAdmin && isWarehouse) {
      return col.findOne({ id: Number(id) }).then(prev => {
        const diff = Date.now() - new Date(prev?.purchase_date||Date.now()).getTime()
        if (diff > 24*3600*1000) return res.status(403).json({ message: 'Warehouse cannot edit purchases after 24h' })
        proceedMongo()
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
    }
    function proceedMongo() {
    const upd = {};
    if (purchase_date != null) upd.purchase_date = purchase_date;
    if (supplier_name != null) upd.supplier_name = supplier_name;
    if (weight != null) upd.weight = Number(weight);
    if (unit_price != null) upd.unit_price = Number(unit_price);
    if (payment_status != null) upd.payment_status = payment_status;
    if (water_percent != null) upd.water_percent = Number(water_percent);
    if (net_weight != null) upd.net_weight = Number(net_weight);
    if (ticket_name != null) upd.ticket_name = ticket_name;
    if (invoice_no != null) upd.invoice_no = invoice_no;
    if (weigh_ticket_code != null) upd.weigh_ticket_code = weigh_ticket_code;
    if (vehicle_plate != null) upd.vehicle_plate = vehicle_plate;
    const needTotal = unit_price != null || weight != null || net_weight != null || water_percent != null;
    if (payment_status === 'paid' && !receipt_data) return res.status(400).json({ message: 'Receipt image required', detail: 'Ảnh giao dịch bắt buộc (<5MB) khi đánh dấu đã trả' });
    if (receipt_data) {
      const m = String(receipt_data).match(/^data:\w+\/\w+;base64,(.+)$/);
      let buf; try { buf = Buffer.from(m ? m[1] : String(receipt_data), 'base64') } catch { return res.status(400).json({ message: 'Invalid image data' }) }
      if (buf.length > 5*1024*1024) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
      const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
      const fname = `purchase_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const encName = `${fname}.enc`;
      const encPath = `${ENC_DIR}/${encName}`;
      try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
      upd.receipt_path = `/${encPath}`;
    }
    if (payment_status === 'paid') { upd.paid_by = String(req.user?.username || '') }
    const doUpdate = () => col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => { const changes = { ...upd }; delete changes.receipt_data; auditLog('purchases', id, 'update', req, changes); res.json({ changed: 1 }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    if (payment_status === 'pending') {
      return col.findOne({ id: Number(id) }).then(prev => {
        const rel = prev?.receipt_path; if (rel) { try { const safe = String(rel).replace(/^\//,''); const abs = path.join(__dirname, safe); if (fs.existsSync(abs)) fs.unlinkSync(abs) } catch {} }
        upd.receipt_path = null; upd.paid_by = null;
        if (needTotal) {
          const up = unit_price != null ? Number(unit_price) : Number(prev?.unit_price || 0);
          let nw;
          if (net_weight != null) nw = Number(net_weight);
          else {
            const wv = weight != null ? Number(weight) : Number(prev?.weight || 0);
            const wp = water_percent != null ? Number(water_percent) : Number(prev?.water_percent || 0);
            nw = wv * (wp >= 100 ? 0 : (1 - (wp || 0) / 100));
          }
          upd.total_cost = up * nw; return doUpdate();
        }
        return doUpdate();
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (needTotal) {
      col.findOne({ id: Number(id) }).then(prev => {
        const up = unit_price != null ? Number(unit_price) : Number(prev?.unit_price || 0);
        let nw;
        if (net_weight != null) nw = Number(net_weight);
        else {
          const wv = weight != null ? Number(weight) : Number(prev?.weight || 0);
          const wp = water_percent != null ? Number(water_percent) : Number(prev?.water_percent || 0);
          nw = wv * (wp >= 100 ? 0 : (1 - (wp || 0) / 100));
        }
        upd.total_cost = up * nw; doUpdate();
      }).catch(doUpdate);
    } else doUpdate();
    }
    return;
  }
  function doSqliteUpdate() {
  const fields = [];
  const params = [];
  if (purchase_date != null) { fields.push('purchase_date = ?'); params.push(purchase_date); }
  if (supplier_name != null) { fields.push('supplier_name = ?'); params.push(supplier_name); }
  if (weight != null) { fields.push('weight = ?'); params.push(Number(weight)); }
  if (unit_price != null) { fields.push('unit_price = ?'); params.push(Number(unit_price)); }
  if (payment_status != null) { fields.push('payment_status = ?'); params.push(payment_status); }
  if (water_percent != null) { fields.push('water_percent = ?'); params.push(Number(water_percent)); }
  if (net_weight != null) { fields.push('net_weight = ?'); params.push(Number(net_weight)); }
  if (ticket_name != null) { fields.push('ticket_name = ?'); params.push(ticket_name); }
  if (invoice_no != null) { fields.push('invoice_no = ?'); params.push(invoice_no); }
  if (weigh_ticket_code != null) { fields.push('weigh_ticket_code = ?'); params.push(weigh_ticket_code); }
  if (vehicle_plate != null) { fields.push('vehicle_plate = ?'); params.push(vehicle_plate); }
  if (payment_status === 'paid' && !receipt_data) return res.status(400).json({ message: 'Receipt image required', detail: 'Ảnh giao dịch bắt buộc (<5MB) khi đánh dấu đã trả' });
  if (receipt_data) {
    const m = String(receipt_data).match(/^data:\w+\/\w+;base64,(.+)$/);
    let buf; try { buf = Buffer.from(m ? m[1] : String(receipt_data), 'base64') } catch { return res.status(400).json({ message: 'Invalid image data' }) }
    if (buf.length > 5*1024*1024) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
    const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
    const fname = `purchase_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const encName = `${fname}.enc`;
    const encPath = `${ENC_DIR}/${encName}`;
    try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
    fields.push('receipt_path = ?'); params.push(`/${encPath}`);
  }
  if (payment_status === 'paid') { fields.push('paid_by = ?'); params.push(String(req.user?.username || '')) }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE purchases SET ${fields.join(', ')} WHERE id = ?`;
  const run = () => db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) {
      const col = mongoDb.collection('purchases');
      const upd = {};
      if (purchase_date != null) upd.purchase_date = purchase_date;
      if (supplier_name != null) upd.supplier_name = supplier_name;
      if (weight != null) upd.weight = Number(weight);
      if (unit_price != null) upd.unit_price = Number(unit_price);
      if (payment_status != null) upd.payment_status = payment_status;
      if (water_percent != null) upd.water_percent = Number(water_percent);
      if (net_weight != null) upd.net_weight = Number(net_weight);
      if (ticket_name != null) upd.ticket_name = ticket_name;
      if (invoice_no != null) upd.invoice_no = invoice_no;
      if (weigh_ticket_code != null) upd.weigh_ticket_code = weigh_ticket_code;
      if (vehicle_plate != null) upd.vehicle_plate = vehicle_plate;
      const needTotal = unit_price != null || weight != null || net_weight != null || water_percent != null;
      if (needTotal) {
        col.findOne({ id: Number(id) }).then(prev => {
          const up = unit_price != null ? Number(unit_price) : Number(prev?.unit_price || 0);
          let nw;
          if (net_weight != null) nw = Number(net_weight);
          else {
            const w = weight != null ? Number(weight) : Number(prev?.weight || 0);
            const wp = water_percent != null ? Number(water_percent) : Number(prev?.water_percent || 0);
            nw = w * (wp >= 100 ? 0 : (1 - (wp || 0) / 100));
          }
          upd.total_cost = up * nw;
          col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
        }).catch(() => {
          col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
        });
      } else {
        col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
      }
    }
    const changes = {};
    if (purchase_date != null) changes.purchase_date = purchase_date;
    if (supplier_name != null) changes.supplier_name = supplier_name;
    if (weight != null) changes.weight = Number(weight);
    if (unit_price != null) changes.unit_price = Number(unit_price);
    if (payment_status != null) changes.payment_status = payment_status;
    if (water_percent != null) changes.water_percent = Number(water_percent);
    if (net_weight != null) changes.net_weight = Number(net_weight);
    if (ticket_name != null) changes.ticket_name = ticket_name;
    if (invoice_no != null) changes.invoice_no = invoice_no;
    if (weigh_ticket_code != null) changes.weigh_ticket_code = weigh_ticket_code;
    if (vehicle_plate != null) changes.vehicle_plate = vehicle_plate;
    auditLog('purchases', id, 'update', req, changes);
    res.json({ changed: this.changes });
  });
  if (payment_status === 'pending') {
    return db.get('SELECT receipt_path FROM purchases WHERE id = ?', [Number(id)], (err, row) => {
      if (!err) { const rel = row?.receipt_path; if (rel) { try { const safe = String(rel).replace(/^\//,''); const abs = path.join(__dirname, safe); if (fs.existsSync(abs)) fs.unlinkSync(abs) } catch {} } }
      fields.push('receipt_path = NULL');
      fields.push('paid_by = NULL');
      params.push(id);
      return run();
    })
  }
  params.push(id);
  return run();
  }
  if (!isAdmin && isWarehouse) {
    return db.get('SELECT purchase_date FROM purchases WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      const diff = Date.now() - new Date(row?.purchase_date||Date.now()).getTime()
      if (diff > 24*3600*1000) return res.status(403).json({ message: 'Warehouse cannot edit purchases after 24h' })
      doSqliteUpdate()
    })
  }
  doSqliteUpdate()
});

app.delete('/purchases/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (MONGO_READY) {
    mongoDb.collection('purchases').deleteOne({ id: Number(id) }).then(r => res.json({ deleted: r.deletedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  db.run('DELETE FROM purchases WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) mongoDb.collection('purchases').deleteOne({ id: Number(id) }).catch(() => {});
    auditLog('purchases', id, 'delete', req, {});
    res.json({ deleted: this.changes });
  });
});

// Finished stock endpoints
app.get('/finished-stock', requireAuth, (req, res) => {
  const { month, year } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const and = [];
    if (month && year) and.push({ entry_date: { $regex: `^${y}-${m}` } });
    const filter = and.length ? { $and: and } : {};
    return mongoDb.collection('finished_stock').find(filter).sort({ entry_date: 1, id: 1 }).toArray()
      .then(rows => res.json(rows.map(r => ({ id: r.id, entry_date: r.entry_date, tea_type: r.tea_type || '', weight: Number(r.weight || 0), unit_cost: Number(r.unit_cost || 0), note: r.note || null }))))
      .catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const where = [];
  const params = [];
  if (month && year) { where.push("strftime('%m', entry_date) = ?"); params.push(pad2(month)); where.push("strftime('%Y', entry_date) = ?"); params.push(String(year)); }
  const sql = `SELECT id, entry_date, tea_type, weight, unit_cost, note FROM finished_stock ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY entry_date ASC, id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  });
});

app.post('/finished-stock', requireAuth, (req, res) => {
  if (!(hasRole(req, 'admin') || hasRole(req, 'warehouse'))) return res.status(403).json({ message: 'Forbidden: warehouse/admin required' })
  const { entry_date, tea_type, weight, unit_cost, note } = req.body || {};
  const w = Number(weight);
  const c = Number(unit_cost);
  if (!entry_date || w <= 0 || c < 0) return res.status(400).json({ message: 'Missing/invalid entry_date/weight/unit_cost' });
  if (MONGO_READY) {
    nextId('finished_stock').then(id => {
      const doc = { id, entry_date, tea_type: tea_type || '', weight: w, unit_cost: c, note: note || null };
      mongoDb.collection('finished_stock').insertOne(doc).then(() => { auditLog('finished_stock', id, 'create', req, { entry_date, tea_type, weight: w, unit_cost: c, note }); res.json({ id }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    });
    return;
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.run(`INSERT INTO finished_stock (entry_date, tea_type, weight, unit_cost, note) VALUES (?,?,?,?,?)`, [entry_date, tea_type || '', w, c, note || null], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    const id = this.lastID;
    if (MONGO_READY) mongoDb.collection('finished_stock').insertOne({ id, entry_date, tea_type: tea_type || '', weight: w, unit_cost: c, note: note || null }).catch(() => {});
    auditLog('finished_stock', id, 'create', req, { entry_date, tea_type, weight: w, unit_cost: c, note });
    res.json({ id });
  });
});

app.put('/finished-stock/:id', requireAuth, (req, res) => {
  if (!(hasRole(req, 'admin') || hasRole(req, 'warehouse'))) return res.status(403).json({ message: 'Forbidden: warehouse/admin required' })
  const id = Number(req.params.id);
  const { entry_date, tea_type, weight, unit_cost, note } = req.body || {};
  const upd = {};
  if (entry_date != null) upd.entry_date = entry_date;
  if (tea_type != null) upd.tea_type = tea_type;
  if (weight != null) upd.weight = Number(weight);
  if (unit_cost != null) upd.unit_cost = Number(unit_cost);
  if (note != null) upd.note = note;
  if (MONGO_READY) {
    return mongoDb.collection('finished_stock').updateOne({ id }, { $set: upd }, { upsert: true }).then(() => { auditLog('finished_stock', id, 'update', req, upd); res.json({ changed: 1 }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const fields = []; const params = [];
  if (entry_date != null) { fields.push('entry_date = ?'); params.push(entry_date) }
  if (tea_type != null) { fields.push('tea_type = ?'); params.push(tea_type) }
  if (weight != null) { fields.push('weight = ?'); params.push(Number(weight)) }
  if (unit_cost != null) { fields.push('unit_cost = ?'); params.push(Number(unit_cost)) }
  if (note != null) { fields.push('note = ?'); params.push(note) }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  params.push(id);
  db.run(`UPDATE finished_stock SET ${fields.join(', ')} WHERE id = ?`, params, function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) mongoDb.collection('finished_stock').updateOne({ id }, { $set: upd }, { upsert: true }).catch(() => {});
    auditLog('finished_stock', id, 'update', req, upd);
    res.json({ changed: this.changes });
  })
})

// Unified receipts list
app.get('/receipts', requireAuth, async (req, res) => {
  const { month, year, type, missing } = req.query || {};
  const mStr = month ? String(month).padStart(2,'0') : null;
  const yStr = year ? String(year) : null;
  const wantType = ['sales','purchases','expenses'].includes(String(type)) ? String(type) : 'all';
  const limit = 500;
  const onlyMine = !hasRole(req, 'admin');
  try {
    const out = [];
    const matchDate = (dateStr) => {
      if (!mStr || !yStr) return true;
      return String(dateStr||'').startsWith(`${yStr}-${mStr}`);
    };
    if (MONGO_READY) {
      const uname = String(req.user?.username || '');
      const pushMany = (rows, t) => {
        rows.forEach(r => {
          if (r.receipt_path) out.push({
            type: t,
            id: r.id,
            date: r.sale_date||r.purchase_date||r.expense_date,
            owner: r.owner||r.created_by||null,
            invoice_no: r.invoice_no || r.ticket_name || r.weigh_ticket_code || null
          })
        })
      };
      if (wantType==='all' || wantType==='sales') {
        const and = [{ receipt_path: { $exists: true, $ne: null } }];
        if (mStr && yStr) and.push({ sale_date: { $regex: `^${yStr}-${mStr}` } });
        if (onlyMine) and.push({ $or: [{ owner: uname }, { created_by: uname }] });
        const rows = await mongoDb.collection('sales').find({ $and: and }).sort({ sale_date: -1, id: -1 }).limit(limit).toArray();
        pushMany(rows, 'sales');
      }
      if (wantType==='all' || wantType==='purchases') {
        const and = [{ receipt_path: { $exists: true, $ne: null } }];
        if (mStr && yStr) and.push({ purchase_date: { $regex: `^${yStr}-${mStr}` } });
        if (onlyMine) and.push({ $or: [{ owner: uname }, { created_by: uname }] });
        const rows = await mongoDb.collection('purchases').find({ $and: and }).sort({ purchase_date: -1, id: -1 }).limit(limit).toArray();
        pushMany(rows, 'purchases');
      }
      if (wantType==='all' || wantType==='expenses') {
        const and = [{ receipt_path: { $exists: true, $ne: null } }];
        if (mStr && yStr) and.push({ expense_date: { $regex: `^${yStr}-${mStr}` } });
        if (onlyMine) and.push({ $or: [{ owner: uname }] });
        const rows = await mongoDb.collection('expenses').find({ $and: and }).sort({ expense_date: -1, id: -1 }).limit(limit).toArray();
        pushMany(rows, 'expenses');
      }
      return res.json(out);
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' });
    const uname = String(req.user?.username || '');
    const clauses = [];
    const params = [];
    const addDate = (col) => {
      if (mStr && yStr) { clauses.push(`strftime('%m', ${col}) = ?`); params.push(mStr); clauses.push(`strftime('%Y', ${col}) = ?`); params.push(yStr); }
    };
    const ownerClause = (tbl) => (onlyMine ? ` AND ${tbl}.owner = ?` : '');
    const ownerParam = (onlyMine ? [uname] : []);
    const getColInfo = (tbl) => new Promise((resolve) => db.all(`PRAGMA table_info(${tbl})`, [], (e, rows) => resolve(rows||[])));
    const salesCols = await getColInfo('sales');
    const purchCols = await getColInfo('purchases');
    const has = (cols, name) => cols.some(c => c.name === name);
    const salesInvExprRaw = has(salesCols,'invoice_no') ? (has(salesCols,'ticket_name') ? 'COALESCE(invoice_no, ticket_name)' : 'invoice_no') : (has(salesCols,'ticket_name') ? 'ticket_name' : 'NULL');
    const purchInvExprRaw = has(purchCols,'invoice_no') ? (has(purchCols,'ticket_name') || has(purchCols,'weigh_ticket_code') ? 'COALESCE(invoice_no, ticket_name, weigh_ticket_code)' : 'invoice_no') : (has(purchCols,'ticket_name') || has(purchCols,'weigh_ticket_code') ? 'COALESCE(ticket_name, weigh_ticket_code)' : 'NULL');
    const salesInvExpr = salesInvExprRaw;
    const purchInvExpr = purchInvExprRaw;
    let sql = '';
    if (wantType==='sales') {
      clauses.length = 0; params.length = 0;
      clauses.push('sales.receipt_path IS NOT NULL'); addDate('sale_date');
      if (missing) clauses.push("(invoice_no IS NULL OR TRIM(COALESCE(invoice_no,'')) = '')")
      sql = `SELECT 'sales' AS type, id, sale_date AS d, owner, ${salesInvExpr} AS invoice_no FROM sales ${clauses.length?'WHERE '+clauses.join(' AND '):''}${ownerClause('sales')} ORDER BY d DESC, id DESC LIMIT ${limit}`;
      params.push(...ownerParam);
    } else if (wantType==='purchases') {
      clauses.length = 0; params.length = 0;
      clauses.push('purchases.receipt_path IS NOT NULL'); addDate('purchase_date');
      if (missing) clauses.push("(invoice_no IS NULL OR TRIM(COALESCE(invoice_no,'')) = '')")
      sql = `SELECT 'purchases' AS type, id, purchase_date AS d, owner, ${purchInvExpr} AS invoice_no FROM purchases ${clauses.length?'WHERE '+clauses.join(' AND '):''}${ownerClause('purchases')} ORDER BY d DESC, id DESC LIMIT ${limit}`;
      params.push(...ownerParam);
    } else if (wantType==='expenses') {
      clauses.length = 0; params.length = 0;
      clauses.push('expenses.receipt_path IS NOT NULL'); addDate('expense_date');
      sql = `SELECT 'expenses' AS type, id, expense_date AS d, owner, NULL AS invoice_no FROM expenses ${clauses.length?'WHERE '+clauses.join(' AND '):''}${ownerClause('expenses')} ORDER BY d DESC, id DESC LIMIT ${limit}`;
      params.push(...ownerParam);
    } else {
      const salesWhere = []; const purchasesWhere = []; const expensesWhere = [];
      salesWhere.push('sales.receipt_path IS NOT NULL'); purchasesWhere.push('purchases.receipt_path IS NOT NULL'); expensesWhere.push('expenses.receipt_path IS NOT NULL');
      if (mStr && yStr) { salesWhere.push("strftime('%m', sale_date) = ?"); salesWhere.push("strftime('%Y', sale_date) = ?"); purchasesWhere.push("strftime('%m', purchase_date) = ?"); purchasesWhere.push("strftime('%Y', purchase_date) = ?"); expensesWhere.push("strftime('%m', expense_date) = ?"); expensesWhere.push("strftime('%Y', expense_date) = ?"); params.push(mStr,yStr,mStr,yStr,mStr,yStr); }
      if (onlyMine) { salesWhere.push('sales.owner = ?'); purchasesWhere.push('purchases.owner = ?'); expensesWhere.push('expenses.owner = ?'); params.push(uname, uname, uname); }
      sql = `
        SELECT 'sales' AS type, id, sale_date AS d, owner, ${salesInvExpr} AS invoice_no FROM sales ${salesWhere.length?'WHERE '+salesWhere.join(' AND '):''}
        UNION ALL
        SELECT 'purchases' AS type, id, purchase_date AS d, owner, ${purchInvExpr} AS invoice_no FROM purchases ${purchasesWhere.length?'WHERE '+purchasesWhere.join(' AND '):''}
        UNION ALL
        SELECT 'expenses' AS type, id, expense_date AS d, owner, NULL AS invoice_no FROM expenses ${expensesWhere.length?'WHERE '+expensesWhere.join(' AND '):''}
        ORDER BY d DESC, id DESC LIMIT ${limit}
      `;
      if (missing) { sql = sql.replace('FROM sales', "FROM sales WHERE (invoice_no IS NULL OR TRIM(COALESCE(invoice_no,'')) = '')").replace('FROM purchases', "FROM purchases WHERE (invoice_no IS NULL OR TRIM(COALESCE(invoice_no,'')) = '')") }
    }
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      const data = (rows||[]).map(r => ({ type: r.type, id: r.id, date: r.d, owner: r.owner||null, invoice_no: r.invoice_no || null }));
      res.json(data);
    });
  } catch (e) {
    res.status(500).json({ message: 'DB error', detail: e.message })
  }
});

// Audit logs viewer
app.get('/admin/audit-logs', requireAdmin, (req, res) => {
  const { limit = 100, offset = 0, entity, action, user, entity_id } = req.query||{}
  if (!SQLITE_READY) return res.status(500).json({ message:'DB error', detail:'SQLite disabled' })
  const where = []
  const params = []
  if (entity) { where.push('entity = ?'); params.push(String(entity)) }
  if (action) { where.push('action = ?'); params.push(String(action)) }
  if (user) { where.push('user = ?'); params.push(String(user)) }
  if (entity_id) { where.push('entity_id = ?'); params.push(Number(entity_id)) }
  const sql = `SELECT id, ts, user, action, entity, entity_id, changes FROM audit_logs ${where.length?('WHERE '+where.join(' AND ')):''} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`
  db.all(sql, [...params, Number(limit), Number(offset)], (err, rows) => {
    if (err) return res.status(500).json({ message:'DB error', detail:err.message })
    res.json(rows||[])
  })
})

// CSV import/export templates
app.get('/admin/import/template', requireAdmin, (req, res) => {
  const type = String((req.query&&req.query.type)||'').toLowerCase()
  let headers = []
  if (type==='sales') headers = ['sale_date','customer_name','tea_type','price_per_kg','weight','payment_status','ticket_name','invoice_no','contract','issued_by','export_type','country']
  else if (type==='purchases') headers = ['purchase_date','supplier_name','weight','unit_price','payment_status','water_percent','net_weight','ticket_name','invoice_no','weigh_ticket_code','vehicle_plate']
  else if (type==='expenses') headers = ['expense_date','description','amount','category']
  else return res.status(400).json({ message:'Unknown type', detail:'type must be sales|purchases|expenses' })
  const csv = '\uFEFF'+headers.join(',')+'\n'
  res.setHeader('Content-Type','text/csv; charset=utf-8')
  res.setHeader('Content-Disposition',`attachment; filename="template_${type}.csv"`)
  res.send(csv)
})

app.post('/admin/import', requireAdmin, (req, res) => {
  const type = String((req.body&&req.body.type)||'').toLowerCase()
  const rows = Array.isArray(req.body&&req.body.rows) ? req.body.rows : []
  if (!rows.length) return res.status(400).json({ message:'No rows' })
  if (!SQLITE_READY) return res.status(500).json({ message:'DB error', detail:'SQLite disabled' })
  const results = { inserted: 0, failed: 0, errors: [] }
  const normalizeNum = (v) => { const s=String(v||'').toLowerCase(); const mult=/k|nghìn|ngàn/.test(s)?1000:/tr|triệu|m/.test(s)?1_000_000:1; const dig=s.replace(/[^\d]/g,''); return dig?Number(dig)*mult:0 }
  const insertDynamic = (table, obj) => new Promise((resolve) => {
    db.all(`PRAGMA table_info(${table})`, [], (e, cols) => {
      if (e) { results.failed++; results.errors.push(String(e.message||'error')); return resolve() }
      const names = new Set((cols||[]).map(c=>c.name))
      const row = { ...obj }
      const commonUser = String(req.user?.username||'')
      if (table==='sales'){ row.created_by = commonUser; row.owner = commonUser; row.price_per_kg = normalizeNum(row.price_per_kg); row.weight = normalizeNum(row.weight) }
      if (table==='purchases'){ row.owner = commonUser; row.unit_price = normalizeNum(row.unit_price); row.weight = normalizeNum(row.weight); if (row.net_weight!=null) row.net_weight = normalizeNum(row.net_weight); if (row.water_percent!=null) row.water_percent = Number(row.water_percent) }
      if (table==='expenses'){ row.owner = commonUser; row.amount = normalizeNum(row.amount) }
      const fields = []; const vals = []
      Object.keys(row).forEach(k => { if (names.has(k)) { fields.push(k); vals.push(row[k]===''?null:row[k]) } })
      if (!fields.length) { results.failed++; results.errors.push('No matching columns'); return resolve() }
      const placeholders = fields.map(()=>'?').join(',')
      const sql = `INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders})`
      db.run(sql, vals, function(err){ if(err){ results.failed++; results.errors.push(String(err.message||'error')) } else { results.inserted++ } resolve() })
    })
  })
  const go = async () => {
    for (const r of rows) {
      try {
        if (type==='sales') await insertDynamic('sales', r)
        else if (type==='purchases') await insertDynamic('purchases', r)
        else if (type==='expenses') await insertDynamic('expenses', r)
        else { results.failed++; results.errors.push('Unknown type') }
      } catch (e) { results.failed++; results.errors.push(String(e.message||'error')) }
    }
    res.json(results)
  }
  go()
})

app.delete('/finished-stock/:id', requireAuth, (req, res) => {
  if (!(hasRole(req, 'admin') || hasRole(req, 'warehouse'))) return res.status(403).json({ message: 'Forbidden: warehouse/admin required' })
  const id = Number(req.params.id);
  if (MONGO_READY) {
    mongoDb.collection('finished_stock').deleteOne({ id }).then(r => res.json({ deleted: r.deletedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.run('DELETE FROM finished_stock WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) mongoDb.collection('finished_stock').deleteOne({ id }).catch(() => {});
    auditLog('finished_stock', id, 'delete', req, {});
    res.json({ deleted: this.changes });
  });
})

app.get('/purchases/:id/receipt', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const sendFile = (rel) => {
    if (!rel) return res.status(404).json({ message: 'Receipt not found' });
    const safe = String(rel).replace(/^\//, '');
    const abs = path.join(__dirname, safe);
    if (!fs.existsSync(abs)) return res.status(404).json({ message: 'Receipt not found' });
    if (safe.startsWith(`${ENC_DIR}/`)) {
      try {
        const data = fs.readFileSync(abs);
        const dec = decryptBuffer(data);
        if (!dec) return res.status(500).json({ message: 'Decrypt failed' });
        res.setHeader('Content-Type', contentTypeFromName(safe));
        res.setHeader('Content-Disposition', contentDispositionInline(safe));
        return res.send(dec);
      } catch (e) { return res.status(500).json({ message: 'File read error', detail: e.message }) }
    }
    res.setHeader('Content-Disposition', contentDispositionInline(safe));
    return res.sendFile(abs);
  };
  if (MONGO_READY) {
    return mongoDb.collection('purchases').findOne({ id }).then(r => sendFile(r?.receipt_path)).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get('SELECT receipt_path FROM purchases WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    sendFile(row?.receipt_path);
  });
});

// Expenses endpoints
app.get('/expenses', requireAuth, async (req, res) => {
  const { month, year } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    if (month && year) { try { await ensureFixedExpenses(month, year) } catch {} }
    const and = [];
    if (month && year) and.push({ expense_date: { $regex: `^${y}-${m}` } });
  if (!hasRole(req, 'admin')) and.push({ owner: String(req.user?.username || '') });
    const filter = and.length ? { $and: and } : {};
    return mongoDb.collection('expenses').find(filter).sort({ expense_date: 1, id: 1 }).toArray()
      .then(rows => res.json(rows.map(r => ({ id: r.id, expense_date: r.expense_date, description: r.description || '', amount: Number(r.amount || 0), category: r.category || null, owner: r.owner || null, receipt_path: r.receipt_path || null }))))
      .catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  const where = [];
  const params = [];
  if (month && year) {
    where.push("strftime('%m', expense_date) = ?"); params.push(pad2(month));
    where.push("strftime('%Y', expense_date) = ?"); params.push(String(year));
  }
  if (String(req.user?.role) !== 'admin') { where.push('owner = ?'); params.push(String(req.user?.username || '')) }
  try { if (month && year) await ensureFixedExpenses(month, year) } catch {}
  const sql = `SELECT id, expense_date, description, amount, category, owner, receipt_path FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY expense_date ASC, id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  });
});

app.post('/expenses', rateLimit(60_000, 30, 'expenses_post'), requireAuth, (req, res) => {
  const { expense_date, description, amount, category, receipt_data, receipt_name } = req.body;
  if (!expense_date || amount == null) return res.status(400).json({ message: 'Missing expense_date/amount' });
  const parseData = (d) => { const m = String(d).match(/^data:\w+\/\w+;base64,(.+)$/); return Buffer.from(m ? m[1] : String(d), 'base64') };
  const ownerUser = String(req.user?.username || '');
  if (MONGO_READY) {
    nextId('expenses').then(id => {
      const doc = { id, expense_date, description: description || '', amount: Number(amount), category: category || null, owner: ownerUser || null };
      if (receipt_data) {
        let buf; try { buf = parseData(receipt_data) } catch { return res.status(400).json({ message: 'Invalid image data' }) }
        const MAX = 5 * 1024 * 1024; if (buf.length > MAX) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
        const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
        const fname = `expense_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const encName = `${fname}.enc`;
        const encPath = `${ENC_DIR}/${encName}`;
        try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
        doc.receipt_path = `/${encPath}`; doc.paid_by = ownerUser || null
      }
      mongoDb.collection('expenses').insertOne(doc).then(() => { auditLog('expenses', id, 'create', req, { expense_date, description, amount: Number(amount), category }); res.json({ id, receipt_path: doc.receipt_path || null }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    });
    return;
  }
  const baseFields = ['expense_date','description','amount','category','owner'];
  const baseVals = [expense_date, description || '', Number(amount), category || null, ownerUser || null];
  let receiptPath = null; let paidBy = null;
  if (receipt_data) {
    let buf; try { buf = parseData(receipt_data) } catch { return res.status(400).json({ message: 'Invalid image data' }) }
    const MAX = 5 * 1024 * 1024; if (buf.length > MAX) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
    const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
    const fname = `expense_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const encName = `${fname}.enc`;
    const encPath = `${ENC_DIR}/${encName}`;
    try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
    receiptPath = `/${encPath}`; paidBy = ownerUser || null;
  }
  db.all(`PRAGMA table_info(expenses)`, [], (e, cols) => {
    const hasPaidBy = !e && cols?.some(r => r.name === 'paid_by');
    const fields = receiptPath ? [...baseFields, 'receipt_path'] : [...baseFields];
    const vals = receiptPath ? [...baseVals, receiptPath] : [...baseVals];
    if (hasPaidBy) { fields.push('paid_by'); vals.push(paidBy) }
    const placeholders = fields.map(()=>'?').join(',');
    const sql = `INSERT INTO expenses (${fields.join(',')}) VALUES (${placeholders})`;
    db.run(sql, vals, function (err) {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      const id = this.lastID;
      if (MONGO_READY) {
        const doc = { id, expense_date, description: description || '', amount: Number(amount), category: category || null, receipt_path: receiptPath || null, paid_by: paidBy || null };
        mongoDb.collection('expenses').insertOne(doc).catch(() => {});
      }
      auditLog('expenses', id, 'create', req, { expense_date, description, amount: Number(amount), category });
      res.json({ id, receipt_path: receiptPath || null });
    });
  });
});

app.put('/expenses/:id', rateLimit(60_000, 60, 'expenses_put'), requireAuth, (req, res) => {
  const id = req.params.id;
  const { expense_date, description, amount, category, receipt_data, receipt_name } = req.body;
  const isAdmin = hasRole(req, 'admin')
  const isFinance = hasRole(req, 'finance')
  if (!(isAdmin || isFinance)) return res.status(403).json({ message: 'Forbidden: admin/finance required' })
  if (MONGO_READY) {
    const upd = {};
    if (isAdmin) {
      if (expense_date != null) upd.expense_date = expense_date;
      if (description != null) upd.description = description;
      if (amount != null) upd.amount = Number(amount);
      if (category != null) upd.category = category;
    }
    if (receipt_data) {
      const parseData = (d) => { const m = String(d).match(/^data:\w+\/\w+;base64,(.+)$/); return Buffer.from(m ? m[1] : String(d), 'base64'); };
      let buf; try { buf = parseData(receipt_data) } catch { return res.status(400).json({ message: 'Invalid image data' }) }
      const MAX = 5 * 1024 * 1024; if (buf.length > MAX) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
    const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
    const fname = `expense_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const encName = `${fname}.enc`;
    const encPath = `${ENC_DIR}/${encName}`; try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
    upd.receipt_path = `/${encPath}`; upd.paid_by = String(req.user?.username || '')
    }
    mongoDb.collection('expenses').updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => { auditLog('expenses', id, 'update', req, upd); res.json({ changed: 1 }) }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  const fields = [];
  const params = [];
  if (isAdmin) {
    if (expense_date != null) { fields.push('expense_date = ?'); params.push(expense_date); }
    if (description != null) { fields.push('description = ?'); params.push(description); }
    if (amount != null) { fields.push('amount = ?'); params.push(Number(amount)); }
    if (category != null) { fields.push('category = ?'); params.push(category); }
  }
  if (receipt_data) {
    const parseData = (d) => { const m = String(d).match(/^data:\w+\/\w+;base64,(.+)$/); return Buffer.from(m ? m[1] : String(d), 'base64'); };
    let buf; try { buf = parseData(receipt_data) } catch { return res.status(400).json({ message: 'Invalid image data' }) }
    const MAX = 5 * 1024 * 1024; if (buf.length > MAX) return res.status(400).json({ message: 'Image too large', detail: 'Dung lượng ảnh phải < 5MB' });
    const ext = (String(receipt_name||'').match(/\.([a-zA-Z0-9]+)$/) || [null,'jpg'])[1];
    const fname = `expense_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const encName = `${fname}.enc`;
    const encPath = `${ENC_DIR}/${encName}`; try { fs.writeFileSync(encPath, encryptBuffer(buf)) } catch (e) { return res.status(500).json({ message: 'File save error', detail: e.message }) }
    fields.push('receipt_path = ?'); params.push(`/${encPath}`);
    fields.push('paid_by = ?'); params.push(String(req.user?.username || ''));
  }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`;
  params.push(id);
  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) {
      const upd = {};
      if (expense_date != null) upd.expense_date = expense_date;
      if (description != null) upd.description = description;
      if (amount != null) upd.amount = Number(amount);
      if (category != null) upd.category = category;
      mongoDb.collection('expenses').updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
    }
    const changes = {};
    if (expense_date != null) changes.expense_date = expense_date;
    if (description != null) changes.description = description;
    if (amount != null) changes.amount = Number(amount);
    if (category != null) changes.category = category;
    if (receipt_data) changes.receipt_path = '(updated)';
    auditLog('expenses', id, 'update', req, changes);
    res.json({ changed: this.changes });
  });
});

app.get('/expenses/:id/receipt', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const sendFile = (rel) => {
    if (!rel) return res.status(404).json({ message: 'Receipt not found' });
    const safe = String(rel).replace(/^\//, '');
    const abs = path.join(__dirname, safe);
    if (!fs.existsSync(abs)) return res.status(404).json({ message: 'Receipt not found' });
    if (safe.startsWith(`${ENC_DIR}/`)) {
      try {
        const data = fs.readFileSync(abs);
        const dec = decryptBuffer(data);
        if (!dec) return res.status(500).json({ message: 'Decrypt failed' });
        res.setHeader('Content-Type', contentTypeFromName(safe));
        res.setHeader('Content-Disposition', contentDispositionInline(safe));
        return res.send(dec);
      } catch (e) { return res.status(500).json({ message: 'File read error', detail: e.message }) }
    }
    res.setHeader('Content-Disposition', contentDispositionInline(safe));
    return res.sendFile(abs);
  };
  if (MONGO_READY) {
    return mongoDb.collection('expenses').findOne({ id }).then(r => sendFile(r?.receipt_path)).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get('SELECT receipt_path FROM expenses WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    sendFile(row?.receipt_path);
  });
});

app.delete('/expenses/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (MONGO_READY) {
    mongoDb.collection('expenses').deleteOne({ id: Number(id) }).then(r => res.json({ deleted: r.deletedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  db.run('DELETE FROM expenses WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (MONGO_READY) mongoDb.collection('expenses').deleteOne({ id: Number(id) }).catch(() => {});
    auditLog('expenses', id, 'delete', req, {});
    res.json({ deleted: this.changes });
  });
});

// Directory endpoints: suppliers/customers/staff
function makeCrud(table) {
  app.get(`/${table}`, requireAuth, (req, res) => {
    if (MONGO_READY) {
      return mongoDb.collection(table).find({}).sort({ name: 1, id: 1 }).toArray()
        .then(rows => res.json(rows))
        .catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
    }
    const baseCols = table === 'staff' ? 'id, name, role, phone, note' : (table === 'customers' ? 'id, name, phone, address, note, country, export_type' : 'id, name, phone, address, note');
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    db.all(`SELECT ${baseCols} FROM ${table} ORDER BY name ASC, id ASC`, [], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      res.json(rows);
    });
  });
  app.post(`/${table}`, (table === 'staff' ? requireAdmin : requireAuth), (req, res) => {
    const { name, phone, address, note, role, country, export_type } = req.body;
    if (!name) return res.status(400).json({ message: 'Missing name' });
    if (MONGO_READY) {
      return nextId(table).then(id => {
        const doc = table === 'staff'
          ? { id, name: name || '', role: role || null, phone: phone || '', note: note || '' }
          : (table === 'customers'
              ? { id, name: name || '', phone: phone || '', address: address || '', note: note || '', country: country || null, export_type: export_type || null }
              : { id, name: name || '', phone: phone || '', address: address || '', note: note || '' });
        mongoDb.collection(table).insertOne(doc).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    let cols = ['name','phone','address','note'];
    let vals = [name || '', phone || '', address || '', note || ''];
    if (table === 'staff') {
      cols = ['name','role','phone','note'];
      vals = [name || '', role || null, phone || '', note || ''];
    } else if (table === 'customers') {
      cols = ['name','phone','address','note','country','export_type'];
      vals = [name || '', phone || '', address || '', note || '', country || null, export_type || null];
    }
    const placeholders = cols.map(() => '?').join(',');
    db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, vals, function(err){
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      const id = this.lastID;
      if (MONGO_READY) {
        const doc = table === 'staff'
          ? { id, name: name || '', role: role || null, phone: phone || '', note: note || '' }
          : (table === 'customers'
              ? { id, name: name || '', phone: phone || '', address: address || '', note: note || '', country: country || null, export_type: export_type || null }
              : { id, name: name || '', phone: phone || '', address: address || '', note: note || '' });
        mongoDb.collection(table).insertOne(doc).catch(() => {});
      }
      res.json({ id });
    });
  });
  app.put(`/${table}/:id`, requireAdmin, (req, res) => {
    const id = req.params.id;
    const { name, phone, address, note, role, country, export_type } = req.body;
    if (MONGO_READY) {
      const upd = {};
      if (name != null) upd.name = name;
      if (phone != null) upd.phone = phone;
      if (table !== 'staff' && address != null) upd.address = address;
      if (note != null) upd.note = note;
      if (table === 'staff' && role != null) upd.role = role;
      if (table === 'customers') {
        if (country != null) upd.country = country;
        if (export_type != null) upd.export_type = export_type;
      }
      return mongoDb.collection(table).updateOne({ id: Number(id) }, { $set: upd }, { upsert: true })
        .then(() => res.json({ changed: 1 }))
        .catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    const fields = []; const params = [];
    if (name != null) { fields.push('name = ?'); params.push(name); }
    if (phone != null) { fields.push('phone = ?'); params.push(phone); }
    if (table !== 'staff' && address != null) { fields.push('address = ?'); params.push(address); }
    if (note != null) { fields.push('note = ?'); params.push(note); }
    if (table === 'staff' && role != null) { fields.push('role = ?'); params.push(role); }
    if (table === 'customers') {
      if (country != null) { fields.push('country = ?'); params.push(country); }
      if (export_type != null) { fields.push('export_type = ?'); params.push(export_type); }
    }
    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
    const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);
    db.run(sql, params, function(err){
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      if (MONGO_READY) {
        const upd = {};
        if (name != null) upd.name = name;
        if (phone != null) upd.phone = phone;
        if (table !== 'staff' && address != null) upd.address = address;
        if (note != null) upd.note = note;
        if (table === 'staff' && role != null) upd.role = role;
        if (table === 'customers') {
          if (country != null) upd.country = country;
          if (export_type != null) upd.export_type = export_type;
        }
        mongoDb.collection(table).updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
      }
      res.json({ changed: this.changes });
    });
  });
  app.delete(`/${table}/:id`, requireAdmin, (req, res) => {
    const id = req.params.id;
    if (MONGO_READY) {
      return mongoDb.collection(table).deleteOne({ id: Number(id) })
        .then(r => res.json({ deleted: r.deletedCount || 0 }))
        .catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    db.run(`DELETE FROM ${table} WHERE id = ?`, [id], function(err){
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      if (MONGO_READY) mongoDb.collection(table).deleteOne({ id: Number(id) }).catch(() => {});
      res.json({ deleted: this.changes });
    });
  });
}

['suppliers','customers','staff'].forEach(makeCrud);

// Dashboard aggregate endpoint
app.get('/dashboard', (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ message: 'Thiếu month/year' });
  const m = pad2(month); const y = String(year);
  const VAR_CATS = ['Utility','Electricity','Fuel','Wood','Coal','Gas','Wage','Salary','Labor'];
  const FIX_CATS = ['Depreciation','Interest','Loan Interest','Bank Interest','Amortization','Repair'];
  if (MONGO_READY) {
    const prefix = `${y}-${m}`;
    Promise.all([
      mongoDb.collection('sales').find({ sale_date: { $regex: `^${prefix}` } }).toArray(),
      mongoDb.collection('purchases').find({ purchase_date: { $regex: `^${prefix}` } }).toArray(),
      mongoDb.collection('expenses').find({ expense_date: { $regex: `^${prefix}` } }).toArray(),
    ]).then(([sales, purchases, expenses]) => {
      const totalSales = sales.reduce((s, r) => s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg || 0) * Number(r.weight || 0))), 0);
      const totalPurchases = purchases.reduce((s, r) => {
        const unit = Number(r.unit_price || 0);
        const netw = r.net_weight != null ? Number(r.net_weight) : Number(r.weight || 0);
        return s + Number(r.total_cost != null ? r.total_cost : (unit * netw));
      }, 0);
      const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
      const variableExpense = expenses.reduce((s, r) => s + (VAR_CATS.includes(String(r.category || '')) ? Number(r.amount || 0) : 0), 0);
      const fixedExpense = expenses.reduce((s, r) => s + (FIX_CATS.includes(String(r.category || '')) ? Number(r.amount || 0) : 0), 0);
      const variableCost = totalPurchases + variableExpense;
      const netProfit = totalSales - totalPurchases - totalExpenses;
      const profitMarginPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
      const variablePct = totalSales > 0 ? (variableCost / totalSales) * 100 : 0;
      const fixedPct = totalSales > 0 ? (fixedExpense / totalSales) * 100 : 0;
      res.json({ totalSales, totalPurchases, totalExpenses, netProfit, variableCost, fixedExpense, variablePct, fixedPct, profitMarginPct });
    }).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }))
    return;
  }

  const queries = {
    sales: {
      sql: `SELECT COALESCE(SUM(price_per_kg * weight), 0) AS total FROM sales WHERE strftime('%m', sale_date) = ? AND strftime('%Y', sale_date) = ?`,
      params: [m, y]
    },
    purchases: {
      sql: `SELECT COALESCE(SUM(unit_price * COALESCE(net_weight, weight)), 0) AS total FROM purchases WHERE strftime('%m', purchase_date) = ? AND strftime('%Y', purchase_date) = ?`,
      params: [m, y]
    },
    expenses: {
      sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ?`,
      params: [m, y]
    }
  };

  const result = { totalSales: 0, totalPurchases: 0, totalExpenses: 0, netProfit: 0, variableCost: 0, fixedExpense: 0, variablePct: 0, fixedPct: 0, profitMarginPct: 0 };
  db.get(queries.sales.sql, queries.sales.params, (err1, r1) => {
    if (err1) return res.status(500).json({ message: 'DB error', detail: err1.message });
    result.totalSales = Number(r1?.total || 0);
    db.get(queries.purchases.sql, queries.purchases.params, (err2, r2) => {
      if (err2) return res.status(500).json({ message: 'DB error', detail: err2.message });
      result.totalPurchases = Number(r2?.total || 0);
      db.get(queries.expenses.sql, queries.expenses.params, (err3, r3) => {
        if (err3) return res.status(500).json({ message: 'DB error', detail: err3.message });
        result.totalExpenses = Number(r3?.total || 0);
        db.all(`SELECT category, amount FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ?`, [m, y], (err4, rows) => {
          const expRows = err4 ? [] : rows;
          const variableExpense = expRows.reduce((s, r) => s + (VAR_CATS.includes(String(r.category || '')) ? Number(r.amount || 0) : 0), 0);
          const fixedExpense = expRows.reduce((s, r) => s + (FIX_CATS.includes(String(r.category || '')) ? Number(r.amount || 0) : 0), 0);
          result.variableCost = result.totalPurchases + variableExpense;
          result.fixedExpense = fixedExpense;
          result.netProfit = result.totalSales - result.totalPurchases - result.totalExpenses;
          result.profitMarginPct = result.totalSales > 0 ? (result.netProfit / result.totalSales) * 100 : 0;
          result.variablePct = result.totalSales > 0 ? (result.variableCost / result.totalSales) * 100 : 0;
          result.fixedPct = result.totalSales > 0 ? (result.fixedExpense / result.totalSales) * 100 : 0;
          res.json(result);
        });
      });
    });
  });
});

app.get('/stats', (req, res) => {
  const { month, year } = req.query;
  const m = month ? pad2(month) : null; const y = year ? String(year) : null;
  if (MONGO_READY) {
    const matchSales = (m && y) ? { sale_date: { $regex: `^${y}-${m}` } } : {};
    const matchPurch = (m && y) ? { purchase_date: { $regex: `^${y}-${m}` } } : {};
    Promise.all([
      mongoDb.collection('sales').aggregate([
        { $match: matchSales },
        { $group: { _id: '$customer_name', amount: { $sum: { $cond: [{ $gt: ['$total_amount', null] }, '$total_amount', { $multiply: [{ $toDouble: { $ifNull: ['$price_per_kg', 0] } }, { $toDouble: { $ifNull: ['$weight', 0] } }] }] } }, weight: { $sum: { $toDouble: { $ifNull: ['$weight', 0] } } }, count: { $sum: 1 } } },
        { $project: { name: '$_id', amount: 1, weight: 1, count: 1, _id: 0 } }
      ]).toArray(),
      mongoDb.collection('purchases').aggregate([
        { $match: matchPurch },
        { $group: { _id: '$supplier_name', amount: { $sum: { $cond: [{ $gt: ['$total_cost', null] }, '$total_cost', { $multiply: [{ $toDouble: { $ifNull: ['$unit_price', 0] } }, { $toDouble: { $ifNull: ['$net_weight', '$weight'] } }] }] } }, weight: { $sum: { $toDouble: { $ifNull: ['$net_weight', '$weight'] } } }, count: { $sum: 1 } } },
        { $project: { name: '$_id', amount: 1, weight: 1, count: 1, _id: 0 } }
      ]).toArray()
    ]).then(([buyers, suppliers]) => {
      const byAmtDesc = (a,b) => (Number(b.amount||0) - Number(a.amount||0));
      const byAmtAsc = (a,b) => (Number(a.amount||0) - Number(b.amount||0));
      res.json({ buyers_all: buyers, buyers_top: [...buyers].sort(byAmtDesc).slice(0,5), buyers_bottom: [...buyers].sort(byAmtAsc).slice(0,5), suppliers_all: suppliers, suppliers_top: [...suppliers].sort(byAmtDesc).slice(0,5), suppliers_bottom: [...suppliers].sort(byAmtAsc).slice(0,5) });
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const buyersSql = (m && y)
    ? `SELECT customer_name AS name, COALESCE(SUM(price_per_kg * weight),0) AS amount, COALESCE(SUM(weight),0) AS weight, COUNT(*) AS count FROM sales WHERE strftime('%m', sale_date)=? AND strftime('%Y', sale_date)=? GROUP BY customer_name`
    : `SELECT customer_name AS name, COALESCE(SUM(price_per_kg * weight),0) AS amount, COALESCE(SUM(weight),0) AS weight, COUNT(*) AS count FROM sales GROUP BY customer_name`;
  const buyersParams = (m && y) ? [m, y] : [];
  const suppliersSql = (m && y)
    ? `SELECT supplier_name AS name, COALESCE(SUM(unit_price * COALESCE(net_weight, weight)),0) AS amount, COALESCE(SUM(COALESCE(net_weight, weight)),0) AS weight, COUNT(*) AS count FROM purchases WHERE strftime('%m', purchase_date)=? AND strftime('%Y', purchase_date)=? GROUP BY supplier_name`
    : `SELECT supplier_name AS name, COALESCE(SUM(unit_price * COALESCE(net_weight, weight)),0) AS amount, COALESCE(SUM(COALESCE(net_weight, weight)),0) AS weight, COUNT(*) AS count FROM purchases GROUP BY supplier_name`;
  db.all(buyersSql, buyersParams, (e1, buyers) => {
    if (e1) return res.status(500).json({ message: 'DB error', detail: e1.message });
    db.all(suppliersSql, buyersParams, (e2, suppliers) => {
      if (e2) return res.status(500).json({ message: 'DB error', detail: e2.message });
      const byAmtDesc = (a,b) => (Number(b.amount||0) - Number(a.amount||0));
      const byAmtAsc = (a,b) => (Number(a.amount||0) - Number(b.amount||0));
      res.json({ buyers_all: buyers, buyers_top: [...buyers].sort(byAmtDesc).slice(0,5), buyers_bottom: [...buyers].sort(byAmtAsc).slice(0,5), suppliers_all: suppliers, suppliers_top: [...suppliers].sort(byAmtDesc).slice(0,5), suppliers_bottom: [...suppliers].sort(byAmtAsc).slice(0,5) });
    });
  });
});

app.get('/balance-sheet', requireAuth, async (req, res) => {
  try {
    if (!(hasRole(req, 'admin') || hasRole(req, 'finance'))) return res.status(403).json({ message: 'Forbidden: admin/finance required' })
    const q = req.query || {}
    let month = q.month, year = q.year
    if (month && typeof month === 'string' && /^(\d{4})-(\d{2})$/.test(month)) { const m = month.match(/^(\d{4})-(\d{2})$/); year = m[1]; month = m[2] }
    if (!month || !year) { const now = new Date(); month = String(now.getMonth()+1).padStart(2,'0'); year = String(now.getFullYear()) }
    const valuation = String(q.valuation || '').toLowerCase() // '7d' | '30d' | 'month'
    const initialCapital = Number(q.initial_capital || 0)
    const prefix = `${year}-${month}`
    const now = new Date()
    const dayDiff = (d) => { try { return Math.floor((now.getTime() - new Date(d).getTime())/(24*3600*1000)) } catch { return 0 } }
    const out = {
      assets: { cash: 0, inventory: { quantity_kg: 0, avg_cost: 0, value: 0 }, receivable: { total: 0, in_due: 0, overdue_7: 0, overdue_30: 0 }, total_assets: 0 },
      liabilities: { payable: { total: 0, in_due: 0, overdue_7: 0, overdue_30: 0 }, cost_pending: 0, total_liabilities: 0 },
      equity: { initial_capital: initialCapital, retained_earnings: 0, profit_current_period: 0, total_equity: 0 },
      summary: { assets: 0, liabilities_plus_equity: 0, balanced: true }
    }
    if (MONGO_READY) {
      const salesAll = await mongoDb.collection('sales').find({ sale_date: { $regex: `^${prefix}` } }).toArray()
      const purchAll = await mongoDb.collection('purchases').find({ purchase_date: { $regex: `^${prefix}` } }).toArray()
      const expAll = await mongoDb.collection('expenses').find({ expense_date: { $regex: `^${prefix}` } }).toArray()
      const paidSales = salesAll.filter(r => String(r.payment_status)==='paid')
      const paidPurch = purchAll.filter(r => String(r.payment_status)==='paid')
      const paidExp = expAll.filter(r => !!r.receipt_path)
      const sumSales = (rows) => rows.reduce((s,r)=> s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))), 0)
      const sumPurch = (rows) => rows.reduce((s,r)=> { const unit=Number(r.unit_price||0); const nw = r.net_weight!=null?Number(r.net_weight):Number(r.weight||0); return s + Number(r.total_cost != null ? r.total_cost : (unit*nw)) }, 0)
      const sumExp = (rows) => rows.reduce((s,r)=> s + Number(r.amount||0), 0)
      const cash = sumSales(paidSales) - sumPurch(paidPurch) - sumExp(paidExp)
      const recvRows = salesAll.filter(r => String(r.payment_status)!=='paid')
      const recvTotal = sumSales(recvRows)
      const recvAging = { in_due:0, overdue_7:0, overdue_30:0 }
      recvRows.forEach(r => { const v = Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))); const d = dayDiff(r.sale_date); if (d<=7) recvAging.in_due+=v; else if (d<=30) recvAging.overdue_7+=v; else recvAging.overdue_30+=v })
      const payRows = purchAll.filter(r => String(r.payment_status)!=='paid')
      const payTotal = sumPurch(payRows)
      const payAging = { in_due:0, overdue_7:0, overdue_30:0 }
      payRows.forEach(r => { const v = Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number(r.net_weight!=null?r.net_weight:r.weight||0))); const d = dayDiff(r.purchase_date); if (d<=7) payAging.in_due+=v; else if (d<=30) payAging.overdue_7+=v; else payAging.overdue_30+=v })
      const costPending = sumExp(expAll.filter(r => !r.receipt_path))
      const fgAll = await mongoDb.collection('finished_stock').find({ entry_date: { $regex: `^${prefix}` } }).toArray()
      const qtyOut = salesAll.reduce((s,r)=> s + Number(r.weight||0), 0)
      const fgQtyIn = fgAll.reduce((s,r)=> s + Number(r.weight||0), 0)
      const useFinished = fgQtyIn > 0
      const qtyIn = useFinished ? fgQtyIn : purchAll.reduce((s,r)=> s + Number(r.net_weight!=null?r.net_weight:r.weight||0), 0)
      const invQty = Math.max(0, qtyIn - qtyOut)
      let avgCost = 0
      if (valuation === '7d' || valuation === '30d') {
        const days = valuation==='7d' ? 7 : 30
        const ref = new Date(`${year}-${month}-28`)
        const since = new Date(ref.getTime() - days*24*3600*1000)
        const items = useFinished
          ? await mongoDb.collection('finished_stock').find({ entry_date: { $gte: since.toISOString().slice(0,10), $lte: ref.toISOString().slice(0,10) } }).toArray()
          : await mongoDb.collection('purchases').find({ purchase_date: { $gte: since.toISOString().slice(0,10), $lte: ref.toISOString().slice(0,10) } }).toArray()
        const sum = useFinished
          ? items.reduce((s,r)=> s + Number(r.unit_cost||0) * Number(r.weight||0), 0)
          : items.reduce((s,r)=> s + Number(r.unit_price||0) * Number(r.net_weight!=null?r.net_weight:r.weight||0), 0)
        const wsum = useFinished
          ? items.reduce((s,r)=> s + Number(r.weight||0), 0)
          : items.reduce((s,r)=> s + Number(r.net_weight!=null?r.net_weight:r.weight||0), 0)
        avgCost = wsum>0 ? (sum/wsum) : 0
      } else {
        if (useFinished) {
          const totalFgValue = fgAll.reduce((s,r)=> s + Number(r.unit_cost||0) * Number(r.weight||0), 0)
          avgCost = fgQtyIn>0 ? (totalFgValue/fgQtyIn) : 0
        } else {
          const totalPurchValue = sumPurch(purchAll)
          avgCost = qtyIn>0 ? (totalPurchValue/qtyIn) : 0
        }
      }
      const invVal = Math.round(avgCost * invQty)
      const profitMonth = sumSales(salesAll) - sumPurch(purchAll) - sumExp(expAll)
      out.assets.cash = cash
      out.assets.inventory.quantity_kg = invQty
      out.assets.inventory.avg_cost = avgCost
      out.assets.inventory.value = invVal
      out.assets.receivable.total = recvTotal
      out.assets.receivable.in_due = recvAging.in_due
      out.assets.receivable.overdue_7 = recvAging.overdue_7
      out.assets.receivable.overdue_30 = recvAging.overdue_30
      out.liabilities.payable.total = payTotal
      out.liabilities.payable.in_due = payAging.in_due
      out.liabilities.payable.overdue_7 = payAging.overdue_7
      out.liabilities.payable.overdue_30 = payAging.overdue_30
      out.liabilities.cost_pending = costPending
      out.equity.profit_current_period = profitMonth
    } else {
      if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' })
      const buyersSql = `SELECT id, sale_date, price_per_kg, weight, payment_status FROM sales WHERE strftime('%m', sale_date)=? AND strftime('%Y', sale_date)=?`
      const purchSql = `SELECT id, purchase_date, unit_price, COALESCE(net_weight, weight) AS nw, weight, payment_status FROM purchases WHERE strftime('%m', purchase_date)=? AND strftime('%Y', purchase_date)=?`
      const expSql = `SELECT id, expense_date, amount, receipt_path FROM expenses WHERE strftime('%m', expense_date)=? AND strftime('%Y', expense_date)=?`
      const m = String(month), y = String(year)
      const getAll = (sql, params) => new Promise((resolve) => db.all(sql, params, (e, rows) => resolve(e ? [] : rows)))
      const [salesAll, purchAll, expAll] = await Promise.all([getAll(buyersSql, [m, y]), getAll(purchSql, [m, y]), getAll(expSql, [m, y])])
      const sumSales = (rows) => rows.reduce((s,r)=> s + (Number(r.price_per_kg||0)*Number(r.weight||0)), 0)
      const sumPurch = (rows) => rows.reduce((s,r)=> s + (Number(r.unit_price||0)*Number(r.nw||0)), 0)
      const sumExp = (rows) => rows.reduce((s,r)=> s + Number(r.amount||0), 0)
      const paidSales = salesAll.filter(r => String(r.payment_status)==='paid')
      const paidPurch = purchAll.filter(r => String(r.payment_status)==='paid')
      const paidExp = expAll.filter(r => !!r.receipt_path)
      const cash = sumSales(paidSales) - sumPurch(paidPurch) - sumExp(paidExp)
      const recvRows = salesAll.filter(r => String(r.payment_status)!=='paid')
      const recvTotal = sumSales(recvRows)
      const recvAging = { in_due:0, overdue_7:0, overdue_30:0 }
      recvRows.forEach(r => { const v = Number(r.price_per_kg||0)*Number(r.weight||0); const d = dayDiff(r.sale_date); if (d<=7) recvAging.in_due+=v; else if (d<=30) recvAging.overdue_7+=v; else recvAging.overdue_30+=v })
      const payRows = purchAll.filter(r => String(r.payment_status)!=='paid')
      const payTotal = sumPurch(payRows)
      const payAging = { in_due:0, overdue_7:0, overdue_30:0 }
      payRows.forEach(r => { const v = Number(r.unit_price||0)*Number(r.nw||0); const d = dayDiff(r.purchase_date); if (d<=7) payAging.in_due+=v; else if (d<=30) payAging.overdue_7+=v; else payAging.overdue_30+=v })
      const costPending = sumExp(expAll.filter(r => !r.receipt_path))
      const fgAll = await new Promise((resolve)=> db.all(`SELECT entry_date, weight, unit_cost FROM finished_stock`, [], (e, rows)=> resolve(e?[]:rows)))
      const fgMonth = fgAll.filter(r => String(r.entry_date||'').startsWith(prefix))
      const qtyOut = salesAll.reduce((s,r)=> s + Number(r.weight||0), 0)
      const fgQtyIn = fgMonth.reduce((s,r)=> s + Number(r.weight||0), 0)
      const useFinished = fgQtyIn > 0
      const qtyIn = useFinished ? fgQtyIn : purchAll.reduce((s,r)=> s + Number(r.nw||0), 0)
      const invQty = Math.max(0, qtyIn - qtyOut)
      let avgCost = 0
      if (valuation === '7d' || valuation === '30d') {
        const days = valuation==='7d' ? 7 : 30
        const ref = new Date(`${year}-${month}-28`)
        const since = new Date(ref.getTime() - days*24*3600*1000)
        if (useFinished) {
          const filtered = fgAll.filter(r => { const d = new Date(r.entry_date); return d>=since && d<=ref })
          const sum = filtered.reduce((s,r)=> s + Number(r.unit_cost||0) * Number(r.weight||0), 0)
          const wsum = filtered.reduce((s,r)=> s + Number(r.weight||0), 0)
          avgCost = wsum>0 ? (sum/wsum) : 0
        } else {
          const items = purchAll
          const sum = items.reduce((s,r)=> s + Number(r.unit_price||0) * Number(r.nw||0), 0)
          const wsum = items.reduce((s,r)=> s + Number(r.nw||0), 0)
          avgCost = wsum>0 ? (sum/wsum) : 0
        }
      } else {
        if (useFinished) {
          const totalFgValue = fgMonth.reduce((s,r)=> s + Number(r.unit_cost||0) * Number(r.weight||0), 0)
          avgCost = fgQtyIn>0 ? (totalFgValue/fgQtyIn) : 0
        } else {
          const totalPurchValue = sumPurch(purchAll)
          avgCost = qtyIn>0 ? (totalPurchValue/qtyIn) : 0
        }
      }
      const invVal = Math.round(avgCost * invQty)
      const profitMonth = sumSales(salesAll) - sumPurch(purchAll) - sumExp(expAll)
      out.assets.cash = cash
      out.assets.inventory.quantity_kg = invQty
      out.assets.inventory.avg_cost = avgCost
      out.assets.inventory.value = invVal
      out.assets.receivable.total = recvTotal
      out.assets.receivable.in_due = recvAging.in_due
      out.assets.receivable.overdue_7 = recvAging.overdue_7
      out.assets.receivable.overdue_30 = recvAging.overdue_30
      out.liabilities.payable.total = payTotal
      out.liabilities.payable.in_due = payAging.in_due
      out.liabilities.payable.overdue_7 = payAging.overdue_7
      out.liabilities.payable.overdue_30 = payAging.overdue_30
      out.liabilities.cost_pending = costPending
      out.equity.profit_current_period = profitMonth
    }
    out.assets.total_assets = Number(out.assets.cash||0) + Number(out.assets.receivable?.total||0) + Number(out.assets.inventory?.value||0)
    out.liabilities.total_liabilities = Number(out.liabilities.payable?.total||0) + Number(out.liabilities.cost_pending||0)
    out.equity.retained_earnings = Math.max(0, out.assets.total_assets - out.liabilities.total_liabilities - out.equity.initial_capital)
    out.equity.total_equity = out.equity.initial_capital + out.equity.retained_earnings + out.equity.profit_current_period
    out.summary.assets = out.assets.total_assets
    out.summary.liabilities_plus_equity = out.liabilities.total_liabilities + out.equity.total_equity
    out.summary.balanced = Math.abs(out.summary.assets - out.summary.liabilities_plus_equity) < 1
    res.json(out)
  } catch (e) {
    res.status(500).json({ message: 'Balance sheet error', detail: e.message })
  }
})

app.post('/admin/migrate/sqlite-to-mongo', rateLimit(60_000, 5, 'migrate_sqlite_to_mongo'), requireAdmin, async (req, res) => {
  try {
    if (!SQLITE_READY) return res.status(400).json({ message: 'SQLite not available' })
    if (!MONGO_READY) return res.status(400).json({ message: 'MongoDB not connected' })
    const q = req.body || {}
    const dry = !!q.dry_run
    const getAll = (sql, params=[]) => new Promise((resolve) => db.all(sql, params, (e, rows) => resolve(e ? [] : rows)))
    const tables = [
      { name: 'users', sql: 'SELECT * FROM users', coll: 'users' },
      { name: 'sales', sql: 'SELECT * FROM sales', coll: 'sales' },
      { name: 'purchases', sql: 'SELECT * FROM purchases', coll: 'purchases' },
      { name: 'expenses', sql: 'SELECT * FROM expenses', coll: 'expenses' },
      { name: 'audit_logs', sql: 'SELECT * FROM audit_logs', coll: 'audit_logs' },
      { name: 'security_logs', sql: 'SELECT * FROM security_logs', coll: 'security_logs' }
    ]
    const result = { migrated: {}, skipped: {}, total: {}, dry_run: dry }
    for (const t of tables) {
      const rows = await getAll(t.sql)
      result.total[t.name] = rows.length
      let mig = 0, skip = 0
      if (!dry) {
        for (const row of rows) {
          try {
            await mongoDb.collection(t.coll).updateOne({ id: Number(row.id) }, { $set: row }, { upsert: true })
            mig++
          } catch { skip++ }
        }
      }
      result.migrated[t.name] = dry ? 0 : mig
      result.skipped[t.name] = dry ? 0 : skip
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ message: 'Migration error', detail: e.message })
  }
})

app.get('/health', (req, res) => {
  res.json({ ok: true, mongo: !!MONGO_READY });
});

app.get('/whoami', requireAuth, (req, res) => {
  res.json({ user: req.user || null })
})

function auditLog(entity, entityId, action, req, changesObj) {
  try {
    const user = String(req.user?.username || '')
    const ts = new Date().toISOString()
    const changes = JSON.stringify(changesObj || {})
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString()
    const ua = String(req.headers['user-agent'] || '')
    const city = ''
    if (MONGO_READY) {
      mongoDb.collection('audit_logs').insertOne({ ts, user, entity, entity_id: Number(entityId), action, changes, ip, ua, city }).catch(() => {})
      return
    }
    if (!SQLITE_READY) return
    db.run(`INSERT INTO audit_logs (ts, user, entity, entity_id, action, changes, ip, ua, city) VALUES (?,?,?,?,?,?,?,?,?)`, [ts, user, entity, Number(entityId), action, changes, ip, ua, city], () => {})
  } catch {}
}

app.get('/audit', requireAdmin, (req, res) => {
  const { entity, entity_id, limit = 100 } = req.query
  const lim = Math.min(Number(limit)||100, 500)
  if (SQLITE_READY) {
    const where = []; const params = []
    if (entity) { where.push('entity = ?'); params.push(String(entity)) }
    if (entity_id) { where.push('entity_id = ?'); params.push(Number(entity_id)) }
    const sql = `SELECT ts, user, entity, entity_id, action, changes FROM audit_logs ${where.length?('WHERE '+where.join(' AND ')):''} ORDER BY ts DESC, id DESC LIMIT ?`
    params.push(lim)
    return db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      res.json(rows)
    })
  }
  if (MONGO_READY) {
    const filter = {}
    if (entity) filter.entity = String(entity)
    if (entity_id) filter.entity_id = Number(entity_id)
    return mongoDb.collection('audit_logs').find(filter).sort({ ts: -1, id: -1 }).limit(lim).toArray().then(rows => res.json(rows)).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
  }
  return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' })
})

app.get('/notifications', requireAuth, async (req, res) => {
  const days = Math.max(1, Number(req.query.days)||7)
  const weightThreshold = Number(req.query.weight_threshold)||2000
  const now = new Date()
  const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0')
  const threshold = new Date(now.getTime() - days*24*3600*1000)
  const tStr = `${threshold.getFullYear()}-${String(threshold.getMonth()+1).padStart(2,'0')}-${String(threshold.getDate()).padStart(2,'0')}`
  const out = []
  try {
    if (MONGO_READY) {
      const ownerFilter = (String(req.user?.role)==='admin') ? {} : { $or: [{ owner: String(req.user?.username||'') }, { created_by: String(req.user?.username||'') }] }
      const [sOver, pOver, fixedCount, heavyCount, adminUpdates] = await Promise.all([
        mongoDb.collection('sales').countDocuments({ payment_status:'pending', sale_date: { $lte: tStr }, ...ownerFilter }),
        mongoDb.collection('purchases').countDocuments({ payment_status:'pending', purchase_date: { $lte: tStr }, ...ownerFilter }),
        mongoDb.collection('expenses').countDocuments({ expense_date: { $regex: `^${y}-${m}` }, category: /định/i, ...(String(req.user?.role)==='admin'?{}:{ owner: String(req.user?.username||'') }) }),
        mongoDb.collection('purchases').countDocuments({ purchase_date: { $regex: `^${y}-${m}` }, weight: { $gt: weightThreshold }, ...ownerFilter }),
        mongoDb.collection('audit_logs').countDocuments({ entity: { $in: ['sales','purchases'] }, action: 'update', ts: { $gte: new Date(now.getTime() - 24*3600*1000).toISOString() } })
      ])
      if (sOver) out.push(`Có ${sOver} đơn bán chưa thanh toán >${days} ngày`)
      if (pOver) out.push(`Có ${pOver} đơn nhập chưa thanh toán >${days} ngày`)
      if (!fixedCount) out.push('Định phí tháng này chưa được sinh tự động hoặc chưa có dữ liệu')
      if (heavyCount) out.push(`Có ${heavyCount} đơn nhập vượt hạn mức trọng lượng (> ${weightThreshold} kg) trong tháng`)
      if (adminUpdates) out.push(`Có ${adminUpdates} lần sửa phiếu bởi Admin trong 24h qua`)
      return res.json(out)
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' })
    await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) AS c FROM sales WHERE payment_status = 'pending' AND sale_date <= ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [tStr].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { out.push((r?.c||0) ? `Có ${r.c} đơn bán chưa thanh toán >${days} ngày` : null); resolve() })
    })
    await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) AS c FROM purchases WHERE payment_status = 'pending' AND purchase_date <= ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [tStr].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { out.push((r?.c||0) ? `Có ${r.c} đơn nhập chưa thanh toán >${days} ngày` : null); resolve() })
    })
    await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) AS c FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ? AND LOWER(COALESCE(category,'')) LIKE '%định%' ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [m, String(y)].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { out.push((r?.c||0) ? null : 'Định phí tháng này chưa được sinh tự động hoặc chưa có dữ liệu'); resolve() })
    })
    await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) AS c FROM purchases WHERE strftime('%m', purchase_date) = ? AND strftime('%Y', purchase_date) = ? AND weight > ? ${String(req.user?.role)==='admin'?'':' AND owner = ?'}`, [m, String(y), weightThreshold].concat(String(req.user?.role)==='admin'?[]:[String(req.user?.username||'')]), (e, r) => { out.push((r?.c||0) ? `Có ${r.c} đơn nhập vượt hạn mức trọng lượng (> ${weightThreshold} kg) trong tháng` : null); resolve() })
    })
    await new Promise((resolve) => {
      const since = new Date(now.getTime() - 24*3600*1000).toISOString()
      db.get(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'update' AND (entity = 'sales' OR entity = 'purchases') AND ts >= ?`, [since], (e, r) => { out.push((r?.c||0) ? `Có ${r.c} lần sửa phiếu bởi Admin trong 24h qua` : null); resolve() })
    })
    res.json(out.filter(Boolean))
  } catch (e) {
    res.status(500).json({ message: 'DB error', detail: e.message })
  }
})
app.get('/events', rateLimit(10_000, 3, 'events'), (req, res) => {
  const token = req.query && (req.query.token || req.query.t)
  const user = verifyToken(token)
  if (!user) return res.status(401).end()
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGIN) {
    if (origin && origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  } else if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.flushHeaders && res.flushHeaders()
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`)
  const client = { res, user }
  sseClients.push(client)
  req.on('close', () => { const i = sseClients.indexOf(client); if (i>=0) sseClients.splice(i,1) })
})
app.get('/chat', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit)||50, 200)
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : String(req.user?.role||'').split(',').map(s=>s.trim()).filter(Boolean)
  const uname = String(req.user?.username||'')
  const match = (m) => {
    if (!m.to_role && !m.to_users) return true
    const roleOk = (!!m.to_role && (roles.includes(String(m.to_role)) || String(m.to_role)==='admin'))
    const userOk = (() => { try { const arr = String(m.to_users||'').split(',').map(s=>s.trim()).filter(Boolean); return arr.length ? arr.includes(uname) : false } catch { return false } })()
    return roleOk || userOk
  }
  if (MONGO_READY) {
    return mongoDb.collection('chat_messages').find({}).sort({ ts:-1, id:-1 }).limit(limit).toArray().then(rows => res.json(rows.reverse().filter(match))).catch(e => res.status(500).json({ message:'DB error', detail:e.message }))
  }
  if (!SQLITE_READY) return res.status(500).json({ message:'DB error', detail:'SQLite disabled' })
  db.all(`SELECT id, ts, from_user, to_role, to_users, text, ref_type, ref_id FROM chat_messages ORDER BY ts DESC, id DESC LIMIT ?`, [limit], (err, rows) => {
    if (err) return res.status(500).json({ message:'DB error', detail: err.message })
    res.json((rows||[]).reverse().filter(match))
  })
})
app.post('/chat', rateLimit(60_000, 20, 'chat_post'), requireAuth, (req, res) => {
  const { to_role, to, to_users, text, ref_type = null, ref_id = null } = req.body || {}
  const from_user = String(req.user?.username||'')
  if (!text) return res.status(400).json({ message:'Missing text' })
  const ts = new Date().toISOString()
  if (MONGO_READY) {
    nextId('chat_messages').then(id => {
      const toUsersCsv = Array.isArray(to_users) ? to_users.join(',') : (typeof to_users==='string' ? to_users : null)
      mongoDb.collection('chat_messages').insertOne({ id, ts, from_user, to_role: (to_role ?? to) || null, to_users: toUsersCsv, text, ref_type, ref_id }).then(() => {
        broadcastEvent('chat', { id, ts, from_user, to_role: (to_role ?? to) || null, to_users: (Array.isArray(to_users)?to_users:(toUsersCsv?String(toUsersCsv).split(',').map(s=>s.trim()).filter(Boolean):[])), text, ref_type, ref_id })
        res.json({ id })
      }).catch(e => res.status(500).json({ message:'DB error', detail:e.message }))
    })
    return
  }
  if (!SQLITE_READY) return res.status(500).json({ message:'DB error', detail:'SQLite disabled' })
  const toUsersCsv = Array.isArray(to_users) ? to_users.join(',') : (typeof to_users==='string' ? to_users : null)
  db.run(`INSERT INTO chat_messages (ts, from_user, to_role, to_users, text, ref_type, ref_id) VALUES (?,?,?,?,?,?,?)`, [ts, from_user, (to_role ?? to) || null, toUsersCsv, text, ref_type, ref_id], function (err) {
    if (err) return res.status(500).json({ message:'DB error', detail: err.message })
    const id = this.lastID
    broadcastEvent('chat', { id, ts, from_user, to_role: (to_role ?? to) || null, to_users: (Array.isArray(to_users)?to_users:(toUsersCsv?String(toUsersCsv).split(',').map(s=>s.trim()).filter(Boolean):[])), text, ref_type, ref_id })
    res.json({ id })
  })
})
app.get('/chat/users', requireAuth, (req, res) => {
  if (MONGO_READY) {
    return mongoDb.collection('users').find({}).project({ username:1, _id:0 }).sort({ username:1 }).toArray().then(rows => res.json(rows.map(r => r.username))).catch(e => res.status(500).json({ message:'DB error', detail:e.message }))
  }
  if (!SQLITE_READY) return res.status(500).json({ message:'DB error', detail:'SQLite disabled' })
  db.all(`SELECT username FROM users ORDER BY username ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ message:'DB error', detail: err.message })
    res.json(rows.map(r => r.username))
  })
})
app.get('/admin/backups', requireAdmin, (req, res) => {
  try { res.json(backupSqliteList()) } catch (e) { res.status(500).json({ message: 'Lỗi tải danh sách bản sao lưu', detail: e.message }) }
})
app.post('/admin/backup', requireAdmin, async (req, res) => {
  try { const name = MONGO_READY ? await backupMongoNow() : backupSqliteNow(); res.json({ name }) } catch (e) { res.status(500).json({ message: 'Lỗi tạo bản sao lưu', detail: e.message }) }
})
app.post('/admin/restore', requireAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Thiếu tên bản sao lưu' })
  try {
    if (String(name).endsWith('.json') && MONGO_READY) { await restoreMongo(String(name)); return res.json({ ok: true }) }
    restoreSqlite(String(name), (err) => { if (err) return res.status(500).json({ message: 'Khôi phục lỗi', detail: err.message }); res.json({ ok: true }) })
  } catch (e) { res.status(500).json({ message: 'Khôi phục lỗi', detail: e.message }) }
})

app.post('/admin/wipe', requireAdmin, async (req, res) => {
  const { confirm } = req.body || {}
  if (String(confirm || '').toUpperCase() !== 'DELETE') return res.status(400).json({ message: 'Missing confirm=DELETE' })
  const result = { cleared: [], files_removed: 0 }
  try {
    if (MONGO_READY) {
      const cols = await mongoDb.listCollections().toArray()
      await Promise.all(cols.map(c => mongoDb.collection(c.name).deleteMany({})))
      result.cleared = cols.map(c => c.name)
    } else if (SQLITE_READY) {
      const tables = ['sales','purchases','expenses','customers','suppliers','staff','finished_stock','chat_messages','security_logs']
      await new Promise((resolve) => db.serialize(() => { db.run('BEGIN'); tables.forEach(t => db.run(`DELETE FROM ${t}`)); db.run('COMMIT', resolve) }))
      result.cleared = tables
      try { await new Promise((resolve) => db.run('VACUUM', resolve)) } catch {}
    } else {
      return res.status(500).json({ message: 'No storage backend ready' })
    }
    try {
      if (!fs.existsSync(ENC_DIR)) fs.mkdirSync(ENC_DIR)
      const files = fs.readdirSync(ENC_DIR)
      for (const f of files) { try { fs.unlinkSync(path.join(ENC_DIR, f)) } catch {} }
      result.files_removed = files.length
    } catch {}
    auditLog('system', 0, 'wipe', req, result)
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ message: 'Wipe error', detail: e.message })
  }
})

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const qTok = (req.query && (req.query.token || req.query.t)) ? String(req.query.token || req.query.t) : null;
  const tok = m ? m[1] : qTok;
  if (!tok) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(tok, JWT_SECRET);
    const sid = String(payload?.sid||'');
    const uname = String(payload?.username||'');
    if (!sid || !uname) return res.status(401).json({ message: 'Unauthorized' });
    const proceed = () => { req.user = payload; next(); };
    if (MONGO_READY) {
      return mongoDb.collection('users').findOne({ username: uname }).then(u => {
        if (!u || String(u.session_id||'') !== sid) return res.status(401).json({ message: 'Unauthorized' });
        proceed();
      }).catch(() => res.status(401).json({ message: 'Unauthorized' }));
    }
    if (!SQLITE_READY) return res.status(401).json({ message: 'Unauthorized' });
    db.get(`SELECT session_id FROM users WHERE username = ?`, [uname], (err, row) => {
      if (err) return res.status(401).json({ message: 'Unauthorized' });
      if (!row || String(row.session_id||'') !== sid) return res.status(401).json({ message: 'Unauthorized' });
      proceed();
    });
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function hasRole(req, name) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : String(req.user?.role||'').split(',').map(s=>s.trim()).filter(Boolean)
  return roles.includes(String(name))
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!hasRole(req, 'admin')) return res.status(403).json({ message: 'Forbidden: admin required' });
    next();
  });
}

//

// Seed endpoint (local use)
app.get('/seed', async (req, res) => {
  if (!MONGO_READY) return res.status(500).json({ message: 'Mongo not connected' });
  try {
    const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0');
    const out = {}
    const insMany = async (col, docs) => { if (!docs.length) return; await mongoDb.collection(col).insertMany(docs); out[col] = docs.length }
    // Only seed if empty
    const need = async (col) => (await mongoDb.collection(col).countDocuments({})) === 0
    const next = async (col) => {
      const r = await mongoDb.collection('__counters').findOneAndUpdate({ _id: col }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
      return Number(r.value?.seq || 1);
    }
    if (await need('suppliers')) await insMany('suppliers', [
      { id: await next('suppliers'), name: 'Chị Hoa', phone: '0901 000 001', address: 'Bản A', note: '' },
      { id: await next('suppliers'), name: 'Anh Nam', phone: '0901 000 002', address: 'Bản B', note: '' },
    ])
    if (await need('customers')) await insMany('customers', [
      { id: await next('customers'), name: 'Lan', phone: '0902 000 001', address: '', note: '' },
      { id: await next('customers'), name: 'Phượng', phone: '0902 000 002', address: '', note: '' },
    ])
    if (await need('staff')) await insMany('staff', [
      { id: await next('staff'), name: 'Duyên', role: 'creator', phone: '0903 000 001', note: '' },
      { id: await next('staff'), name: 'Duy', role: 'seller', phone: '0903 000 002', note: '' },
    ])
    if (await need('purchases')) await insMany('purchases', [
      { id: await next('purchases'), purchase_date: `${y}-${m}-02`, supplier_name: 'Chị Hoa', weight: 100, unit_price: 5000, water_percent: 10, net_weight: 90, payment_status: 'paid', ticket_name: 'Tien Hue 1', total_cost: 450000 },
      { id: await next('purchases'), purchase_date: `${y}-${m}-05`, supplier_name: 'Anh Nam', weight: 90, unit_price: 5000, water_percent: 5, net_weight: 85.5, payment_status: 'paid', ticket_name: 'Tien Hue 2', total_cost: 427500 },
      { id: await next('purchases'), purchase_date: `${y}-${m}-09`, supplier_name: 'Chị Hoa', weight: 120, unit_price: 5000, water_percent: 8, net_weight: 110.4, payment_status: 'paid', ticket_name: 'Tien Hue 3', total_cost: 552000 },
    ])
    if (await need('sales')) await insMany('sales', [
      { id: await next('sales'), sale_date: `${y}-${m}-13`, customer_name: 'Lan', tea_type: 'Chè thô', price_per_kg: 20000, weight: 5, payment_status: 'paid', ticket_name: 'Phieu Xuat 1', contract: 'Không', created_by: 'Duyên', issued_by: 'Duy', total_amount: 100000 },
      { id: await next('sales'), sale_date: `${y}-${m}-16`, customer_name: 'Phượng', tea_type: 'Chè thô', price_per_kg: 20000, weight: 5, payment_status: 'paid', ticket_name: 'Phieu Xuat 2', contract: 'Không', created_by: 'Duyên', issued_by: 'Duy', total_amount: 100000 },
      { id: await next('sales'), sale_date: `${y}-${m}-20`, customer_name: 'Lan', tea_type: 'Chè thô', price_per_kg: 20000, weight: 5, payment_status: 'paid', ticket_name: 'Phieu Xuat 3', contract: 'Không', created_by: 'Duyên', issued_by: 'Duy', total_amount: 100000 },
    ])
    if (await need('expenses')) await insMany('expenses', [
      { id: await next('expenses'), expense_date: `${y}-${m}-10`, description: 'Tiền điện', amount: 300000, category: 'Utility' },
      { id: await next('expenses'), expense_date: `${y}-${m}-18`, description: 'Sửa máy', amount: 500000, category: 'Repair' },
    ])
    res.json({ message: 'Seeded', inserted: out })
  } catch (e) {
    res.status(500).json({ message: 'DB error', detail: e.message })
  }
})

app.delete('/admin/wipe', requireAdmin, async (req, res) => {
  try {
    if (MONGO_READY) {
      await Promise.all([
        mongoDb.collection('sales').deleteMany({}),
        mongoDb.collection('purchases').deleteMany({}),
        mongoDb.collection('expenses').deleteMany({})
      ])
    }
    await new Promise((resolve, reject) => db.run('DELETE FROM sales', [], (e) => e ? reject(e) : resolve()))
    await new Promise((resolve, reject) => db.run('DELETE FROM purchases', [], (e) => e ? reject(e) : resolve()))
    await new Promise((resolve, reject) => db.run('DELETE FROM expenses', [], (e) => e ? reject(e) : resolve()))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'DB error', detail: e.message })
  }
})

// duplicate simple wipe endpoint removed; use the enhanced /admin/wipe above

// Auth endpoints
app.post('/auth/login', rateLimit(60_000, 5, 'login'), (req, res) => {
  const b = req.body || {};
  const q = req.query || {};
  const username = b.username ?? q.username ?? b.u ?? q.u;
  const password = b.password ?? q.password ?? b.p ?? q.p;
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
  const ua = String(req.headers['user-agent'] || '');
  if (!username || !password) return res.status(400).json({ message: 'Missing username/password' });
  if (MONGO_READY) {
    return mongoDb.collection('users').findOne({ username }).then(row => {
      if (!row) return res.status(401).json({ message: 'Invalid credentials' });
      const ok = bcrypt.compareSync(password, row.password_hash || '');
      if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
      const roles = Array.isArray(row.role) ? row.role : String(row.role || 'user').split(',').map(s=>s.trim()).filter(Boolean);
      if (roles.includes('user_disabled') || roles.includes('disabled')) return res.status(403).json({ message: 'Account disabled' })
      const sid = crypto.randomBytes(16).toString('hex');
      mongoDb.collection('users').updateOne({ id: row.id }, { $set: { session_id: sid } }).catch(()=>{})
      const token = jwt.sign({ uid: row.id, username: row.username, roles, sid }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, roles });
      mongoDb.collection('security_logs').insertOne({ ts: new Date().toISOString(), username, success: 1, ip, ua, city: '', note: 'login' }).catch(()=>{})
    }).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get(`SELECT id, username, password_hash, role FROM users WHERE username = ?`, [username], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (!row) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const roles = String(row.role || 'user').split(',').map(s=>s.trim()).filter(Boolean);
    if (roles.includes('user_disabled') || roles.includes('disabled')) return res.status(403).json({ message: 'Account disabled' })
    const sid = crypto.randomBytes(16).toString('hex');
    db.run(`UPDATE users SET session_id = ? WHERE id = ?`, [sid, row.id], () => {});
    const token = jwt.sign({ uid: row.id, username: row.username, roles, sid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, roles });
    db.run(`INSERT INTO security_logs (ts, username, success, ip, ua, city, note) VALUES (?,?,?,?,?,?,?)`, [new Date().toISOString(), username, 1, ip, ua, '', 'login'], () => {})
  });
});

app.post('/auth/change-password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ message: 'Missing old/new password' });
  if (MONGO_READY) {
    return mongoDb.collection('users').findOne({ id: Number(req.user.uid) }).then(row => {
      if (!row) return res.status(404).json({ message: 'User not found' });
      const ok = bcrypt.compareSync(old_password, row.password_hash || '');
      if (!ok) return res.status(401).json({ message: 'Invalid old password' });
      const hash = bcrypt.hashSync(String(new_password), 10);
      mongoDb.collection('users').updateOne({ id: Number(req.user.uid) }, { $set: { password_hash: hash } }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get(`SELECT id, password_hash FROM users WHERE id = ?`, [req.user.uid], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (!row) return res.status(404).json({ message: 'User not found' });
    const ok = bcrypt.compareSync(old_password, row.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'Invalid old password' });
    const hash = bcrypt.hashSync(String(new_password), 10);
    db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user.uid], function(e){
      if (e) return res.status(500).json({ message: 'DB error', detail: e.message });
      res.json({ changed: this.changes });
    });
  });
});

// Users & Roles management (admin only)
app.get('/users', requireAdmin, (req, res) => {
  if (MONGO_READY) {
    return mongoDb.collection('users').find({}).sort({ username: 1, id: 1 }).toArray().then(rows => {
      res.json(rows.map(r => ({ id: r.id, username: r.username, role: r.role || 'user' })));
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.all(`PRAGMA table_info(users)`, [], (e, cols) => {
    if (e) return res.status(500).json({ message: 'DB error', detail: e.message });
    const hasRole = cols?.some(r => r.name === 'role');
    const sql = hasRole ? `SELECT id, username, role FROM users ORDER BY username ASC` : `SELECT id, username FROM users ORDER BY username ASC`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      const data = rows.map(r => ({ id: r.id, username: r.username, role: hasRole ? (r.role || 'user') : 'user' }));
      res.json(data);
    });
  });
});

app.post('/users', requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Missing username/password' });
  const hash = bcrypt.hashSync(String(password), 10);
  if (MONGO_READY) {
    return mongoDb.collection('users').findOne({ username }).then(exists => {
      if (exists) return res.status(409).json({ message: 'Username already exists' });
      nextId('users').then(id => {
        mongoDb.collection('users').insertOne({ id, username, password_hash: hash, role }).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
      });
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.all(`PRAGMA table_info(users)`, [], (e, cols) => {
    if (e) return res.status(500).json({ message: 'DB error', detail: e.message });
    const hasUsername = cols?.some(r => r.name === 'username');
    const hasPwd = cols?.some(r => r.name === 'password_hash');
    const hasRole = cols?.some(r => r.name === 'role');
    const insertCols = [];
    const insertVals = [];
    if (hasUsername) { insertCols.push('username'); insertVals.push(username); }
    if (hasPwd) { insertCols.push('password_hash'); insertVals.push(hash); }
    if (hasRole) { insertCols.push('role'); insertVals.push(role); }
    if (!insertCols.length) return res.status(500).json({ message: 'DB error', detail: 'users table missing required columns' });
    const placeholders = insertCols.map(() => '?').join(',');
    const sql = `INSERT INTO users (${insertCols.join(',')}) VALUES (${placeholders})`;
    db.run(sql, insertVals, function(err){
      if (err) {
        const msg = String(err.message || '');
        if (/UNIQUE constraint failed: users\.username/i.test(msg)) {
          return res.status(409).json({ message: 'Username already exists', detail: err.message });
        }
        return res.status(500).json({ message: 'DB error', detail: err.message });
      }
      res.json({ id: this.lastID });
    });
  });
});

app.put('/users/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { username, role, roles } = req.body || {};
  const roleStr = Array.isArray(roles) ? roles.join(',') : (role || null);
  if (MONGO_READY) {
    const upd = {};
    if (username != null) upd.username = String(username);
    if (roleStr != null) upd.role = roleStr;
    const doUpdate = () => mongoDb.collection('users').updateOne({ id: Number(id) }, { $set: upd }, { upsert: false }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    if (username != null) {
      return mongoDb.collection('users').findOne({ username: String(username), id: { $ne: Number(id) } }).then(ex => {
        if (ex) return res.status(409).json({ message: 'Username already exists' });
        doUpdate();
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    return doUpdate();
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const fields = []; const params = [];
  if (username != null) { fields.push('username = ?'); params.push(String(username)); }
  if (roleStr != null) { fields.push('role = ?'); params.push(roleStr); }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
  params.push(Number(id));
  db.run(sql, params, function (err) {
    if (err) {
      const msg = String(err.message || '');
      if (/UNIQUE constraint failed: users\.username/i.test(msg)) {
        return res.status(409).json({ message: 'Username already exists', detail: err.message });
      }
      return res.status(500).json({ message: 'DB error', detail: err.message });
    }
    res.json({ changed: this.changes });
  });
});

app.delete('/users/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const username = req.query && req.query.username ? String(req.query.username) : null;
  if (SQLITE_READY) {
    return db.run(`DELETE FROM users WHERE id = ?`, [Number(id)], function (err) {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      if ((this.changes || 0) === 0 && username) {
        return db.run(`DELETE FROM users WHERE username = ?`, [username], function (e2) {
          if (e2) return res.status(500).json({ message: 'DB error', detail: e2.message });
          if ((this.changes || 0) === 0) {
            return db.run(`UPDATE users SET role = 'user_disabled' WHERE username = ?`, [username], function (e3) {
              if (e3) return res.status(500).json({ message: 'DB error', detail: e3.message });
              return res.json({ deleted: 1, disabled: 1 });
            })
          }
          return res.json({ deleted: this.changes });
        });
      }
      res.json({ deleted: this.changes });
    });
  }
  if (MONGO_READY) {
    const filter = { id: Number(id) };
    return mongoDb.collection('users').deleteOne(filter).then(async (r) => {
      if ((r.deletedCount || 0) === 0 && username) {
        const r2 = await mongoDb.collection('users').deleteOne({ username });
        if ((r2.deletedCount || 0) === 0) {
          await mongoDb.collection('users').updateOne({ username }, { $set: { role: 'user_disabled' } });
          return res.json({ deleted: 1, disabled: 1 });
        }
        return res.json({ deleted: r2.deletedCount || 0 });
      }
      res.json({ deleted: r.deletedCount || 0 });
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' });
});

app.put('/users/:id/password', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { new_password } = req.body;
  if (!new_password) return res.status(400).json({ message: 'Missing new_password' });
  const hash = bcrypt.hashSync(String(new_password), 10);
  if (MONGO_READY) {
    return mongoDb.collection('users').updateOne({ id: Number(id) }, { $set: { password_hash: hash } }, { upsert: true }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, id], function(err){
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ changed: this.changes });
  });
});
app.post('/admin/fix-owners', requireAdmin, async (req, res) => {
  try {
    const out = { sales_sqlite: 0, sales_mongo: 0 };
    if (SQLITE_READY) {
      await new Promise((resolve, reject) => {
        db.run(`UPDATE sales SET owner = created_by WHERE owner IS NULL AND created_by IS NOT NULL`, [], function(err){
          if (err) return reject(err); out.sales_sqlite = this.changes || 0; resolve();
        });
      })
    }
    if (MONGO_READY) {
      const docs = await mongoDb.collection('sales').find({ $or: [{ owner: { $exists: false } }, { owner: null }] , created_by: { $exists: true, $ne: null } }).toArray()
      for (const d of docs) { await mongoDb.collection('sales').updateOne({ id: d.id }, { $set: { owner: d.created_by } }) }
      out.sales_mongo = docs.length
    }
    res.json(out)
  } catch (e) {
    res.status(500).json({ message: 'Fix owners failed', detail: e.message })
  }
})
app.post('/admin/assign-owner', requireAdmin, (req, res) => {
  const { type, id, owner } = req.body || {};
  if (!['sales','purchases','expenses'].includes(String(type))) return res.status(400).json({ message: 'Invalid type' });
  if (!id || !owner) return res.status(400).json({ message: 'Missing id/owner' });
  if (MONGO_READY) {
    return mongoDb.collection(type).updateOne({ id: Number(id) }, { $set: { owner: String(owner) } })
      .then(() => res.json({ changed: 1 }))
      .catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.run(`UPDATE ${type} SET owner = ? WHERE id = ?`, [String(owner), Number(id)], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ changed: this.changes });
  })
});
function ensureFixedExpenses(month, year) {
  const m = String(month).padStart(2,'0');
  const y = String(year);
  if (MONGO_READY) {
    return mongoDb.collection('expense_templates').find({ active: { $ne: 0 } }).toArray().then(async (templates) => {
      for (const t of templates) {
        const exists = await mongoDb.collection('expenses').findOne({ template_id: t.id, expense_date: { $regex: `^${y}-${m}` } })
        if (!exists) {
          const day = t.day_of_month && t.day_of_month >=1 && t.day_of_month <=31 ? String(t.day_of_month).padStart(2,'0') : '01';
          await mongoDb.collection('expenses').insertOne({
            id: await nextId('expenses'),
            expense_date: `${y}-${m}-${day}`,
            description: t.description,
            amount: Number(t.amount || 0),
            category: t.category || 'Định phí',
            owner: t.owner || null,
            template_id: t.id
          })
        }
      }
    })
  }
  if (!SQLITE_READY) return Promise.resolve();
  return new Promise((resolve) => {
    db.all(`SELECT * FROM expense_templates WHERE active != 0`, [], (err, templates) => {
      if (err) return resolve();
      const runNext = (i) => {
        if (i >= templates.length) return resolve();
        const t = templates[i];
        db.get(`SELECT id FROM expenses WHERE template_id = ? AND strftime('%m', expense_date)=? AND strftime('%Y', expense_date)=?`, [t.id, m, y], (e2, row) => {
          if (!row) {
            const day = t.day_of_month && t.day_of_month >=1 && t.day_of_month <=31 ? String(t.day_of_month).padStart(2,'0') : '01';
            const dateStr = `${y}-${m}-${day}`;
            db.run(`INSERT INTO expenses (expense_date, description, amount, category, owner, template_id) VALUES (?,?,?,?,?,?)`, [dateStr, t.description, Number(t.amount || 0), t.category || 'Định phí', t.owner || null, t.id], () => runNext(i+1));
          } else { runNext(i+1) }
        })
      }
      runNext(0)
    })
  })
}
// Admin: manage fixed expense templates
app.get('/admin/expense-templates', requireAdmin, (req, res) => {
  if (MONGO_READY) {
    return mongoDb.collection('expense_templates').find({}).sort({ id: 1 }).toArray().then(r => res.json(r)).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.all(`SELECT id, description, amount, category, day_of_month, owner, active FROM expense_templates ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  })
})
app.post('/admin/expense-templates', requireAdmin, (req, res) => {
  const { description, amount, category = 'Định phí', day_of_month = 1, owner = null, active = 1 } = req.body || {};
  if (!description || amount == null) return res.status(400).json({ message: 'Missing description/amount' });
  if (MONGO_READY) {
    return nextId('expense_templates').then(id => mongoDb.collection('expense_templates').insertOne({ id, description, amount: Number(amount), category, day_of_month: Number(day_of_month), owner, active: Number(active) })).then(()=> res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.run(`INSERT INTO expense_templates (description, amount, category, day_of_month, owner, active) VALUES (?,?,?,?,?,?)`, [description, Number(amount), category, Number(day_of_month), owner, Number(active)], function(err){
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ id: this.lastID })
  })
})
app.put('/admin/expense-templates/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { description, amount, category, day_of_month, owner, active } = req.body || {};
  if (MONGO_READY) {
    const set = {}; if (description != null) set.description = description; if (amount != null) set.amount = Number(amount); if (category != null) set.category = category; if (day_of_month != null) set.day_of_month = Number(day_of_month); if (owner != null) set.owner = owner; if (active != null) set.active = Number(active);
    return mongoDb.collection('expense_templates').updateOne({ id }, { $set: set }, { upsert: false }).then(()=> res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  const fields = []; const params = [];
  if (description != null) { fields.push('description = ?'); params.push(description) }
  if (amount != null) { fields.push('amount = ?'); params.push(Number(amount)) }
  if (category != null) { fields.push('category = ?'); params.push(category) }
  if (day_of_month != null) { fields.push('day_of_month = ?'); params.push(Number(day_of_month)) }
  if (owner != null) { fields.push('owner = ?'); params.push(owner) }
  if (active != null) { fields.push('active = ?'); params.push(Number(active)) }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  params.push(id);
  db.run(`UPDATE expense_templates SET ${fields.join(', ')} WHERE id = ?`, params, function(err){
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ changed: this.changes })
  })
})
app.delete('/admin/expense-templates/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (MONGO_READY) {
    return mongoDb.collection('expense_templates').deleteOne({ id }).then(()=> res.json({ deleted: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  db.run(`DELETE FROM expense_templates WHERE id = ?`, [id], function(err){
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ deleted: this.changes })
  })
})
app.delete('/users', requireAdmin, (req, res) => {
  const id = req.query && req.query.id ? Number(req.query.id) : null;
  const username = req.query && req.query.username ? String(req.query.username) : null;
  if (!id && !username) return res.status(400).json({ message: 'Missing id/username' });
  if (MONGO_READY) {
    const filter = id ? { id } : { username };
    return mongoDb.collection('users').deleteOne(filter).then(r => res.json({ deleted: r.deletedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const sql = id ? `DELETE FROM users WHERE id = ?` : `DELETE FROM users WHERE username = ?`;
  const val = id ? id : username;
  db.run(sql, [val], function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json({ deleted: this.changes });
  })
});

app.post('/admin/users/delete', requireAdmin, (req, res) => {
  const { id, username } = req.body || {}
  if (!id && !username) return res.status(400).json({ message: 'Missing id/username' })
  if (SQLITE_READY) {
    const doResp = (deleted, disabled) => res.json({ deleted, disabled })
    const tryById = () => db.run(`DELETE FROM users WHERE id = ?`, [Number(id)], function (err) {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      if ((this.changes || 0) === 0 && username) {
        return db.run(`DELETE FROM users WHERE username = ?`, [String(username)], function (e2) {
          if (e2) return res.status(500).json({ message: 'DB error', detail: e2.message })
          if ((this.changes || 0) === 0) {
            return db.run(`UPDATE users SET role = 'user_disabled' WHERE username = ?`, [String(username)], function (e3) {
              if (e3) return res.status(500).json({ message: 'DB error', detail: e3.message })
              return doResp(1, 1)
            })
          }
          return doResp(this.changes, 0)
        })
      }
      return doResp(this.changes, 0)
    })
    if (id) return tryById();
    return db.run(`DELETE FROM users WHERE username = ?`, [String(username)], function (err) {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      if ((this.changes || 0) === 0) {
        return db.run(`UPDATE users SET role = 'user_disabled' WHERE username = ?`, [String(username)], function (e3) {
          if (e3) return res.status(500).json({ message: 'DB error', detail: e3.message })
          return res.json({ deleted: 1, disabled: 1 })
        })
      }
      return res.json({ deleted: this.changes, disabled: 0 })
    })
  }
  if (MONGO_READY) {
    const doResp = (deleted, disabled) => res.json({ deleted, disabled })
    const tryById = () => mongoDb.collection('users').deleteOne({ id: Number(id) }).then(async (r) => {
      if ((r.deletedCount || 0) === 0 && username) {
        const r2 = await mongoDb.collection('users').deleteOne({ username: String(username) })
        if ((r2.deletedCount || 0) === 0) {
          await mongoDb.collection('users').updateOne({ username: String(username) }, { $set: { role: 'user_disabled' } })
          return doResp(1, 1)
        }
        return doResp(r2.deletedCount || 0, 0)
      }
      return doResp(r.deletedCount || 0, 0)
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
    if (id) return tryById();
    return mongoDb.collection('users').deleteOne({ username: String(username) }).then(async (r) => {
      if ((r.deletedCount || 0) === 0) {
        await mongoDb.collection('users').updateOne({ username: String(username) }, { $set: { role: 'user_disabled' } })
        return doResp(1, 1)
      }
      return doResp(r.deletedCount || 0, 0)
    }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
  }
  return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' })
})
app.put('/users/:id/password', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const { new_password } = req.body || {}
  if (!new_password) return res.status(400).json({ message: 'Missing new_password' })
  const hash = bcrypt.hashSync(String(new_password), 10)
  if (SQLITE_READY) {
    return db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, id], function (err) {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message })
      res.json({ changed: this.changes })
    })
  }
  if (MONGO_READY) {
    return mongoDb.collection('users').updateOne({ id }, { $set: { password_hash: hash } }).then(r => res.json({ changed: r.modifiedCount || 0 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
  }
  return res.status(500).json({ message: 'DB error', detail: 'No storage backend ready' })
})
function verifyToken(token) {
  try { return jwt.verify(String(token||''), JWT_SECRET) } catch { return null }
}
const sseClients = []
function broadcastEvent(event, data) {
  try {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    sseClients.forEach(c => { try { c.res.write(payload) } catch {} })
  } catch {}
}
// (license feature removed)
function simpleBotReply(text) {
  const msg = String(text||'').trim().toLowerCase()
  if (!msg) return 'Bạn cần hỏi gì? Ví dụ: "Hướng dẫn nhập đơn"'
  const intents = [
    { k: ['help','trợ giúp','hướng dẫn'], r: 'Các mục chính: Tổng quan, Bán, Nhập, Chi phí, Công nợ, Ảnh hóa đơn. Bạn muốn làm gì?' },
    { k: ['bán','đơn bán','thêm bán'], r: 'Mở tab Bán chè, điền Ngày/Khách hàng/Giá/kg/Cân nặng và bấm "Thêm đơn bán".' },
    { k: ['nhập','đơn nhập','thêm nhập'], r: 'Mở tab Nhập chè, điền Ngày/Nhà cung cấp/Giá/kg/Cân nặng và bấm "Thêm đơn nhập".' },
    { k: ['chi phí','thêm chi'], r: 'Vào tab Chi phí, nhập Ngày/Mô tả/Số tiền/Loại, bấm "Thêm chi phí". Có thể đính kèm ảnh.' },
    { k: ['ảnh','hóa đơn','bill','receipt'], r: 'Mở tab "Ảnh hóa đơn" để xem hoặc tìm theo Số HĐ, tháng/năm.' },
    { k: ['công nợ','nợ','phải thu','phải trả'], r: 'Xem mục Công nợ để theo dõi phải thu/phải trả theo thời gian.' },
  ]
  for (const it of intents) {
    if (it.k.some(w => msg.includes(w))) return it.r
  }
  return 'Chưa hiểu yêu cầu. Bạn có thể hỏi: "Hướng dẫn nhập đơn", "Xem ảnh hóa đơn", "Thêm chi phí".'
}
async function findByAmount(msg){
  if (!SQLITE_READY) return { reply:'DB chưa sẵn sàng', actions:[] }
  const s = String(msg||'')
  const isSales = /\b(đơn bán|bán|thu)\b/i.test(s)
  const isPurch = /\b(đơn nhập|nhập)\b/i.test(s)
  const opM = s.match(/(>|<|>=|<=)\s*(\d+[\.,]?\d*)\s*(triệu|\bt\b|vnd|đ|vnđ)?/i)
  if (!opM) return { reply:'Câu lệnh số tiền chưa rõ. Ví dụ: "đơn bán > 20 triệu tháng 11"', actions:[] }
  const op = opM[1]
  const val = Number(opM[2].replace(',','.')) * (/triệu|\bt\b/i.test(opM[3]||'') ? 1_000_000 : 1)
  const { m, y } = detectMonthYear(s)
  const mm = pad2(m); const yy = String(y)
  const cmp = (op) => (op==='>'?' > ':(op==='>='?' >= ':(op==='<')?' < ': (op==='<=')?' <= ':' > '))
  const out = []
  if (isSales) {
    const sql = `SELECT id, sale_date AS d, customer_name AS name, (price_per_kg * weight) AS v FROM sales WHERE strftime('%m', sale_date)=? AND strftime('%Y', sale_date)=? AND (price_per_kg * weight) ${cmp(op)} ? ORDER BY v DESC LIMIT 10`
    return new Promise((resolve)=> db.all(sql, [mm, yy, val], (e, rows)=> {
      (rows||[]).forEach(r => out.push({ type:'sales', id:r.id, label:`${r.name||'-'} ${Number(r.v||0).toLocaleString()}` }))
      const actions = out.map(x => ({ type:'navigate', tab:'sales', label:`Mở đơn ${x.type} #${x.id} • ${x.label}` }))
      resolve({ reply:`Có ${out.length} đơn bán thỏa điều kiện`, actions })
    }))
  }
  if (isPurch) {
    const sql = `SELECT id, purchase_date AS d, supplier_name AS name, (unit_price * COALESCE(net_weight, weight)) AS v FROM purchases WHERE strftime('%m', purchase_date)=? AND strftime('%Y', purchase_date)=? AND (unit_price * COALESCE(net_weight, weight)) ${cmp(op)} ? ORDER BY v DESC LIMIT 10`
    return new Promise((resolve)=> db.all(sql, [mm, yy, val], (e, rows)=> {
      (rows||[]).forEach(r => out.push({ type:'purchases', id:r.id, label:`${r.name||'-'} ${Number(r.v||0).toLocaleString()}` }))
      const actions = out.map(x => ({ type:'navigate', tab:'purchases', label:`Mở đơn ${x.type} #${x.id} • ${x.label}` }))
      resolve({ reply:`Có ${out.length} đơn nhập thỏa điều kiện`, actions })
    }))
  }
  return { reply:'Cần chỉ rõ Bán hay Nhập. Ví dụ: "đơn bán > 20 triệu tháng 11"', actions:[] }
}
async function parseUpdateSale(s){
  const m = s.match(/#?(\d+)/); const id = m ? Number(m[1]) : 0; if (!id) return null
  const priceM = s.match(/giá\s*\/kg\s*(\d+[\.,]?\d*)\s*(k|nghìn|ngàn|vnd|đ|vnđ)?/i)
  const weightM = s.match(/cân\s*(\d+[\.,]?\d*)/i)
  const custM = s.match(/khách\s*hàng\s+([a-zA-Z0-9À-ỹ\s]+)/i)
  const teaM = s.match(/loại\s+([a-zA-Z0-9À-ỹ\s]+)/i)
  const payload = { id }
  if (priceM) { const val = Number(String(priceM[1]).replace(',','.')); const scale = /k|nghìn|ngàn/i.test(priceM[2]||'') ? 1000 : 1; payload.price_per_kg = val*scale }
  if (weightM) { payload.weight = Number(String(weightM[1]).replace(',','.')) }
  if (custM) { payload.customer_name = custM[1].trim() }
  if (teaM) { payload.tea_type = teaM[1].trim() }
  if (Object.keys(payload).length<=1) return null
  return { reply:`Sửa đơn bán #${id}?`, actions:[{ type:'function_call', name:'update_sale', args: payload, label:'Xác nhận sửa' }] }
}
async function parseUpdatePurchase(s){
  const m = s.match(/#?(\d+)/); const id = m ? Number(m[1]) : 0; if (!id) return null
  const priceM = s.match(/(đơn\s*giá|giá)\s*\/kg\s*(\d+[\.,]?\d*)\s*(k|nghìn|ngàn|vnd|đ|vnđ)?/i)
  const weightM = s.match(/cân\s*(\d+[\.,]?\d*)/i)
  const supM = s.match(/(ncc|nhà\s*cung\s*cấp)\s+([a-zA-Z0-9À-ỹ\s]+)/i)
  const payload = { id }
  if (priceM) { const val = Number(String(priceM[2]).replace(',','.')); const scale = /k|nghìn|ngàn/i.test(priceM[3]||'') ? 1000 : 1; payload.unit_price = val*scale }
  if (weightM) { payload.weight = Number(String(weightM[1]).replace(',','.')) }
  if (supM) { payload.supplier_name = supM[2].trim() }
  if (Object.keys(payload).length<=1) return null
  return { reply:`Sửa đơn nhập #${id}?`, actions:[{ type:'function_call', name:'update_purchase', args: payload, label:'Xác nhận sửa' }] }
}
async function parseSetInvoice(s){
  const invM = s.match(/(số\s*hđ|invoice)\s*([a-zA-Z0-9\-\/_]+)/i)
  const idM = s.match(/#?(\d+)/)
  if (!invM || !idM) return null
  const invoice_no = invM[2]
  const id = Number(idM[1])
  if (/đơn\s*bán|bán/.test(s.toLowerCase())) return { reply:`Gán Số HĐ ${invoice_no} cho đơn bán #${id}?`, actions:[{ type:'function_call', name:'update_sale', args:{ id, invoice_no }, label:'Xác nhận' }] }
  if (/đơn\s*nhập|nhập/.test(s.toLowerCase())) return { reply:`Gán Số HĐ ${invoice_no} cho đơn nhập #${id}?`, actions:[{ type:'function_call', name:'update_purchase', args:{ id, invoice_no }, label:'Xác nhận' }] }
  return null
}
async function findMissingInvoice(s){
  const mM = s.match(/tháng\s*(\d{1,2})/i); const yM = s.match(/năm\s*(\d{4})/i)
  const m = mM ? String(mM[1]).padStart(2,'0') : null
  const y = yM ? String(yM[1]) : null
  const salesRows = await new Promise((resolve)=> db.all(`SELECT id, ticket_name, COALESCE(invoice_no,'') AS invoice_no, sale_date AS d, receipt_path FROM sales WHERE receipt_path IS NOT NULL AND (invoice_no IS NULL OR invoice_no='') ${m?" AND strftime('%m', sale_date)=?":""} ${y?" AND strftime('%Y', sale_date)=?":""} ORDER BY d DESC LIMIT 10`, [m,y].filter(Boolean), (e,r)=> resolve(r||[])))
  const purchRows = await new Promise((resolve)=> db.all(`SELECT id, ticket_name, COALESCE(invoice_no,'') AS invoice_no, purchase_date AS d, receipt_path FROM purchases WHERE receipt_path IS NOT NULL AND (invoice_no IS NULL OR invoice_no='') ${m?" AND strftime('%m', purchase_date)=?":""} ${y?" AND strftime('%Y', purchase_date)=?":""} ORDER BY d DESC LIMIT 10`, [m,y].filter(Boolean), (e,r)=> resolve(r||[])))
  const actions = []
  salesRows.forEach(r => { actions.push({ type:'open_url', path:`/api/sales/${r.id}/receipt`, label:`Ảnh bán #${r.id}` }) })
  purchRows.forEach(r => { actions.push({ type:'open_url', path:`/api/purchases/${r.id}/receipt`, label:`Ảnh nhập #${r.id}` }) })
  const reply = `Có ${salesRows.length} ảnh đơn bán và ${purchRows.length} ảnh đơn nhập thiếu Số HĐ${m?` tháng ${Number(m)}`:''}${y?`/${y}`:''}.`
  return { reply, actions }
}
async function compareMonths(s){
  const mm = s.match(/tháng\s*(\d{1,2}).*vs.*tháng\s*(\d{1,2})/i)
  const now = new Date(); const y = now.getFullYear();
  const m1 = mm ? Number(mm[1]) : (now.getMonth()+1)
  const m2 = mm ? Number(mm[2]) : (m1>1 ? m1-1 : 12)
  const y2 = (m1>1) ? y : (y-1)
  const pad2 = (n)=> String(n).padStart(2,'0')
  const qSales = async (m,y)=> new Promise((resolve)=> db.get(`SELECT COALESCE(SUM(price_per_kg*weight),0) AS s FROM sales WHERE strftime('%m', sale_date)=? AND strftime('%Y', sale_date)=?`, [pad2(m), String(y)], (e,r)=> resolve(Number((r&&r.s)||0))))
  const qPurch = async (m,y)=> new Promise((resolve)=> db.get(`SELECT COALESCE(SUM(unit_price*COALESCE(net_weight,weight)),0) AS p FROM purchases WHERE strftime('%m', purchase_date)=? AND strftime('%Y', purchase_date)=?`, [pad2(m), String(y)], (e,r)=> resolve(Number((r&&r.p)||0))))
  const qExp = async (m,y)=> new Promise((resolve)=> db.get(`SELECT COALESCE(SUM(amount),0) AS e FROM expenses WHERE strftime('%m', expense_date)=? AND strftime('%Y', expense_date)=?`, [pad2(m), String(y)], (e,r)=> resolve(Number((r&&r.e)||0))))
  const [s1,p1,e1] = await Promise.all([qSales(m1,y), qPurch(m1,y), qExp(m1,y)])
  const [s2,p2,e2] = await Promise.all([qSales(m2,y2), qPurch(m2,y2), qExp(m2,y2)])
  const l1 = s1 - p1 - e1
  const l2 = s2 - p2 - e2
  const diff = (a,b)=> a-b
  const fmt = (n)=> (Math.round(n)||0).toLocaleString()
  const reply = `Tháng ${m1}/${y}: Thu ${fmt(s1)}, Chi nhập ${fmt(p1)}, Chi phí ${fmt(e1)}, Lãi ${fmt(l1)}. So với tháng ${m2}/${y2}: Thu ${fmt(diff(s1,s2))}, Chi nhập ${fmt(diff(p1,p2))}, Chi phí ${fmt(diff(e1,e2))}, Lãi ${fmt(diff(l1,l2))}.`
  const actions = [
    { type:'navigate', tab:'sales', label:`Mở Thu tháng ${m1}` },
    { type:'navigate', tab:'purchases', label:`Mở Nhập tháng ${m1}` },
    { type:'navigate', tab:'expenses', label:`Mở Chi phí tháng ${m1}` }
  ]
  return { reply, actions }
}
