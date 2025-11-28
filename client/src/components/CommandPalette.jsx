import * as React from 'react'
const { useEffect, useMemo, useState, useRef } = React
import api from '../api.js'

export default function CommandPalette({ open, onClose, onNavigate }) {
  const [q, setQ] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [purchases, setPurchases] = useState([])
  const [sales, setSales] = useState([])
  const [staff, setStaff] = useState([])
  useEffect(() => { if (open) { (async () => { try { const s = await api.get('/suppliers'); setSuppliers(Array.isArray(s.data) ? s.data : []) } catch {} try { const c = await api.get('/customers'); setCustomers(Array.isArray(c.data) ? c.data : []) } catch {} try { const p = await api.get('/purchases'); setPurchases(Array.isArray(p.data) ? p.data.slice(0,200) : []) } catch {} try { const so = await api.get('/sales'); setSales(Array.isArray(so.data) ? so.data.slice(0,200) : []) } catch {} })() } }, [open])
  const items = useMemo(() => {
    const role = (localStorage.getItem('role')||'user').toLowerCase()
    const base = [
      ...(role==='admin' ? [{ key: 'dashboard', label: '📊 Tổng quan' }] : []),
      { key: 'season', label: '📅 Theo Đợt' },
      { key: 'sales', label: '🛒 Bán chè' },
      { key: 'purchases', label: '📥 Nhập chè' },
      { key: 'expenses', label: '🧾 Chi phí' },
      ...(role==='admin' ? [{ key: 'debts', label: '💳 Công nợ' }, { key: 'suppliers', label: 'Nhà CC' }, { key: 'customers', label: 'Người mua' }, { key: 'staff', label: 'Tạo phiếu/Bán' }, { key: 'admin', label: '⚙️ Quản trị' }, { key: 'stats', label: '📈 Thống kê' }, { key: 'tradeStats', label: '📊 Thống kê giao dịch' }] : [])
    ]
    return base
  }, [])
  const base = items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()))
  const sup = suppliers.filter(s => s.name.toLowerCase().includes(q.toLowerCase())).slice(0,5).map(s => ({ key:'suppliers', label:`🏪 Mở Nhà CC: ${s.name}` }))
  const cus = customers.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0,5).map(c => ({ key:'customers', label:`👥 Mở Người mua: ${c.name}` }))
  const purByPlate = purchases.filter(p => String(p.vehicle_plate||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(p => ({ key:'purchases', label:`🚚 Biển số: ${p.vehicle_plate} → Nhập` }))
  const purByWeigh = purchases.filter(p => String(p.weigh_ticket_code||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(p => ({ key:'purchases', label:`⚖️ Phiếu cân: ${p.weigh_ticket_code} → Nhập` }))
  const purByTicket = purchases.filter(p => String(p.ticket_name||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(p => ({ key:'purchases', label:`📥 Phiếu: ${p.ticket_name} → Nhập` }))
  const saleByTicket = sales.filter(s => String(s.ticket_name||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(s => ({ key:'sales', label:`🧾 Phiếu: ${s.ticket_name} → Bán` }))
  const saleByCustomer = sales.filter(s => String(s.customer_name||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(s => ({ key:'sales', label:`🛒 Khách: ${s.customer_name} → Bán` }))
  const saleByTea = sales.filter(s => String(s.tea_type||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(s => ({ key:'sales', label:`🍵 Loại: ${s.tea_type} → Bán` }))
  const staffSuggest = staff.filter(st => String(st.name||'').toLowerCase().includes(q.toLowerCase())).slice(0,5).map(st => ({ key:'sales', label:`👤 Người tạo: ${st.name} → Bán` }))
  const filtered = [...base, ...sup, ...cus, ...purByPlate, ...purByWeigh, ...purByTicket, ...saleByTicket, ...saleByCustomer, ...saleByTea, ...staffSuggest]
  useEffect(() => { if (open) setQ('') }, [open])
  if (!open) return null
  return (
    <div className="drawer open" onClick={onClose}>
      <div className="drawer-panel" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="" placeholder="Tìm nhanh (ví dụ: Công nợ, Thu, Nhập)" value={q} onChange={(e) => setQ(e.target.value)} style={{ height:40, border:'1px solid var(--border)', borderRadius:10, padding:'0 12px', marginBottom:12 }} />
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(i => (
            <button key={`${i.key}-${i.label}`} className="btn" onClick={() => { try { localStorage.setItem('quickSearch', JSON.stringify({ tab: i.key, value: q })) } catch {} onNavigate(i.key); onClose() }}>{i.label}</button>
          ))}
          {!filtered.length && <div className="empty-state">Không tìm thấy. Thử từ khoá khác.</div>}
        </div>
      </div>
    </div>
  )
}
