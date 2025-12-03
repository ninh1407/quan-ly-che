import * as React from 'react'

export default function BottomNav({ tab, onNavigate, allowedTabs }) {
  const itemsAdmin = [
    { key:'dashboard', icon:'🏠', label:'Trang' },
    { key:'sales', icon:'🛒', label:'Bán' },
    { key:'purchases', icon:'📥', label:'Nhập' },
    { key:'expenses', icon:'🧾', label:'Chi' },
    { key:'changePwd', icon:'🔑', label:'Mật khẩu' }
  ]
  const itemsUser = [
    { key:'sales', icon:'🛒', label:'Bán' },
    { key:'purchases', icon:'📥', label:'Nhập' },
    { key:'expenses', icon:'🧾', label:'Chi' },
    { key:'changePwd', icon:'🔑', label:'Mật khẩu' }
  ]
  const items = (allowedTabs.includes('dashboard')) ? itemsAdmin : itemsUser
  return (
    <div className="bottom-nav">
      {items.filter(x => allowedTabs.includes(x.key)).slice(0,5).map(it => (
        <button key={it.key} className={`item ${tab===it.key?'active':''}`} onClick={() => onNavigate(it.key)}>
          <div className="icon" aria-hidden>{it.icon}</div>
          <div className="label">{it.label}</div>
        </button>
      ))}
    </div>
  )
}

