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

export default function Sales() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({
    sale_date: '', ticket_name: '', contract: '', created_by: '', issued_by: '', customer_name: '', tea_type: '', price_per_kg: '', weight: '', payment_status: 'pending'
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
      const res = await api.get('/sales', { params });
      setList(res.data);
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải danh sách lỗi');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, paymentFilter]);
  useEffect(() => {
    (async () => {
      try { const c = await api.get('/customers'); setCustomers(c.data || []); } catch {}
      try { const s = await api.get('/staff'); setStaff(s.data || []); } catch {}
    })();
  }, []);

  const totalPreview = (() => {
    const p = parseMoneyInput(form.price_per_kg || 0);
    const w = parseFloat(form.weight || 0);
    return (p * w) || 0;
  })();

  const onSubmit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form, price_per_kg: parseMoneyInput(form.price_per_kg), weight: Number(form.weight) };
      if (!payload.sale_date || !payload.price_per_kg || !payload.weight) {
        setError('Vui lòng nhập ngày bán, đơn giá/kg, khối lượng'); return;
      }
      if (payload.price_per_kg <= 0 || payload.weight <= 0) {
        setError('Đơn giá và khối lượng phải > 0'); return;
      }
      if (editingId) {
        await api.put(`/sales/${editingId}`, payload);
        setEditingId(null);
      } else {
        await api.post('/sales', payload);
      }
      setForm({ sale_date: '', ticket_name: '', contract: '', created_by: '', issued_by: '', customer_name: '', tea_type: '', price_per_kg: '', weight: '', payment_status: 'pending' });
      await load();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.response?.data?.message || e?.message || 'Thêm đơn bán lỗi';
      setError(msg);
    }
  };

  const change = (k, v) => {
    if (k === 'price_per_kg') {
      setForm(s => ({ ...s, [k]: formatMoneyInput(v) }));
      return;
    }
    setForm(s => ({ ...s, [k]: v }));
  };

  const markPaid = async (id) => {
    try {
      await api.put(`/sales/${id}`, { payment_status: 'paid' });
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || 'Cập nhật trạng thái lỗi');
    }
  };

  const editRow = (r) => {
    setEditingId(r.id);
    setForm({
      sale_date: r.sale_date || '',
      ticket_name: r.ticket_name || '',
      contract: r.contract || '',
      created_by: r.created_by || '',
      issued_by: r.issued_by || '',
      customer_name: r.customer_name || '',
      tea_type: r.tea_type || '',
      price_per_kg: formatMoneyInput(r.price_per_kg || ''),
      weight: r.weight || '',
      payment_status: r.payment_status || 'pending'
    });
  };

  const deleteRow = async (id) => {
    setDeleteId(id);
  };
  const confirmDelete = async (ok) => {
    const id = deleteId; setDeleteId(null);
    if (!ok || !id) return;
    try { await api.delete(`/sales/${id}`); await load(); }
    catch (e) { setError(e?.response?.data?.message || 'Xóa đơn bán lỗi'); }
  };

  const exportCsv = () => {
    const headers = ['Ngày','Tên phiếu','Hợp đồng','Người tạo phiếu','Người xuất chè','Khách hàng','Loại','Giá','Cân','Thành tiền','Thanh toán'];
    const rows = list.map(r => [
      r.sale_date,
      r.ticket_name || '',
      r.contract || '',
      r.created_by || '',
      r.issued_by || '',
      r.customer_name || '',
      r.tea_type || '',
      fmtMoney(r.price_per_kg),
      r.weight,
      fmtMoney(r.total_amount),
      r.payment_status
    ]);
    const totalSum = list.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const totalRow = ['Tổng cộng','','','','','','','', '', fmtMoney(totalSum), ''];
    const csv = [headers, ...rows, totalRow].map(row => row.map(v => (v ?? '')).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sales_${year}-${String(month).padStart(2,'0')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const w = window.open('');
    const rowsHtml = list.map(r => `<tr>`+
      `<td>${r.sale_date}</td>`+
      `<td>${r.ticket_name||''}</td>`+
      `<td>${r.contract||''}</td>`+
      `<td>${r.created_by||''}</td>`+
      `<td>${r.issued_by||''}</td>`+
      `<td>${r.customer_name||''}</td>`+
      `<td>${r.tea_type||''}</td>`+
      `<td>${fmtMoney(r.price_per_kg)}</td>`+
      `<td>${r.weight}</td>`+
      `<td>${fmtMoney(r.total_amount)}</td>`+
      `<td>${r.payment_status}</td>`+
    `</tr>`).join('');
    const totalSum = list.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const totalFormatted = fmtMoney(totalSum);
    w.document.write(`<!doctype html><html><head><title>Sales ${year}-${String(month).padStart(2,'0')}</title><style>
      body{font-family:sans-serif}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px;text-align:left}
      td:nth-child(4), td:nth-child(5), td:nth-child(6){text-align:right}
      h3{margin:12px 0}
    </style></head><body>
      <h3>Báo cáo Thu ${year}-${String(month).padStart(2,'0')}</h3>
      <table>
        <thead><tr><th>Số vụ</th><th>Ngày xuất</th><th>Tháng</th><th>Năm</th><th>Tên</th><th>Hợp đồng</th><th>Người tạo phiếu</th><th>Người xuất chè</th><th>Loại chè</th><th>Giá</th><th>Cân</th><th>Thành tiền</th><th>Thanh toán</th></tr></thead>
        <tbody>${rowsHtml}<tr style="font-weight:bold"><td colspan="11" style="text-align:right">Tổng cộng</td><td>${totalFormatted}</td><td></td></tr></tbody>
      </table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="card">
      <h2>Quản lý Xuất Chè (Thu)</h2>
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
        <label>Ngày bán</label>
        <input type="date" value={form.sale_date} onChange={(e) => change('sale_date', e.target.value)} />
        <label>Tên phiếu</label>
        <input value={form.ticket_name} onChange={(e) => change('ticket_name', e.target.value)} />
        <label>Hợp đồng</label>
        <input value={form.contract} onChange={(e) => change('contract', e.target.value)} />
        <label>Người tạo phiếu</label>
        <input list="staffCreators" value={form.created_by} onChange={(e) => change('created_by', e.target.value)} />
        <datalist id="staffCreators">
          {staff.filter(x => !x.role || x.role === 'creator').map(x => <option key={`c${x.id}`} value={x.name} />)}
        </datalist>
        <label>Người xuất chè</label>
        <input list="staffSellers" value={form.issued_by} onChange={(e) => change('issued_by', e.target.value)} />
        <datalist id="staffSellers">
          {staff.filter(x => !x.role || x.role === 'seller').map(x => <option key={`s${x.id}`} value={x.name} />)}
        </datalist>
        <label>Khách hàng</label>
        <input list="customersList" value={form.customer_name} onChange={(e) => change('customer_name', e.target.value)} />
        <datalist id="customersList">
          {customers.map(c => <option key={c.id} value={c.name} />)}
        </datalist>
        <label>Loại chè</label>
        <input value={form.tea_type} onChange={(e) => change('tea_type', e.target.value)} />
        <label>Đơn giá/kg</label>
        <input value={form.price_per_kg} onChange={(e) => change('price_per_kg', e.target.value)} />
        <label>Khối lượng (kg)</label>
        <input type="number" min="0.001" step="0.001" value={form.weight} onChange={(e) => change('weight', e.target.value)} />
        <label>Trạng thái thanh toán</label>
        <select value={form.payment_status} onChange={(e) => change('payment_status', e.target.value)}>
          <option value="pending">pending</option>
          <option value="paid">paid</option>
        </select>
        <div className="muted">Tổng tạm tính: {totalPreview.toLocaleString()}</div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu chỉnh sửa' : 'Thêm đơn bán'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ sale_date: '', customer_name: '', tea_type: '', price_per_kg: '', weight: '', payment_status: 'pending' }); }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead>
              <tr>
                <th>Ngày xuất</th>
                <th>Tên phiếu</th>
                <th>Hợp đồng</th>
                <th>Người tạo phiếu</th>
                <th>Người xuất chè</th>
                <th>Khách hàng</th>
                <th>Loại chè</th>
                <th className="num">Giá</th>
                <th className="num">Cân</th>
                <th className="num">Thành tiền</th>
                <th>Thanh toán</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td>{r.sale_date}</td>
                  <td>{r.ticket_name}</td>
                  <td>{r.contract}</td>
                  <td>{r.created_by}</td>
                  <td>{r.issued_by}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.tea_type}</td>
                  <td className="num">{fmtMoney(r.price_per_kg)}</td>
                  <td className="num">{(Number(r.weight)||0).toLocaleString()}</td>
                  <td className="num">{fmtMoney(r.total_amount)}</td>
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
            <div style={{ fontWeight:700, marginBottom:8 }}>Xóa đơn bán?</div>
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
