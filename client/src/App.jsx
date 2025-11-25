import React, { useState } from 'react'
import Sales from './pages/Sales.jsx'
import Purchases from './pages/Purchases.jsx'
import Expenses from './pages/Expenses.jsx'
import Dashboard from './pages/Dashboard.jsx'
import BalanceSheet from './pages/BalanceSheet.jsx'
import FinishedStock from './pages/FinishedStock.jsx'
import Season from './pages/Season.jsx'
import Suppliers from './pages/Suppliers.jsx'
import Customers from './pages/Customers.jsx'
import api from './api.js'
import Stats from './pages/Stats.jsx'
import TradeStats from './pages/TradeStats.jsx'
import Debts from './pages/Debts.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import ToastContainer, { toast } from './components/Toast.jsx'
import Login from './pages/Login.jsx'
import Breadcrumb from './components/Breadcrumb.jsx'
import Admin from './pages/Admin.jsx'
import ChangePassword from './pages/ChangePassword.jsx'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'))
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')
  const [device, setDevice] = useState(localStorage.getItem('device') || 'pc')
  const [menuOpen, setMenuOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const rolesRaw = (() => { try { const r = JSON.parse(localStorage.getItem('roles')||'null'); if (Array.isArray(r)) return r; } catch {} const s = (localStorage.getItem('role')||'user'); return String(s).split(',').map(x=>x.trim()).filter(Boolean) })()
  const hasRole = (name) => rolesRaw.includes(name)
  const allowedTabs = hasRole('admin')
    ? ['dashboard','balanceSheet','finishedStock','sales','purchases','expenses','debts','season','suppliers','customers','changePwd','admin','stats','tradeStats']
    : Array.from(new Set([
        ...(hasRole('seller') ? ['sales'] : []),
        ...(hasRole('warehouse') ? ['purchases','finishedStock'] : []),
        ...(hasRole('finance') ? ['dashboard','balanceSheet','expenses','debts'] : []),
        'customers','suppliers','changePwd'
      ]))
  const go = (k) => { if (allowedTabs.includes(k)) setTab(k); else toast('Không có quyền truy cập') }
  React.useEffect(() => { if (!allowedTabs.includes(tab)) setTab(allowedTabs[0]) }, [])
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme) }, [theme])
  React.useEffect(() => { document.documentElement.setAttribute('data-device', device); localStorage.setItem('device', device) }, [device])
  React.useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  React.useEffect(() => { (async () => { try { const r = await api.get('/notifications'); const items = r.data||[]; setNotifs(items); } catch {} })() }, [notifOpen])
  if (!authed) {
    return (
      <div className="container">
        <h1 className="glass">Quản lý Chè</h1>
        <Login onSuccess={() => setAuthed(true)} onLogout={() => setAuthed(false)} />
      </div>
    )
  }

  return (
      <div className="container">
      <h1 className="glass">Quản lý Chè</h1>
      <Breadcrumb tab={tab} />
        <div className="tabs">
          <button className="hamburger-btn corner" onClick={() => setMenuOpen(true)}>☰ Menu</button>
        <button className="btn" onClick={() => setTheme(theme === 'light' ? 'dark' : (theme==='dark' ? 'tea' : (theme==='tea' ? 'wood' : 'light')))}>{theme === 'light' ? '🌙 Tối' : (theme==='dark' ? '🍵 Nâu – Xanh lá' : (theme==='tea' ? '🪵 Gỗ truyền thống' : '☀️ Sáng'))}</button>
        <details className="dropdown">
          <summary className="btn">Thiết bị: {device==='pc'?'🖥️ PC':'📱 Mobile'} ▾</summary>
          <div className="dropdown-menu">
            <button className="btn" onClick={() => setDevice('pc')}>🖥️ PC</button>
            <button className="btn" onClick={() => setDevice('mobile')}>📱 Mobile</button>
          </div>
        </details>
        <details className="dropdown" style={{ marginLeft: 'auto' }}>
          <summary className="btn avatar"><span className="circle">{(localStorage.getItem('username')||'N')[0].toUpperCase()}</span> {(localStorage.getItem('username')||'Người dùng')} ▾</summary>
          <div className="dropdown-menu">
            <button className="btn" onClick={() => setAccountOpen(true)}>Tài khoản</button>
            <button className="btn" onClick={() => setNotifOpen(true)}>Thông báo</button>
            <button className="btn" onClick={() => setSettingsOpen(true)}>Cài đặt</button>
            <button className="btn" onClick={() => setTab('changePwd')}>Đổi mật khẩu</button>
            <button className="btn" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('role'); setAuthed(false) }}>Đăng xuất</button>
          </div>
        </details>
        
      </div>
      {menuOpen && (
        <div className="drawer open" onClick={() => setMenuOpen(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <button className="btn drawer-close" onClick={() => setMenuOpen(false)}>✕</button>
            {(
              (hasRole('admin'))
                ? [
                    { key:'dashboard', label:'📊 Tổng quan' },
                    { key:'balanceSheet', label:'📘 Bảng cân đối' },
                    { key:'finishedStock', label:'🏷️ Thành phẩm' },
                    { key:'season', label:'📅 Theo Đợt' },
                    { key:'sales', label:'🛒 Bán chè' },
                    { key:'purchases', label:'📥 Nhập chè' },
                    { key:'expenses', label:'🧾 Chi phí' },
                    { key:'debts', label:'💳 Công nợ' },
                    { key:'suppliers', label:'Nhà CC' },
                    { key:'customers', label:'Người mua' },
                    { key:'stats', label:'Thống kê' },
                    { key:'tradeStats', label:'Thống kê giao dịch' },
                    { key:'changePwd', label:'Đổi mật khẩu' },
                    { key:'admin', label:'⚙️ Quản trị' }
                  ]
                : [
                    { key:'sales', label:'🛒 Bán chè' },
                    { key:'purchases', label:'📥 Nhập chè' },
                    { key:'expenses', label:'🧾 Chi phí' },
                    { key:'changePwd', label:'Đổi mật khẩu' }
                  ]
            ).map(item => (
              <button key={item.key} className={`btn ${tab===item.key?'primary':''}`} onClick={() => { go(item.key); setMenuOpen(false) }}>{item.label}</button>
            ))}
            <button className="btn" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('role'); setAuthed(false) }}>Đăng xuất</button>
          </div>
        </div>
      )}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={(k) => go(k)} />
      <ToastContainer />
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'balanceSheet' && <BalanceSheet />}
      {tab === 'finishedStock' && <FinishedStock />}
      {tab === 'season' && <Season />}
      {tab === 'sales' && <Sales />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'debts' && <Debts />}
      {tab === 'customers' && <Customers />}
      {tab === 'changePwd' && <ChangePassword />}
      {tab === 'stats' && <Stats />}
      {tab === 'tradeStats' && <TradeStats />}
      {tab === 'admin' && <Admin />}
      {accountOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 380 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Tài khoản</div>
            <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:8 }}>
              <div className="muted">Tên người dùng</div>
              <div>{localStorage.getItem('username')||'Người dùng'}</div>
              <div className="muted">Vai trò</div>
              <div>{(localStorage.getItem('role')||'user')}</div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              {(localStorage.getItem('role')||'').toLowerCase()==='admin' && <button className="btn" onClick={() => { setTab('admin'); setAccountOpen(false) }}>Mở Quản trị</button>}
              <button className="btn primary" onClick={() => setAccountOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {notifOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Thông báo</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {(notifs||[]).map((n,i) => (<div key={i} className="muted">{n}</div>))}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button className="btn primary" onClick={() => setNotifOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Cài đặt</div>
            <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:8 }}>
              <div className="muted">Chủ đề</div>
              <div>
                <button className="btn" onClick={() => setTheme('light')}>Light</button>
                <button className="btn" style={{ marginLeft:6 }} onClick={() => setTheme('dark')}>Dark</button>
                <button className="btn" style={{ marginLeft:6 }} onClick={() => setTheme('tea')}>Tea</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button className="btn primary" onClick={() => setSettingsOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
