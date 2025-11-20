import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN')

function useMonthYear() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  return { month, year, setMonth, setYear }
}

export default function Debts() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const role = (localStorage.getItem('role') || '').toLowerCase()
  const [query, setQuery] = useState('')

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => y - 2 + i)
  }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { month, year, payment_status: 'pending' }
      const [rs, rp] = await Promise.all([
        api.get('/sales', { params }),
        api.get('/purchases', { params })
      ])
      setSales(rs.data || [])
      setPurchases(rp.data || [])
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải công nợ lỗi')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [month, year])

  const markPaidSale = async (id) => {
    try { await api.put(`/sales/${id}`, { payment_status: 'paid' }); await load() } catch (e) { setError(e?.response?.data?.message || 'Cập nhật công nợ thu lỗi') }
  }
  const markPaidPurchase = async (id) => {
    try { await api.put(`/purchases/${id}`, { payment_status: 'paid' }); await load() } catch (e) { setError(e?.response?.data?.message || 'Cập nhật công nợ chi lỗi') }
  }

  const totalReceivable = sales.reduce((s, r) => s + (Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))) || 0), 0)
  const totalPayable = purchases.reduce((s, r) => s + (Number(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number(((r.net_weight ?? r.weight) || 0)))) || 0), 0)

  return (
    <div className="card">
      <h2>Công nợ</h2>
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
        <div className="muted" style={{ marginLeft:'auto' }}>Thu: {fmtMoney(totalReceivable)} | Chi: {fmtMoney(totalPayable)}</div>
      </div>
      <div className="section-bar" style={{ display:'flex', gap:8, alignItems:'center', marginTop:8 }}>
        <label>Lọc</label>
        <input placeholder="Khách/nhà CC/loại/ghi chú" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        {loading ? 'Đang tải...' : (
          <>
            <div className="card">
              <div style={{ fontWeight:700, marginBottom:8 }}>Công nợ phải thu</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Khách</th>
                    <th>Loại chè</th>
                    <th className="num">Kg</th>
                    <th className="num">Giá/kg</th>
                    <th className="num">Tổng</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {(query ? sales.filter(r => {
                    const s = query.toLowerCase()
                    return [r.customer_name, r.tea_type].some(v => String(v||'').toLowerCase().includes(s))
                  }) : sales).map(r => (
                    <tr key={r.id}>
                      <td>{r.sale_date}</td>
                      <td>{r.customer_name}</td>
                      <td>{r.tea_type}</td>
                      <td className="num">{(Number(r.weight)||0).toLocaleString()}</td>
                      <td className="num">{fmtMoney(r.price_per_kg)}</td>
                      <td className="num">{fmtMoney(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0)))}</td>
                      <td>
                        {role === 'admin' && <button className="btn" onClick={() => markPaidSale(r.id)}>Đã thu</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>Công nợ phải trả</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Nhà CC</th>
                    <th className="num">Kg</th>
                    <th className="num">% Nước</th>
                    <th className="num">Sau trừ hao</th>
                    <th className="num">Giá/kg</th>
                    <th className="num">Tổng</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {(query ? purchases.filter(r => {
                    const s = query.toLowerCase()
                    return [r.supplier_name, r.ticket_name, r.vehicle_plate].some(v => String(v||'').toLowerCase().includes(s))
                  }) : purchases).map(r => (
                    <tr key={r.id}>
                      <td>{r.purchase_date}</td>
                      <td>{r.supplier_name}</td>
                      <td className="num">{(Number(r.weight)||0).toLocaleString()}</td>
                      <td className="num">{r.water_percent ?? ''}</td>
                      <td className="num">{(Number(r.net_weight ?? r.weight)||0).toLocaleString()}</td>
                      <td className="num">{fmtMoney(r.unit_price)}</td>
                      <td className="num">{fmtMoney(r.total_cost != null ? r.total_cost : (Number(r.unit_price||0)*Number(((r.net_weight ?? r.weight) || 0))))}</td>
                      <td>
                        {role === 'admin' && <button className="btn" onClick={() => markPaidPurchase(r.id)}>Đã trả</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
          </>
        )}
      </div>
    </div>
  )
}
