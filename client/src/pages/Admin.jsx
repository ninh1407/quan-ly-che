import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ username: '', password: '', role: 'user' })

  const load = async () => {
    setLoading(true); setError('')
    try { const r = await api.get('/users'); setUsers(r.data || []) }
    catch (e) { setError(e?.response?.data?.message || 'Tải danh sách lỗi') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }))
  const onSubmit = async (e) => {
    e.preventDefault(); setError('')
    if (!form.username || !form.password) { setError('Nhập username/password'); return }
    try { await api.post('/users', form); setForm({ username: '', password: '', role: 'user' }); await load() }
    catch (e) { setError(e?.response?.data?.message || e?.response?.data?.detail || 'Tạo user lỗi') }
  }

  return (
    <div className="card">
      <h2>Quản trị – Tạo Role</h2>
      <form onSubmit={onSubmit} className="form">
        <label>Username</label><input value={form.username} onChange={(e) => change('username', e.target.value)} />
        <label>Password</label><input type="password" value={form.password} onChange={(e) => change('password', e.target.value)} />
        <label>Role</label>
        <select value={form.role} onChange={(e) => change('role', e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">Tạo user</button>
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead><tr><th>Username</th><th>Role</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}><td>{u.username}</td><td>{u.role}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
