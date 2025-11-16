const express = require('express');
const cors = require('cors');
let sqlite3 = null;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let db = null;
let SQLITE_READY = false;
try {
  sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database('data.db');
  SQLITE_READY = true;
} catch (e) {
  console.warn('SQLite disabled:', e.message);
}
let SALES_HAS_TOTAL_AMOUNT = false;
let PURCHASES_HAS_TOTAL_COST = false;
if (SQLITE_READY) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
}

let MONGO_READY = false;
let mongoDb = null;
let MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
let MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'quanlyche';
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

const VARIABLE_EXPENSE_CATEGORIES = ['Utility','Electricity','Fuel','Wood','Coal','Gas','Wage','Salary','Labor'];
const FIXED_EXPENSE_CATEGORIES = ['Depreciation','Interest','Loan Interest','Bank Interest','Amortization','Repair'];

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
    category TEXT
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
    note TEXT
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
              db.run(`ALTER TABLE users_new RENAME TO users`, [], () => {
                console.log('Users table migrated');
              });
            });
          });
        });
      }
    }
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
      ensureCol('contract', `ALTER TABLE sales ADD COLUMN contract TEXT`);
      ensureCol('created_by', `ALTER TABLE sales ADD COLUMN created_by TEXT`);
      ensureCol('issued_by', `ALTER TABLE sales ADD COLUMN issued_by TEXT`);

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
              db.run(`ALTER TABLE sales_new RENAME TO sales`, [], () => {
                console.log('Sales table migrated successfully');
                SALES_HAS_TOTAL_AMOUNT = false; // New schema has no total_amount column
              });
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
              db.run(`ALTER TABLE purchases_new RENAME TO purchases`, [], () => {
                console.log('Purchases table migrated successfully');
                PURCHASES_HAS_TOTAL_COST = false; // new schema has no total_cost column
              });
            });
          });
        });
      }
    }
  });
});

function pad2(n) { return String(n).padStart(2, '0'); }

// Sales endpoints
app.get('/sales', (req, res) => {
  const { month, year, payment_status } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const filter = {};
    if (month && year) filter.sale_date = { $regex: `^${y}-${m}` };
    if (payment_status && payment_status !== 'all') filter.payment_status = payment_status;
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
        contract: r.contract || null,
        created_by: r.created_by || null,
        issued_by: r.issued_by || null,
        total_amount: Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg || 0) * Number(r.weight || 0)))
      })))).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const where = [];
  const params = [];
  if (month && year) {
    where.push("strftime('%m', sale_date) = ?"); params.push(pad2(month));
    where.push("strftime('%Y', sale_date) = ?"); params.push(String(year));
  }
  if (payment_status && payment_status !== 'all') {
    where.push('payment_status = ?'); params.push(payment_status);
  }
  const sql = `SELECT id, sale_date, customer_name, tea_type, price_per_kg, weight, payment_status, ticket_name, contract, created_by, issued_by,
    (price_per_kg * weight) AS total_amount FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sale_date ASC, id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  });
});

app.post('/sales', requireAuth, (req, res) => {
  const { sale_date, customer_name, tea_type, price_per_kg, weight, payment_status = 'pending', ticket_name = null, contract = null, created_by = null, issued_by = null } = req.body;
  const p = Number(price_per_kg);
  const w = Number(weight);
  if (!sale_date || p <= 0 || w <= 0) return res.status(400).json({ message: 'Missing/invalid sale_date/price_per_kg/weight', detail: 'price_per_kg and weight must be > 0' });
  const total = Number(price_per_kg) * Number(weight);
  if (MONGO_READY) {
    nextId('sales').then(id => {
      const doc = { id, sale_date, customer_name: customer_name || '', tea_type: tea_type || '', price_per_kg: p, weight: w, payment_status, ticket_name: ticket_name || null, contract: contract || null, created_by: created_by || null, issued_by: issued_by || null, total_amount: p * w };
      mongoDb.collection('sales').insertOne(doc).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
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
      db.run(`UPDATE sales SET ticket_name = ?, contract = ?, created_by = ?, issued_by = ? WHERE id = ?`, [ticket_name || null, contract || null, created_by || null, issued_by || null, id], () => {});
      if (MONGO_READY) {
        const doc = { id, sale_date, customer_name: customer_name || '', tea_type: tea_type || '', price_per_kg: Number(price_per_kg), weight: Number(weight), payment_status, ticket_name: ticket_name || null, contract: contract || null, created_by: created_by || null, issued_by: issued_by || null, total_amount: Number(price_per_kg) * Number(weight) };
        mongoDb.collection('sales').insertOne(doc).catch(() => {});
      }
      res.json({ id });
    });
  };
  runInsert(SALES_HAS_TOTAL_AMOUNT || true);
});

app.put('/sales/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { sale_date, customer_name, tea_type, price_per_kg, weight, payment_status, ticket_name, contract, created_by, issued_by } = req.body;
  if (price_per_kg != null && Number(price_per_kg) <= 0) return res.status(400).json({ message: 'price_per_kg must be > 0' });
  if (weight != null && Number(weight) <= 0) return res.status(400).json({ message: 'weight must be > 0' });
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
    const doUpdate = () => col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    if (needTotal) {
      col.findOne({ id: Number(id) }).then(prev => {
        const p = price_per_kg != null ? Number(price_per_kg) : Number(prev?.price_per_kg || 0);
        const w = weight != null ? Number(weight) : Number(prev?.weight || 0);
        upd.total_amount = p * w; doUpdate();
      }).catch(doUpdate);
    } else doUpdate();
    return;
  }
  const fields = [];
  const params = [];
  if (sale_date != null) { fields.push('sale_date = ?'); params.push(sale_date); }
  if (customer_name != null) { fields.push('customer_name = ?'); params.push(customer_name); }
  if (tea_type != null) { fields.push('tea_type = ?'); params.push(tea_type); }
  if (price_per_kg != null) { fields.push('price_per_kg = ?'); params.push(Number(price_per_kg)); }
  if (weight != null) { fields.push('weight = ?'); params.push(Number(weight)); }
  if (payment_status != null) { fields.push('payment_status = ?'); params.push(payment_status); }
  if (ticket_name != null) { fields.push('ticket_name = ?'); params.push(ticket_name); }
  if (contract != null) { fields.push('contract = ?'); params.push(contract); }
  if (created_by != null) { fields.push('created_by = ?'); params.push(created_by); }
  if (issued_by != null) { fields.push('issued_by = ?'); params.push(issued_by); }
  if (SALES_HAS_TOTAL_AMOUNT && (price_per_kg != null || weight != null)) {
    // Recompute total_amount based on current price_per_kg and weight values
    fields.push('total_amount = (price_per_kg * weight)');
  }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE sales SET ${fields.join(', ')} WHERE id = ?`;
  params.push(id);
  db.run(sql, params, function (err) {
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
    res.json({ changed: this.changes });
  });
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
    res.json({ deleted: this.changes });
  });
});

