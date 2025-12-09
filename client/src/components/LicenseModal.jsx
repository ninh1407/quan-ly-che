import * as React from 'react'
import api from '../api.js'

function getWebMachineId() {
  try {
    let webId = localStorage.getItem('web_machine_id')
    if (!webId) {
      webId = 'WEB-' + Math.random().toString(36).substring(2, 12).toUpperCase()
      localStorage.setItem('web_machine_id', webId)
    }
    return webId
  } catch {
    return 'WEB-UNKNOWN'
  }
}

export default function LicenseModal({ open, onClose, onActivated }) {
  const [key, setKey] = React.useState('')
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const hwid = React.useMemo(() => getWebMachineId(), [])

  const activate = async () => {
    setError('')
    const k = key.trim()
    if (!k) { setError('Vui lòng nhập mã bản quyền'); return }
    setLoading(true)
    try {
      const r = await api.post('/license/activate', { key: k, hwid })
      const claims = r.data?.claims
      const signature = r.data?.signature
      if (!claims) throw new Error('Máy chủ không trả dữ liệu bản quyền')
      localStorage.setItem('license_claims', JSON.stringify({ claims, signature }))
      try {
        const v = await api.post('/license/verify', { claims, signature })
        if (!v.data?.ok) throw new Error('Bản quyền không hợp lệ hoặc hết hạn')
      } catch (e) { throw e }
      onActivated && onActivated()
      onClose && onClose()
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Kích hoạt lỗi')
    } finally { setLoading(false) }
  }

  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10002 }}>
      <div className="card" style={{ width: 440 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Kích hoạt bản quyền</div>
        <div className="form" style={{ display:'grid', gridTemplateColumns:'150px 1fr', gap:8 }}>
          <div className="muted">Thiết bị</div>
          <div>{hwid}</div>
          <div className="muted">Mã bản quyền</div>
          <div><input className="input" value={key} onChange={(e)=>setKey(e.target.value)} placeholder="NHẬP MÃ" /></div>
          {error && <div className="muted" style={{ gridColumn:'1 / span 2', color:'#c62828' }}>{error}</div>}
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
          <button className="btn" onClick={onClose}>Đóng</button>
          <button className="btn primary" disabled={loading} onClick={activate}>{loading?'ĐANG KÍCH HOẠT':'KÍCH HOẠT'}</button>
        </div>
      </div>
    </div>
  )
}

