import * as React from 'react'

const labels = {
  dashboard: 'Tổng quan', balanceSheet: 'Bảng cân đối', finishedStock: 'Thành phẩm', sales: 'Thu', purchases: 'Nhập', expenses: 'Chi phí', suppliers: 'Nhà CC', customers: 'Người mua', debts: 'Công nợ', admin: 'Quản trị', season: 'Theo Đợt', receipts: 'Ảnh hóa đơn'
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
