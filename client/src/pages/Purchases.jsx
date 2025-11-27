import React, { useEffect, useMemo, useState } from 'react';
import api from '../api.js';

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN');
const parseMoneyInput = (s) => {
  const raw = String(s || '').toLowerCase();
  const mult = /k|nghìn|ngàn/.test(raw) ? 1000 : /tr|triệu|m/.test(raw) ? 1_000_000 : 1;
  const digits = raw.replace(/[^\d]/g, '');
  const val = digits ? Number(digits) : 0;
  return val * mult;
};
const formatMoneyInput = (s) => {
  const raw = String(s || '').toLowerCase();
  const mult = /k|nghìn|ngàn/.test(raw) ? 1000 : /tr|triệu|m/.test(raw) ? 1_000_000 : 1;
  const digits = raw.replace(/[^\d]/g, '');
  const val = digits ? Number(digits) * mult : 0;
  return val ? val.toLocaleString('vi-VN') : '';
};

function useMonthYear() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return { month, year, setMonth, setYear };
}

export default function Purchases() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const rolesRaw = (() => { try { const r = JSON.parse(localStorage.getItem('roles')||'null'); if (Array.isArray(r)) return r; } catch {} const s = (localStorage.getItem('role')||'user'); return String(s).split(',').map(x=>x.trim()) })()
  const hasRole = (name) => rolesRaw.includes(name)
  const [deleteId, setDeleteId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [payModal, setPayModal] = useState({ id: null, file: null, error: '', ack: false });
  const [q, setQ] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1); const pageSize = 10;
  const [sort, setSort] = useState({ key: 'purchase_date', asc: true });
  const origin = (typeof window !== 'undefined') ? window.location.origin : ''
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('token')||'') : ''
  const receiptEndpoint = (type, id) => `${origin}/api/${type}/${id}/receipt?t=${encodeURIComponent(token)}`
  const [viewer, setViewer] = useState({ open:false, url:'', scale:1, img:true })
  const STATUS_LABELS = { pending: 'Chờ', paid: 'Đã thanh toán' }
  const [form, setForm] = useState({
    purchase_date: '', supplier_name: '', ticket_name: '', invoice_no: '', weigh_ticket_code: '', vehicle_plate: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending'
  });
  const [hint, setHint] = useState('')
  const currentUser = (localStorage.getItem('username')||'')
  const draftKey = `draft:purchases:${currentUser}`
  const [recentPurchases, setRecentPurchases] = useState([])
  const [imgWarn, setImgWarn] = useState([])
  const compressImage = (file) => new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const maxW=1600, maxH=1600; let w=img.width, h=img.height; const r=Math.min(1, maxW/w, maxH/h); w=Math.round(w*r); h=Math.round(h*r); const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); let q=0.8; let data=c.toDataURL('image/jpeg', q); while (data.length>1024*1024*1.33 && q>0.4) { q-=0.1; data=c.toDataURL('image/jpeg', q) } URL.revokeObjectURL(url); resolve({ name: (file.name||'image')+'.jpg', data }) };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')) };
    img.src = url;
  })

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => y - 2 + i);
  }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = { month, year };
      if (paymentFilter !== 'all') params.payment_status = paymentFilter;
      if (q) params.q = q;
      const res = await api.get('/purchases', { params });
      let data = res.data || [];
      if (q) {
        const s = q.toLowerCase();
        data = data.filter(r => [r.invoice_no, r.ticket_name, r.weigh_ticket_code, r.vehicle_plate, r.supplier_name].some(v => String(v||'').toLowerCase().includes(s)));
      }
      if (range.from || range.to) {
        data = data.filter(r => {
          const d = new Date(r.purchase_date);
          return (!range.from || d >= new Date(range.from)) && (!range.to || d <= new Date(range.to));
        });
      }
      const key = sort.key; const asc = sort.asc ? 1 : -1;
      data.sort((a,b) => {
        const va = (key==='unit_price'||key==='weight'||key==='net_weight'||key==='total_cost') ? Number(a[key]||0) : String(a[key]||'');
        const vb = (key==='unit_price'||key==='weight'||key==='net_weight'||key==='total_cost') ? Number(b[key]||0) : String(b[key]||'');
        if (va<vb) return -1*asc; if (va>vb) return 1*asc; return 0;
      })
      setList(data);
    } catch (e) { setError(e?.response?.data?.detail || e?.response?.data?.message || e?.message || 'Tải danh sách lỗi'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, paymentFilter]);
  useEffect(() => { const t = setTimeout(() => { load(); }, 250); return () => clearTimeout(t) }, [q]);
  useEffect(() => {
    try {
      const p = localStorage.getItem('prefill_purchases');
      if (p) {
        const v = JSON.parse(p);
        setForm(f => ({ ...f, ...v, unit_price: formatMoneyInput(v.unit_price||''), weight: v.weight||'' }));
        localStorage.removeItem('prefill_purchases');
      }
    } catch {}
  }, [])
  useEffect(() => {
    (async () => {
      try { const r = await api.get('/suppliers'); setSuppliers(r.data || []); } catch {}
      try { const p = await api.get('/purchases'); setRecentPurchases((p.data||[]).slice(-200)) } catch {}
    })();
  }, []);
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(draftKey)||'null'); if (d && d.form) setForm(f => ({ ...f, ...d.form })) } catch {} }, [])
  useEffect(() => { const t = setInterval(() => { try { localStorage.setItem(draftKey, JSON.stringify({ form })) } catch {} }, 10_000); return () => clearInterval(t) }, [form])
  useEffect(() => {
    try {
      const qs = JSON.parse(localStorage.getItem('quickSearch')||'null');
      if (qs && qs.tab === 'purchases' && qs.value) { setQ(qs.value); localStorage.removeItem('quickSearch'); }
    } catch {}
  }, []);

  const netWeightPreview = (() => {
    const w = parseFloat(form.weight || 0);
    const wp = parseFloat(form.water_percent || 0);
    const pct = isNaN(wp) ? 0 : Math.max(0, Math.min(100, wp));
    return w * (1 - pct / 100);
  })();
  const totalPreview = (() => {
    const u = parseMoneyInput(form.unit_price || 0);
    return (u * netWeightPreview) || 0;
  })();

  const change = (k, v) => setForm(s => {
    if (k === 'water_percent') {
      if (v === '') return { ...s, [k]: '' };
      let num = Number(v);
      if (!Number.isFinite(num)) return { ...s, [k]: '' };
      num = Math.max(0, Math.min(100, num));
      return { ...s, [k]: String(num) };
    }
    if (k === 'unit_price') {
      return { ...s, [k]: formatMoneyInput(v) };
    }
    return { ...s, [k]: v };
  });

  const markPaid = (id) => { setPayModal({ id, file: null, error: '' }) };

  const onSubmit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form };
      if (!payload.purchase_date || !payload.unit_price || !payload.weight) {
        setError('Vui lòng nhập ngày mua, đơn giá/kg, khối lượng'); return;
      }
      payload.water_percent = payload.water_percent === '' ? null : Number(payload.water_percent);
      payload.net_weight = Number(netWeightPreview);
      payload.unit_price = parseMoneyInput(form.unit_price);
      payload.weight = Number(payload.weight);
      if (payload.unit_price <= 0 || payload.weight <= 0) {
        setError('Đơn giá và khối lượng phải > 0'); return;
      }
      if (editingId) {
        await api.put(`/purchases/${editingId}`, payload);
        setEditingId(null);
      } else {
        await api.post('/purchases', payload);
      }
      try { localStorage.removeItem(draftKey) } catch {}
      setForm({ purchase_date: '', supplier_name: '', ticket_name: '', invoice_no: '', weigh_ticket_code: '', vehicle_plate: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending' });
      await load();
    } catch (e) { setError(e?.response?.data?.message || 'Thêm giao dịch nhập lỗi'); }
  };

  const editRow = (r) => {
    setEditingId(r.id);
      setForm({
        purchase_date: r.purchase_date || '',
        supplier_name: r.supplier_name || '',
        ticket_name: r.ticket_name || '',
        invoice_no: r.invoice_no || '',
        weigh_ticket_code: r.weigh_ticket_code || '',
        vehicle_plate: r.vehicle_plate || '',
        weight: r.weight || '',
        water_percent: r.water_percent ?? '',
        unit_price: formatMoneyInput(r.unit_price || ''),
        payment_status: r.payment_status || 'pending'
      });
  };

  const deleteRow = async (id) => { setDeleteId(id); };
  const confirmDelete = async (ok) => {
    const id = deleteId; setDeleteId(null);
    if (!ok || !id) return;
    try { await api.delete(`/purchases/${id}`); await load(); }
    catch (e) { setError(e?.response?.data?.message || 'Xóa giao dịch nhập lỗi'); }
  };

  const exportCsv = () => {
    const headers = ['Ngày','Tên Phiếu','Mã phiếu cân','Biển số xe','Nhà CC','Kg','% Nước','Cân sau trừ hao','Đơn giá/kg','Thành tiền','Trạng thái'];
    const source = selected.length ? list.filter(r => selected.includes(r.id)) : list;
    const rows = source.map(r => [
      r.purchase_date,
      r.ticket_name || '',
      r.weigh_ticket_code || '',
      r.vehicle_plate || '',
      r.supplier_name || '',
      r.weight,
      r.water_percent ?? '',
      r.net_weight ?? (Number(r.weight) || 0),
      fmtMoney(r.unit_price),
      fmtMoney(r.total_cost),
      (STATUS_LABELS[r.payment_status] || r.payment_status)
    ]);
    const totalSum = source.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
    const totalRow = ['Tổng cộng','','','','','','', '', fmtMoney(totalSum), ''];
    const makeLine = (row) => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')
    const csv = ['\uFEFF'+makeLine(headers), ...rows.map(makeLine), makeLine(totalRow)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `purchases_${year}-${String(month).padStart(2,'0')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const w = window.open('');
    const rowsHtml = list.map(r => `<tr>`+
      `<td>${r.purchase_date}</td>`+
      `<td>${r.ticket_name||''}</td>`+
      `<td>${r.weigh_ticket_code||''}</td>`+
      `<td>${r.vehicle_plate||''}</td>`+
      `<td>${r.supplier_name||''}</td>`+
      `<td>${r.weight}</td>`+
      `<td>${r.water_percent ?? ''}</td>`+
      `<td>${r.net_weight ?? (Number(r.weight) || 0)}</td>`+
      `<td>${fmtMoney(r.unit_price)}</td>`+
      `<td>${fmtMoney(r.total_cost)}</td>`+
      `<td>${STATUS_LABELS[r.payment_status] || r.payment_status}</td>`+
    `</tr>`).join('');
    const totalSum = list.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
    const totalFormatted = fmtMoney(totalSum);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Báo cáo Nhập ${year}-${String(month).padStart(2,'0')}</title><style>
      body{font-family:sans-serif}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px;text-align:left}
      td:nth-child(3), td:nth-child(4), td:nth-child(5){text-align:right}
      h3{margin:12px 0}
    </style></head><body>
      <h3>Báo cáo Nhập ${year}-${String(month).padStart(2,'0')}</h3>
      <table>
        <thead><tr><th>Ngày</th><th>Tên Phiếu</th><th>Mã phiếu cân</th><th>Biển số xe</th><th>Nhà CC</th><th>Kg</th><th>% Nước</th><th>Cân sau trừ hao</th><th>Đơn giá/kg</th><th>Thành tiền</th><th>Trạng thái</th></tr></thead>
        <tbody>${rowsHtml}<tr style="font-weight:bold"><td colspan="7" style="text-align:right">Tổng cộng</td><td>${totalFormatted}</td><td></td></tr></tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="card">
      <h2>Nhập chè</h2>
      <div className="section-bar">
        <label>Tháng</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Năm</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Tìm</label>
        <input placeholder="nhà CC/tên phiếu/biển số" value={q} onChange={(e)=> setQ(e.target.value)} />
        <label>Từ ngày</label>
        <input type="date" value={range.from} onChange={(e)=> setRange(s=>({ ...s, from:e.target.value }))} />
        <label>Đến ngày</label>
        <input type="date" value={range.to} onChange={(e)=> setRange(s=>({ ...s, to:e.target.value }))} />
        <label>Trạng thái</label>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="pending">Chờ</option>
          <option value="paid">Đã thanh toán</option>
        </select>
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportCsv} type="button">Xuất CSV</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportPdf} type="button">Xuất PDF</button>
      </div>
      {selected.length > 0 && (
        <div className="card" style={{ display:'flex', gap:8, alignItems:'center', marginTop:12 }}>
          <div className="muted">Đã chọn {selected.length}</div>
          <button className="btn" onClick={exportCsv}>Xuất CSV (đã chọn)</button>
          {(hasRole('admin') || hasRole('finance')) && <button className="btn" onClick={() => { if (selected.length>0) setPayModal({ id: selected[0], file:null, error:'' }) }}>Đánh dấu đã trả</button>}
          <button className="btn" onClick={() => window.print()}>In phiếu</button>
          <button className="btn" onClick={() => setSelected([])}>Bỏ chọn</button>
        </div>
      )}

      <form onSubmit={onSubmit} className="form-grid">
        <div className="form-card">
          <div className="card-title">Thông tin phiếu nhập</div>
          <div className="group">
            <div>
              <label>Ngày mua</label>
              <input type="date" value={form.purchase_date} onChange={(e) => change('purchase_date', e.target.value)} />
            </div>
            <div>
              <label>Tên Phiếu</label>
              <input placeholder="VD: PN-11" value={form.ticket_name} onChange={(e) => change('ticket_name', e.target.value)} />
            </div>
            <div>
              <label>Số HĐ</label>
              <input placeholder="VD: 00123" value={form.invoice_no} onChange={(e) => change('invoice_no', e.target.value)} />
            </div>
            <div>
              <label>Mã phiếu cân</label>
              <input value={form.weigh_ticket_code} onChange={(e) => change('weigh_ticket_code', e.target.value)} />
            </div>
            <div>
              <label>Biển số xe cân</label>
              <input value={form.vehicle_plate} onChange={(e) => change('vehicle_plate', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="form-card">
          <div className="card-title">Thông số – Sản lượng</div>
          <div className="group">
            <div>
              <label>Nhà cung cấp</label>
              <input list="suppliersList" placeholder="VD: A Hưng" value={form.supplier_name} onChange={(e) => { const name = e.target.value; setForm(s=> ({ ...s, supplier_name: name })); const list = (recentPurchases||[]).filter(r => String(r.supplier_name||'')===name); if (list.length) { const avg = Math.round(list.reduce((sum, r) => sum + Number(r.unit_price||0), 0) / list.length); setForm(s => ({ ...s, unit_price: formatMoneyInput(String(avg)) })) } }} />
              <datalist id="suppliersList">
                {suppliers.map(s => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
          </div>
        </div>
        
        <div className="form-card">
          <div className="card-title">Giá & Thanh toán</div>
          <div className="group">
            <div>
              <label>Khối lượng (kg)</label>
              <input className="highlight" type="number" min="0.001" step="0.001" value={form.weight} onChange={(e) => change('weight', e.target.value)} />
            </div>
            <div>
              <label>% Nước</label>
              <input type="number" min="0" max="100" step="0.1" value={form.water_percent} onChange={(e) => change('water_percent', e.target.value)} />
            </div>
            <div>
              <label>Cân sau trừ hao</label>
              <input type="number" value={netWeightPreview} readOnly />
            </div>
            <div>
              <div className="muted">Chênh lệch cân: {(Number(form.weight||0) - Number(netWeightPreview||0)).toLocaleString()} kg</div>
            </div>
          </div>
        </div>
        <div className="form-card">
          <div className="group">
            <div>
              <label>Đơn giá/kg</label>
              <input className="highlight" value={form.unit_price} onChange={(e) => {
          const v = e.target.value; const val = parseMoneyInput(v); setForm(s => ({ ...s, unit_price: formatMoneyInput(v) }));
          const refDate = form.purchase_date ? new Date(form.purchase_date) : new Date(); const since = new Date(refDate.getTime() - 7*24*3600*1000)
          const items = (recentPurchases||[]).filter(r => { const d = new Date(r.purchase_date); return d >= since && d <= refDate })
          let sum=0, cnt=0; items.forEach(r => { sum += Number(r.unit_price||0); cnt++ }); const avg = cnt>0 ? (sum/cnt) : 0
          if (avg>0 && val > avg*1.15) setError(`Giá mua cao hơn trung bình 7 ngày gần nhất (${Math.round(avg).toLocaleString()} đ/kg)`) 
        }} />
            </div>
            <div>
              <label>Trạng thái thanh toán</label>
              <select value={form.payment_status} onChange={(e) => change('payment_status', e.target.value)}>
                <option value="pending">Chờ</option>
                <option value="paid">Đã thanh toán</option>
              </select>
            </div>
            <div>
              <div className="total-money">💰 Thành tiền dự tính: {totalPreview.toLocaleString()} đ</div>
              {error && <div className="error">{error}</div>}
              <button className="submit" type="submit">{editingId ? 'Lưu chỉnh sửa' : 'Thêm giao dịch nhập'}</button>
            </div>
          </div>
        </div>
        <div className="card" style={{ marginTop:8, padding:12 }} onDragOver={(e)=> e.preventDefault()} onDrop={async (e)=>{
          e.preventDefault(); const f=e.dataTransfer.files&&e.dataTransfer.files[0]; if(!f){return}
          if(!selected.length){ setError('Hãy chọn một dòng để đính kèm ảnh rồi thả ảnh vào'); return }
          const id=selected[0]; if(f.size>5*1024*1024){ setError('Ảnh phải nhỏ hơn 5MB'); return }
          try{
            if(f.size>1024*1024){ const out=await compressImage(f); setPayModal({ id, file:{ name: out.name, data: out.data }, error:'' }) }
            else { const r=new FileReader(); r.onload=()=> setPayModal({ id, file:{ name:f.name, data:r.result }, error:'' }); r.readAsDataURL(f) }
          }catch{ setError('Nén ảnh lỗi') }
        }}>
          Kéo thả ảnh vào đây để đính kèm cho dòng đã chọn
        </div>
        {hint && <div className="muted" style={{ gridColumn:'1/-1', marginTop:8 }}>{hint}</div>}
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ purchase_date: '', supplier_name: '', ticket_name: '', weigh_ticket_code: '', vehicle_plate: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending' }); }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ngày</th><th>Tên Phiếu</th><th>Mã phiếu cân</th><th>Biển số xe</th><th>Nhà CC</th><th className="num">Kg</th><th className="num">% Nước</th><th className="num">Sau trừ hao</th><th className="num">Đơn giá/kg</th><th className="num">Thành tiền</th><th>TT</th><th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({length:5}).map((_,i)=> (
                  <tr key={i}>
                    {Array.from({length:12}).map((_,j)=> <td key={j}><div className="skeleton skeleton-line" style={{width: j%3===0?'60%':'80%'}}></div></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          list.length === 0 ? (
            <div className="empty-state" style={{ marginTop:12 }}>
              Chưa có dữ liệu tháng {String(month).padStart(2,'0')}/{year}. → Thêm giao dịch nhập ở form phía trên.
            </div>
          ) : (
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={selected.length===list.length && list.length>0} onChange={(e) => setSelected(e.target.checked ? list.map(r=>r.id) : [])} /></th>
                <th><button className="btn" onClick={()=> setSort(s=>({ key:'purchase_date', asc: !s.asc }))}>Ngày {sort.key==='purchase_date' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th><button className="btn" onClick={()=> setSort(s=>({ key:'ticket_name', asc: !s.asc }))}>Tên Phiếu {sort.key==='ticket_name' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th>Mã phiếu cân</th>
                <th>Biển số xe</th>
                <th><button className="btn" onClick={()=> setSort(s=>({ key:'supplier_name', asc: !s.asc }))}>Nhà CC {sort.key==='supplier_name' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th>Người tạo</th>
                <th className="num"><button className="btn" onClick={()=> setSort(s=>({ key:'weight', asc: !s.asc }))}>Kg {sort.key==='weight' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th className="num">% Nước</th>
                <th className="num"><button className="btn" onClick={()=> setSort(s=>({ key:'net_weight', asc: !s.asc }))}>Sau trừ hao {sort.key==='net_weight' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th className="num"><button className="btn" onClick={()=> setSort(s=>({ key:'unit_price', asc: !s.asc }))}>Đơn giá/kg {sort.key==='unit_price' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th className="num"><button className="btn" onClick={()=> setSort(s=>({ key:'total_cost', asc: !s.asc }))}>Thành tiền {sort.key==='total_cost' ? (sort.asc?'↑':'↓') : ''}</button></th>
                <th>TT</th>
                <th>Ảnh</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {list.slice((page-1)*pageSize, page*pageSize).map(r => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(s => e.target.checked ? [...new Set([...s, r.id])] : s.filter(x=>x!==r.id))} /></td>
                  <td>{r.purchase_date}</td>
                  <td>{r.ticket_name}</td>
                  <td>{r.weigh_ticket_code || ''}</td>
                  <td>{r.vehicle_plate || ''}</td>
                  <td>{r.supplier_name}</td>
                  <td>{r.owner || r.created_by || ''}</td>
                  <td className="num">{(Number(r.weight)||0).toLocaleString()}</td>
                  <td className="num">{r.water_percent ?? ''}</td>
                  <td className="num">{(Number(r.net_weight ?? r.weight)||0).toLocaleString()}</td>
                  <td className="num">{fmtMoney(r.unit_price)}</td>
                  <td className="num">{fmtMoney(r.total_cost)}</td>
                  <td><span className={`pill ${r.payment_status}`}>{STATUS_LABELS[r.payment_status] || r.payment_status}</span></td>
                  <td>{r.receipt_path ? (
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="btn" onClick={()=> setViewer({ open:true, url: receiptEndpoint('purchases', r.id), scale:1, img:true })}>Thu phóng</button>
                      <a href={receiptEndpoint('purchases', r.id)} target="_blank" rel="noreferrer">Mở tab</a>
                    </div>
                  ) : (<span className="muted">Chưa có tệp</span>)}</td>
                  <td>
                    {(hasRole('admin') || hasRole('finance')) && r.payment_status !== 'paid' && (
                      <button className="btn" onClick={() => markPaid(r.id)}>Đã thanh toán</button>
                    )}
                    {(hasRole('admin') || hasRole('finance')) && !r.receipt_path && (
                      <button className="btn" style={{ marginLeft: 6 }} onClick={() => setPayModal({ id: r.id, file:null, error:'' })}>Đính kèm ảnh</button>
                    )}
                    {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => editRow(r)}>Sửa</button>}
                    {hasRole('admin') && <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
            <button className="btn" onClick={()=> setPage(p=> Math.max(1, p-1))}>«</button>
            <div className="muted">Trang {page}</div>
            <button className="btn" onClick={()=> setPage(p=> (p*pageSize<list.length ? p+1 : p))}>»</button>
          </div>
          </div>
          )
        )}
      </div>

      {deleteId != null && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 360 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Xóa giao dịch nhập?</div>
            <div className="muted" style={{ marginBottom:12 }}>Hành động này không thể hoàn tác.</div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn" onClick={() => confirmDelete(false)}>Hủy</button>
              <button className="btn primary" onClick={() => confirmDelete(true)}>Xóa</button>
            </div>
          </div>
        </div>
      )}

      {payModal.id && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card" style={{ width: 420 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Đính kèm ảnh/PDF giao dịch (&lt;5MB)</div>
            <input type="file" accept="image/*,.pdf" capture="environment" onChange={async (e) => {
              const f = e.target.files && e.target.files[0]; if (!f) return;
              if (f.size > 5*1024*1024) { setPayModal(s=>({ ...s, error:'Tệp phải nhỏ hơn 5MB' })); e.target.value=''; return; }
              try {
                if (String(f.type||'').startsWith('image/')) {
                  if (f.size > 1024*1024) {
                    const out = await compressImage(f);
                    setPayModal(s=>({ ...s, file: { name: out.name, data: out.data } }));
                  } else {
                    const r = new FileReader(); r.onload = () => setPayModal(s=>({ ...s, file: { name: f.name, data: r.result } })); r.readAsDataURL(f);
                  }
                  const w = await analyzeImageFile(f); setImgWarn(w)
                } else {
                  const r = new FileReader(); r.onload = () => setPayModal(s=>({ ...s, file: { name: f.name, data: r.result } })); r.readAsDataURL(f);
                  setImgWarn([])
                }
              } catch { setPayModal(s=>({ ...s, error:'Nén ảnh lỗi' })) }
            }} />
            {imgWarn.length>0 && <div className="error" style={{ marginTop:6 }}>{imgWarn.join(' • ')}</div>}
            {payModal.error && <div className="error" style={{ marginTop:8 }}>{payModal.error}</div>}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <div style={{flex:1}}></div>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                <input type="checkbox" checked={payModal.ack} onChange={(e)=> setPayModal(s=>({ ...s, ack:e.target.checked }))} /> Tôi xác nhận ghi nhận đã thanh toán
              </label>
              <button className="btn" onClick={() => setPayModal({ id:null, file:null, error:'', ack:false })}>Hủy</button>
              <button className={`btn primary ${!payModal.ack?'disabled':''}`} onClick={async () => {
                if (!payModal.file) { setPayModal(s=>({ ...s, error:'Vui lòng chọn tệp (&lt;5MB)' })); return; }
                if (!payModal.ack) { setPayModal(s=>({ ...s, error:'Vui lòng tick xác nhận trước khi ghi' })); return; }
                try {
                  await api.put(`/purchases/${payModal.id}`, { payment_status: 'paid', receipt_data: payModal.file.data, receipt_name: payModal.file.name })
                  setPayModal({ id:null, file:null, error:'', ack:false }); await load(); setSelected([])
                } catch (e) { setPayModal(s=>({ ...s, error: e?.response?.data?.message || 'Cập nhật lỗi' })) }
              }}>Xác nhận</button>
            </div>
          </div>
        </div>
      )}
    </div>
    {viewer.open && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="card" style={{ width:'90vw', maxWidth:1100 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale: Math.max(0.25, s.scale-0.25) }))}>−</button>
            <div className="muted">{Math.round(viewer.scale*100)}%</div>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale: Math.min(6, s.scale+0.25) }))}>+</button>
            <button className="btn" onClick={()=> setViewer(s=> ({ ...s, scale:1 }))}>100%</button>
            <div style={{flex:1}}></div>
            <button className="btn" onClick={()=> setViewer({ open:false, url:'', scale:1, img:true })}>Đóng</button>
          </div>
          <div style={{ marginTop:8, border:'1px solid #e8dac2', borderRadius:12, overflow:'auto', maxHeight:'70vh' }}>
            {viewer.img ? (
              <img src={viewer.url} style={{ transform:`scale(${viewer.scale})`, transformOrigin:'center top', display:'block', maxWidth:'100%' }} onError={()=> setViewer(s=> ({ ...s, img:false }))} />
            ) : (
              <iframe title="viewer" src={viewer.url} style={{ width:'100%', height:'70vh', border:0 }} />
            )}
          </div>
        </div>
      </div>
    )}
  );
}
  const analyzeImageFile = (file) => new Promise((resolve) => {
    const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { const max=512; let w=img.width, h=img.height; const r=Math.min(1, max/w, max/h); w=Math.round(w*r); h=Math.round(h*r); const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h); const d=ctx.getImageData(0,0,w,h).data; const g=new Float32Array(w*h); for(let i=0,j=0;i<d.length;i+=4,j++){ g[j]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2] } let sum=0, sum2=0; for(let i=0;i<g.length;i++){ sum+=g[i]; sum2+=g[i]*g[i] } const mean=sum/g.length; const std=Math.sqrt(Math.max(0,sum2/g.length-mean*mean)); const lap=new Float32Array(w*h); for(let y=1;y<h-1;y++){ for(let x=1;x<w-1;x++){ const i=y*w+x; lap[i]=g[i-w]+g[i-1]+g[i+1]+g[i+w]-4*g[i] } } let lsum=0, lsum2=0; for(let i=0;i<lap.length;i++){ lsum+=lap[i]; lsum2+=lap[i]*lap[i] } const lvar=Math.max(0,lsum2/lap.length-(lsum/lap.length)*(lsum/lap.length)); const sobX=[-1,0,1,-2,0,2,-1,0,1]; const sobY=[-1,-2,-1,0,0,0,1,2,1]; const bins=new Array(18).fill(0); for(let y=1;y<h-1;y++){ for(let x=1;x<w-1;x++){ let gx=0, gy=0; let k=0; for(let yy=-1;yy<=1;yy++){ for(let xx=-1;xx<=1;xx++){ const val=g[(y+yy)*w+(x+xx)]; gx+=val*sobX[k]; gy+=val*sobY[k]; k++ } } const ang=Math.atan2(gy,gx); const deg=((ang*180/Math.PI)+360)%180; const bin=Math.min(17,Math.floor(deg/10)); bins[bin]+=Math.hypot(gx,gy) } } const peak=bins.indexOf(Math.max(...bins)); const peakDeg=peak*10; const tilt=Math.min(Math.abs(peakDeg-0),Math.abs(peakDeg-90)); const warns=[]; if (lvar<15) warns.push('Ảnh có thể bị mờ'); if (std<20 || mean<40 || mean>215) warns.push('Ảnh có thể thiếu độ rõ'); if (tilt>15) warns.push('Ảnh có thể chụp sai góc'); URL.revokeObjectURL(url); resolve(warns) }; img.onerror=()=>{ URL.revokeObjectURL(url); resolve([]) }; img.src=url; })
