import * as React from 'react'
const { useEffect, useMemo, useState, useRef } = React
import api from '../api.js'

function useMonthYear() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  return { month, year, setMonth, setYear }
}

export default function Stats() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [data, setData] = useState({ buyers_top: [], buyers_bottom: [], suppliers_top: [], suppliers_bottom: [] })
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [expenses, setExpenses] = useState([])
  const [reportType, setReportType] = useState('fin_month')
  const [season, setSeason] = useState('q1')
  const [selectedCols, setSelectedCols] = useState([])
  const [exportHistory, setExportHistory] = useState([])

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return Array.from({ length: 5 }, (_, i) => y - 2 + i) }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get('/stats', { params: { month, year } })
      setData(res.data || {})
      try { const c = await api.get('/customers'); setCustomers(c.data || []) } catch {}
      try { const s = await api.get('/sales', { params: { month, year } }); setSales(s.data||[]) } catch {}
      try { const p = await api.get('/purchases', { params: { month, year } }); setPurchases(p.data||[]) } catch {}
      try { const e = await api.get('/expenses', { params: { month, year } }); setExpenses(e.data||[]) } catch {}
    } catch (e) { setError(e?.response?.data?.message || 'Tải thống kê lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, year])

  const customerInfo = (name) => {
    const c = customers.find(x => x.name === name)
    return { export_type: c?.export_type || '', country: c?.country || '' }
  }

  const fmt = (v) => (Number(v) || 0).toLocaleString('vi-VN')
  const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN')

  useEffect(() => {
    try { const hist = JSON.parse(localStorage.getItem('exportHistory')||'[]'); setExportHistory(hist) } catch {}
  }, [])
  const saveHistory = (entry) => {
    try {
      const hist = JSON.parse(localStorage.getItem('exportHistory')||'[]')
      const item = { ts: new Date().toISOString(), month, year, reportType, season, cols: selectedCols, meta: entry }
      const next = [item, ...hist].slice(0, 50)
      localStorage.setItem('exportHistory', JSON.stringify(next))
      setExportHistory(next)
    } catch {}
  }

  const seasonMonths = (() => {
    if (season==='q1') return [1,2,3]
    if (season==='q2') return [4,5,6]
    if (season==='q3') return [7,8,9]
    if (season==='q4') return [10,11,12]
    return [month]
  })()
  const buildReport = () => {
    if (reportType === 'fin_month') {
      const totalSales = sales.reduce((s,r)=> s + (Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0)))||0), 0)
      const totalPurchases = purchases.reduce((s,r)=> s + (Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight != null ? r.net_weight : r.weight)||0)) )||0), 0)
      const totalExpenses = expenses.reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const net = totalSales - totalPurchases - totalExpenses
      const rows = [
        { Mục:'Thu', Giá_trị: totalSales },
        { Mục:'Chi (Nhập)', Giá_trị: totalPurchases },
        { Mục:'Chi phí', Giá_trị: totalExpenses },
        { Mục:'Lãi/Lỗ', Giá_trị: net }
      ]
      const cols = ['Mục','Giá_trị']
      return { rows, cols }
    }
    if (reportType === 'debts') {
      const sPend = sales.filter(r => String(r.payment_status)==='pending').map(r => ({ Loại:'Thu', Ngày:r.sale_date, Đối_tác:r.customer_name||'', Tổng_tiền:Number(r.total_amount|| (Number(r.price_per_kg||0)*Number(r.weight||0))), Trạng_thái:r.payment_status }))
      const pPend = purchases.filter(r => String(r.payment_status)==='pending').map(r => ({ Loại:'Chi', Ngày:r.purchase_date, Đối_tác:r.supplier_name||'', Tổng_tiền:Number(r.total_cost|| (Number(r.unit_price||0)*Number((r.net_weight != null ? r.net_weight : r.weight)||0))), Trạng_thái:r.payment_status }))
      const rows = [...sPend, ...pPend]
      const cols = ['Loại','Ngày','Đối_tác','Tổng_tiền','Trạng_thái']
      return { rows, cols }
    }
    if (reportType === 'season_purchase') {
      const monthsSet = new Set(seasonMonths.map(m=>String(m)))
      const rowsMap = new Map()
      purchases.forEach(r => { const m = Number(String(r.purchase_date||'').split('-')[1]||'0'); if (!monthsSet.has(String(m))) return; const key = String(m).padStart(2,'0'); const prev = rowsMap.get(key) || { Tháng:key, Số_vụ:0, Kg:0, Tổng_tiền:0 }
        rowsMap.set(key, { Tháng:key, Số_vụ: prev.Số_vụ+1, Kg: prev.Kg + Number((r.net_weight != null ? r.net_weight : r.weight) || 0), Tổng_tiền: prev.Tổng_tiền + Number(r.total_cost || (Number(r.unit_price||0)*Number((r.net_weight != null ? r.net_weight : r.weight)||0))) })
      })
      const rows = Array.from(rowsMap.values()).sort((a,b)=> a.Tháng.localeCompare(b.Tháng))
      const cols = ['Tháng','Số_vụ','Kg','Tổng_tiền']
      return { rows, cols }
    }
    if (reportType === 'tea_profit') {
      const byTea = new Map()
      const totalSales = sales.reduce((s,r)=> s + (Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0)))||0), 0)
      const totalCosts = purchases.reduce((s,r)=> s + (Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight != null ? r.net_weight : r.weight)||0)))||0), 0) + expenses.reduce((s,r)=> s + (Number(r.amount)||0), 0)
      sales.forEach(r => { const tea = r.tea_type || 'Khác'; const rev = Number(r.total_amount|| (Number(r.price_per_kg||0)*Number(r.weight||0))); const prev = byTea.get(tea) || { Loại_chè: tea, Doanh_thu: 0, Số_vụ: 0, Kg: 0 }
        byTea.set(tea, { Loại_chè: tea, Doanh_thu: prev.Doanh_thu + rev, Số_vụ: prev.Số_vụ + 1, Kg: prev.Kg + Number(r.weight||0) })
      })
      const rows = Array.from(byTea.values()).map(r => { const share = totalSales>0 ? (r.Doanh_thu/totalSales) : 0; const costAlloc = share * totalCosts; const profit = r.Doanh_thu - costAlloc; return { ...r, Chi_phí_phân_bổ: costAlloc, Lợi_nhuận: profit } })
      rows.sort((a,b)=> Number(b.Lợi_nhuận||0) - Number(a.Lợi_nhuận||0))
      const cols = ['Loại_chè','Doanh_thu','Chi_phí_phân_bổ','Lợi_nhuận','Số_vụ','Kg']
      return { rows, cols }
    }
    return { rows: [], cols: [] }
  }

  const currentReport = buildReport()
  useEffect(() => { if (!selectedCols.length) setSelectedCols(currentReport.cols) }, [reportType, season, month, year, sales, purchases, expenses])
  const toggleCol = (c) => setSelectedCols(cols => (cols.includes(c) ? cols.filter(x=>x!==c) : [...cols, c]))
  const exportCsv = () => {
    const cols = selectedCols.length ? selectedCols : currentReport.cols
    const rows = currentReport.rows.map(r => cols.map(k => r[k]))
    const csv = [cols.join(','), ...rows.map(row => row.map(v => (v != null ? v : '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `report_${reportType}_${year}-${String(month).padStart(2,'0')}.csv`; a.click(); URL.revokeObjectURL(url)
    saveHistory({ kind:'csv' })
  }
  const exportPdf = () => {
    const w = window.open('')
    const cols = selectedCols.length ? selectedCols : currentReport.cols
    const header = `<tr>${cols.map(c => `<th>${c.replace(/_/g,' ')}</th>`).join('')}</tr>`
    const rowsHtml = currentReport.rows.map(r => `<tr>${cols.map(c => {
      const val = (r[c] != null ? r[c] : '')
      const txt = (val != null && typeof val.toLocaleString === 'function') ? val.toLocaleString('vi-VN') : val
      return `<td>${txt}</td>`
    }).join('')}</tr>`).join('')
    w.document.write(`<!doctype html><html><head><title>Bao cao ${year}-${String(month).padStart(2,'0')}</title><style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left}td:nth-child(n+2){text-align:right}h3{margin:12px 0}</style></head><body><h3>Báo cáo ${year}-${String(month).padStart(2,'0')}</h3><div>Loại: ${reportType}</div><table><thead>${header}</thead><tbody>${rowsHtml}</tbody></table></body></html>`)
    w.document.close(); w.focus(); w.print()
    saveHistory({ kind:'pdf' })
  }

  return (
    <div className="card">
      <h2>Thống kê Người mua / NCC</h2>
      <div className="section-bar">
        <label>Tháng</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Năm</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && <div className="error" style={{ marginTop:8 }}>{error}</div>}

      <div style={{ marginTop: 12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:8 }}>Người mua nhiều nhất (theo tiền)</div>
          {loading ? 'Đang tải...' : (
            <table className="table">
              <thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng tiền</th><th>Xuất</th><th>Quốc gia</th></tr></thead>
              <tbody>
                {(data.buyers_top||[]).map(r => {
                  const info = customerInfo(r.name)
                  return (
                    <tr key={r.name}><td>{r.name}</td><td className="num">{fmt(r.count)}</td><td className="num">{fmt(r.weight)}</td><td className="num">{fmt(r.amount)}</td><td>{info.export_type}</td><td>{info.country}</td></tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:8 }}>Người mua ít nhất (theo tiền)</div>
          {loading ? 'Đang tải...' : (
            <table className="table">
              <thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng tiền</th><th>Xuất</th><th>Quốc gia</th></tr></thead>
              <tbody>
                {(data.buyers_bottom||[]).map(r => {
                  const info = customerInfo(r.name)
                  return (
                    <tr key={r.name}><td>{r.name}</td><td className="num">{fmt(r.count)}</td><td className="num">{fmt(r.weight)}</td><td className="num">{fmt(r.amount)}</td><td>{info.export_type}</td><td>{info.country}</td></tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:8 }}>NCC nhiều nhất (theo tiền)</div>
          {loading ? 'Đang tải...' : (
            <table className="table">
              <thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng tiền</th></tr></thead>
              <tbody>
                {(data.suppliers_top||[]).map(r => (
                  <tr key={r.name}><td>{r.name}</td><td className="num">{fmt(r.count)}</td><td className="num">{fmt(r.weight)}</td><td className="num">{fmt(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:8 }}>NCC ít nhất (theo tiền)</div>
          {loading ? 'Đang tải...' : (
            <table className="table">
              <thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng tiền</th></tr></thead>
              <tbody>
                {(data.suppliers_bottom||[]).map(r => (
                  <tr key={r.name}><td>{r.name}</td><td className="num">{fmt(r.count)}</td><td className="num">{fmt(r.weight)}</td><td className="num">{fmt(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Báo cáo nâng cao</div>
        <div className="section-bar" style={{ marginBottom:8 }}>
          <label>Loại báo cáo</label>
          <select value={reportType} onChange={(e)=> setReportType(e.target.value)}>
            <option value="fin_month">BCTC thu–chi tháng</option>
            <option value="debts">BCTC công nợ</option>
            <option value="season_purchase">Báo cáo mua theo mùa vụ</option>
            <option value="tea_profit">Báo cáo loại chè (lợi nhuận)</option>
          </select>
          <label>Mùa vụ</label>
          <select value={season} onChange={(e)=> setSeason(e.target.value)}>
            <option value="q1">Q1</option>
            <option value="q2">Q2</option>
            <option value="q3">Q3</option>
            <option value="q4">Q4</option>
          </select>
          <button className="btn" onClick={exportCsv}>Xuất CSV</button>
          <button className="btn" onClick={exportPdf}>Xuất PDF</button>
        </div>
        <div className="muted" style={{ marginBottom:6 }}>Chọn cột để export</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
          { (currentReport.cols||[]).map(c => (
            <label key={c} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
              <input type="checkbox" checked={selectedCols.includes(c)} onChange={()=> toggleCol(c)} /> {c.replace(/_/g,' ')}
            </label>
          )) }
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                {currentReport.cols.map(c => (<th key={c}>{c.replace(/_/g,' ')}</th>))}
              </tr>
            </thead>
            <tbody>
              {currentReport.rows.map((r,i) => (
                <tr key={i}>
                  {currentReport.cols.map(c => {
                    const val = (r[c] != null ? r[c] : '')
                    const txt = (val != null && typeof val.toLocaleString === 'function') ? val.toLocaleString('vi-VN') : val
                    return (<td key={c} className={c==='Mục'||c==='Loại'||c==='Ngày'||c==='Đối_tác'||c==='Loại_chè'?'':'num'}>{txt}</td>)
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Lịch sử xuất báo cáo</div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Thời gian</th><th>Loại</th><th>Tháng</th><th>Năm</th><th>Mùa vụ</th><th>Cột</th></tr></thead>
            <tbody>
              {(exportHistory||[]).map((h,i) => (
                <tr key={i}><td>{h.ts}</td><td>{h.reportType}</td><td className="num">{h.month}</td><td className="num">{h.year}</td><td>{h.season}</td><td>{(h.cols||[]).join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
