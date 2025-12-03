import * as React from 'react'

export default function Header({ theme, onToggleTheme, onOpenMenu, onOpenAccount, onOpenNotif }) {
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
        <button className="btn avatar" onClick={onOpenAccount}><span className="circle" style={{ width:32, height:32 }}>{initials}</span> {name}</button>
      </div>
    </div>
  )
}

