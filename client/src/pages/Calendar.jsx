import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

function useMonthYear() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return { month, year, setMonth, setYear };
}

export default function Calendar() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return Array.from({ length: 5 }, (_, i) => y - 2 + i) }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { month, year }
      const [s, p, e] = await Promise.all([
        api.get('/sales', { params }),
        api.get('/purchases', { params }),
        api.get('/expenses', { params })
      ])
      setSales(s.data||[]); setPurchases(p.data||[]); setExpenses(e.data||[])
    } catch (err) { setError(err?.response?.data?.message || 'Tải lịch lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, year])

  const firstDay = useMemo(() => new Date(year, month-1, 1), [month, year])
  const daysInMonth = useMemo(() => new Date(year, month, 0).getDate(), [month, year])
  const startWeekday = useMemo(() => firstDay.getDay(), [firstDay])

  const eventsByDate = useMemo(() => {
    const map = {}
    const add = (d, type, amt, meta) => {
      if (!d) return
      const key = String(d)
      if (!map[key]) map[key] = { sales: [], purchases: [], expenses: [], sums: { sales:0, purchases:0, expenses:0 }, pending: { sales:0, purchases:0 } }
      map[key][type].push(meta)
      map[key].sums[type] += Number(amt||0)
    }
    ;(sales||[]).forEach(r => { add(r.sale_date, 'sales', (r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))), { name: r.customer_name||'', status: r.payment_status||'pending' }); if (String(r.payment_status)==='pending') { const k=String(r.sale_date); if (!map[k]) map[k]={ sales:[], purchases:[], expenses:[], sums:{sales:0,purchases:0,expenses:0}, pending:{sales:0,purchases:0} }; map[k].pending.sales++ } })
    ;(purchases||[]).forEach(r => { const amt = (r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight != null ? r.net_weight : r.weight)||0))); add(r.purchase_date, 'purchases', amt, { name: r.supplier_name||'', status: r.payment_status||'pending' }); if (String(r.payment_status)==='pending') { const k=String(r.purchase_date); if (!map[k]) map[k]={ sales:[], purchases:[], expenses:[], sums:{sales:0,purchases:0,expenses:0}, pending:{sales:0,purchases:0} }; map[k].pending.purchases++ } })
    ;(expenses||[]).forEach(r => { add(r.expense_date, 'expenses', r.amount, { name: r.description||'' }) })
    return map
  }, [sales, purchases, expenses])

  const cells = useMemo(() => {
    const arr = []
    const totalCells = startWeekday + daysInMonth
    for (let i=0;i<startWeekday;i++) arr.push(null)
    for (let d=1; d<=daysInMonth; d++) arr.push(d)
    while (arr.length % 7 !== 0) arr.push(null)
    return arr
  }, [startWeekday, daysInMonth])

  const fmt = (v) => (Number(v)||0).toLocaleString('vi-VN')

  const emptyMonth = !loading && !error && (sales.length===0 && purchases.length===0 && expenses.length===0)

  return (
    <div className="card">
      <h2>Lịch theo ngày</h2>
      <div className="section-bar" style={{ marginBottom:8 }}>
        <label>Tháng</label>
        <select value={month} onChange={(e)=> setMonth(Number(e.target.value))}>{monthOptions.map(m => (<option key={m} value={m}>{m}</option>))}</select>
        <label>Năm</label>
        <select value={year} onChange={(e)=> setYear(Number(e.target.value))}>{yearOptions.map(y => (<option key={y} value={y}>{y}</option>))}</select>
      </div>
      {error && <div className="error" style={{ marginBottom:8 }}>{error}</div>}
      {loading ? 'Đang tải...' : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:8 }}>
          {['CN','T2','T3','T4','T5','T6','T7'].map(w => (<div key={w} className="muted" style={{ fontWeight:700 }}>{w}</div>))}
          {cells.map((d,idx) => {
            if (!d) return (<div key={idx} className="card" style={{ background:'transparent', border:'none' }} />)
            const dayStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
            const ev = eventsByDate[dayStr] || { sales:[], purchases:[], expenses:[], sums:{sales:0,purchases:0,expenses:0}, pending:{sales:0,purchases:0} }
            return (
              <div key={idx} className="card" style={{ padding:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontWeight:700 }}>{d}</div>
                  <div className="muted">Thu {fmt(ev.sums.sales)} • Chi {fmt(ev.sums.purchases)} • CP {fmt(ev.sums.expenses)}</div>
                </div>
                <div style={{ marginTop:6 }}>
                  {ev.sales.slice(0,3).map((s,i)=>(<div key={`s${i}`} className="muted">🛒 {s.name} {s.status==='pending'?'• Chờ':''}</div>))}
                  {ev.purchases.slice(0,3).map((p,i)=>(<div key={`p${i}`} className="muted">📥 {p.name} {p.status==='pending'?'• Chờ':''}</div>))}
                  {ev.expenses.slice(0,3).map((e,i)=>(<div key={`e${i}`} className="muted">🧾 {e.name}</div>))}
                  {(ev.pending.sales+ev.pending.purchases>0) && (<div style={{ marginTop:4, color:'#ef4444' }}>Công nợ: {ev.pending.sales+ev.pending.purchases}</div>)}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {emptyMonth && (
        <div className="empty-state" style={{ marginTop:12 }}>Chưa có giao dịch trong tháng này</div>
      )}
    </div>
  )
}