import * as React from 'react';
const { useEffect, useMemo, useState, useRef } = React;
import api from '../api.js';

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN');
const parseMoneyInput = (s) => Number(String(s || '').replace(/[^\d]/g, ''));
const formatMoneyInput = (s) => {
  const digits = String(s || '').replace(/[^\d]/g, '');
  return digits ? Number(digits).toLocaleString('vi-VN') : '';
};

function useMonthYear() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return { month, year, setMonth, setYear };
}

export default function Expenses() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    expense_date: '', description: '', amount: '', category: 'Biến phí', receipt_data: '', receipt_name: ''
  });
  const VAR_CATS = ['Tiện ích','Điện','Nhiên liệu','Củi','Than','Gas','Lương','Tiền lương','Nhân công']
  const FIX_CATS = ['Khấu hao','Lãi','Lãi vay','Lãi ngân hàng','Phân bổ','Sửa chữa']
  const [subCategory, setSubCategory] = useState('')
  const [acctImpact, setAcctImpact] = useState('liability')
  const [paidStatus, setPaidStatus] = useState('pending')
  const [summary, setSummary] = useState({ total:0, paid:0, unpaid:0, overdue7:0, overdue30:0, liability:0, cashOut:0, fixedPct:0, variablePct:0, costRevenuePct:0, profitMonth:0, revenueMonth:0 })
  const [query, setQuery] = useState('')
  const currentUser = (localStorage.getItem('username')||'')
  const draftKey = `draft:expenses:${currentUser}`
  const [imgWarn, setImgWarn] = useState([])
  const rolesRaw = (() => { try { const r = JSON.parse(localStorage.getItem('roles')||'null'); if (Array.isArray(r)) return r; } catch {} const s = (localStorage.getItem('role')||'user'); return String(s).split(',').map(x=>x.trim()) })()
  const hasRole = (name) => rolesRaw.includes(name)

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => y - 2 + i);
  }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = { month, year };
      const [re, rs] = await Promise.all([
        api.get('/expenses', { params }),
        api.get('/sales', { params })
      ])
      const data = re.data || []
      setList(data);
      const now = new Date()
      const days = (d) => { try { return Math.floor((now.getTime()-new Date(d).getTime())/(24*3600*1000)) } catch { return 0 } }
      const total = data.reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const paid = data.filter(r=> !!r.receipt_path).reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const unpaid = total - paid
      const overdue7 = data.filter(r=> !r.receipt_path && days(r.expense_date)>7 && days(r.expense_date)<=30).reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const overdue30 = data.filter(r=> !r.receipt_path && days(r.expense_date)>30).reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const liability = unpaid
      const cashOut = paid
      const fixedSum = data.filter(r=> String(r.category||'').toLowerCase().includes('định')).reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const variableSum = data.filter(r=> String(r.category||'').toLowerCase().includes('biến')).reduce((s,r)=> s + (Number(r.amount)||0), 0)
      const fixedPct = total>0 ? (fixedSum/total)*100 : 0
      const variablePct = total>0 ? (variableSum/total)*100 : 0
      const revenueMonth = (rs.data||[]).reduce((s,r)=> s + Number(r.total_amount != null ? r.total_amount : (Number(r.price_per_kg||0)*Number(r.weight||0))), 0)
      const costRevenuePct = revenueMonth>0 ? (total/revenueMonth)*100 : 0
      let profitMonth = 0
      try { const d = await api.get('/dashboard', { params }); profitMonth = Number(d.data?.netProfit||0) } catch {}
      setSummary({ total, paid, unpaid, overdue7, overdue30, liability, cashOut, fixedPct, variablePct, fixedSum, variableSum, costRevenuePct, profitMonth, revenueMonth })
    } catch (e) { setError(e?.response?.data?.message || 'Tải chi phí lỗi'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(draftKey)||'null'); if (d && d.form) setForm(f => ({ ...f, ...d.form })) } catch {} }, [])
  useEffect(() => { const t = setInterval(() => { try { localStorage.setItem(draftKey, JSON.stringify({ form })) } catch {} }, 10_000); return () => clearInterval(t) }, [form])

  const change = (k, v) => {
    if (k === 'amount') {
      setForm(s => ({ ...s, [k]: formatMoneyInput(v) }));
      return;
    }
    setForm(s => ({ ...s, [k]: v }));
  };
  const compressImage = (file) => new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const maxW=1600, maxH=1600; let w=img.width, h=img.height; const r=Math.min(1, maxW/w, maxH/h); w=Math.round(w*r); h=Math.round(h*r); const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); let q=0.8; let data=c.toDataURL('image/jpeg', q); while (data.length>1024*1024*1.33 && q>0.4) { q-=0.1; data=c.toDataURL('image/jpeg', q) } URL.revokeObjectURL(url); resolve({ name: (file.name||'image')+'.jpg', data }) };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')) };
    img.src = url;
  })
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const MAX = 5 * 1024 * 1024; if (f.size > MAX) { setError('Ảnh phải nhỏ hơn 5MB'); e.target.value = ''; return; }
    try {
      if (f.size > 1024*1024) {
        const out = await compressImage(f);
        setForm(s => ({ ...s, receipt_data: out.data, receipt_name: out.name }));
      } else {
        const r = new FileReader(); r.onload = () => setForm(s => ({ ...s, receipt_data: r.result, receipt_name: f.name })); r.readAsDataURL(f);
      }
      const w = await analyzeImageFile(f); setImgWarn(w)
    } catch { setError('Nén ảnh lỗi'); }
  }
  React.useEffect(() => {
    try {
      const p = localStorage.getItem('prefill_expenses');
      if (p) {
        const v = JSON.parse(p);
        setForm(f => ({ ...f, ...v }));
        localStorage.removeItem('prefill_expenses');
      }
    } catch {}
  }, [])
  const analyzeImageFile = (file) => new Promise((resolve) => {
    const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { const max=512; let w=img.width, h=img.height; const r=Math.min(1, max/w, max/h); w=Math.round(w*r); h=Math.round(h*r); const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); const d=ctx.getImageData(0,0,w,h).data; const g=new Float32Array(w*h); for(let i=0,j=0;i<d.length;i+=4,j++){ g[j]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2] } let sum=0, sum2=0; for(let i=0;i<g.length;i++){ sum+=g[i]; sum2+=g[i]*g[i] } const mean=sum/g.length; const std=Math.sqrt(Math.max(0,sum2/g.length-mean*mean)); const lap=new Float32Array(w*h); for(let y=1;y<h-1;y++){ for(let x=1;x<w-1;x++){ const i=y*w+x; lap[i]=g[i-w]+g[i-1]+g[i+1]+g[i+w]-4*g[i] } } let lsum=0, lsum2=0; for(let i=0;i<lap.length;i++){ lsum+=lap[i]; lsum2+=lap[i]*lap[i] } const lvar=Math.max(0,lsum2/lap.length-(lsum/lap.length)*(lsum/lap.length)); const sobX=[-1,0,1,-2,0,2,-1,0,1]; const sobY=[-1,-2,-1,0,0,0,1,2,1]; const bins=new Array(18).fill(0); for(let y=1;y<h-1;y++){ for(let x=1;x<w-1;x++){ let gx=0, gy=0; let k=0; for(let yy=-1;yy<=1;yy++){ for(let xx=-1;xx<=1;xx++){ const val=g[(y+yy)*w+(x+xx)]; gx+=val*sobX[k]; gy+=val*sobY[k]; k++ } } const ang=Math.atan2(gy,gx); const deg=((ang*180/Math.PI)+360)%180; const bin=Math.min(17,Math.floor(deg/10)); bins[bin]+=Math.hypot(gx,gy) } } const peak=bins.indexOf(Math.max(...bins)); const peakDeg=peak*10; const tilt=Math.min(Math.abs(peakDeg-0),Math.abs(peakDeg-90)); const warns=[]; if (lvar<15) warns.push('Ảnh có thể bị mờ'); if (std<20 || mean<40 || mean>215) warns.push('Ảnh có thể thiếu độ rõ'); if (tilt>15) warns.push('Ảnh có thể chụp sai góc'); URL.revokeObjectURL(url); resolve(warns) }; img.onerror=()=>{ URL.revokeObjectURL(url); resolve([]) }; img.src=url; })
  const origin = (typeof window !== 'undefined') ? window.location.origin : '';
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('token')||'') : '';
  const receiptEndpoint = (type, id) => `${origin}/api/${type}/${id}/receipt?t=${encodeURIComponent(token)}`

  const onSubmit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form };
      if (!payload.expense_date || payload.amount === '') {
        setError('Vui lòng nhập ngày và số tiền'); return;
      }
      payload.amount = parseMoneyInput(payload.amount);
      if (subCategory) payload.category = subCategory;
      if ((acctImpact === 'cash' || paidStatus === 'paid') && !payload.receipt_data) { setError('Chọn ảnh để đánh dấu “Đã chi” (<5MB)'); return; }
      if (editingId) {
        await api.put(`/expenses/${editingId}`, payload);
        setEditingId(null);
      } else {
        await api.post('/expenses', payload);
      }
      try { localStorage.removeItem(draftKey) } catch {}
      setForm({ expense_date: '', description: '', amount: '', category: 'Biến phí', receipt_data: '', receipt_name: '' });
      setAcctImpact('liability'); setPaidStatus('pending')
      setSubCategory('')
      await load();
    } catch (e) { setError(e?.response?.data?.message || 'Lưu chi phí lỗi'); }
  };

  const editRow = (r) => {
    setEditingId(r.id);
    setForm({ expense_date: r.expense_date || '', description: r.description || '', amount: formatMoneyInput(r.amount || ''), category: r.category || 'Biến phí', receipt_data: '', receipt_name: '' });
  };

  const deleteRow = async (id) => {
    if (!window.confirm('Xóa chi phí này?')) return;
    try { await api.delete(`/expenses/${id}`); await load(); }
    catch (e) { setError(e?.response?.data?.message || 'Xóa chi phí lỗi'); }
  };

  const exportCsv = () => {
    const headers = ['Ngày','Mô tả','Loại','Số tiền'];
    const rows = list.map(r => [r.expense_date, r.description, r.category || '', fmtMoney(r.amount)]);
    const totalSum = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalRow = ['Tổng cộng','', '', fmtMoney(totalSum)];
    const csv = [headers, ...rows, totalRow].map(row => row.map(v => (v ?? '')).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `expenses_${year}-${String(month).padStart(2,'0')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const w = window.open('');
    const rowsHtml = list.map(r => `<tr><td>${r.expense_date}</td><td>${r.description||''}</td><td>${r.category||''}</td><td style="text-align:right">${fmtMoney(r.amount)}</td></tr>`).join('');
    const totalSum = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalFormatted = fmtMoney(totalSum);
    w.document.write(`<!doctype html><html><head><title>Expenses ${year}-${String(month).padStart(2,'0')}</title><style>
      body{font-family:sans-serif}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px;text-align:left}
      td:nth-child(4){text-align:right}
      h3{margin:12px 0}
    </style></head><body><h3>Báo cáo Chi phí ${year}-${String(month).padStart(2,'0')}</h3>
      <table><thead><tr><th>Ngày</th><th>Mô tả</th><th>Loại</th><th>Số tiền</th></tr></thead>
        <tbody>${rowsHtml}<tr style="font-weight:bold"><td colspan="3" style="text-align:right">Tổng cộng</td><td>${totalFormatted}</td></tr></tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  const markPaid = async (row) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.pdf';
      input.onchange = async (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const MAX = 5 * 1024 * 1024; if (f.size > MAX) { setError('Tệp phải nhỏ hơn 5MB'); return; }
        try {
          let payload = {};
          if (String(f.type||'').startsWith('image/')) {
            if (f.size > 1024*1024) {
              const out = await compressImage(f);
              payload = { receipt_data: out.data, receipt_name: out.name };
            } else {
              const r = new FileReader();
              payload = await new Promise((resolve) => { r.onload = () => resolve({ receipt_data: r.result, receipt_name: f.name }); r.readAsDataURL(f); });
            }
          } else {
            const r = new FileReader();
            payload = await new Promise((resolve) => { r.onload = () => resolve({ receipt_data: r.result, receipt_name: f.name }); r.readAsDataURL(f); });
          }
          await api.put(`/expenses/${row.id}`, payload);
          await load();
        } catch (err) {
          setError(err?.response?.data?.message || 'Đánh dấu đã chi lỗi');
        }
      };
      input.click();
    } catch {}
  };

  return (
    <div className="card">
      <h2>Quản lý Chi phí</h2>
      <div className="filters">
        <label>Tháng</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Năm</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="table-wrap" style={{ marginTop:12 }}>
        <table className="table compact">
          <thead><tr><th>CHI PHÍ (Cost Summary)</th><th className="num">Giá trị</th></tr></thead>
          <tbody>
            <tr><td>Tổng chi phí tháng</td><td className="num">{fmtMoney(summary.total)}</td></tr>
            <tr><td>Đã thanh toán</td><td className="num">{fmtMoney(summary.paid)}</td></tr>
            <tr><td>Chưa thanh toán</td><td className="num">{fmtMoney(summary.unpaid)}</td></tr>
            <tr><td>Chi phí cố định</td><td className="num">{fmtMoney(summary.fixedSum||0)}</td></tr>
            <tr><td>Chi phí biến phí</td><td className="num">{fmtMoney(summary.variableSum||0)}</td></tr>
          </tbody>
        </table>
      </div>

      <form onSubmit={onSubmit} className="form form-2col">
        <label>Ngày</label>
        <div className="input-icon"><span className="icon">📅</span><input type="date" value={form.expense_date} onChange={(e) => change('expense_date', e.target.value)} /></div>
        <label>Mô tả</label>
        <div className="input-icon"><span className="icon">📝</span><input value={form.description} onChange={(e) => change('description', e.target.value)} /></div>
        <label>Loại chi phí</label>
        <div className="input-icon"><span className="icon">📌</span><select value={form.category} onChange={(e) => change('category', e.target.value)}>
          <option value="Biến phí">Biến phí</option>
          <option value="Định phí">Định phí</option>
          <option value="Thuế">Thuế</option>
          <option value="Trả trước">Trả trước</option>
          <option value="Khác">Khác</option>
        </select></div>
        
        <label>Trạng thái</label>
        <div className="input-icon"><span className="icon">🏷️</span><select value={paidStatus} onChange={(e)=> setPaidStatus(e.target.value)}>
          <option value="pending">Chờ</option>
          <option value="paid">Đã chi</option>
        </select></div>
        <label>Số tiền</label>
        <div className="input-icon"><span className="icon">₫</span><input value={form.amount} onChange={(e) => change('amount', e.target.value)} /></div>
      <label>Ảnh giao dịch (để đánh dấu đã chi, &lt;5MB)</label>
      <input type="file" accept="image/*" capture="environment" onChange={onFile} />
      {imgWarn.length>0 && <div className="error" style={{ marginTop:6 }}>{imgWarn.join(' • ')}</div>}
      {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu chỉnh sửa' : 'Thêm chi phí'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ expense_date: '', description: '', amount: '', category: 'Biến phí', receipt_data: '', receipt_name: '' }); }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ngày</th><th>Mô tả</th><th>Khoản</th><th>Nhóm</th><th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({length:5}).map((_,i)=> (
                  <tr key={i}>
                    {Array.from({length:5}).map((_,j)=> <td key={j}><div className="skeleton skeleton-line" style={{width: j%2===0?'60%':'80%'}}></div></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="card">
              <div style={{ fontWeight:700, marginBottom:6 }}>Định phí (Fixed)</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ngày</th><th>Khoản mục</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Ảnh</th><th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.filter(r => String(r.category||'').toLowerCase().includes('định')).map(r => (
                      <tr key={`f${r.id}`}>
                        <td>{r.expense_date}</td>
                        <td>{r.description}</td>
                        <td className="num">{fmtMoney(r.amount)}</td>
                        <td>{r.receipt_path ? <span className="pill paid">Đã chi</span> : <span className="pill pending">Chờ</span>}</td>
                        <td>{r.receipt_path ? <a href={receiptEndpoint('expenses', r.id)} target="_blank" rel="noreferrer">Xem</a> : ''}</td>
                        <td>
                          {hasRole('admin') && !r.receipt_path && <button className="btn" onClick={() => markPaid(r)}>Đã chi</button>}
                          {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => editRow(r)}>Sửa</button>}
                          {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div style={{ fontWeight:700, marginBottom:6 }}>Biến phí (Variable)</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ngày</th><th>Khoản mục</th><th className="num">Số tiền</th><th>Trạng thái</th><th>Ảnh</th><th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.filter(r => { const cat = String(r.category||''); return VAR_CATS.includes(cat) || cat.toLowerCase().includes('biến') }).map(r => (
                      <tr key={`v${r.id}`}>
                        <td>{r.expense_date}</td>
                        <td>{r.description}</td>
                        <td className="num">{fmtMoney(r.amount)}</td>
                        <td>{r.receipt_path ? <span className="pill paid">Đã chi</span> : <span className="pill pending">Chờ</span>}</td>
                        <td>{r.receipt_path ? <a href={receiptEndpoint('expenses', r.id)} target="_blank" rel="noreferrer">Xem</a> : ''}</td>
                        <td>
                          {hasRole('admin') && !r.receipt_path && <button className="btn" onClick={() => markPaid(r)}>Đã chi</button>}
                          {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => editRow(r)}>Sửa</button>}
                          {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
