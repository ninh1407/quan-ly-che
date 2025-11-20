import React, { useEffect, useMemo, useState } from 'react';
import api from '../api.js';

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN');

function monthRange(startMonth, startYear, length = 3) {
  const arr = [];
  for (let i = 0; i < length; i++) {
    const m = ((startMonth - 1 + i) % 12) + 1;
    const y = startYear + Math.floor((startMonth - 1 + i) / 12);
    arr.push({ month: m, year: y });
  }
  return arr;
}

function useSeasonInit() {
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const year = now.getFullYear();
  // Mặc định chọn tháng hiện tại làm bắt đầu (có thể đổi trong UI)
  const startMonth = thisMonth;
  return { startMonth, year };
}

export default function Season() {
  const init = useSeasonInit();
  const [startMonth, setStartMonth] = useState(init.startMonth);
  const [length, setLength] = useState(3); // cho phép chọn 2 hoặc 4; mặc định 3 vẫn hỗ trợ
  const [year, setYear] = useState(init.year);
  const [sales, setSales] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Bộ lọc
  const [teaTypeFilter, setTeaTypeFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const seasonMonths = useMemo(() => monthRange(startMonth, year, length), [startMonth, year, length]);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const lengthOptions = useMemo(() => [2, 3, 4], []); // yêu cầu 2 hoặc 4; thêm 3 để tiện so sánh
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => y - 3 + i);
  }, []);

  // Cho phép chọn tháng bắt đầu 1–12 cho mọi độ dài đợt
  const seasonStartOptions = useMemo(() => monthOptions, [monthOptions]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      // Fetch per month then merge
      const salesPromises = seasonMonths.map(({ month, year }) => api.get('/sales', { params: { month, year } }));
      const purchasePromises = seasonMonths.map(({ month, year }) => api.get('/purchases', { params: { month, year } }));
      const expensePromises = seasonMonths.map(({ month, year }) => api.get('/expenses', { params: { month, year } }));
      const [sResList, pResList, eResList] = await Promise.all([
        Promise.all(salesPromises),
        Promise.all(purchasePromises),
        Promise.all(expensePromises)
      ]);
      setSales(sResList.flatMap(r => r.data || []));
      setPurchases(pResList.flatMap(r => r.data || []));
      setExpenses(eResList.flatMap(r => r.data || []));
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải dữ liệu theo đợt lỗi');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [startMonth, year, length]);

  // Datalist gợi ý
  const teaTypeOptions = useMemo(() => {
    const set = new Set();
    for (const r of sales) { if (r.tea_type) set.add(r.tea_type); }
    return Array.from(set);
  }, [sales]);
  const customerOptions = useMemo(() => {
    const set = new Set();
    for (const r of sales) { if (r.customer_name) set.add(r.customer_name); }
    return Array.from(set);
  }, [sales]);
  const supplierOptions = useMemo(() => {
    const set = new Set();
    for (const r of purchases) { if (r.supplier_name) set.add(r.supplier_name); }
    return Array.from(set);
  }, [purchases]);

  // Áp dụng bộ lọc vào dữ liệu
  const filteredSales = useMemo(() => {
    return sales.filter(r => {
      const okTea = teaTypeFilter ? String(r.tea_type || '').toLowerCase().includes(teaTypeFilter.toLowerCase()) : true;
      const okCust = customerFilter ? String(r.customer_name || '').toLowerCase().includes(customerFilter.toLowerCase()) : true;
      return okTea && okCust;
    });
  }, [sales, teaTypeFilter, customerFilter]);
  const filteredPurchases = useMemo(() => {
    return purchases.filter(r => {
      const okSupp = supplierFilter ? String(r.supplier_name || '').toLowerCase().includes(supplierFilter.toLowerCase()) : true;
      return okSupp;
    });
  }, [purchases, supplierFilter]);

  const totalSales = useMemo(() => filteredSales.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0), [filteredSales]);
  const totalPurchases = useMemo(() => filteredPurchases.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0), [filteredPurchases]);
  const totalExpenses = useMemo(() => expenses.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [expenses]);
  const netProfit = useMemo(() => totalSales - totalPurchases - totalExpenses, [totalSales, totalPurchases, totalExpenses]);

  // Ranking suppliers (farmers) by total weight and amount within the season
  const supplierStats = useMemo(() => {
    const map = new Map();
    for (const r of filteredPurchases) {
      const key = r.supplier_name || 'Không rõ';
      const prev = map.get(key) || { supplier_name: key, total_weight: 0, total_amount: 0, transactions: 0 };
      prev.total_weight += Number(r.weight) || 0;
      prev.total_amount += Number(r.total_cost) || 0;
      prev.transactions += 1;
      map.set(key, prev);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.total_amount - a.total_amount || b.total_weight - a.total_weight);
    return arr;
  }, [filteredPurchases]);

  // Ranking customers by total weight/amount within the season (sales side)
  const customerStats = useMemo(() => {
    const map = new Map();
    for (const r of filteredSales) {
      const key = r.customer_name || 'Không rõ';
      const prev = map.get(key) || { customer_name: key, total_weight: 0, total_amount: 0, transactions: 0 };
      prev.total_weight += Number(r.weight) || 0;
      prev.total_amount += Number(r.total_amount) || 0;
      prev.transactions += 1;
      map.set(key, prev);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.total_amount - a.total_amount || b.total_weight - a.total_weight);
    return arr;
  }, [filteredSales]);

  // Công nợ theo khách hàng (Thu)
  const customerDebtStats = useMemo(() => {
    const map = new Map();
    for (const r of filteredSales) {
      const key = r.customer_name || 'Không rõ';
      const prev = map.get(key) || { customer_name: key, transactions: 0, total_amount: 0, paid_amount: 0, pending_amount: 0 };
      const amount = Number(r.total_amount) || 0;
      prev.transactions += 1;
      prev.total_amount += amount;
      if (String(r.payment_status).toLowerCase() === 'paid') prev.paid_amount += amount; else prev.pending_amount += amount;
      map.set(key, prev);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.pending_amount - a.pending_amount || b.total_amount - a.total_amount);
    return arr;
  }, [filteredSales]);

  // Công nợ theo nhà vườn (Nhập)
  const supplierDebtStats = useMemo(() => {
    const map = new Map();
    for (const r of filteredPurchases) {
      const key = r.supplier_name || 'Không rõ';
      const prev = map.get(key) || { supplier_name: key, transactions: 0, total_amount: 0, paid_amount: 0, pending_amount: 0 };
      const amount = Number(r.total_cost) || 0;
      prev.transactions += 1;
      prev.total_amount += amount;
      if (String(r.payment_status).toLowerCase() === 'paid') prev.paid_amount += amount; else prev.pending_amount += amount;
      map.set(key, prev);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.pending_amount - a.pending_amount || b.total_amount - a.total_amount);
    return arr;
  }, [filteredPurchases]);

  const monthsLabel = seasonMonths.map(m => `${String(m.month).padStart(2,'0')}/${m.year}`).join(' — ');

  const maxBar = Math.max(totalSales, totalPurchases, totalExpenses, 1);
  const barWidth = (v) => `${Math.round((v / maxBar) * 100)}%`;

  // Biểu đồ theo tháng trong đợt
  const monthlyData = useMemo(() => {
    const arr = seasonMonths.map(({ month, year }) => {
      const s = filteredSales.filter(r => {
        const d = new Date(r.sale_date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
      }).reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
      const p = filteredPurchases.filter(r => {
        const d = new Date(r.purchase_date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
      }).reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0);
      const e = expenses.filter(r => {
        const d = new Date(r.expense_date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
      }).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      return { label: `${String(month).padStart(2,'0')}/${year}`, s, p, e };
    });
    return arr;
  }, [seasonMonths, filteredSales, filteredPurchases, expenses]);
  const maxMonthly = useMemo(() => {
    const values = monthlyData.flatMap(d => [d.s, d.p, d.e]);
    return Math.max(...values, 1);
  }, [monthlyData]);

  const exportSeasonCsv = () => {
    const header = [`Đợt: ${monthsLabel}`];
    const summary = [
      ['Tổng Thu', fmtMoney(totalSales)],
      ['Tổng Nhập', fmtMoney(totalPurchases)],
      ['Tổng Chi phí', fmtMoney(totalExpenses)],
      ['Lãi/Lỗ', fmtMoney(netProfit)]
    ];
    const supplierHeader = ['Nhà vườn','Số giao dịch','KL (kg)','Tổng tiền'];
    const supplierRows = supplierStats.map(s => [
      s.supplier_name,
      s.transactions,
      (Number(s.total_weight)||0).toLocaleString('vi-VN'),
      fmtMoney(s.total_amount)
    ]);
    const customerHeader = ['Khách hàng','Số giao dịch','KL (kg)','Tổng tiền'];
    const customerRows = customerStats.map(c => [
      c.customer_name,
      c.transactions,
      (Number(c.total_weight)||0).toLocaleString('vi-VN'),
      fmtMoney(c.total_amount)
    ]);
    const sections = [];
    sections.push(header.join(','));
    sections.push('Tóm tắt');
    sections.push(...summary.map(r => r.join(',')));
    sections.push('');
    sections.push('Xếp hạng Nhà vườn');
    sections.push(supplierHeader.join(','));
    sections.push(...supplierRows.map(r => r.join(',')));
    sections.push('');
    sections.push('Xếp hạng Khách hàng');
    sections.push(customerHeader.join(','));
    sections.push(...customerRows.map(r => r.join(',')));
    sections.push('');
    sections.push('Công nợ Khách hàng');
    sections.push(['Khách hàng','Số giao dịch','Tổng tiền','Đã thanh toán','Còn nợ'].join(','));
    sections.push(...customerDebtStats.map(c => [c.customer_name, c.transactions, fmtMoney(c.total_amount), fmtMoney(c.paid_amount), fmtMoney(c.pending_amount)].join(',')));
    sections.push('');
    sections.push('Công nợ Nhà vườn');
    sections.push(['Nhà vườn','Số giao dịch','Tổng tiền','Đã thanh toán','Còn nợ'].join(','));
    sections.push(...supplierDebtStats.map(s => [s.supplier_name, s.transactions, fmtMoney(s.total_amount), fmtMoney(s.paid_amount), fmtMoney(s.pending_amount)].join(',')));
    const csv = sections.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `season_${monthsLabel.replace(/\s|\//g,'_')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportSeasonPdf = () => {
    const w = window.open('');
    const supplierRowsHtml = supplierStats.map(s => `<tr>`+
      `<td>${s.supplier_name}</td>`+
      `<td style="text-align:right">${s.transactions}</td>`+
      `<td style="text-align:right">${(Number(s.total_weight)||0).toLocaleString('vi-VN')}</td>`+
      `<td style="text-align:right">${fmtMoney(s.total_amount)}</td>`+
    `</tr>`).join('');
    const customerRowsHtml = customerStats.map(c => `<tr>`+
      `<td>${c.customer_name}</td>`+
      `<td style="text-align:right">${c.transactions}</td>`+
      `<td style="text-align:right">${(Number(c.total_weight)||0).toLocaleString('vi-VN')}</td>`+
      `<td style="text-align:right">${fmtMoney(c.total_amount)}</td>`+
    `</tr>`).join('');
    const customerDebtRowsHtml = customerDebtStats.map(c => `<tr>`+
      `<td>${c.customer_name}</td>`+
      `<td style="text-align:right">${c.transactions}</td>`+
      `<td style="text-align:right">${fmtMoney(c.total_amount)}</td>`+
      `<td style="text-align:right">${fmtMoney(c.paid_amount)}</td>`+
      `<td style="text-align:right">${fmtMoney(c.pending_amount)}</td>`+
    `</tr>`).join('');
    const supplierDebtRowsHtml = supplierDebtStats.map(s => `<tr>`+
      `<td>${s.supplier_name}</td>`+
      `<td style="text-align:right">${s.transactions}</td>`+
      `<td style="text-align:right">${fmtMoney(s.total_amount)}</td>`+
      `<td style="text-align:right">${fmtMoney(s.paid_amount)}</td>`+
      `<td style="text-align:right">${fmtMoney(s.pending_amount)}</td>`+
    `</tr>`).join('');
    w.document.write(`<!doctype html><html><head><title>Season ${monthsLabel}</title><style>
      body{font-family:sans-serif}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:6px;text-align:left}
      td:nth-child(2), td:nth-child(3), td:nth-child(4){text-align:right}
      h3{margin:12px 0}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      .muted{color:#666}
    </style></head><body>
      <h3>Thống kê Đợt (${monthsLabel})</h3>
      <div class="grid">
        <div><div class="muted">Tổng Thu</div><div style="font-weight:700">${fmtMoney(totalSales)}</div></div>
        <div><div class="muted">Tổng Nhập</div><div style="font-weight:700">${fmtMoney(totalPurchases)}</div></div>
        <div><div class="muted">Tổng Chi phí</div><div style="font-weight:700">${fmtMoney(totalExpenses)}</div></div>
        <div><div class="muted">Lãi/Lỗ</div><div style="font-weight:700;color:${netProfit>=0?'#2e7d32':'#c62828'}">${fmtMoney(netProfit)}</div></div>
      </div>
      <h3>Nhà vườn bán nhiều nhất</h3>
      <table><thead><tr><th>Nhà vườn</th><th>Số giao dịch</th><th>KL (kg)</th><th>Tổng tiền</th></tr></thead><tbody>${supplierRowsHtml}</tbody></table>
      <h3>Khách hàng mua nhiều nhất</h3>
      <table><thead><tr><th>Khách hàng</th><th>Số giao dịch</th><th>KL (kg)</th><th>Tổng tiền</th></tr></thead><tbody>${customerRowsHtml}</tbody></table>
      <h3>Công nợ Khách hàng</h3>
      <table><thead><tr><th>Khách hàng</th><th>Số giao dịch</th><th>Tổng tiền</th><th>Đã thanh toán</th><th>Còn nợ</th></tr></thead><tbody>${customerDebtRowsHtml}</tbody></table>
      <h3>Công nợ Nhà vườn</h3>
      <table><thead><tr><th>Nhà vườn</th><th>Số giao dịch</th><th>Tổng tiền</th><th>Đã thanh toán</th><th>Còn nợ</th></tr></thead><tbody>${supplierDebtRowsHtml}</tbody></table>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="card">
      <h2>Thống kê theo Đợt ({length} tháng)</h2>
      <div className="filters">
        <label>Bắt đầu tháng</label>
        <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
          {seasonStartOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Độ dài đợt</label>
        <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
          {lengthOptions.map(l => <option key={l} value={l}>{l} tháng</option>)}
        </select>
        <label>Năm</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label style={{ marginLeft: 8 }}>Loại chè</label>
        <input value={teaTypeFilter} onChange={(e) => setTeaTypeFilter(e.target.value)} list="tea-types" placeholder="vd: Ô long" />
        <label style={{ marginLeft: 8 }}>Khách hàng</label>
        <input value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} list="customers" placeholder="tên khách" />
        <label style={{ marginLeft: 8 }}>Nhà vườn</label>
        <input value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} list="suppliers" placeholder="tên nhà vườn" />
        <button className="btn" style={{ marginLeft: 8 }} type="button" onClick={exportSeasonCsv}>Xuất CSV</button>
        <button className="btn" style={{ marginLeft: 8 }} type="button" onClick={exportSeasonPdf}>Xuất PDF</button>
      </div>
      {/* Datalists for filters */}
      <datalist id="tea-types">
        {teaTypeOptions.map(t => <option key={t} value={t} />)}
      </datalist>
      <datalist id="customers">
        {customerOptions.map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="suppliers">
        {supplierOptions.map(s => <option key={s} value={s} />)}
      </datalist>


      <div className="muted" style={{ marginTop: 6 }}>Đợt: {monthsLabel}</div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        {loading ? 'Đang tải...' : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div>
                <div className="muted">Tổng Thu ({length} tháng)</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMoney(totalSales)}</div>
              </div>
              <div>
                <div className="muted">Tổng Nhập ({length} tháng)</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMoney(totalPurchases)}</div>
              </div>
              <div>
                <div className="muted">Tổng Chi phí ({length} tháng)</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMoney(totalExpenses)}</div>
              </div>
              <div>
                <div className="muted">Lãi/Lỗ ({length} tháng)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: netProfit >= 0 ? '#2e7d32' : '#c62828' }}>{fmtMoney(netProfit)}</div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Biểu đồ đơn giản (tỷ lệ)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
                <div>Thu</div>
                <div style={{ background: '#1976d2', height: 18, width: barWidth(totalSales) }} />
                <div>Nhập</div>
                <div style={{ background: '#9c27b0', height: 18, width: barWidth(totalPurchases) }} />
                <div>Chi phí</div>
                <div style={{ background: '#f57c00', height: 18, width: barWidth(totalExpenses) }} />
              </div>
              <div className="muted" style={{ margin: '12px 0 6px' }}>Biểu đồ theo tháng (đợt)</div>
              <div>
                {monthlyData.map(d => (
                  <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <div className="muted">{d.label}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div title={`Thu ${fmtMoney(d.s)}`} style={{ background: '#1976d2', height: 16, width: `${Math.round((d.s / maxMonthly) * 100)}%` }} />
                      <div title={`Nhập ${fmtMoney(d.p)}`} style={{ background: '#9c27b0', height: 16, width: `${Math.round((d.p / maxMonthly) * 100)}%` }} />
                      <div title={`Chi phí ${fmtMoney(d.e)}`} style={{ background: '#f57c00', height: 16, width: `${Math.round((d.e / maxMonthly) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '8px 0' }}>Nhà vườn bán nhiều nhất (trong đợt)</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nhà vườn</th><th>Số giao dịch</th><th>KL (kg)</th><th>Tổng tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierStats.map(s => (
                    <tr key={s.supplier_name}>
                      <td>{s.supplier_name}</td>
                      <td style={{ textAlign: 'right' }}>{s.transactions}</td>
                      <td style={{ textAlign: 'right' }}>{(Number(s.total_weight) || 0).toLocaleString('vi-VN')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(s.total_amount)}</td>
                    </tr>
                  ))}
                  {supplierStats.length === 0 && (
                    <tr><td colSpan={4} className="muted">Không có dữ liệu trong đợt này</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '8px 0' }}>Khách hàng mua nhiều nhất (trong đợt)</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Khách hàng</th><th>Số giao dịch</th><th>KL (kg)</th><th>Tổng tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {customerStats.map(c => (
                    <tr key={c.customer_name}>
                      <td>{c.customer_name}</td>
                      <td style={{ textAlign: 'right' }}>{c.transactions}</td>
                      <td style={{ textAlign: 'right' }}>{(Number(c.total_weight) || 0).toLocaleString('vi-VN')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.total_amount)}</td>
                    </tr>
                  ))}
                  {customerStats.length === 0 && (
                    <tr><td colSpan={4} className="muted">Không có dữ liệu trong đợt này</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '8px 0' }}>Công nợ Khách hàng (trong đợt)</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Khách hàng</th><th>Số giao dịch</th><th>Tổng tiền</th><th>Đã thanh toán</th><th>Còn nợ</th>
                  </tr>
                </thead>
                <tbody>
                  {customerDebtStats.map(c => (
                    <tr key={c.customer_name}>
                      <td>{c.customer_name}</td>
                      <td style={{ textAlign: 'right' }}>{c.transactions}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.total_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.paid_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(c.pending_amount)}</td>
                    </tr>
                  ))}
                  {customerDebtStats.length === 0 && (
                    <tr><td colSpan={5} className="muted">Không có dữ liệu trong đợt này</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '8px 0' }}>Công nợ Nhà vườn (trong đợt)</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Nhà vườn</th><th>Số giao dịch</th><th>Tổng tiền</th><th>Đã thanh toán</th><th>Còn nợ</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierDebtStats.map(s => (
                    <tr key={s.supplier_name}>
                      <td>{s.supplier_name}</td>
                      <td style={{ textAlign: 'right' }}>{s.transactions}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(s.total_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(s.paid_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(s.pending_amount)}</td>
                    </tr>
                  ))}
                  {supplierDebtStats.length === 0 && (
                    <tr><td colSpan={5} className="muted">Không có dữ liệu trong đợt này</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}