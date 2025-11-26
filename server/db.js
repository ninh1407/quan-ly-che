const path = require('path')
const fs = require('fs')
let sqlite3 = null
let READY = false
let LOAD_ERR = ''
try { sqlite3 = require('sqlite3').verbose(); READY = true } catch (e) { LOAD_ERR = String(e.message||''); console.warn('BOT SQLite load error:', LOAD_ERR) }
const DB_ENV = process.env.BOT_DB_PATH
const DB_PATH = DB_ENV ? (path.isAbsolute(DB_ENV) ? DB_ENV : path.join(__dirname, DB_ENV)) : path.join(__dirname, 'database.sqlite')
try { const dir = path.dirname(DB_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch {}
const db = READY ? new sqlite3.Database(DB_PATH) : null
function run(sql, params=[]) { if (!READY) return Promise.reject(new Error('SQLite not available: '+LOAD_ERR)); return new Promise((resolve, reject) => db.run(sql, params, function(e){ if (e) return reject(e); resolve({ lastID: this.lastID, changes: this.changes }) })) }
function get(sql, params=[]) { if (!READY) return Promise.reject(new Error('SQLite not available: '+LOAD_ERR)); return new Promise((resolve, reject) => db.get(sql, params, (e,row)=> e?reject(e):resolve(row))) }
function all(sql, params=[]) { if (!READY) return Promise.reject(new Error('SQLite not available: '+LOAD_ERR)); return new Promise((resolve, reject) => db.all(sql, params, (e,rows)=> e?reject(e):resolve(rows))) }
function init() {
  if (!READY) return
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tea_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, base_price REAL, season TEXT)`)
    db.run(`CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, phone TEXT, address TEXT)`)
    db.run(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER, tea_type_id INTEGER, weight REAL, price REAL, humidity REAL, date TEXT)`)
    db.run(`CREATE TABLE IF NOT EXISTS inventory (tea_type_id INTEGER UNIQUE, current_weight REAL)`)
  })
}
function ymd(d){ const x = d instanceof Date ? d : new Date(d||Date.now()); const yy = x.getFullYear(); const mm = String(x.getMonth()+1).padStart(2,'0'); const dd = String(x.getDate()).padStart(2,'0'); return `${yy}-${mm}-${dd}` }
async function ensureTeaType(name, base_price=null, season=null){ const row = await get(`SELECT id FROM tea_types WHERE name = ?`, [String(name)]); if (row && row.id) return row.id; const r = await run(`INSERT INTO tea_types (name, base_price, season) VALUES (?,?,?)`, [String(name), base_price!=null?Number(base_price):null, season||null]); return r.lastID }
async function ensureSupplier(name, phone=null, address=null){ const row = await get(`SELECT id FROM suppliers WHERE name = ?`, [String(name)]); if (row && row.id) return row.id; const r = await run(`INSERT INTO suppliers (name, phone, address) VALUES (?,?,?)`, [String(name), phone||null, address||null]); return r.lastID }
async function adjustInventory(tea_type_id, delta){ const cur = await get(`SELECT current_weight FROM inventory WHERE tea_type_id = ?`, [tea_type_id]); if (cur) { await run(`UPDATE inventory SET current_weight = COALESCE(current_weight,0) + ? WHERE tea_type_id = ?`, [Number(delta), tea_type_id]); return } await run(`INSERT INTO inventory (tea_type_id, current_weight) VALUES (?, ?)`, [tea_type_id, Number(delta)]) }
async function createPurchase(params){ const sql = []; const supplier_id = await ensureSupplier(params.supplier, params.phone||null, params.address||null); const tea_type_id = await ensureTeaType(params.tea_type, null, null); const d = ymd(params.date); sql.push(`INSERT INTO purchases (supplier_id, tea_type_id, weight, price, humidity, date) VALUES (${supplier_id}, ${tea_type_id}, ${Number(params.weight)}, ${Number(params.price)}, ${params.humidity!=null?Number(params.humidity):'NULL'}, '${d}')`); await run(`INSERT INTO purchases (supplier_id, tea_type_id, weight, price, humidity, date) VALUES (?,?,?,?,?,?)`, [supplier_id, tea_type_id, Number(params.weight), Number(params.price), params.humidity!=null?Number(params.humidity):null, d]); await adjustInventory(tea_type_id, Number(params.weight)); sql.push(`UPDATE inventory SET current_weight = current_weight + ${Number(params.weight)} WHERE tea_type_id = ${tea_type_id}`); return { sql }
}
async function updatePrice(params){ const id = await ensureTeaType(params.tea_type, null, null); const sql = [`UPDATE tea_types SET base_price = ${Number(params.new_price)} WHERE id = ${id}`]; await run(`UPDATE tea_types SET base_price = ? WHERE id = ?`, [Number(params.new_price), id]); return { sql } }
async function getInventory(params){ if (params && params.tea_type) { const id = await ensureTeaType(params.tea_type, null, null); const row = await get(`SELECT t.name AS tea_type, COALESCE(i.current_weight,0) AS current_weight FROM tea_types t LEFT JOIN inventory i ON i.tea_type_id = t.id WHERE t.id = ?`, [id]); return { rows: row ? [row] : [] } } const rows = await all(`SELECT t.name AS tea_type, COALESCE(i.current_weight,0) AS current_weight FROM tea_types t LEFT JOIN inventory i ON i.tea_type_id = t.id ORDER BY t.name ASC`, []); return { rows }
}
async function reportRange(params){ const days = Number(params.days||7); const since = new Date(Date.now() - days*24*3600*1000); const s = ymd(since); const rows = await all(`SELECT p.date AS date, t.name AS tea_type, s.name AS supplier, p.weight, p.price, p.humidity FROM purchases p LEFT JOIN tea_types t ON t.id = p.tea_type_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.date >= ? ORDER BY p.date DESC, p.id DESC`, [s]); const totalWeight = rows.reduce((a,r)=>a+Number(r.weight||0),0); const totalValue = rows.reduce((a,r)=>a+Number(r.weight||0)*Number(r.price||0),0); const html = [`<table border="1" cellpadding="6"><thead><tr><th>Ngày</th><th>Loại chè</th><th>Nhà CC</th><th>Khối lượng</th><th>Giá</th><th>Ẩm</th></tr></thead><tbody>`].concat(rows.map(r=>`<tr><td>${r.date}</td><td>${r.tea_type}</td><td>${r.supplier}</td><td style="text-align:right">${Number(r.weight||0).toLocaleString()}</td><td style="text-align:right">${Number(r.price||0).toLocaleString()}</td><td style="text-align:right">${r.humidity==null?'-':Number(r.humidity)}</td></tr>`)).concat([`</tbody><tfoot><tr><td colspan="3">Tổng</td><td style="text-align:right">${totalWeight.toLocaleString()}</td><td style="text-align:right">${totalValue.toLocaleString()}</td><td></td></tr></tfoot></table>`]).join(''); return { rows, totalWeight, totalValue, html }
}
async function insertSupplier(params){ const id = await ensureSupplier(params.name, params.phone||null, params.address||null); const row = await get(`SELECT id, name, phone, address FROM suppliers WHERE id = ?`, [id]); return { row }
}
module.exports = { db, init, ensureTeaType, ensureSupplier, createPurchase, updatePrice, getInventory, reportRange, insertSupplier }
