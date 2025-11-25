import React, { useState, useEffect } from 'react'
import api from '../api.js'

export default function Login({ onSuccess, onLogout }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(''), 3000)
      return () => clearTimeout(t)
    }
  }, [error])

  useEffect(() => {
    if (info) {
      const t = setTimeout(() => setInfo(''), 3000)
      return () => clearTimeout(t)
    }
  }, [info])

  useEffect(() => {
    try { localStorage.setItem('device', 'pc') } catch {}
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-device', 'pc')
  }, [])

  const onLogin = async (e) => {
    e.preventDefault(); setError(''); setInfo('')
    try {
      const res = await api.post('/auth/login', { username, password })
      const { token, roles, role } = res.data || {}
      if (!token) throw new Error('No token')
      localStorage.setItem('token', token)
      if (Array.isArray(roles)) localStorage.setItem('roles', JSON.stringify(roles))
      localStorage.setItem('role', (Array.isArray(roles) ? roles.join(',') : (role || 'user')))
      localStorage.setItem('username', username)
      setInfo(`Đăng nhập thành công: quyền ${(Array.isArray(roles)?roles.join(','): (role||'user'))}`)
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
    <div className="container" style={{ position:'relative' }}>
      <div className="bg-decor"></div>
      <div className="hero">
        <div className="hero-left">
          <div className="hero-badge"><span className="hero-emoji">🫖</span><span>Hệ thống mua bán chè</span></div>
          <div className="hero-title">Quản lý giao dịch Chè</div>
          <div className="hero-sub">Nền tảng chuyên nghiệp cho Bán chè, Nhập chè và Chi phí</div>
        </div>
      </div>
      <div className="card login-card glass shadow-4">
        <div className="login-title">Đăng nhập</div>
        <form onSubmit={onLogin} className="login-form">
          <div className="field">
            <label>Tài khoản</label>
            <div className="input-icon"><span className="icon">👤</span><input placeholder="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Mật khẩu</label>
            <div className="input-icon"><span className="icon">🔒</span><input placeholder="••••••••" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </div>
          {error && <div className="error">{error}</div>}
          {info && <div className="muted">{info}</div>}
          <div className="login-actions">
            <button className="btn primary" type="submit">Đăng nhập</button>
            <button className="btn" type="button" onClick={onLogoutClick}>Đăng xuất</button>
          </div>
        </form>
        <div className="brand-footer">© Quản lý Chè • Nền tảng mua bán chè chuyên nghiệp</div>
      </div>
    </div>
  )
}
