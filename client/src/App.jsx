import * as React from 'react'
const { useState, useEffect, useMemo, useRef } = React
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
import Header from './components/Header.jsx'
import Admin from './pages/Admin.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Receipts from './pages/Receipts.jsx'
import BottomNav from './components/BottomNav.jsx'
import NavMenu from './components/NavMenu.jsx'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'))
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [installEvt, setInstallEvt] = useState(null)
  const [iosGuideOpen, setIosGuideOpen] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [badges, setBadges] = useState({ sales: 0, purchases: 0 })
  const rolesRaw = (() => { try { const r = JSON.parse(localStorage.getItem('roles')||'null'); if (Array.isArray(r)) return r; } catch {} const s = (localStorage.getItem('role')||'user'); return String(s).split(',').map(x=>x.trim()).filter(Boolean) })()
  const hasRole = (name) => rolesRaw.includes(name)
  const allowedTabs = hasRole('admin')
    ? ['dashboard','balanceSheet','finishedStock','sales','purchases','expenses','debts','season','suppliers','customers','receipts','changePwd','admin','stats','tradeStats']
    : Array.from(new Set([
        'dashboard',
        ...(hasRole('seller') ? ['sales'] : []),
        ...(hasRole('warehouse') ? ['purchases','finishedStock'] : []),
        ...(hasRole('finance') ? ['dashboard','balanceSheet','expenses','debts','receipts'] : []),
        'customers','suppliers','changePwd'
      ]))
  const navItems = (hasRole('admin'))
    ? [
        { key:'dashboard', label:'Tổng quan' },
        { key:'balanceSheet', label:'Bảng cân đối' },
        { key:'finishedStock', label:'Thành phẩm' },
        { key:'sales', label:'Bán' },
        { key:'purchases', label:'Nhập' },
        { key:'expenses', label:'Chi phí' },
        { key:'debts', label:'Công nợ' },
        { key:'suppliers', label:'Nhà CC' },
        { key:'customers', label:'Người mua' },
        { key:'receipts', label:'Ảnh hóa đơn' },
        { key:'stats', label:'Thống kê' },
        { key:'tradeStats', label:'Giao dịch' },
        { key:'changePwd', label:'Đổi mật khẩu' },
        { key:'admin', label:'Quản trị' }
      ]
    : [
        { key:'sales', label:'Bán' },
        { key:'purchases', label:'Nhập' },
        { key:'expenses', label:'Chi phí' },
        { key:'changePwd', label:'Đổi mật khẩu' }
      ]
  const go = (k) => { if (allowedTabs.includes(k)) { setTab(k); try { localStorage.setItem('current_tab', k) } catch {} } else toast('Không có quyền truy cập') }
  useEffect(() => { if (!allowedTabs.includes(tab)) setTab(allowedTabs[0]) }, [])
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme) }, [theme])
  useEffect(() => {
    try {
      const ua = navigator.userAgent || ''
      const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua)
      const isSmall = (typeof window!=='undefined') ? (window.innerWidth <= 768) : false
      const dev = (isMobileUA || isSmall) ? 'mobile' : 'pc'
      document.documentElement.setAttribute('data-device', dev)
      localStorage.setItem('device', dev)
    } catch {
      document.documentElement.setAttribute('data-device', 'pc')
      localStorage.setItem('device', 'pc')
    }
  }, [])
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setInstallEvt(e) })
  }, [])
  useEffect(() => {
    try {
      const ua = navigator.userAgent || ''
      const isiOS = /iPad|iPhone|iPod/.test(ua) || ((navigator.platform||'')==='MacIntel' && Number(navigator.maxTouchPoints||0)>1)
      const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua)
      setIsIOS(isiOS && isSafari)
      const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua)
      const isSmall = (typeof window!=='undefined') ? (window.innerWidth <= 768) : false
      setIsMobile(isMobileUA || isSmall)
    } catch {}
  }, [])
  const installApp = async () => { try { if (installEvt) { await installEvt.prompt(); setInstallEvt(null) } } catch {} }
  const notify = async (title, body) => {
    try {
      if (Notification.permission !== 'granted') { try { await Notification.requestPermission() } catch {} }
      if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); reg && reg.active && reg.active.postMessage({ type:'notify', title, body }) }
    } catch {}
  }
  const forceUpdate = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all((regs||[]).map(r => r.unregister()));
      }
      if (window.caches && window.caches.keys) {
        const ks = await caches.keys();
        await Promise.all((ks||[]).map(k => caches.delete(k)));
      }
    } catch {}
    try { location.reload(true) } catch { location.reload() }
  }
  useEffect(() => { (async () => { try { const r = await api.get('/notifications'); const items = r.data||[]; setNotifs(items); } catch {} })() }, [notifOpen])
  useEffect(() => {
    let timer = null
    const extractCount = (arr, re) => {
      for (const s of (arr||[])) { const m = String(s).match(re); if (m) return Number(m[1]||0) }
      return 0
    }
    const loadBadges = async () => {
      try {
        const [r7, r30] = await Promise.all([
          api.get('/notifications', { params: { days: 7 } }),
          api.get('/notifications', { params: { days: 30 } })
        ])
        const a7 = r7.data || []
        const a30 = r30.data || []
        const salesOver7 = extractCount(a7, /Có\s+(\d+)\s+đơn bán chưa thanh toán/i)
        const purchasesOver30 = extractCount(a30, /Có\s+(\d+)\s+đơn nhập chưa thanh toán/i)
        setBadges({ sales: salesOver7||0, purchases: purchasesOver30||0 })
      } catch {}
    }
    loadBadges()
    timer = setInterval(loadBadges, 60_000)
    return () => { if (timer) clearInterval(timer) }
  }, [])
  useEffect(() => {
    const closeOutside = (e) => {
      document.querySelectorAll('details.dropdown[open]').forEach((d) => {
        if (!d.contains(e.target)) d.removeAttribute('open')
      })
    }
    document.addEventListener('click', closeOutside, true)
    document.addEventListener('touchstart', closeOutside, true)
    return () => {
      document.removeEventListener('click', closeOutside, true)
      document.removeEventListener('touchstart', closeOutside, true)
    }
  }, [])
  if (!authed) {
    return (
      <div className="container">
        <h1 className="glass">Quản lý Chè</h1>
        <Login onSuccess={() => { setAuthed(true); setTab('dashboard'); try { localStorage.setItem('current_tab','dashboard') } catch {} }} onLogout={() => setAuthed(false)} />
      </div>
    )
  }

  return (
      <div className="container">
      <Header theme={theme} onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : (theme==='dark' ? 'tea' : (theme==='tea' ? 'wood' : 'light')))} onOpenMenu={() => setMenuOpen(true)} onOpenAccount={() => setAccountOpen(true)} onOpenNotif={() => setNotifOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onInstallApp={installApp} installEvt={installEvt} isIOS={isIOS} onOpenIosGuide={() => setIosGuideOpen(true)} onOpenChangePwd={() => setTab('changePwd')} onLogout={() => { try { localStorage.removeItem('token'); localStorage.removeItem('role'); localStorage.removeItem('roles'); localStorage.removeItem('username'); localStorage.removeItem('current_tab'); } catch {} setAuthed(false) }} />
      <Breadcrumb tab={tab} />
      {isMobile ? (
        <NavMenu items={navItems.filter(i => allowedTabs.includes(i.key))} active={tab} onSelect={(k) => go(k)} />
      ) : (
        <div className="compact-tabs">
          {navItems.filter(i => allowedTabs.includes(i.key)).map(item => (
            <button key={item.key} className={`tab ${tab===item.key?'active':''}`} onClick={() => go(item.key)}>{item.label}</button>
          ))}
        </div>
      )}
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
                    { key:'suppliers', label:'🏪 Nhà CC' },
                    { key:'customers', label:'🧑‍💼 Người mua' },
                    { key:'receipts', label:'🖼️ Ảnh hóa đơn' },
                    { key:'stats', label:'📈 Thống kê' },
                    { key:'tradeStats', label:'📊 Thống kê giao dịch' },
                    { key:'changePwd', label:'🔑 Đổi mật khẩu' },
                    { key:'admin', label:'⚙️ Quản trị' }
                  ]
                : [
                    { key:'sales', label:'🛒 Bán chè' },
                    { key:'purchases', label:'📥 Nhập chè' },
                    { key:'expenses', label:'🧾 Chi phí' },
                    { key:'changePwd', label:'🔑 Đổi mật khẩu' }
                  ]
            ).map(item => (
              <button key={item.key} className={`btn ${tab===item.key?'primary':''}`} onClick={() => { go(item.key); setMenuOpen(false) }}>
                <span>{item.label}</span>
                {item.key==='sales' && badges.sales>0 && <span style={{ marginLeft:8 }} className="badge">{badges.sales}</span>}
                {item.key==='purchases' && badges.purchases>0 && <span style={{ marginLeft:8 }} className="badge">{badges.purchases}</span>}
              </button>
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
          {tab === 'receipts' && <Receipts />}
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
              <div className="muted">Chế độ giao diện</div>
              <div>
                <button className="btn" onClick={() => { document.documentElement.setAttribute('data-device','mobile'); localStorage.setItem('device','mobile') }}>Mobile</button>
                <button className="btn" style={{ marginLeft:6 }} onClick={() => { document.documentElement.setAttribute('data-device','pc'); localStorage.setItem('device','pc') }}>PC</button>
              </div>
              <div className="muted">Cài đặt App</div>
              <div>
                <button className="btn" disabled={!installEvt} onClick={installApp}>{installEvt ? 'Cài đặt trên màn hình' : 'Đã cài hoặc không hỗ trợ'}</button>
              </div>
              <div className="muted">Cập nhật phiên bản</div>
              <div>
                <button className="btn" onClick={forceUpdate}>Làm mới ứng dụng</button>
              </div>
              <div className="muted">Cài đặt trên iPhone/iPad</div>
              <div>
                <button className="btn" disabled={!isIOS} onClick={() => setIosGuideOpen(true)}>{isIOS ? 'Hướng dẫn cài trên iPhone' : 'Mở bằng Safari trên iPhone'}</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button className="btn primary" onClick={() => setSettingsOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {iosGuideOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Cài trên iPhone/iPad</div>
            <div className="form">
              <div className="muted">1) Mở trang bằng Safari</div>
              <div className="muted">2) Bấm nút Chia sẻ (ô vuông có mũi tên)</div>
              <div className="muted">3) Chọn “Thêm vào Màn hình chính”</div>
              <div className="muted">4) Tên: Quản lý Chè → Thêm</div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button className="btn primary" onClick={() => setIosGuideOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      <button className="fab-menu" onClick={() => setMenuOpen(true)} aria-label="Menu">☰</button>
      {isMobile && (
        <BottomNav tab={tab} onNavigate={(k) => go(k)} allowedTabs={allowedTabs} />
      )}
    </div>
  )
}
