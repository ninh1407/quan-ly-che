import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function Suppliers() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '', note: '' })
  const [query, setQuery] = useState('')
  const rolesRaw = (() => { try { const r = JSON.parse(localStorage.getItem('roles')||'null'); if (Array.isArray(r)) return r; } catch {} const s = (localStorage.getItem('role')||'user'); return String(s).split(',').map(x=>x.trim()) })()
  const hasRole = (name) => rolesRaw.includes(name)

  const load = async () => {
    setLoading(true); setError('')
    try { const res = await api.get('/suppliers'); setList(res.data) }
    catch (e) { setError(e?.response?.data?.message || 'Tải danh sách lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }))

  const onSubmit = async (e) => {
    e.preventDefault(); setError('')
    if (!form.name) { setError('Vui lòng nhập tên'); return }
    try {
      if (editingId) {
        if (!hasRole('admin')) { setError('Chỉ admin mới được sửa'); return }
        await api.put(`/suppliers/${editingId}`, form); setEditingId(null)
      }
      else { await api.post('/suppliers', form) }
      setForm({ name: '', phone: '', address: '', note: '' }); await load()
    } catch (e) { setError(e?.response?.data?.message || 'Lưu nhà cung cấp lỗi') }
  }

  const editRow = (r) => { if (!hasRole('admin')) return; setEditingId(r.id); setForm({ name: r.name||'', phone: r.phone||'', address: r.address||'', note: r.note||'' }) }
  const deleteRow = async (id) => { if (!hasRole('admin')) { setError('Chỉ admin mới được xóa'); return } if (!window.confirm('Xóa nhà cung cấp?')) return; try { await api.delete(`/suppliers/${id}`); await load() } catch (e) { setError(e?.response?.data?.message || 'Xóa lỗi') } }

  return (
    <div className="card">
      <h2>Nhà cung cấp</h2>
      <div className="section-bar" style={{ marginBottom: 8 }}>
        <label>Lọc</label>
        <input placeholder="Tên/ĐT/Địa chỉ/Ghi chú" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <form onSubmit={onSubmit} className="form">
        <label>Tên</label><input value={form.name} onChange={(e) => change('name', e.target.value)} />
        <label>Điện thoại</label><input value={form.phone} onChange={(e) => change('phone', e.target.value)} />
        <label>Địa chỉ</label><input value={form.address} onChange={(e) => change('address', e.target.value)} />
        <label>Ghi chú</label><input value={form.note} onChange={(e) => change('note', e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu' : 'Thêm'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ name: '', phone: '', address: '', note: '' }) }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead><tr><th>Tên</th><th>ĐT</th><th>Địa chỉ</th><th>Ghi chú</th><th>Hành động</th></tr></thead>
            <tbody>
              {(query ? list.filter(r => {
                const s = query.toLowerCase()
                return [r.name, r.phone, r.address, r.note].some(v => String(v||'').toLowerCase().includes(s))
              }) : list).map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.phone}</td><td>{r.address}</td><td>{r.note}</td>
                  <td>
                    {hasRole('admin') && <button className="btn" onClick={() => editRow(r)}>Sửa</button>}
                    {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>}
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
