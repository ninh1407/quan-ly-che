import React, { useState } from 'react'
import Sales from './pages/Sales.jsx'
import Purchases from './pages/Purchases.jsx'
import Expenses from './pages/Expenses.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Season from './pages/Season.jsx'
import Suppliers from './pages/Suppliers.jsx'
import Customers from './pages/Customers.jsx'
import Staff from './pages/Staff.jsx'
import Login from './pages/Login.jsx'
import Admin from './pages/Admin.jsx'
import ChangePassword from './pages/ChangePassword.jsx'

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'))
  if (!authed) {
    return (
      <div className="container">
        <h1>Quản lý Chè</h1>
        <Login onSuccess={() => setAuthed(true)} onLogout={() => setAuthed(false)} />
      </div>
    )
  }

  return (
    <div className="container">
      <h1>Quản lý Chè</h1>
      <div className="tabs">
        <button className={`btn ${tab==='dashboard'?'primary':''}`} onClick={() => setTab('dashboard')}>Tổng quan</button>
        <button className={`btn ${tab==='season'?'primary':''}`} onClick={() => setTab('season')}>Theo Đợt</button>
        <button className={`btn ${tab==='sales'?'primary':''}`} onClick={() => setTab('sales')}>Thu</button>
        <button className={`btn ${tab==='purchases'?'primary':''}`} onClick={() => setTab('purchases')}>Nhập</button>
        <button className={`btn ${tab==='expenses'?'primary':''}`} onClick={() => setTab('expenses')}>Chi phí</button>
        <button className={`btn ${tab==='suppliers'?'primary':''}`} onClick={() => setTab('suppliers')}>Nhà CC</button>
        <button className={`btn ${tab==='customers'?'primary':''}`} onClick={() => setTab('customers')}>Người mua</button>
        <button className={`btn ${tab==='staff'?'primary':''}`} onClick={() => setTab('staff')}>Tạo phiếu/Bán</button>
        <button className={`btn ${tab==='changePwd'?'primary':''}`} onClick={() => setTab('changePwd')}>Đổi mật khẩu</button>
        <button className="btn" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('role'); setAuthed(false) }}>Đăng xuất</button>
        { (localStorage.getItem('role')||'').toLowerCase() === 'admin' && (
          <button className={`btn ${tab==='admin'?'primary':''}`} onClick={() => setTab('admin')}>Quản trị</button>
        )}
      </div>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'season' && <Season />}
      {tab === 'sales' && <Sales />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'customers' && <Customers />}
      {tab === 'staff' && <Staff />}
      {tab === 'changePwd' && <ChangePassword />}
      {tab === 'admin' && <Admin />}
    </div>
  )
}
