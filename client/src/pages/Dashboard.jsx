import * as React from 'react';
const { useEffect, useMemo, useState, useRef } = React;
import api from '../api.js';
import FilterBar from '../components/FilterBar.jsx';

function useMonthYear() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return { month, year, setMonth, setYear };
}

const fmtMoney = (v) => (Number(v) || 0).toLocaleString('vi-VN');

export default function Dashboard() {
  const { month, year, setMonth, setYear } = useMonthYear();
  const [selectedDay, setSelectedDay] = useState('all');
  const [sales, setSales] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [prevSales, setPrevSales] = useState([]);
  const [prevPurchases, setPrevPurchases] = useState([]);
  const [prevExpenses, setPrevExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ totalSales: 0, totalPurchases: 0, totalExpenses: 0, netProfit: 0, variableCost: 0, fixedExpense: 0, variablePct: 0, fixedPct: 0, profitMarginPct: 0 });
  const [tops, setTops] = useState({ buyers_top: [], suppliers_top: [] })
  const [netByMonth, setNetByMonth] = useState([])
  const [notifs, setNotifs] = useState([])
  const heroImg = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_HERO_IMG_URL) ? import.meta.env.VITE_HERO_IMG_URL : '/hero-tea.jpg'

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
      const [aggRes, sRes, pRes, eRes, sPrevRes, pPrevRes, ePrevRes, statsRes] = await Promise.allSettled([
        api.get('/dashboard', { params }),
        api.get('/sales', { params }),
        api.get('/purchases', { params }),
        api.get('/expenses', { params }),
        api.get('/sales', { params: prevParams }),
        api.get('/purchases', { params: prevParams }),
        api.get('/expenses', { params: prevParams }),
        api.get('/stats', { params })
      ]);

      const salesData = sRes.status === 'fulfilled' ? (Array.isArray(sRes.value.data) ? sRes.value.data : []) : [];
      const purchasesData = pRes.status === 'fulfilled' ? (Array.isArray(pRes.value.data) ? pRes.value.data : []) : [];
      const expensesData = eRes.status === 'fulfilled' ? (Array.isArray(eRes.value.data) ? eRes.value.data : []) : [];
      const prevSalesData = sPrevRes.status === 'fulfilled' ? (Array.isArray(sPrevRes.value.data) ? sPrevRes.value.data : []) : [];
      const prevPurchasesData = pPrevRes.status === 'fulfilled' ? (Array.isArray(pPrevRes.value.data) ? pPrevRes.value.data : []) : [];
      const prevExpensesData = ePrevRes.status === 'fulfilled' ? (Array.isArray(ePrevRes.value.data) ? ePrevRes.value.data : []) : [];
      const statsData = statsRes.status === 'fulfilled' ? (statsRes.value.data || {}) : {}

      let s = salesData, p = purchasesData, e = expensesData;
      if (selectedDay !== 'all') {
        const dd = String(selectedDay).padStart(2,'0');
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${dd}`;
        s = s.filter(r => String(r.sale_date) === dateStr);
        p = p.filter(r => String(r.purchase_date) === dateStr);
        e = e.filter(r => String(r.expense_date) === dateStr);
      }
      setSales(s);
      setPurchases(p);
      setExpenses(e);
      setPrevSales(prevSalesData);
      setPrevPurchases(prevPurchasesData);
      setPrevExpenses(prevExpensesData);
      setTops({ buyers_top: Array.isArray(statsData.buyers_top) ? statsData.buyers_top : [], suppliers_top: Array.isArray(statsData.suppliers_top) ? statsData.suppliers_top : [] })

      if (aggRes.status === 'fulfilled' && selectedDay === 'all') {
        const d = aggRes.value.data || {}
        setTotals({
          totalSales: Number(d.totalSales)||0,
          totalPurchases: Number(d.totalPurchases)||0,
          totalExpenses: Number(d.totalExpenses)||0,
          netProfit: Number(d.netProfit)||0,
          variableCost: Number(d.variableCost)||0,
          fixedExpense: Number(d.fixedExpense)||0,
          variablePct: Number(d.variablePct)||0,
          fixedPct: Number(d.fixedPct)||0,
          profitMarginPct: Number(d.profitMarginPct)||0,
        });
      } else {
        const fallbackSales = (selectedDay==='all' ? salesData : s).reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
        const fallbackPurchases = (selectedDay==='all' ? purchasesData : p).reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0);
        const fallbackExpenses = (selectedDay==='all' ? expensesData : e).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
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
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(year, month - 1, 1); d.setMonth(d.getMonth() - i); return { m: d.getMonth()+1, y: d.getFullYear() } }).reverse()
      const series = await Promise.all(months.map(mp => api.get('/dashboard', { params: { month: mp.m, year: mp.y } }).then(r => ({ m: mp.m, y: mp.y, sales: Number(r.data?.totalSales)||0, costs: (Number(r.data?.totalPurchases)||0) + (Number(r.data?.totalExpenses)||0) })).catch(() => ({ m: mp.m, y: mp.y, sales: 0, costs: 0 })) ))
      setNetByMonth(series)
    } catch (e) {
      setError(e?.response?.data?.message || 'Tải dữ liệu tổng quan lỗi');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, selectedDay]);
  useEffect(() => { (async () => { try { const r = await api.get('/notifications'); setNotifs(Array.isArray(r.data) ? r.data : []) } catch {} })() }, [month, year])

  useEffect(() => {
    const dim = new Date(year, month, 0).getDate();
    if (selectedDay !== 'all' && Number(selectedDay) > dim) {
      setSelectedDay('all');
    }
  }, [month, year])

  const start = useMemo(() => new Date(year, month - 1, 1), [month, year]);
  const end = useMemo(() => new Date(year, month, 0), [month, year]);
  const days = useMemo(() => {
    if (selectedDay !== 'all') {
      const d = new Date(year, month - 1, Number(selectedDay));
      return [d];
    }
    return Array.from({ length: end.getDate() }, (_, i) => new Date(year, month - 1, i + 1));
  }, [end, month, year, selectedDay]);
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
  const expenseCats = useMemo(() => {
    const catMap = new Map();
    (expenses||[]).forEach(e => { const k = e.category || 'Khác'; catMap.set(k, (catMap.get(k)||0) + (Number(e.amount)||0)) })
    return Array.from(catMap.entries()).map(([name, amount]) => ({ name, amount }))
  }, [expenses])

  const maxBar = Math.max(totalSales, totalCosts, 1);
  const barWidth = (v) => `${Math.round((v / maxBar) * 100)}%`;
  const miniBar = (v, max) => `${Math.round((v / Math.max(max, 1)) * 100)}%`;

  const lineRef = React.useRef(null)
  const doughnutRef = React.useRef(null)
  const netMonthRef = React.useRef(null)
  React.useEffect(() => {
    let chartLine, chartD, chartNet
    (async () => {
      const { default: Chart } = await import('chart.js/auto')
      const css = getComputedStyle(document.documentElement)
      const cSales = css.getPropertyValue('--chart-sales-color')?.trim() || '#2563eb'
      const cCosts = css.getPropertyValue('--chart-costs-color')?.trim() || '#ef4444'
      const cProfit = css.getPropertyValue('--chart-profit-color')?.trim() || '#22c55e'
      const isMobile = (typeof window !== 'undefined' && window.innerWidth <= 768)
      if (lineRef.current) {
        const ctx = lineRef.current.getContext('2d')
        const gradSales = ctx.createLinearGradient(0,0,0,200); gradSales.addColorStop(0,`${cSales}80`); gradSales.addColorStop(1,`${cSales}20`)
        const gradCosts = ctx.createLinearGradient(0,0,0,200); gradCosts.addColorStop(0,`${cCosts}80`); gradCosts.addColorStop(1,`${cCosts}20`)
        chartLine = new Chart(lineRef.current, {
          type: 'line',
          data: {
            labels: days.map(d => fmtLocalDate(d)),
            datasets: [
              { label: 'Thu', data: salesByDay.map(x => x.total), borderColor: cSales, backgroundColor: gradSales, tension: .25, borderWidth: 2, fill:true },
              { label: 'Chi', data: costsByDay.map(x => x.total), borderColor: cCosts, backgroundColor: gradCosts, tension: .25, borderWidth: 2, fill:true }
            ]
          }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y||0).toLocaleString()}` } } }, scales: { y: { beginAtZero: true, grid: { color:'rgba(0,0,0,.06)' } }, x:{ ticks: { autoSkip: true, maxTicksLimit: isMobile ? 5 : 10 }, grid:{ display:false } } } }
        })
      }
      if (doughnutRef.current) {
        chartD = new Chart(doughnutRef.current, {
          type: 'doughnut', data: {
            labels: ['Biến phí/DT', 'Định phí/DT', 'Biên lợi nhuận'],
            datasets: [{ data: [Math.max(0, variablePct), Math.max(0, fixedPct), Math.max(0, profitMarginPct)], backgroundColor: [cCosts, '#6b7280', cProfit] }]
          }, options: { plugins: { legend: { display: true } } }
        })
      }
      if (netMonthRef.current && netByMonth.length) {
        chartNet = new Chart(netMonthRef.current, { type:'line', data:{ labels: netByMonth.map(x => `${x.y}-${String(x.m).padStart(2,'0')}`), datasets:[{ label:'Thu (tháng)', data: netByMonth.map(x => x.sales||0), borderColor:cSales, backgroundColor:`${cSales}33`, tension:.25, borderWidth:2, fill:true }, { label:'Chi (tháng)', data: netByMonth.map(x => x.costs||0), borderColor:cCosts, backgroundColor:`${cCosts}33`, tension:.25, borderWidth:2, fill:true }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true, position:'bottom' } }, scales:{ y:{ beginAtZero:true }, x:{ ticks:{ autoSkip:true, maxTicksLimit:6 }, grid:{ display:false } } } } })
      }
      // bar chart cơ cấu chi phí theo nhóm
      const cats = expenseCats.map(x => x.name)
      const vals = expenseCats.map(x => x.amount)
      const barEl = document.getElementById('chart-expense-bar')
      if (barEl && cats.length) {
        new Chart(barEl, { type:'bar', data:{ labels: cats, datasets:[{ label:'Chi phí theo nhóm', data: vals, backgroundColor:cCosts }] }, options:{ plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } } })
      }
    })()
    return () => { chartLine && chartLine.destroy(); chartD && chartD.destroy(); chartNet && chartNet.destroy() }
  }, [month, year, salesByDay, costsByDay, variablePct, fixedPct, profitMarginPct, netByMonth])

  return (
    <div className="card">
      <div className="hero with-img with-pattern" style={{ '--hero-img': `url(${heroImg})` }}>
        <div className="hero-left">
          <div className="hero-title">Hệ thống quản lý thu mua chè</div>
          <div className="hero-sub">Ảnh nền nhẹ, tối ưu cho tốc độ</div>
          <div className="hero-badge"><span className="hero-emoji">🍃</span> Xanh chè • Tinh khiết • Mát mắt</div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><div className="muted">Thu</div><div className="num">{fmtMoney(totalSales)}</div></div>
          <div className="hero-stat"><div className="muted">Chi</div><div className="num">{fmtMoney(totalCosts)}</div></div>
          <div className="hero-stat"><div className="muted">Lãi/Lỗ</div><div className="num" style={{ color: netProfit>=0?'#1A8754':'#c62828' }}>{fmtMoney(netProfit)}</div></div>
        </div>
        <div className="bg-decor" />
      </div>
      <FilterBar month={month} year={year} setMonth={setMonth} setYear={setYear} selectedDay={selectedDay} setSelectedDay={setSelectedDay} />

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        {loading ? 'Đang tải...' : (
          <div>
            {/* Dòng KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              <div className="kpi"><div className="icon">📈</div><div><div className="muted">Tổng Thu</div><div className="kpi-value" style={{ color:'#1A8754' }}>{fmtMoney(totalSales)} đ</div></div></div>
              <div className="kpi"><div className="icon">📉</div><div><div className="muted">Tổng Chi</div><div className="kpi-value" style={{ color:'#ef4444' }}>{fmtMoney(totalCosts)} đ</div></div></div>
              <div className="kpi"><div className="icon">💵</div><div><div className="muted">Doanh thu</div><div className="kpi-value">{fmtMoney(totalSales)} đ</div></div></div>
              <div className="kpi"><div className="icon">💹</div><div><div className="muted">Biên lợi nhuận</div><div className="kpi-value" style={{ color: profitMarginPct>=0?'#1A8754':'#c62828' }}>{profitMarginPct.toFixed(1)}%</div></div></div>
              <div className="kpi"><div className="icon">🗓️</div><div><div className="muted">Tháng trước</div><div className="kpi-value">{fmtMoney(prevTotalSales)} đ</div></div></div>
            </div>

            {/* Widget gộp Thu–Chi–Lãi */}
            <div className="card" style={{ marginTop:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
                <div className="kpi"><div>💵 Tổng Thu</div><div className="kpi-value">{fmtMoney(totalSales)}</div></div>
                <div className="kpi"><div>🧾 Tổng Chi</div><div className="kpi-value">{fmtMoney(totalCosts)}</div></div>
                <div className="kpi"><div>📈 Lãi/Lỗ</div><div className="kpi-value" style={{ color: netProfit>=0?'#22c55e':'#ef4444' }}>{fmtMoney(netProfit)}</div></div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center', marginTop:12 }}>
                <div>Thu</div><div style={{ background:'#2563eb', height:18, width: barWidth(totalSales), borderRadius:8 }} />
                <div>Chi</div><div style={{ background:'#ef4444', height:18, width: barWidth(totalCosts), borderRadius:8 }} />
              </div>
            </div>

            {/* Biểu đồ Chart.js */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '2.5fr 1fr', gap: 16 }}>
              <div className="card chart-card">
                <div className="muted" style={{ marginBottom: 6 }}>Dòng tiền theo ngày</div>
                <canvas ref={lineRef} style={{ width:'100%', height:'320px' }} />
              </div>
              <div className="card chart-card">
                <div className="muted" style={{ marginBottom: 6 }}>Tỷ lệ/DT (doughnut)</div>
                <canvas ref={doughnutRef} style={{ width:'100%', height:'280px' }} />
              </div>
            </div>
            <div className="card chart-card" style={{ marginTop:16 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Thu–Chi theo tháng</div>
              <canvas ref={netMonthRef} style={{ width:'100%', height:'320px' }} />
            </div>
            <div className="card chart-card" style={{ marginTop:16 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Cơ cấu chi phí theo nhóm</div>
              {expenseCats.length ? (
                <canvas id="chart-expense-bar" style={{ width:'100%', height:'220px' }} />
              ) : (
                <div className="empty-state" style={{ marginTop:8 }}>Chưa có dữ liệu tháng {String(month).padStart(2,'0')}/{year}</div>
              )}
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
            <div style={{ marginTop:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div className="card">
                <div style={{ fontWeight:700, marginBottom:6 }}>Top 5 Khách hàng</div>
                {((tops.buyers_top||[]).length===0) ? (
                  <div className="empty-state" style={{ marginTop:8 }}>Chưa có dữ liệu tháng {String(month).padStart(2,'0')}/{year}</div>
                ) : (
                  <table className="table compact"><thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng</th></tr></thead><tbody>{(tops.buyers_top||[]).slice(0,5).map(r => (<tr key={r.name}><td title={r.name}>{r.name}</td><td className="num">{(Number(r.count)||0).toLocaleString()}</td><td className="num">{(Number(r.weight)||0).toLocaleString()}</td><td className="num">{fmtMoney(Number(r.amount)||0)} đ</td></tr>))}</tbody></table>
                )}
              </div>
              <div className="card">
                <div style={{ fontWeight:700, marginBottom:6 }}>Top 5 Nhà cung cấp</div>
                {((tops.suppliers_top||[]).length===0) ? (
                  <div className="empty-state" style={{ marginTop:8 }}>Chưa có dữ liệu tháng {String(month).padStart(2,'0')}/{year}</div>
                ) : (
                  <table className="table compact"><thead><tr><th>Tên</th><th className="num">Số vụ</th><th className="num">Kg</th><th className="num">Tổng</th></tr></thead><tbody>{(tops.suppliers_top||[]).slice(0,5).map(r => (<tr key={r.name}><td title={r.name}>{r.name}</td><td className="num">{(Number(r.count)||0).toLocaleString()}</td><td className="num">{(Number(r.weight)||0).toLocaleString()}</td><td className="num">{fmtMoney(Number(r.amount)||0)} đ</td></tr>))}</tbody></table>
                )}
              </div>
              <div className="card" style={{ gridColumn:'1 / -1' }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Top chi phí trong tháng</div>
                {expenseCats.length ? (
                  <table className="table compact"><thead><tr><th>Nhóm</th><th className="num">Giá trị</th></tr></thead><tbody>{[...expenseCats].sort((a,b)=>b.amount-a.amount).slice(0,5).map((x,i)=>(<tr key={i}><td>{x.name}</td><td className="num">{fmtMoney(x.amount)}</td></tr>))}</tbody></table>
                ) : (
                  <div className="empty-state" style={{ marginTop:8 }}>Chưa có dữ liệu</div>
                )}
              </div>
              <div className="card" style={{ gridColumn:'1 / -1' }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Thông báo nội bộ</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {(notifs||[]).slice(0,5).map((n,i)=>(<div key={i} className="muted">• {n}</div>))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
