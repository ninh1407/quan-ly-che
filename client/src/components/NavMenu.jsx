import * as React from 'react'

export default function NavMenu({ items, active, onSelect }) {
  const activeLabel = (items.find(i => i.key === active)?.label) || 'Menu'
  return (
    <div className="menu-bar">
      <details className="dropdown">
        <summary className="btn">☰ {activeLabel} ▾</summary>
        <div className="dropdown-menu">
          {items.map(item => (
            <button key={item.key} className={`btn ${active===item.key?'primary':''}`} onClick={() => onSelect(item.key)}>{item.label}</button>
          ))}
        </div>
      </details>
    </div>
  )
}

