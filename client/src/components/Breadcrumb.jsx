import React from 'react'

const labels = {
  dashboard: 'Tổng quan', sales: 'Thu', purchases: 'Nhập', expenses: 'Chi phí', suppliers: 'Nhà CC', customers: 'Người mua', debts: 'Công nợ', staff: 'Phiếu', admin: 'Quản trị', season: 'Theo Đợt'
}

export default function Breadcrumb({ tab }) {
  return (
    <div className="breadcrumb">
      <span className="crumb">Tổng quan</span>
      <span>›</span>
      <span className="crumb">{labels[tab] || 'Trang'}</span>
      <span className="tooltip" style={{ marginLeft:8 }}>ℹ️
        <span className="tip">Dùng Ctrl+K để tìm nhanh, Toggle 🌙/☀️ để đổi theme</span>
      </span>
    </div>
  )
}

