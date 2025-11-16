import React, { useEffect, useMemo, useState } from 'react';
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

export default function Purchases() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({
    purchase_date: '', supplier_name: '', ticket_name: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending'
  });

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
      const res = await api.get('/purchases', { params });
      setList(res.data);
    } catch (e) { setError(e?.response?.data?.message || 'Tải danh sách lỗi'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, paymentFilter]);
  useEffect(() => {
    (async () => {
      try { const r = await api.get('/suppliers'); setSuppliers(r.data || []); } catch {}
    })();
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

  const markPaid = async (id) => {
    try {
      await api.put(`/purchases/${id}`, { payment_status: 'paid' });
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || 'Cập nhật trạng thái lỗi');
    }
  };

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
      setForm({ purchase_date: '', supplier_name: '', ticket_name: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending' });
      await load();
    } catch (e) { setError(e?.response?.data?.message || 'Thêm giao dịch nhập lỗi'); }
  };

  const editRow = (r) => {
    setEditingId(r.id);
    setForm({
      purchase_date: r.purchase_date || '',
      supplier_name: r.supplier_name || '',
      ticket_name: r.ticket_name || '',
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
    const headers = ['Ngày','Tên Phiếu','Nhà CC','Kg','% Nước','Cân sau trừ hao','Đơn giá/kg','Thành tiền','Trạng thái'];
    const rows = list.map(r => [
      r.purchase_date,
      r.ticket_name || '',
      r.supplier_name || '',
      r.weight,
      r.water_percent ?? '',
      r.net_weight ?? (Number(r.weight) || 0),
      fmtMoney(r.unit_price),
      fmtMoney(r.total_cost),
      r.payment_status
    ]);
    const totalSum = list.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
    const totalRow = ['Tổng cộng','','','','','', '', fmtMoney(totalSum), ''];
    const csv = [headers, ...rows, totalRow].map(row => row.map(v => (v ?? '')).join(',')).join('\n');
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
      `<td>${r.supplier_name||''}</td>`+
      `<td>${r.weight}</td>`+
      `<td>${r.water_percent ?? ''}</td>`+
      `<td>${r.net_weight ?? (Number(r.weight) || 0)}</td>`+
      `<td>${fmtMoney(r.unit_price)}</td>`+
      `<td>${fmtMoney(r.total_cost)}</td>`+
      `<td>${r.payment_status}</td>`+
    `</tr>`).join('');
    const totalSum = list.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
    const totalFormatted = fmtMoney(totalSum);
    w.document.write(`<!doctype html><html><head><title>Purchases ${year}-${String(month).padStart(2,'0')}</title><style>
      body{font-family:sans-serif}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px;text-align:left}
      td:nth-child(3), td:nth-child(4), td:nth-child(5){text-align:right}
      h3{margin:12px 0}
    </style></head><body>
      <h3>Báo cáo Nhập ${year}-${String(month).padStart(2,'0')}</h3>
      <table>
        <thead><tr><th>Ngày</th><th>Tên Phiếu</th><th>Nhà CC</th><th>Kg</th><th>% Nước</th><th>Cân sau trừ hao</th><th>Đơn giá/kg</th><th>Thành tiền</th><th>Trạng thái</th></tr></thead>
        <tbody>${rowsHtml}<tr style="font-weight:bold"><td colspan="7" style="text-align:right">Tổng cộng</td><td>${totalFormatted}</td><td></td></tr></tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="card">
      <h2>Quản lý Nhập Chè (Chi)</h2>
      <div className="filters">
        <label>Tháng</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Năm</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label>Trạng thái</label>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="pending">pending</option>
          <option value="paid">paid</option>
        </select>
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportCsv} type="button">Xuất CSV</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportPdf} type="button">Xuất PDF</button>
      </div>

      <form onSubmit={onSubmit} className="form">
        <label>Ngày mua</label>
        <input type="date" value={form.purchase_date} onChange={(e) => change('purchase_date', e.target.value)} />
        <label>Tên Phiếu</label>
        <input value={form.ticket_name} onChange={(e) => change('ticket_name', e.target.value)} />
        <label>Nhà cung cấp</label>
        <input list="suppliersList" value={form.supplier_name} onChange={(e) => change('supplier_name', e.target.value)} />
        <datalist id="suppliersList">
          {suppliers.map(s => <option key={s.id} value={s.name} />)}
        </datalist>
        <label>Khối lượng (kg)</label>
        <input type="number" min="0.001" step="0.001" value={form.weight} onChange={(e) => change('weight', e.target.value)} />
        <label>% Nước</label>
        <input type="number" min="0" max="100" step="0.1" value={form.water_percent} onChange={(e) => change('water_percent', e.target.value)} />
        <label>Cân sau trừ hao</label>
        <input type="number" value={netWeightPreview} readOnly />
        <label>Đơn giá/kg</label>
        <input value={form.unit_price} onChange={(e) => change('unit_price', e.target.value)} />
        <label>Trạng thái thanh toán</label>
        <select value={form.payment_status} onChange={(e) => change('payment_status', e.target.value)}>
          <option value="pending">pending</option>
          <option value="paid">paid</option>
        </select>
        <div className="muted">Tổng tạm tính: {totalPreview.toLocaleString()}</div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu chỉnh sửa' : 'Thêm giao dịch nhập'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ purchase_date: '', supplier_name: '', ticket_name: '', weight: '', water_percent: '', unit_price: '', payment_status: 'pending' }); }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Tên Phiếu</th>
                <th>Nhà CC</th>
                <th className="num">Kg</th>
                <th className="num">% Nước</th>
                <th className="num">Sau trừ hao</th>
                <th className="num">Đơn giá/kg</th>
                <th className="num">Thành tiền</th>
                <th>TT</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td>{r.purchase_date}</td>
                  <td>{r.ticket_name}</td>
                  <td>{r.supplier_name}</td>
                  <td className="num">{(Number(r.weight)||0).toLocaleString()}</td>
                  <td className="num">{r.water_percent ?? ''}</td>
                  <td className="num">{(Number(r.net_weight ?? r.weight)||0).toLocaleString()}</td>
                  <td className="num">{fmtMoney(r.unit_price)}</td>
                  <td className="num">{fmtMoney(r.total_cost)}</td>
                  <td><span className={`pill ${r.payment_status}`}>{r.payment_status}</span></td>
                  <td>
                    {role === 'admin' && r.payment_status !== 'paid' && (
                      <button className="btn" onClick={() => markPaid(r.id)}>Đã thanh toán</button>
                    )}
                    {role === 'admin' && <button className="btn" style={{ marginLeft: 6 }} onClick={() => editRow(r)}>Sửa</button>}
                    {role === 'admin' && <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
