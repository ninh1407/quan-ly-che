import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN')

function useMonthYear() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  return { month, year, setMonth, setYear }
}

export default function BalanceSheet() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState({
    receivables: 0,
    payables: 0,
    inventoryWeight: 0,
    inventoryValue: 0,
    netProfit: 0,
    cashflowNet: 0,
    receivablesByAging: { in7: 0, in30: 0, over30: 0 },
    receivablesByCustomer: [],
    payablesByAging: { in7: 0, in30: 0, over30: 0 },
    payablesBySupplier: [],
    openingStock: 0,
    periodIn: 0,
    periodOut: 0,
    closingStock: 0,
    prepaidExpenses: 0,
    pendingCosts: 0,
    taxes: 0,
    shortTermLoans: 0,
    longTermLoans: 0,
    cumulativeProfit: 0,
  })
  const [valuationMethod, setValuationMethod] = useState(localStorage.getItem('valuationMethod') || 'month_avg')
  const [initialCapital, setInitialCapital] = useState(() => { const v = localStorage.getItem('initialCapital'); return v ? Number(v) : 0 })

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => y - 2 + i)
  }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const paramsPending = { month, year, payment_status: 'pending' }
      const paramsAll = { month, year }
      const [rsPending, rpPending, rsAll, rpAll, rexpAll, dash, rsAllGlobal, rpAllGlobal, rexpAllGlobal] = await Promise.all([
        api.get('/sales', { params: paramsPending }),
        api.get('/purchases', { params: paramsPending }),
        api.get('/sales', { params: paramsAll }),
        api.get('/purchases', { params: paramsAll }),
        api.get('/expenses', { params: paramsAll }),
        api.get('/dashboard', { params: paramsAll }),
        api.get('/sales'),
        api.get('/purchases'),
        api.get('/expenses'),
      ])
      const receivables = (rsPending.data||[]).reduce((s, r) => s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0) * Number(r.weight||0))), 0)
      const payables = (rpPending.data||[]).reduce((s, r) => s + Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0) * Number((r.net_weight ?? r.weight) || 0))), 0)
      const salesAll = rsAll.data||[]
      const purchAll = rpAll.data||[]
      const expAll = rexpAll.data||[]
      const salesWeight = salesAll.reduce((s, r) => s + Number(r.weight||0), 0)
      const purchasesNet = purchAll.reduce((s, r) => s + Number((r.net_weight ?? r.weight) || 0), 0)
      const inventoryWeight = Math.max(0, purchasesNet - salesWeight)
      const totalPurchValue = purchAll.reduce((s, r) => s + Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0) * Number((r.net_weight ?? r.weight) || 0))), 0)
      const refDate = new Date(`${String(year)}-${String(month).padStart(2,'0')}-28`)
      const windowDays = valuationMethod==='7d_avg' ? 7 : (valuationMethod==='30d_avg' ? 30 : null)
      let avgUnitCost = 0
      if (windowDays != null) {
        const since = new Date(refDate.getTime() - windowDays*24*3600*1000)
        const items = (rpAllGlobal.data||[]).filter(r => { const d = new Date(r.purchase_date); return d >= since && d <= refDate })
        const sum = items.reduce((s,r)=> s + Number(r.unit_price||0) * Number((r.net_weight ?? r.weight) || 0), 0)
        const wsum = items.reduce((s,r)=> s + Number((r.net_weight ?? r.weight) || 0), 0)
        avgUnitCost = wsum>0 ? (sum/wsum) : 0
      } else {
        avgUnitCost = purchasesNet > 0 ? (totalPurchValue / purchasesNet) : 0
      }
      const inventoryValue = Math.round(avgUnitCost * inventoryWeight)
      const netProfit = Number(dash.data?.netProfit || 0)
      const paidSales = salesAll.filter(r => String(r.payment_status)==='paid').reduce((s,r)=> s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))), 0)
      const paidPurchases = purchAll.filter(r => String(r.payment_status)==='paid').reduce((s,r)=> s + Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight ?? r.weight) || 0))), 0)
      const paidExpenses = expAll.reduce((s, r) => s + Number(r.amount||0), 0) // giả định chi phí đã chi
      const cashflowNet = paidSales - paidPurchases - paidExpenses
      const salesGlobal = rsAllGlobal.data||[]
      const purchGlobal = rpAllGlobal.data||[]
      const expGlobal = rexpAllGlobal.data||[]
      const firstDay = new Date(`${String(year)}-${String(month).padStart(2,'0')}-01`)
      const openingPurch = purchGlobal.filter(r => new Date(r.purchase_date) < firstDay).reduce((s,r)=> s + Number((r.net_weight ?? r.weight) || 0), 0)
      const openingSales = salesGlobal.filter(r => new Date(r.sale_date) < firstDay).reduce((s,r)=> s + Number(r.weight || 0), 0)
      const openingStock = Math.max(0, openingPurch - openingSales)
      const periodIn = purchasesNet
      const periodOut = salesWeight
      const closingStock = Math.max(0, openingStock + periodIn - periodOut)
      const now = new Date()
      const daysDiff = (d) => Math.floor((now.getTime() - new Date(d).getTime())/(24*3600*1000))
      const receivablesByAging = { in7:0, in30:0, over30:0 }
      ;(rsPending.data||[]).forEach(r => { const dd = daysDiff(r.sale_date); const val = Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))); if (dd <= 7) receivablesByAging.in7 += val; else if (dd <= 30) receivablesByAging.in30 += val; else receivablesByAging.over30 += val })
      const receivablesByCustomerMap = new Map()
      ;(rsPending.data||[]).forEach(r => { const k = String(r.customer_name||''); const v = Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))); receivablesByCustomerMap.set(k, (receivablesByCustomerMap.get(k)||0)+v) })
      const receivablesByCustomer = Array.from(receivablesByCustomerMap.entries()).map(([name,amount])=>({ name, amount }))
      const payablesByAging = { in7:0, in30:0, over30:0 }
      ;(rpPending.data||[]).forEach(r => { const dd = daysDiff(r.purchase_date); const val = Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight ?? r.weight) || 0))); if (dd <= 7) payablesByAging.in7 += val; else if (dd <= 30) payablesByAging.in30 += val; else payablesByAging.over30 += val })
      const payablesBySupplierMap = new Map()
      ;(rpPending.data||[]).forEach(r => { const k = String(r.supplier_name||''); const v = Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight ?? r.weight) || 0))); payablesBySupplierMap.set(k, (payablesBySupplierMap.get(k)||0)+v) })
      const payablesBySupplier = Array.from(payablesBySupplierMap.entries()).map(([name,amount])=>({ name, amount }))
      const pendingCosts = (expAll||[]).filter(r => !r.receipt_path).reduce((s,r)=> s + Number(r.amount||0), 0)
      const cumulativeProfit = salesGlobal.reduce((s,r)=> s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))), 0) - purchGlobal.reduce((s,r)=> s + Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number((r.net_weight ?? r.weight) || 0))), 0) - expGlobal.reduce((s,r)=> s + Number(r.amount||0), 0)
      setData({ receivables, payables, inventoryWeight, inventoryValue, netProfit, cashflowNet,
        receivablesByAging, receivablesByCustomer, payablesByAging, payablesBySupplier,
        openingStock, periodIn, periodOut, closingStock,
        prepaidExpenses: 0, pendingCosts, taxes: 0, shortTermLoans: 0, longTermLoans: 0,
        cumulativeProfit,
      })
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải BCTC lỗi')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [month, year])

  const assetsTotal = Number(data.receivables||0) + Number(data.inventoryValue||0) + Math.max(0, Number(data.cashflowNet||0)) + Number(data.prepaidExpenses||0)
  const liabilitiesTotal = Number(data.payables||0)
  const equityTotal = Number(data.netProfit||0)
  const balanceOk = Math.abs(assetsTotal - (liabilitiesTotal + equityTotal)) < 1

  return (
    <div className="card">
      <h2>Bảng cân đối kế toán</h2>
      <div className="section-bar" style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <div className="inline" style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Tháng</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ width:110 }}>
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="inline" style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Năm</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width:110 }}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="inline" style={{ display:'flex', gap:6, alignItems:'center', marginLeft:'auto' }}>
          <span>Định giá tồn</span>
          <select value={valuationMethod} onChange={(e)=> { setValuationMethod(e.target.value); localStorage.setItem('valuationMethod', e.target.value); load() }}>
            <option value="month_avg">TB tháng</option>
            <option value="7d_avg">TB 7 ngày</option>
            <option value="30d_avg">TB 30 ngày</option>
          </select>
        </div>
        <div className="inline" style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Vốn góp</span>
          <input type="number" value={initialCapital} onChange={(e)=> { const v = Number(e.target.value||0); setInitialCapital(v); try { localStorage.setItem('initialCapital', String(v)) } catch {} }} />
        </div>
      </div>

      {loading ? (
        <div className="table-wrap">Đang tải...</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div className="card">
            <div style={{ fontWeight:700, marginBottom:6 }}>Tài sản</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mục</th><th className="num">Giá trị</th></tr></thead>
                <tbody>
                  <tr><td>Phải thu</td><td className="num">{fmtMoney(data.receivables)}</td></tr>
                  <tr><td>Hàng tồn (ước tính)</td><td className="num">{fmtMoney(data.inventoryValue)}</td></tr>
                  <tr><td>Tiền mặt (ước tính)</td><td className="num">{fmtMoney(Math.max(0, data.cashflowNet))}</td></tr>
                  <tr><td>Chi phí trả trước</td><td className="num">{fmtMoney(data.prepaidExpenses)}</td></tr>
                  <tr style={{ fontWeight:700 }}><td>Tổng tài sản</td><td className="num">{fmtMoney(assetsTotal)}</td></tr>
                </tbody>
              </table>
              <div className="muted" style={{ marginTop:6 }}>Tồn kho: {Number(data.inventoryWeight||0).toLocaleString()} kg • Mở kỳ: {Number(data.openingStock||0).toLocaleString()} kg • Nhập: {Number(data.periodIn||0).toLocaleString()} kg • Xuất: {Number(data.periodOut||0).toLocaleString()} kg • Cuối kỳ: {Number(data.closingStock||0).toLocaleString()} kg</div>
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight:700, marginBottom:6 }}>Nợ phải trả & Vốn chủ sở hữu</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mục</th><th className="num">Giá trị</th></tr></thead>
                <tbody>
                  <tr><td>Phải trả</td><td className="num">{fmtMoney(data.payables)}</td></tr>
                  <tr><td>Chi phí phải trả</td><td className="num">{fmtMoney(data.pendingCosts)}</td></tr>
                  <tr><td>Thuế & khoản phải nộp</td><td className="num">{fmtMoney(data.taxes)}</td></tr>
                  <tr><td>Nợ vay ngắn hạn</td><td className="num">{fmtMoney(data.shortTermLoans)}</td></tr>
                  <tr><td>Nợ vay dài hạn</td><td className="num">{fmtMoney(data.longTermLoans)}</td></tr>
                  <tr><td>Vốn (Lợi nhuận tháng)</td><td className="num">{fmtMoney(equityTotal)}</td></tr>
                  <tr><td>Vốn góp ban đầu</td><td className="num">{fmtMoney(initialCapital)}</td></tr>
                  <tr><td>Lợi nhuận giữ lại</td><td className="num">{fmtMoney(Math.max(0, assetsTotal - (liabilitiesTotal + initialCapital)))}</td></tr>
                  <tr><td>Lãi/lỗ lũy kế</td><td className="num">{fmtMoney(data.cumulativeProfit)}</td></tr>
                  <tr style={{ fontWeight:700 }}><td>Tổng nợ + vốn</td><td className="num">{fmtMoney(liabilitiesTotal + equityTotal)}</td></tr>
                </tbody>
              </table>
              <div className={balanceOk ? 'muted' : 'error'} style={{ marginTop:6 }}>{balanceOk ? 'Cân đối' : 'Chênh lệch nhỏ do ước tính tồn/tiền mặt'}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Aging Phải thu</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nhóm</th><th className="num">Giá trị</th></tr></thead>
              <tbody>
                <tr><td>Trong hạn ≤ 7 ngày</td><td className="num">{fmtMoney(data.receivablesByAging.in7)}</td></tr>
                <tr><td>≤ 30 ngày</td><td className="num">{fmtMoney(data.receivablesByAging.in30)}</td></tr>
                <tr><td>> 30 ngày</td><td className="num">{fmtMoney(data.receivablesByAging.over30)}</td></tr>
              </tbody>
            </table>
            <div className="table-wrap" style={{ marginTop:8 }}>
              <table className="table">
                <thead><tr><th>Khách</th><th className="num">Phải thu</th></tr></thead>
                <tbody>
                  {(data.receivablesByCustomer||[]).map(r => (<tr key={r.name}><td>{r.name}</td><td className="num">{fmtMoney(r.amount)}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Aging Phải trả</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nhóm</th><th className="num">Giá trị</th></tr></thead>
              <tbody>
                <tr><td>Trong hạn ≤ 7 ngày</td><td className="num">{fmtMoney(data.payablesByAging.in7)}</td></tr>
                <tr><td>≤ 30 ngày</td><td className="num">{fmtMoney(data.payablesByAging.in30)}</td></tr>
                <tr><td>> 30 ngày</td><td className="num">{fmtMoney(data.payablesByAging.over30)}</td></tr>
              </tbody>
            </table>
            <div className="table-wrap" style={{ marginTop:8 }}>
              <table className="table">
                <thead><tr><th>Nhà CC</th><th className="num">Phải trả</th></tr></thead>
                <tbody>
                  {(data.payablesBySupplier||[]).map(r => (<tr key={r.name}><td>{r.name}</td><td className="num">{fmtMoney(r.amount)}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
