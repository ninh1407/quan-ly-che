import React, { useState } from 'react'

export default function Sidebar({ tab, setTab }) {
  const [collapsed, setCollapsed] = useState(false)
  const Item = ({ k, label, icon }) => (
    <button className={`btn ${tab===k?'primary':''}`} onClick={() => setTab(k)} style={{ justifyContent:'flex-start' }}>
      <span style={{ marginRight:8 }}>{icon}</span>{!collapsed && label}
    </button>
  )
  return (
    <aside className={`sidebar ${collapsed?'collapsed':''}`}>
      <div className="sidebar-header">
        <button className="btn" onClick={() => setCollapsed(!collapsed)}>{collapsed ? '➡️' : '⬅️'}</button>
      </div>
      <div className="sidebar-items">
        <Item k="dashboard" label="Tổng quan" icon="📊" />
        <Item k="sales" label="Thu" icon="💰" />
        <Item k="purchases" label="Nhập" icon="📦" />
        <Item k="expenses" label="Chi phí" icon="🧾" />
        <Item k="suppliers" label="Nhà cung cấp" icon="🏪" />
        <Item k="customers" label="Người mua" icon="👥" />
        <Item k="debts" label="Công nợ" icon="💳" />
        <Item k="staff" label="Phiếu" icon="📄" />
        <Item k="admin" label="Quản trị" icon="⚙️" />
      </div>
    </aside>
  )
}

