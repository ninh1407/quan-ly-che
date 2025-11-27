import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { error: null } }
  componentDidCatch(error, info){ this.setState({ error }); try { console.error('App error:', error, info) } catch {} }
  render(){ if (this.state.error) { return (
    <div style={{ padding:16 }}>
      <h2>Đã xảy ra lỗi khi tải ứng dụng</h2>
      <div style={{ marginTop:8, color:'#b91c1c' }}>{String(this.state.error && this.state.error.message || 'Lỗi không xác định')}</div>
      <div style={{ marginTop:12 }}>Vui lòng bấm Cài đặt → Làm mới ứng dụng để cập nhật phiên bản mới.</div>
    </div>
  ) } return this.props.children }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>)
