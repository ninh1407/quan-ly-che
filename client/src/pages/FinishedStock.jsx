import React, { useEffect, useMemo, useState } from 'react'
import api from '../api.js'

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN')
const parseMoneyInput = (s) => {
  const raw = String(s || '').toLowerCase();
  const mult = /k|nghìn|ngàn/.test(raw) ? 1000 : /tr|triệu|m/.test(raw) ? 1_000_000 : 1;
  const digits = raw.replace(/[^\d]/g, '');
  const val = digits ? Number(digits) : 0;
  return val * mult;
}
const formatMoneyInput = (s) => {
  const v = parseMoneyInput(s);
  return v ? v.toLocaleString('vi-VN') : '';
}

function useMonthYear() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  return { month, year, setMonth, setYear }
}

export default function FinishedStock() {
  const { month, year, setMonth, setYear } = useMonthYear()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ entry_date: '', tea_type: '', weight: '', unit_cost: '', note: '' })
  const [selectedDay, setSelectedDay] = useState('all')

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return Array.from({ length: 5 }, (_, i) => y - 2 + i) }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await api.get('/finished-stock', { params: { month, year } })
      let arr = r.data || []
      if (selectedDay !== 'all') {
        const dd = String(selectedDay).padStart(2,'0')
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${dd}`
        arr = arr.filter(x => String(x.entry_date) === dateStr)
      }
      setItems(arr)
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải thành phẩm lỗi')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, year, selectedDay])

  const submit = async () => {
    try {
      const payload = { ...form, weight: Number(form.weight), unit_cost: parseMoneyInput(form.unit_cost) }
      if (!payload.entry_date) payload.entry_date = `${year}-${String(month).padStart(2,'0')}-01`
      await api.post('/finished-stock', payload)
      setForm({ entry_date: '', tea_type: '', weight: '', unit_cost: '', note: '' })
      load()
    } catch (e) { alert(e?.response?.data?.message || 'Thêm lỗi') }
  }

  const updateItem = async (id, patch) => {
    try { await api.put(`/finished-stock/${id}`, patch); load() } catch (e) { alert(e?.response?.data?.message || 'Sửa lỗi') }
  }
  const deleteItem = async (id) => {
    if (!confirm('Xóa bản ghi?')) return
    try { await api.delete(`/finished-stock/${id}`); load() } catch (e) { alert(e?.response?.data?.message || 'Xóa lỗi') }
  }

  const totalPreview = (() => {
    const w = Number(form.weight||0); const c = parseMoneyInput(form.unit_cost||0); return w*c || 0
  })()

  return (
    <div className="card">
      <h2>Nhập kho thành phẩm</h2>
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
        <div className="inline" style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Ngày</span>
          <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} style={{ width:110 }}>
            <option value="all">Tất cả</option>
            {Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1).map(d => (<option key={d} value={String(d)}>{d}</option>))}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <form onSubmit={(e)=> { e.preventDefault(); submit() }} className="form-grid" style={{ marginTop:12 }}>
        <div className="form-card">
          <div className="card-title">Thông tin nhập</div>
          <div className="group">
            <div>
              <label>Ngày nhập</label>
              <input type="date" value={form.entry_date} onChange={(e)=> setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div>
              <label>Loại chè</label>
              <input placeholder="vd: Ô long" value={form.tea_type} onChange={(e)=> setForm({ ...form, tea_type: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="form-card">
          <div className="card-title">Khối lượng & Giá vốn</div>
          <div className="group">
            <div>
              <label>Khối lượng (kg)</label>
              <input type="number" min="0" step="0.001" value={form.weight} onChange={(e)=> setForm({ ...form, weight: e.target.value })} />
            </div>
            <div>
              <label>Giá vốn (đ/kg)</label>
              <input placeholder="vd: 100k" value={form.unit_cost} onChange={(e)=> setForm({ ...form, unit_cost: formatMoneyInput(e.target.value) })} />
            </div>
            <div>
              <div className="total-money">💰 Tổng vốn dự tính: {fmtMoney(totalPreview)} đ</div>
            </div>
          </div>
        </div>
        <div className="form-card">
          <div className="card-title">Ghi chú & Lưu</div>
          <div className="group">
            <div>
              <label>Ghi chú</label>
              <input value={form.note} onChange={(e)=> setForm({ ...form, note: e.target.value })} />
            </div>
            <div>
              <button className="submit" type="submit">Thêm</button>
            </div>
          </div>
        </div>
      </form>

      <div className="table-wrap" style={{ marginTop:12 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead>
              <tr>
                <th>Ngày</th><th>Loại chè</th><th className="num">KL (kg)</th><th className="num">Giá vốn</th><th>Ghi chú</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(items||[]).map(r => (
                <tr key={r.id}>
                  <td>{r.entry_date}</td>
                  <td>{r.tea_type||''}</td>
                  <td className="num">{(Number(r.weight)||0).toLocaleString('vi-VN')}</td>
                  <td className="num">{fmtMoney(r.unit_cost)}</td>
                  <td>{r.note||''}</td>
                  <td>
                    <button className="btn" onClick={() => {
                      const w = prompt('Khối lượng (kg)', String(r.weight||''));
                      if (w==null) return; updateItem(r.id, { weight: Number(w) })
                    }}>Sửa KL</button>
                    <button className="btn" style={{ marginLeft:6 }} onClick={() => {
                      const c = prompt('Giá vốn (đ/kg)', String(r.unit_cost||''));
                      if (c==null) return; updateItem(r.id, { unit_cost: Number(c) })
                    }}>Sửa giá</button>
                    <button className="btn" style={{ marginLeft:6 }} onClick={() => deleteItem(r.id)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
