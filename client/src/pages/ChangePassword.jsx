import React, { useState } from 'react'
import api from '../api.js'

export default function ChangePassword() {
  const [oldp, setOldp] = useState('')
  const [newp, setNewp] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const submit = async (e) => {
    e.preventDefault(); setError(''); setInfo('')
    try {
      const r = await api.post('/auth/change-password', { old_password: oldp, new_password: newp })
      if (r.data?.changed) setInfo('Đổi mật khẩu thành công')
      else setInfo('Đổi mật khẩu xong')
      setOldp(''); setNewp('')
    } catch (e) {
      setError(e?.response?.data?.message || 'Đổi mật khẩu lỗi')
    }
  }

  return (
    <div className="card">
      <h2>Đổi mật khẩu</h2>
      <form onSubmit={submit} className="form">
        <label>Mật khẩu hiện tại</label><input type="password" value={oldp} onChange={(e) => setOldp(e.target.value)} />
        <label>Mật khẩu mới</label><input type="password" value={newp} onChange={(e) => setNewp(e.target.value)} />
        {error && <div className="error">{error}</div>}
        {info && <div className="muted">{info}</div>}
        <button className="btn primary" type="submit">Đổi mật khẩu</button>
      </form>
    </div>
  )
}
