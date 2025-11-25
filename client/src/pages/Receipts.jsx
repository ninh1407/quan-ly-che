import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

const fmtDate = (s) => { try { const d = new Date(s); return isNaN(d.getTime()) ? (s||'') : d.toISOString().slice(0,10) } catch { return s||'' } }

export default function Receipts() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth()+1)
  const [year, setYear] = useState(now.getFullYear())
  const [type, setType] = useState('all')
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      const r = await api.get('/receipts', { params })
      setList(r.data||[])
    } catch (e) { setError(e?.response?.data?.message || 'Tải ảnh lỗi') }
    finally { setLoading(false) }
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
      </div>
      {error && <div className="error" style={{ marginTop:8 }}>{error}</div>}
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