// Purchases endpoints
app.get('/purchases', (req, res) => {
  const { month, year, payment_status } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const filter = {};
    if (month && year) filter.purchase_date = { $regex: `^${y}-${m}` };
    if (payment_status && payment_status !== 'all') filter.payment_status = payment_status;
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
        total_cost: Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price || 0) * Number(r.net_weight != null ? r.net_weight : (r.weight || 0))))
      })))).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  const where = [];
  const params = [];
  if (month && year) {
    where.push("strftime('%m', purchase_date) = ?"); params.push(pad2(month));
    where.push("strftime('%Y', purchase_date) = ?"); params.push(String(year));
  }
  if (payment_status && payment_status !== 'all') {
    where.push('payment_status = ?'); params.push(payment_status);
  }
  const totalExpr = PURCHASES_HAS_TOTAL_COST ? 'COALESCE(total_cost, (unit_price * COALESCE(net_weight, weight)))' : '(unit_price * COALESCE(net_weight, weight))';
  const sql = `SELECT id, purchase_date, supplier_name, weight, unit_price, payment_status, water_percent, net_weight, ticket_name,
    ${totalExpr} AS total_cost FROM purchases ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY purchase_date ASC, id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  });
});

app.post('/purchases', requireAuth, (req, res) => {
  const { purchase_date, supplier_name, weight, unit_price, payment_status = 'pending', water_percent = null, net_weight = null, ticket_name = null } = req.body;
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
  if (MONGO_READY) {
    nextId('purchases').then(id => {
      const doc = { id, purchase_date, supplier_name: supplier_name || '', weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name: ticket_name || null, total_cost: numericUnit * calcNet };
      mongoDb.collection('purchases').insertOne(doc).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }))
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
      db.run(`UPDATE purchases SET net_weight = ?, water_percent = ?, ticket_name = ? WHERE id = ?`, [calcNet, numericWater, ticket_name || null, id], () => {});
      if (MONGO_READY) {
        const doc = { id, purchase_date, supplier_name: supplier_name || '', weight: numericWeight, unit_price: numericUnit, payment_status, water_percent: numericWater, net_weight: calcNet, ticket_name: ticket_name || null, total_cost: numericUnit * calcNet };
        mongoDb.collection('purchases').insertOne(doc).catch(() => {});
      }
      res.json({ id });
    });
  };
  runInsert(PURCHASES_HAS_TOTAL_COST || true);
});

app.put('/purchases/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { purchase_date, supplier_name, weight, unit_price, payment_status, water_percent, net_weight, ticket_name } = req.body;
  if (water_percent != null && (Number(water_percent) < 0 || Number(water_percent) > 100)) return res.status(400).json({ message: 'Invalid water_percent', detail: 'water_percent must be between 0 and 100' });
  if (unit_price != null && Number(unit_price) <= 0) return res.status(400).json({ message: 'unit_price must be > 0' });
  if (weight != null && Number(weight) <= 0) return res.status(400).json({ message: 'weight must be > 0' });
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
    const needTotal = unit_price != null || weight != null || net_weight != null || water_percent != null;
    const doUpdate = () => col.updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
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
    return;
  }
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
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  const sql = `UPDATE purchases SET ${fields.join(', ')} WHERE id = ?`;
  params.push(id);
  db.run(sql, params, function (err) {
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
    res.json({ changed: this.changes });
  });
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
    res.json({ deleted: this.changes });
  });
});

// Expenses endpoints
app.get('/expenses', (req, res) => {
  const { month, year } = req.query;
  if (MONGO_READY) {
    const m = String(month || '').padStart(2, '0');
    const y = String(year || '');
    const filter = {};
    if (month && year) filter.expense_date = { $regex: `^${y}-${m}` };
    return mongoDb.collection('expenses').find(filter).sort({ expense_date: 1, id: 1 }).toArray()
      .then(rows => res.json(rows.map(r => ({ id: r.id, expense_date: r.expense_date, description: r.description || '', amount: Number(r.amount || 0), category: r.category || null }))))
      .catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  const where = [];
  const params = [];
  if (month && year) {
    where.push("strftime('%m', expense_date) = ?"); params.push(pad2(month));
    where.push("strftime('%Y', expense_date) = ?"); params.push(String(year));
  }
  const sql = `SELECT id, expense_date, description, amount, category FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY expense_date ASC, id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    res.json(rows);
  });
});

