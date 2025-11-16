import React, { useEffect, useMemo, useState } from 'react';
import api from '../api.js';

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN');

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
    expense_date: '', description: '', amount: '', category: 'Biến phí'
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
      const res = await api.get('/expenses', { params });
      setList(res.data);
    } catch (e) { setError(e?.response?.data?.message || 'Tải chi phí lỗi'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);

  const change = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form };
      if (!payload.expense_date || payload.amount === '') {
        setError('Vui lòng nhập ngày và số tiền'); return;
      }
      if (editingId) {
        await api.put(`/expenses/${editingId}`, { ...payload, amount: Number(payload.amount) });
        setEditingId(null);
      } else {
        await api.post('/expenses', { ...payload, amount: Number(payload.amount) });
      }
      setForm({ expense_date: '', description: '', amount: '', category: 'Biến phí' });
      await load();
    } catch (e) { setError(e?.response?.data?.message || 'Lưu chi phí lỗi'); }
  };

  const editRow = (r) => {
    setEditingId(r.id);
    setForm({ expense_date: r.expense_date || '', description: r.description || '', amount: r.amount || '', category: r.category || 'Biến phí' });
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
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportCsv} type="button">Xuất CSV</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={exportPdf} type="button">Xuất PDF</button>
      </div>

      <form onSubmit={onSubmit} className="form">
        <label>Ngày</label>
        <input type="date" value={form.expense_date} onChange={(e) => change('expense_date', e.target.value)} />
        <label>Mô tả</label>
        <input value={form.description} onChange={(e) => change('description', e.target.value)} />
        <label>Loại chi phí</label>
        <select value={form.category} onChange={(e) => change('category', e.target.value)}>
          <option value="Biến phí">Biến phí</option>
          <option value="Định phí">Định phí</option>
        </select>
        <label>Số tiền</label>
        <input type="number" value={form.amount} onChange={(e) => change('amount', e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit">{editingId ? 'Lưu chỉnh sửa' : 'Thêm chi phí'}</button>
        {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm({ expense_date: '', description: '', amount: '', category: 'Biến phí' }); }}>Hủy</button>}
      </form>

      <div style={{ marginTop: 16 }}>
        {loading ? 'Đang tải...' : (
          <table className="table">
            <thead>
              <tr>
                <th>Ngày</th><th>Mô tả</th><th>Loại</th><th>Số tiền</th><th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td>{r.expense_date}</td>
                  <td>{r.description}</td>
                  <td>{r.category || ''}</td>
                  <td>{r.amount}</td>
                  <td>
                    <button className="btn" onClick={() => editRow(r)}>Sửa</button>
                    <button className="btn" style={{ marginLeft: 6 }} onClick={() => deleteRow(r.id)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}