import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function Staff() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', role: 'creator', phone: '', note: '' })

  const load = async () => {
    setLoading(true); setError('')
    try { const res = await api.get('/staff'); setList(res.data) }
    catch (e) { setError(e?.response?.data?.message || 'Tải danh sách lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }))

  const onSubmit = async (e) => {
    e.preventDefault(); setError('')
    if (!form.name) { setError('Vui lòng nhập tên'); return }
    try {
      if (editingId) { await api.put(`/staff/${editingId}`, form); setEditingId(null) }
      else { await api.post('/staff', form) }
      setForm({ name: '', role: 'creator', phone: '', note: '' }); await load()
    } catch (e) { setError(e?.response?.data?.message || 'Lưu nhân sự lỗi') }
  }

  const editRow = (r) => { setEditingId(r.id); setForm({ name: r.name||'', role: r.role||'creator', phone: r.phone||'', note: r.note||'' }) }
  const deleteRow = async (id) => { if (!window.confirm('Xóa nhân sự?')) return; try { await api.delete(`/staff/${id}`); await load() } catch (e) { setError(e?.response?.data?.message || 'Xóa lỗi') } }

  return (
    <div className="card">
      <h2>Người tạo phiếu / Bán hàng</h2>
      <form onSubmit={onSubmit} className="form">
        <label>Tên</label><input value={form.name} onChange={(e) => change('name', e.target.value)} />
        <label>Vai trò</label>
        <select value={form.role} onChange={(e) => change('role', e.target.value)}>
          <option value="creator">Người tạo phiếu</option>
          <option value="seller">Người bán hàng</option>
        </select>
        <label>Điện thoại</label><input value={form.phone} onChange={(e) => change('phone', e.target.value)} />
        <label>Ghi chú</label><input value={form.note} onChange={(e) => change('note', e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu' : 'Thêm'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ name: '', role: 'creator', phone: '', note: '' }) }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead><tr><th>Tên</th><th>Vai trò</th><th>ĐT</th><th>Ghi chú</th><th>Hành động</th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{r.role}</td><td>{r.phone}</td><td>{r.note}</td>
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
