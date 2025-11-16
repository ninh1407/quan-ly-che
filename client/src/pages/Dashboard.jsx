import React, { useEffect, useMemo, useState } from 'react';
import api from '../api.js';

function useMonthYear() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return { month, year, setMonth, setYear };
}

export default function Dashboard() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [sales, setSales] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [prevSales, setPrevSales] = useState([]);
  const [prevPurchases, setPrevPurchases] = useState([]);
  const [prevExpenses, setPrevExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ totalSales: 0, totalPurchases: 0, totalExpenses: 0, netProfit: 0, variableCost: 0, fixedExpense: 0, variablePct: 0, fixedPct: 0, profitMarginPct: 0 });

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => y - 2 + i);
  }, []);

  const load = async () => {
    setLoading(true); setError('');
    const params = { month, year };
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevParams = { month: prevMonth, year: prevYear };
    try {
      const [aggRes, sRes, pRes, eRes, sPrevRes, pPrevRes, ePrevRes] = await Promise.allSettled([
        api.get('/dashboard', { params }),
        api.get('/sales', { params }),
        api.get('/purchases', { params }),
        api.get('/expenses', { params }),
        api.get('/sales', { params: prevParams }),
        api.get('/purchases', { params: prevParams }),
        api.get('/expenses', { params: prevParams })
      ]);

      const salesData = sRes.status === 'fulfilled' ? (sRes.value.data || []) : [];
      const purchasesData = pRes.status === 'fulfilled' ? (pRes.value.data || []) : [];
      const expensesData = eRes.status === 'fulfilled' ? (eRes.value.data || []) : [];
      const prevSalesData = sPrevRes.status === 'fulfilled' ? (sPrevRes.value.data || []) : [];
      const prevPurchasesData = pPrevRes.status === 'fulfilled' ? (pPrevRes.value.data || []) : [];
      const prevExpensesData = ePrevRes.status === 'fulfilled' ? (ePrevRes.value.data || []) : [];

      setSales(salesData);
      setPurchases(purchasesData);
      setExpenses(expensesData);
      setPrevSales(prevSalesData);
      setPrevPurchases(prevPurchasesData);
      setPrevExpenses(prevExpensesData);

      if (aggRes.status === 'fulfilled') {
        setTotals(aggRes.value.data || { totalSales: 0, totalPurchases: 0, totalExpenses: 0, netProfit: 0, variableCost: 0, fixedExpense: 0, variablePct: 0, fixedPct: 0, profitMarginPct: 0 });
      } else {
        const fallbackSales = salesData.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
        const fallbackPurchases = purchasesData.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0);
        const fallbackExpenses = expensesData.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        setTotals({
          totalSales: fallbackSales,
          totalPurchases: fallbackPurchases,
          totalExpenses: fallbackExpenses,
          netProfit: fallbackSales - fallbackPurchases - fallbackExpenses,
          variableCost: fallbackPurchases,
          fixedExpense: 0,
          variablePct: fallbackSales > 0 ? (fallbackPurchases / fallbackSales) * 100 : 0,
          fixedPct: 0,
          profitMarginPct: fallbackSales > 0 ? ((fallbackSales - fallbackPurchases - fallbackExpenses) / fallbackSales) * 100 : 0
        });
      }

      // Chỉ hiển thị cảnh báo nếu dữ liệu nền tảng (sales/purchases/expenses) lỗi.
      // Nếu chỉ /dashboard lỗi, vẫn dùng số liệu fallback và không cảnh báo.
      const coreErrors = [sRes, pRes, eRes].filter(r => r.status === 'rejected');
      if (coreErrors.length) {
        setError('Một số dữ liệu tải lỗi, đang hiển thị phần khả dụng');
      }
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải dữ liệu tổng quan lỗi');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);

  const start = useMemo(() => new Date(year, month - 1, 1), [month, year]);
  const end = useMemo(() => new Date(year, month, 0), [month, year]);
  const days = useMemo(() => Array.from({ length: end.getDate() }, (_, i) => new Date(year, month - 1, i + 1)), [end, month, year]);
  const fmtLocalDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const totalSales = totals.totalSales;
  const totalPurchases = totals.totalPurchases;
  const totalExpenses = totals.totalExpenses;
  const netProfit = totals.netProfit;
  const totalCosts = totalPurchases + totalExpenses;
  const profitMarginPct = totals.profitMarginPct;
  const variablePct = totals.variablePct;
  const fixedPct = totals.fixedPct;

  const prevTotalSales = useMemo(() => prevSales.reduce((s, r) => s + (Number(r.total_amount) || 0), 0), [prevSales]);
  const prevTotalPurchases = useMemo(() => prevPurchases.reduce((s, r) => s + (Number(r.total_cost) || 0), 0), [prevPurchases]);
  const prevTotalExpenses = useMemo(() => prevExpenses.reduce((s, r) => s + (Number(r.amount) || 0), 0), [prevExpenses]);
  const prevNetProfit = prevTotalSales - prevTotalPurchases - prevTotalExpenses;

  // Chuẩn bị dòng tiền theo ngày
  const byDay = (list, getAmount, dateField) => {
    const map = new Map();
    days.forEach(d => map.set(fmtLocalDate(d), 0));
    for (const r of list) {
      const key = String(r[dateField]);
      if (map.has(key)) map.set(key, map.get(key) + (getAmount(r) || 0));
    }
    return days.map(d => ({ date: fmtLocalDate(d), total: map.get(fmtLocalDate(d)) }));
  };
  const salesByDay = useMemo(() => byDay(sales, r => Number(r.total_amount) || (Number(r.price_per_kg) * Number(r.weight) || 0), 'sale_date'), [sales, days]);
  const expensesByDay = useMemo(() => byDay(expenses, r => Number(r.amount) || 0, 'expense_date'), [expenses, days]);
  const purchasesByDay = useMemo(() => byDay(purchases, r => Number(r.total_cost) || (Number(r.unit_price) * Number(r.weight) || 0), 'purchase_date'), [purchases, days]);
  const costsByDay = useMemo(() => days.map((d, i) => ({ date: d.toISOString().slice(0, 10), total: (purchasesByDay[i]?.total || 0) + (expensesByDay[i]?.total || 0) })), [days, purchasesByDay, expensesByDay]);
  const maxSalesDay = Math.max(...salesByDay.map(x => x.total), 1);
  const maxCostsDay = Math.max(...costsByDay.map(x => x.total), 1);

  const maxBar = Math.max(totalSales, totalCosts, 1);
  const barWidth = (v) => `${Math.round((v / maxBar) * 100)}%`;
  const miniBar = (v, max) => `${Math.round((v / Math.max(max, 1)) * 100)}%`;

  return (
    <div className="card">
      {/* Header giống ảnh */}
      <div style={{ background: '#3b7dbf', color: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>DASHBOARD TÀI CHÍNH CHÈ</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div>
            <div className="muted" style={{ color: '#fff' }}>Tháng</div>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="muted" style={{ color: '#fff' }}>Năm</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        {loading ? 'Đang tải...' : (
          <div>
            {/* Dòng KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
              <div className="kpi">
                <div className="muted">Tổng Thu</div>
                <div className="kpi-value">{totalSales.toLocaleString()} đ</div>
              </div>
              <div className="kpi">
                <div className="muted">Tổng Chi</div>
                <div className="kpi-value">{totalCosts.toLocaleString()} đ</div>
              </div>
              <div className="kpi">
                <div className="muted">Doanh thu</div>
                <div className="kpi-value">{totalSales.toLocaleString()} đ</div>
              </div>
              <div className="kpi">
                <div className="muted">Doanh thu tháng trước</div>
                <div className="kpi-value">{prevTotalSales.toLocaleString()} đ</div>
              </div>
              <div className="kpi">
                <div className="muted">Lãi/Lỗ</div>
                <div className="kpi-value" style={{ color: netProfit >= 0 ? '#2e7d32' : '#c62828' }}>{netProfit.toLocaleString()} đ</div>
              </div>
              <div className="kpi">
                <div className="muted">Biên lợi nhuận</div>
                <div className="kpi-value" style={{ color: profitMarginPct >= 0 ? '#2e7d32' : '#c62828' }}>{profitMarginPct.toFixed(1)}%</div>
              </div>
            </div>

            {/* Biểu đồ so sánh */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="card">
                <div className="muted" style={{ marginBottom: 6 }}>Tổng thu so với Tổng chi</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
                  <div>Thu</div>
                  <div style={{ background: '#1976d2', height: 18, width: barWidth(totalSales) }} />
                  <div>Chi</div>
                  <div style={{ background: '#f57c00', height: 18, width: barWidth(totalCosts) }} />
                </div>
              </div>
              <div className="card">
                <div className="muted" style={{ marginBottom: 6 }}>Tổng Lãi/Lỗ Tháng này và Tháng trước</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
                  <div>Tháng này</div>
                  <div style={{ background: netProfit >= 0 ? '#2e7d32' : '#c62828', height: 18, width: miniBar(Math.abs(netProfit), Math.abs(netProfit) + Math.abs(prevNetProfit)) }} />
                  <div>Tháng trước</div>
                  <div style={{ background: prevNetProfit >= 0 ? '#2e7d32' : '#c62828', height: 18, width: miniBar(Math.abs(prevNetProfit), Math.abs(netProfit) + Math.abs(prevNetProfit)) }} />
                </div>
              </div>
            </div>

            {/* Tỷ lệ chi phí trên doanh thu */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="card">
                <div className="muted" style={{ marginBottom: 6 }}>Tỷ lệ chi phí trên doanh thu</div>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, alignItems: 'center' }}>
                  <div>Biến phí/DT</div>
                  <div style={{ background: '#f57c00', height: 18, width: `${Math.min(100, Math.max(0, variablePct))}%` }} />
                  <div>Định phí/DT</div>
                  <div style={{ background: '#6b7280', height: 18, width: `${Math.min(100, Math.max(0, fixedPct))}%` }} />
                  <div>Biên lợi nhuận</div>
                  <div style={{ background: '#2e7d32', height: 18, width: `${Math.min(100, Math.max(0, profitMarginPct))}%` }} />
                </div>
              </div>
              <div className="card">
                <div className="muted" style={{ marginBottom: 6 }}>Chi tiết</div>
                <table className="table">
                  <thead><tr><th>Mục</th><th className="num">Giá trị</th><th className="num">Tỷ lệ/DT</th></tr></thead>
                  <tbody>
                    <tr><td>Biến phí</td><td className="num">{totals.variableCost.toLocaleString()} đ</td><td className="num">{variablePct.toFixed(1)}%</td></tr>
                    <tr><td>Định phí</td><td className="num">{totals.fixedExpense.toLocaleString()} đ</td><td className="num">{fixedPct.toFixed(1)}%</td></tr>
                    <tr><td>Lãi/Lỗ</td><td className="num">{netProfit.toLocaleString()} đ</td><td className="num">{profitMarginPct.toFixed(1)}%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Dòng tiền theo ngày và bảng tổng hợp */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Dòng tiền chi theo ngày</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4, height: 120, alignItems: 'end' }}>
                  {costsByDay.map((d, i) => (
                    <div key={i} title={`${d.date}: ${d.total.toLocaleString()} đ`} style={{ background: '#f57c00', height: `${Math.round((d.total / maxCostsDay) * 100)}%` }} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4, marginTop: 6 }}>
                  {days.map((d, i) => (
                    <div key={`clabel-${i}`} style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>{d.getDate()}</div>
                  ))}
                </div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Dòng tiền thu theo ngày</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4, height: 120, alignItems: 'end' }}>
                  {salesByDay.map((d, i) => (
                    <div key={i} title={`${d.date}: ${d.total.toLocaleString()} đ`} style={{ background: '#1976d2', height: `${Math.round((d.total / maxSalesDay) * 100)}%` }} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4, marginTop: 6 }}>
                  {days.map((d, i) => (
                    <div key={`slabel-${i}`} style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>{d.getDate()}</div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Khoản</th><th>Số lượng giao dịch</th><th>Tổng tiền</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Thu</td><td>{sales.length}</td><td>{totalSales.toLocaleString()}</td></tr>
                  <tr><td>Nhập</td><td>{purchases.length}</td><td>{totalPurchases.toLocaleString()}</td></tr>
                  <tr><td>Chi phí</td><td>{expenses.length}</td><td>{totalExpenses.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
