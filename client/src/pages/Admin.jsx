import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ username: '', password: '', roles: [] })
  const [logs, setLogs] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState('')
  const [logFilter, setLogFilter] = useState({ entity: 'sales', entity_id: '' })
  const [editingUser, setEditingUser] = useState(null)
  const [pwdForm, setPwdForm] = useState({ id: '', new_password: '' })
  const [backupList, setBackupList] = useState([])

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
    try {
      const role = (form.roles||[]).join(',') || 'user'
      await api.post('/users', { username: form.username, password: form.password, role })
      setForm({ username: '', password: '', roles: [] }); await load()
    }
    catch (e) { setError(e?.response?.data?.message || e?.response?.data?.detail || 'Tạo user lỗi') }
  }

  const editUser = (u) => { setEditingUser({ id: u.id, username: u.username, roles: Array.isArray(u.role) ? u.role : String(u.role||'').split(',').map(s=>s.trim()).filter(Boolean) }) }
  const saveUser = async () => {
    setError(''); if (!editingUser) return; const { id, username, roles } = editingUser; try { await api.put(`/users/${id}`, { username, roles }); setEditingUser(null); await load() } catch (e) { setError(e?.response?.data?.message || 'Lưu user lỗi') }
  }
  const deleteUser = async (id) => {
    if (!window.confirm('Xóa user này?')) return;
    try {
      const u = users.find(x => x.id === id)
      const me = (localStorage.getItem('username')||'')
      if (u && u.username === me) { setError('Không thể xóa chính tài khoản đang đăng nhập'); return }
      let d = 0, disabled = 0
      try {
        const r = await api.post('/admin/users/delete', { id, username: u?.username })
        d = Number(r?.data?.deleted || 0); disabled = Number(r?.data?.disabled || 0)
      } catch (e1) {}
      if (!d && !disabled) {
        try {
          const r2 = await api.delete('/users', { params: { id, username: u?.username } })
          d = Number(r2?.data?.deleted || 0); disabled = Number(r2?.data?.disabled || 0)
        } catch (e2) {}
      }
      if (!d && !disabled) {
        try {
          const r3 = await api.delete(`/users/${id}`, { params: { username: u?.username } })
          d = Number(r3?.data?.deleted || 0); disabled = Number(r3?.data?.disabled || 0)
        } catch (e3) {}
      }
      if (!d && !disabled) { setError('Không tìm thấy user để xóa'); return }
      await load()
    } catch (e) { setError(e?.response?.data?.message || e?.response?.data?.detail || 'Xóa user lỗi') }
  }
  const changePwd = async () => { setError(''); if (!pwdForm.id || !pwdForm.new_password) { setError('Nhập ID và mật khẩu mới'); return } try { await api.put(`/users/${pwdForm.id}/password`, { new_password: pwdForm.new_password }); setPwdForm({ id:'', new_password:'' }) } catch (e) { setError(e?.response?.data?.message || 'Đổi mật khẩu lỗi') } }

  const loadLogs = async () => {
    setLogLoading(true); setLogError('')
    try {
      const params = { entity: logFilter.entity }
      if (logFilter.entity_id) params.entity_id = logFilter.entity_id
      const r = await api.get('/audit', { params })
      setLogs(r.data || [])
    } catch (e) { setLogError(e?.response?.data?.message || 'Tải nhật ký lỗi') }
    finally { setLogLoading(false) }
  }
  useEffect(() => { loadLogs() }, [])
  const loadBackups = async () => { try { const r = await api.get('/admin/backups'); setBackupList(r.data||[]) } catch {} }
  useEffect(() => { loadBackups() }, [])
  const createBackup = async () => { try { const r = await api.post('/admin/backup'); await loadBackups(); alert(`Đã sao lưu: ${r.data?.name}`) } catch (e) { setError(e?.response?.data?.message || 'Sao lưu lỗi') } }
  const restoreBackup = async (name) => { if (!window.confirm(`Khôi phục từ ${name}?`)) return; try { await api.post('/admin/restore', { name }); alert('Khôi phục xong, vui lòng tải lại trang'); } catch (e) { setError(e?.response?.data?.message || 'Khôi phục lỗi') } }
  const [wipeConfirm, setWipeConfirm] = useState('')
  const wipeAll = async () => { if (String(wipeConfirm).toUpperCase() !== 'DELETE') { alert('Nhập DELETE để xác nhận'); return } try { const r = await api.post('/admin/wipe', { confirm: 'DELETE' }); alert(`Đã xóa toàn bộ dữ liệu. Xóa ${r.data?.cleared?.length||0} bảng, ${r.data?.files_removed||0} ảnh.`) } catch (e) { setError(e?.response?.data?.message || 'Xóa dữ liệu lỗi') } }

  return (
    <div className="card">
      <h2>Quản trị – Quản lý quyền</h2>
      <form onSubmit={onSubmit} className="form">
        <label>Tên đăng nhập</label><input value={form.username} onChange={(e) => change('username', e.target.value)} />
        <label>Mật khẩu</label><input type="password" value={form.password} onChange={(e) => change('password', e.target.value)} />
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.roles.includes('seller')} onChange={(e)=> change('roles', e.target.checked ? [...new Set([...(form.roles||[]),'seller'])] : (form.roles||[]).filter(x=>x!=='seller'))} /> Nhân viên bán hàng</label>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.roles.includes('warehouse')} onChange={(e)=> change('roles', e.target.checked ? [...new Set([...(form.roles||[]),'warehouse'])] : (form.roles||[]).filter(x=>x!=='warehouse'))} /> Nhân viên kho</label>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.roles.includes('finance')} onChange={(e)=> change('roles', e.target.checked ? [...new Set([...(form.roles||[]),'finance'])] : (form.roles||[]).filter(x=>x!=='finance'))} /> Nhân viên tài chính</label>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.roles.includes('admin')} onChange={(e)=> change('roles', e.target.checked ? [...new Set([...(form.roles||[]),'admin'])] : (form.roles||[]).filter(x=>x!=='admin'))} /> Admin</label>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">Lưu user</button>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight:700, marginBottom:8, color:'#c62828' }}>Xóa toàn bộ dữ liệu</div>
        <div className="form">
          <label>Nhập DELETE để xác nhận</label>
          <input value={wipeConfirm} onChange={(e)=> setWipeConfirm(e.target.value)} />
          <button className="btn" onClick={wipeAll}>Xóa dữ liệu</button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead><tr><th>Tên đăng nhập</th><th>Vai trò</th><th>Hành động</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{Array.isArray(u.role) ? u.role.join(',') : (u.role||'')}</td>
                  <td>
                    <button className="btn" onClick={() => editUser(u)}>Sửa</button>
                    <button className="btn" style={{ marginLeft:6 }} onClick={() => deleteUser(u.id)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingUser && (
        <div className="card" style={{ marginTop:16 }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Sửa User</div>
          <div className="form">
            <label>Username</label>
            <input value={editingUser.username} onChange={(e)=> setEditingUser(s=> ({ ...s, username: e.target.value }))} />
            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={(editingUser.roles||[]).includes('seller')} onChange={(e)=> setEditingUser(s=> ({ ...s, roles: e.target.checked ? [...new Set([...(s.roles||[]),'seller'])] : (s.roles||[]).filter(x=>x!=='seller') }))} /> Nhân viên bán hàng</label>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={(editingUser.roles||[]).includes('warehouse')} onChange={(e)=> setEditingUser(s=> ({ ...s, roles: e.target.checked ? [...new Set([...(s.roles||[]),'warehouse'])] : (s.roles||[]).filter(x=>x!=='warehouse') }))} /> Nhân viên kho</label>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={(editingUser.roles||[]).includes('finance')} onChange={(e)=> setEditingUser(s=> ({ ...s, roles: e.target.checked ? [...new Set([...(s.roles||[]),'finance'])] : (s.roles||[]).filter(x=>x!=='finance') }))} /> Nhân viên tài chính</label>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={(editingUser.roles||[]).includes('admin')} onChange={(e)=> setEditingUser(s=> ({ ...s, roles: e.target.checked ? [...new Set([...(s.roles||[]),'admin'])] : (s.roles||[]).filter(x=>x!=='admin') }))} /> Admin</label>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button className="btn" onClick={() => setEditingUser(null)}>Hủy</button>
            <button className="btn primary" onClick={saveUser}>Lưu</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Đổi mật khẩu người dùng</div>
        <div className="form">
          <label>ID người dùng</label>
          <input value={pwdForm.id} onChange={(e)=> setPwdForm(s=> ({ ...s, id: e.target.value }))} />
          <label>Mật khẩu mới</label>
          <input type="password" value={pwdForm.new_password} onChange={(e)=> setPwdForm(s=> ({ ...s, new_password: e.target.value }))} />
          <button className="btn" onClick={changePwd}>Đổi mật khẩu</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:10, alignItems:'center' }}>
          <div>
            <label>Bảng</label>
            <select value={logFilter.entity} onChange={(e)=> setLogFilter(s=>({ ...s, entity:e.target.value }))}>
              <option value="sales">sales</option>
              <option value="purchases">purchases</option>
              <option value="expenses">expenses</option>
            </select>
          </div>
          <div>
            <label>ID</label>
            <input value={logFilter.entity_id} onChange={(e)=> setLogFilter(s=>({ ...s, entity_id:e.target.value }))} />
          </div>
          <div className="muted">Nhật ký hoạt động</div>
          <button className="btn" onClick={loadLogs}>Tải nhật ký</button>
        </div>
        {logError && <div className="error" style={{ marginTop:8 }}>{logError}</div>}
        <div style={{ marginTop: 12 }}>
          {logLoading ? 'Đang tải...' : (
            <table className="table compact">
              <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Bảng</th><th className="num">ID</th><th>Hành động</th><th>Trường thay đổi</th></tr></thead>
              <tbody>
                {(logs||[]).map((l,i) => {
                  let changed = ''
                  try { const obj = JSON.parse(l.changes||'{}'); changed = Object.keys(obj||{}).join(', ') } catch {}
                  return (<tr key={i}><td>{l.ts}</td><td>{l.user||''}</td><td>{l.entity}</td><td className="num">{l.entity_id}</td><td>{l.action}</td><td>{changed}</td></tr>)
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Sao lưu & Khôi phục DB</div>
        <div className="section-bar" style={{ marginBottom:8 }}>
          <button className="btn" onClick={createBackup}>Tạo bản sao lưu</button>
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Tên bản sao lưu</th><th>Hành động</th></tr></thead>
            <tbody>
              {(backupList||[]).map((b,i) => (
                <tr key={i}><td>{b}</td><td><button className="btn" onClick={()=> restoreBackup(b)}>Khôi phục</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop:8 }}>Hệ thống tự sao lưu hàng ngày. Khôi phục xong cần tải lại trang để kết nối DB mới.</div>
      </div>

      
    </div>
  )
}
