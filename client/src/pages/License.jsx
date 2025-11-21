import React, { useEffect, useState } from 'react'
import api from '../api.js'

export default function License() {
  const [status, setStatus] = useState({})
  const [form, setForm] = useState({ customer:'', expires:'', key:'' })
  const [token, setToken] = useState(localStorage.getItem('licenseToken')||'')
  const load = async () => { try { const r = await api.get('/license'); setStatus(r.data||{}) } catch {} }
  useEffect(()=>{ load() },[])
  const save = async () => { try { localStorage.setItem('licenseToken', token); await api.post('/license', form, { headers: { 'X-License-Token': token } }); load(); alert('Đã cập nhật license') } catch (e) { alert(e?.response?.data?.message||'Lỗi license') } }
  const [extendDays, setExtendDays] = useState(30)
  const extend = async () => { try { localStorage.setItem('licenseToken', token); await api.post('/license/extend', { days: Number(extendDays) }, { headers: { 'X-License-Token': token } }); load(); alert('Đã gia hạn') } catch (e) { alert(e?.response?.data?.message||'Lỗi gia hạn') } }
  const revoke = async () => { if (!confirm('Xóa license hiện tại?')) return; try { localStorage.setItem('licenseToken', token); await api.delete('/license', { headers: { 'X-License-Token': token } }); load(); alert('Đã xóa license') } catch (e) { alert(e?.response?.data?.message||'Lỗi xóa') } }
  return (
    <div className="card">
      <h2>License</h2>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Trạng thái</div>
          <div className="table-wrap">
            <table className="table compact"><tbody>
              <tr><td>Hợp lệ</td><td className="num">{status.valid ? 'Có' : 'Không'}</td></tr>
              <tr><td>Khách hàng</td><td>{status.customer||''}</td></tr>
              <tr><td>Hết hạn</td><td>{status.expires||''}</td></tr>
              <tr><td>Ngày còn lại</td><td className="num">{status.days_left??0}</td></tr>
              <tr><td>Yêu cầu License</td><td>{status.require ? 'Có' : 'Không'}</td></tr>
              <tr><td>Grace (ngày)</td><td className="num">{status.grace_days??0}</td></tr>
            </tbody></table>
          </div>
        </div>
        <div className="card">
          <div style={{ fontWeight:700, marginBottom:6 }}>Kích hoạt</div>
          <div className="form">
            <div><label>Token (do bên bán cấp)</label><input value={token} onChange={(e)=> setToken(e.target.value)} placeholder="X-License-Token" /></div>
            <div><label>Khách hàng</label><input value={form.customer} onChange={(e)=> setForm({ ...form, customer:e.target.value })} placeholder="Tên KH" /></div>
            <div><label>Hết hạn</label><input type="date" value={form.expires} onChange={(e)=> setForm({ ...form, expires:e.target.value })} /></div>
            <div><label>License Key</label><input value={form.key} onChange={(e)=> setForm({ ...form, key:e.target.value })} placeholder="chuỗi ký" /></div>
            <div><button className="btn primary" type="button" onClick={save}>Lưu</button></div>
            <div style={{ borderTop:'1px solid var(--border)', marginTop:8, paddingTop:8 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>Gia hạn nhanh</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input type="number" value={extendDays} onChange={(e)=> setExtendDays(e.target.value)} style={{ width:120 }} />
                <button className="btn" type="button" onClick={extend}>Gia hạn (ngày)</button>
                <button className="btn" type="button" onClick={revoke}>Xóa license</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}