app.post('/expenses', requireAuth, (req, res) => {
  const { expense_date, description, amount, category } = req.body;
  if (!expense_date || amount == null) return res.status(400).json({ message: 'Missing expense_date/amount' });
  if (MONGO_READY) {
    nextId('expenses').then(id => {
      const doc = { id, expense_date, description: description || '', amount: Number(amount), category: category || null };
      mongoDb.collection('expenses').insertOne(doc).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    });
    return;
  }
  const sql = `INSERT INTO expenses (expense_date, description, amount, category) VALUES (?,?,?,?)`;
  const params = [expense_date, description || '', Number(amount), category || null];
  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    const id = this.lastID;
    if (MONGO_READY) {
      const doc = { id, expense_date, description: description || '', amount: Number(amount), category: category || null };
      mongoDb.collection('expenses').insertOne(doc).catch(() => {});
    }
    res.json({ id });
  });
});

app.put('/expenses/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { expense_date, description, amount, category } = req.body;
  if (MONGO_READY) {
    const upd = {};
    if (expense_date != null) upd.expense_date = expense_date;
    if (description != null) upd.description = description;
    if (amount != null) upd.amount = Number(amount);
    if (category != null) upd.category = category;
    mongoDb.collection('expenses').updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).then(() => res.json({ changed: 1 })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    return;
  }
  const fields = [];
  const params = [];
  if (expense_date != null) { fields.push('expense_date = ?'); params.push(expense_date); }
  if (description != null) { fields.push('description = ?'); params.push(description); }
  if (amount != null) { fields.push('amount = ?'); params.push(Number(amount)); }
  if (category != null) { fields.push('category = ?'); params.push(category); }
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
    res.json({ changed: this.changes });
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
    res.json({ deleted: this.changes });
  });
});

