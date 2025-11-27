import * as React from 'react'
const { useEffect, useMemo, useState, useRef } = React
import api from '../api.js'

const fmt = (v) => (Number(v)||0).toLocaleString('vi-VN')

function useMonthYear() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth()+1)
  const [year, setYear] = useState(now.getFullYear())
  return { month, year, setMonth, setYear }
}

export default function TradeStats() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [range, setRange] = useState({ from:'', to:'' })
  const origin = (typeof window !== 'undefined') ? window.location.origin : ''
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('token')||'') : ''
  const receiptEndpoint = (type, id) => `${origin}/api/${type}/${id}/receipt?t=${encodeURIComponent(token)}`
  const [viewer, setViewer] = useState({ open:false, url:'', scale:1, img:true })

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => { const y=new Date().getFullYear(); return Array.from({length:5},(_,i)=> y-2+i) }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { month, year }
      const sp = { ...params }; if (q) sp.q = q
      const pp = { ...params }; if (q) pp.q = q
      const [rs, rp] = await Promise.all([
        api.get('/sales', { params: sp }),
        api.get('/purchases', { params: pp })
      ])
      let s = rs.data || []; let p = rp.data || []
      if (range.from || range.to) {
        s = s.filter(r => { const d = new Date(r.sale_date); return (!range.from || d>=new Date(range.from)) && (!range.to || d<=new Date(range.to)) })
        p = p.filter(r => { const d = new Date(r.purchase_date); return (!range.from || d>=new Date(range.from)) && (!range.to || d<=new Date(range.to)) })
      }
      setSales(s); setPurchases(p)
    } catch (e) { setError(e?.response?.data?.message || 'Tải thống kê lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, year])

  const totalSales = sales.reduce((s,r)=> s + (Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0)))||0), 0)
  const totalPurchases = purchases.reduce((s,r)=> s + (Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number(r.net_weight != null ? r.net_weight : (r.weight || 0)) ) )||0), 0)
  const net = totalSales - totalPurchases

  const exportCsv = () => {
    const headers = ['Loại','Ngày','Tên phiếu','Đối tác','Kg','Đơn giá','Thành tiền','Trạng thái']
    const saleRows = sales.map(r=> ['Bán', r.sale_date, r.ticket_name||'', r.customer_name||'', r.weight, r.price_per_kg, r.total_amount, r.payment_status])
    const purchRows = purchases.map(r=> ['Nhập', r.purchase_date, r.ticket_name||'', r.supplier_name||'', (r.net_weight != null ? r.net_weight : r.weight), r.unit_price, r.total_cost, r.payment_status])
    const csv = [headers, ...saleRows, ...purchRows].map(row => row.map(v => (v ?? '')).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`trade_${year}-${String(month).padStart(2,'0')}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (<>
    <div className="card">
      <h2>Thống kê Giao dịch Chè</h2>
      <div className="section-bar">
        <label>Tháng</label>
        <select value={month} onChange={(e)=> setMonth(Number(e.target.value))}>{monthOptions.map(m => <option key={m} value={m}>{m}</option>)}</select>
        <label>Năm</label>
        <select value={year} onChange={(e)=> setYear(Number(e.target.value))}>{yearOptions.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <label>Tìm</label>
        <input placeholder="khách/NCC/tên phiếu" value={q} onChange={(e)=> setQ(e.target.value)} />
        <label>Từ ngày</label>
        <input type="date" value={range.from} onChange={(e)=> setRange(s=>({ ...s, from:e.target.value }))} />
        <label>Đến ngày</label>
        <input type="date" value={range.to} onChange={(e)=> setRange(s=>({ ...s, to:e.target.value }))} />
        <button className="btn" style={{ marginLeft:8 }} type="button" onClick={load}>Lọc</button>
        <button className="btn" style={{ marginLeft:8 }} type="button" onClick={exportCsv}>Xuất CSV</button>
      </div>

      {error && <div className="error" style={{ marginTop:8 }}>{error}</div>}

      <div className="card" style={{ marginTop:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          <div className="kpi"><div>Tổng Thu (Bán)</div><div className="kpi-value">{fmt(totalSales)} đ</div></div>
          <div className="kpi"><div>Tổng Chi (Nhập)</div><div className="kpi-value">{fmt(totalPurchases)} đ</div></div>
          <div className="kpi"><div>Lãi/Lỗ</div><div className="kpi-value" style={{ color: net>=0?'#22c55e':'#ef4444' }}>{fmt(net)} đ</div></div>
        </div>
      </div>

      <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Danh sách Bán</div>
          {loading ? 'Đang tải...' : (
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Ngày</th><th>Tên phiếu</th><th>Khách</th><th className="num">Kg</th><th className="num">Giá</th><th className="num">Thành tiền</th><th>TT</th><th>Ảnh</th></tr></thead><tbody>
                {sales.map(r => (
                  <tr key={`s${r.id}`}><td>{r.sale_date}</td><td>{r.ticket_name||''}</td><td>{r.customer_name||''}</td><td className="num">{(Number(r.weight)||0).toLocaleString()}</td><td className="num">{fmt(r.price_per_kg)}</td><td className="num">{fmt(r.total_amount)}</td><td><span className={`pill ${r.payment_status}`}>{STATUS_LABELS[r.payment_status]||r.payment_status}</span></td><td>{(r.payment_status==='paid' && r.receipt_path) ? (<div style={{ display:'flex', gap:6 }}><button className="btn" onClick={()=> setViewer({ open:true, url: receiptEndpoint('sales', r.id), scale:1, img:true })}>Thu phóng</button><a href={receiptEndpoint('sales', r.id)} target="_blank" rel="noreferrer">Mở tab</a></div>) : (<span className="muted">Chưa có tệp</span>)}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Danh sách Nhập</div>
          {loading ? 'Đang tải...' : (
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Ngày</th><th>Tên phiếu</th><th>NCC</th><th className="num">Sau trừ hao</th><th className="num">Giá</th><th className="num">Thành tiền</th><th>TT</th><th>Ảnh</th></tr></thead><tbody>
                {(purchases.map(r => (
                  <tr key={`p${r.id}`}><td>{r.purchase_date}</td><td>{r.ticket_name||''}</td><td>{r.supplier_name||''}</td><td className="num">{(Number(r.net_weight != null ? r.net_weight : r.weight)||0).toLocaleString()}</td><td className="num">{fmt(r.unit_price)}</td><td className="num">{fmt(r.total_cost)}</td><td><span className={`pill ${r.payment_status}`}>{STATUS_LABELS[r.payment_status]||r.payment_status}</span></td><td>{(r.payment_status==='paid' && r.receipt_path) ? (<div style={{ display:'flex', gap:6 }}><button className="btn" onClick={()=> setViewer({ open:true, url: receiptEndpoint('purchases', r.id), scale:1, img:true })}>Thu phóng</button><a href={receiptEndpoint('purchases', r.id)} target="_blank" rel="noreferrer">Mở tab</a></div>) : (<span className="muted">Chưa có tệp</span>)}</td></tr>
                )))}
              </tbody></table>
            </div>
          )}
        </div>
      </div>
    </div>
    {viewer.open && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="card" style={{ width:'90vw', maxWidth:1100 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale: Math.max(0.25, s.scale-0.25) }))}>−</button>
            <div className="muted">{Math.round(viewer.scale*100)}%</div>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale: Math.min(6, s.scale+0.25) }))}>+</button>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale:1 }))}>100%</button>
            <div style={{flex:1}}></div>
            <button className="btn" onClick={()=> setViewer({ open:false, url:'', scale:1, img:true })}>Đóng</button>
          </div>
          <div style={{ marginTop:8, border:'1px solid #e8dac2', borderRadius:12, overflow:'auto', maxHeight:'70vh' }}>
            {viewer.img ? (
              <img src={viewer.url} style={{ transform:`scale(${viewer.scale})`, transformOrigin:'center top', display:'block', maxWidth:'100%' }} onError={()=> setViewer(s=> ({ ...s, img:false }))} />
            ) : (
              <iframe title="viewer" src={viewer.url} style={{ width:'100%', height:'70vh', border:0 }} />
            )}
          </div>
        </div>
      </div>
    )}
  </>)
}
  const STATUS_LABELS = { pending: 'Chờ', paid: 'Đã thanh toán' }
