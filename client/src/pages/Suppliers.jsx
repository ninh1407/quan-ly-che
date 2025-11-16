import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function Suppliers() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '', note: '' })

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
      if (editingId) { await api.put(`/suppliers/${editingId}`, form); setEditingId(null) }
      else { await api.post('/suppliers', form) }
      setForm({ name: '', phone: '', address: '', note: '' }); await load()
    } catch (e) { setError(e?.response?.data?.message || 'Lưu nhà cung cấp lỗi') }
  }

  const editRow = (r) => { setEditingId(r.id); setForm({ name: r.name||'', phone: r.phone||'', address: r.address||'', note: r.note||'' }) }
  const deleteRow = async (id) => { if (!window.confirm('Xóa nhà cung cấp?')) return; try { await api.delete(`/suppliers/${id}`); await load() } catch (e) { setError(e?.response?.data?.message || 'Xóa lỗi') } }

  return (
    <div className="card">
      <h2>Nhà cung cấp</h2>
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
              {list.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.phone}</td><td>{r.address}</td><td>{r.note}</td>
                  <td>
                    <button className="btn" onClick={() => editRow(r)}>Sửa</button>
                    <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>
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