// Directory endpoints: suppliers/customers/staff
function makeCrud(table) {
  app.get(`/${table}`, (req, res) => {
    if (MONGO_READY) {
      return mongoDb.collection(table).find({}).sort({ name: 1, id: 1 }).toArray()
        .then(rows => res.json(rows))
        .catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
    }
    const baseCols = table === 'staff' ? 'id, name, role, phone, note' : 'id, name, phone, address, note';
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    db.all(`SELECT ${baseCols} FROM ${table} ORDER BY name ASC, id ASC`, [], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      res.json(rows);
    });
  });
  app.post(`/${table}`, (req, res) => {
    const { name, phone, address, note, role } = req.body;
    if (!name) return res.status(400).json({ message: 'Missing name' });
    if (MONGO_READY) {
      return nextId(table).then(id => {
        const doc = table === 'staff'
          ? { id, name: name || '', role: role || null, phone: phone || '', note: note || '' }
          : { id, name: name || '', phone: phone || '', address: address || '', note: note || '' };
        mongoDb.collection(table).insertOne(doc).then(() => res.json({ id })).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
      }).catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    const cols = ['name','phone','address','note'];
    const vals = [name || '', phone || '', address || '', note || ''];
    if (table === 'staff') { cols.push('role'); vals.push(role || null); }
    const placeholders = cols.map(() => '?').join(',');
    db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, vals, function(err){
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      const id = this.lastID;
      if (MONGO_READY) {
        const doc = table === 'staff'
          ? { id, name: name || '', role: role || null, phone: phone || '', note: note || '' }
          : { id, name: name || '', phone: phone || '', address: address || '', note: note || '' };
        mongoDb.collection(table).insertOne(doc).catch(() => {});
      }
      res.json({ id });
    });
  });
  app.put(`/${table}/:id`, (req, res) => {
    const id = req.params.id;
    const { name, phone, address, note, role } = req.body;
    if (MONGO_READY) {
      const upd = {};
      if (name != null) upd.name = name;
      if (phone != null) upd.phone = phone;
      if (address != null) upd.address = address;
      if (note != null) upd.note = note;
      if (table === 'staff' && role != null) upd.role = role;
      return mongoDb.collection(table).updateOne({ id: Number(id) }, { $set: upd }, { upsert: true })
        .then(() => res.json({ changed: 1 }))
        .catch(e => res.status(500).json({ message: 'DB error', detail: e.message }));
    }
    if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
    const fields = []; const params = [];
    if (name != null) { fields.push('name = ?'); params.push(name); }
    if (phone != null) { fields.push('phone = ?'); params.push(phone); }
    if (address != null) { fields.push('address = ?'); params.push(address); }
    if (note != null) { fields.push('note = ?'); params.push(note); }
    if (table === 'staff' && role != null) { fields.push('role = ?'); params.push(role); }
    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
    const sql = `UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);
    db.run(sql, params, function(err){
      if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
      if (MONGO_READY) {
        const upd = {};
        if (name != null) upd.name = name;
        if (phone != null) upd.phone = phone;
        if (address != null) upd.address = address;
        if (note != null) upd.note = note;
        if (table === 'staff' && role != null) upd.role = role;
        mongoDb.collection(table).updateOne({ id: Number(id) }, { $set: upd }, { upsert: true }).catch(() => {});
      }
      res.json({ changed: this.changes });
    });
  });
  app.delete(`/${table}/:id`, (req, res) => {
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

app.get('/health', (req, res) => {
  res.json({ ok: true, mongo: !!MONGO_READY });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload; // { uid, username, role }
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (String(req.user?.role) !== 'admin') return res.status(403).json({ message: 'Forbidden: admin required' });
    next();
  });
}

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

app.post('/admin/wipe', requireAdmin, async (req, res) => {
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

// Auth endpoints
app.post('/auth/login', (req, res) => {
  const b = req.body || {};
  const q = req.query || {};
  const username = b.username ?? q.username ?? b.u ?? q.u;
  const password = b.password ?? q.password ?? b.p ?? q.p;
  if (!username || !password) return res.status(400).json({ message: 'Missing username/password' });
  if (MONGO_READY) {
    return mongoDb.collection('users').findOne({ username }).then(row => {
      if (!row) return res.status(401).json({ message: 'Invalid credentials' });
      const ok = bcrypt.compareSync(password, row.password_hash || '');
      if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
      const token = jwt.sign({ uid: row.id, username: row.username, role: row.role || 'user' }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, role: row.role || 'user' });
    }).catch(err => res.status(500).json({ message: 'DB error', detail: err.message }));
  }
  if (!SQLITE_READY) return res.status(500).json({ message: 'DB error', detail: 'SQLite disabled' });
  db.get(`SELECT id, username, password_hash, role FROM users WHERE username = ?`, [username], (err, row) => {
    if (err) return res.status(500).json({ message: 'DB error', detail: err.message });
    if (!row) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ uid: row.id, username: row.username, role: row.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, role: row.role });
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
