import * as React from 'react'

export default function Header({ theme, onToggleTheme, onOpenMenu, onOpenAccount, onOpenNotif, onOpenSettings, onInstallApp, installEvt, isIOS, onOpenIosGuide, onOpenChangePwd, onLogout }) {
  const [scrolled, setScrolled] = React.useState(false)
  React.useEffect(() => {
    const h = () => setScrolled(window.scrollY > 0)
    h()
    window.addEventListener('scroll', h)
    return () => window.removeEventListener('scroll', h)
  }, [])
  const name = (localStorage.getItem('username')||'Người dùng')
  const initials = name[0]?.toUpperCase() || 'N'
  return (
    <div className={`header ${scrolled ? 'scrolled' : ''}`}> 
      <div className="header-left">
        <img src="/icons/leaf.svg" alt="Logo" className="logo" />
      </div>
      <div className="header-center">
        <div className="brand">Quản lý Chè</div>
      </div>
      <div className="header-right">
        <button className="btn" onClick={onOpenMenu}>☰</button>
        <button className="btn" onClick={onToggleTheme}>{theme === 'light' ? '🌙' : (theme==='dark' ? '🍵' : (theme==='tea' ? '🪵' : '☀️'))}</button>
        <button className="btn" onClick={onOpenNotif} aria-label="Thông báo">🔔</button>
        <details className="dropdown" style={{ marginLeft: 8 }}>
          <summary className="btn avatar"><span className="circle" style={{ width:32, height:32 }}>{initials}</span> {name} ▾</summary>
          <div className="dropdown-menu">
            <button className="btn" onClick={onOpenAccount}>Tài khoản</button>
            <button className="btn" onClick={onOpenNotif}>Thông báo</button>
            <button className="btn" onClick={onOpenSettings}>Cài đặt</button>
            {installEvt && <button className="btn" onClick={onInstallApp}>Cài đặt App</button>}
            {isIOS && <button className="btn" onClick={onOpenIosGuide}>Cài trên iPhone</button>}
            <button className="btn" onClick={onOpenChangePwd}>Đổi mật khẩu</button>
            <button className="btn" onClick={onLogout}>Đăng xuất</button>
          </div>
        </details>
      </div>
    </div>
  )
}

