import React, { useState } from 'react'
import api from '../api.js'

export default function Login({ onSuccess, onLogout }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const onLogin = async (e) => {
    e.preventDefault(); setError(''); setInfo('')
    try {
      const isLocal = String(api.defaults?.baseURL || '').includes('localhost');
      if (isLocal) {
        const res = await api.post('/auth/login', { username, password })
        const { token, role } = res.data || {}
        if (!token) throw new Error('No token')
        localStorage.setItem('token', token)
        localStorage.setItem('role', role || 'user')
        setInfo(`Đăng nhập thành công: vai trò ${role}`)
        if (typeof onSuccess === 'function') onSuccess()
        return
      }
      const form = new URLSearchParams();
      form.set('username', username);
      form.set('password', password);
      const res = await api.post('/auth/login', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      const { token, role } = res.data || {}
      if (!token) throw new Error('No token')
      localStorage.setItem('token', token)
      localStorage.setItem('role', role || 'user')
      setInfo(`Đăng nhập thành công: vai trò ${role}`)
      if (typeof onSuccess === 'function') onSuccess()
    } catch (e) {
      setError(e?.response?.data?.message || 'Đăng nhập lỗi')
    }
  }

  const onLogoutClick = () => {
    localStorage.removeItem('token'); localStorage.removeItem('role'); setInfo('Đã đăng xuất'); setError('');
    if (typeof onLogout === 'function') onLogout()
  }

  return (
    <div className="card">
      <h2>Đăng nhập</h2>
      <form onSubmit={onLogin} className="form">
        <label>Tài khoản</label><input value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>Mật khẩu</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        {info && <div className="muted">{info}</div>}
        <button className="btn primary" type="submit">Đăng nhập</button>
        <button className="btn" type="button" onClick={onLogoutClick}>Đăng xuất</button>
      </form>
      <div className="muted" style={{ marginTop: 8 }}></div>
    </div>
  )
}
