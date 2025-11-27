import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

const fmtDate = (s) => { try { const d = new Date(s); return isNaN(d.getTime()) ? (s||'') : d.toISOString().slice(0,10) } catch { return s||'' } }

export default function Receipts() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth()+1)
  const [year, setYear] = useState(now.getFullYear())
  const [type, setType] = useState('all')
  const [missing, setMissing] = useState(false)
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const origin = (typeof window !== 'undefined') ? window.location.origin : ''
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('token')||'') : ''
  const monthOptions = useMemo(() => Array.from({length:12}, (_,i)=> i+1), [])
  const yearOptions = useMemo(() => { const y=new Date().getFullYear(); return Array.from({length:5},(_,i)=> y-2+i) }, [])
  const ep = (t,id) => `${origin}/api/${t}/${id}/receipt?t=${encodeURIComponent(token)}`

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { month, year, type }
      if (q) params.q = q
      if (missing) params.missing = 1
      const r = await api.get('/receipts', { params })
      setList(Array.isArray(r.data) ? r.data : [])
      setPartial(false)
    } catch (e) {
      try {
        const base = { month, year }
        const [rs, rp, re] = await Promise.all([
          api.get('/sales', { params: base }),
          api.get('/purchases', { params: base }),
          api.get('/expenses', { params: base })
        ])
        let items = []
        const add = (arr, t, dateKey) => { (arr||[]).forEach(r => { if (r.receipt_path) { const inv = r.invoice_no || r.ticket_name || r.weigh_ticket_code || r.contract || ''; items.push({ type:t, id:r.id, date:r[dateKey], owner:r.owner||r.created_by||null, invoice_no: inv }) } }) }
        if (type==='all' || type==='sales') add(rs.data||[], 'sales', 'sale_date')
        if (type==='all' || type==='purchases') add(rp.data||[], 'purchases', 'purchase_date')
        if (type==='all' || type==='expenses') add(re.data||[], 'expenses', 'expense_date')
        if (q) { const s=q.toLowerCase(); items = items.filter(r => String(r.invoice_no||'').toLowerCase().includes(s)) }
        items.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')))
        setList(items)
        setPartial(true)
        setError('')
      } catch (e2) {
        setError(e?.response?.data?.message || e2?.response?.data?.message || 'Tải ảnh lỗi')
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, year, type])
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t) }, [q])

  return (
    <div className="card">
      <h2>Ảnh hóa đơn</h2>
      <div className="filters">
        <label>Tháng</label>
        <select value={month} onChange={(e)=> setMonth(Number(e.target.value))}>{monthOptions.map(m => <option key={m} value={m}>{m}</option>)}</select>
        <label>Năm</label>
        <select value={year} onChange={(e)=> setYear(Number(e.target.value))}>{yearOptions.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <label>Loại</label>
        <select value={type} onChange={(e)=> setType(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="sales">Thu</option>
          <option value="purchases">Nhập</option>
          <option value="expenses">Chi</option>
        </select>
        <label>Tìm Số HĐ</label>
        <input value={q} onChange={(e)=> setQ(e.target.value)} placeholder="Nhập Số HĐ" />
        <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" checked={missing} onChange={(e)=> setMissing(e.target.checked)} /> Thiếu Số HĐ
        </label>
      </div>
      {error && <div className="error" style={{ marginTop:8 }}>{error}</div>}
      {!error && partial && <div className="muted" style={{ marginTop:8 }}>Một số mục lỗi, đang hiển thị phần khả dụng</div>}
      <div className="table-wrap" style={{ marginTop:12 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead><tr><th>Ảnh</th><th>Loại</th><th>Ngày</th><th>Số HĐ</th><th>Người tạo</th><th>Actions</th></tr></thead>
            <tbody>
              {(list||[]).map((r,i) => (
                <tr key={`${r.type}-${r.id}-${i}`}>
                  <td><img alt="hoadon" src={ep(r.type, r.id)} style={{ maxHeight:80, borderRadius:8 }} onError={(e)=> { e.currentTarget.style.display='none' }} /></td>
                  <td>{r.type}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.invoice_no||''}</td>
                  <td>{r.owner||''}</td>
                  <td><a className="btn" href={ep(r.type, r.id)} target="_blank" rel="noreferrer">Mở</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
