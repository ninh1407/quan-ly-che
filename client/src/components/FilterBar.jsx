import React from 'react'

export default function FilterBar({ month, year, setMonth, setYear, selectedDay, setSelectedDay }) {
  return (
    <div className="section-bar">
      <div style={{ fontWeight:700 }}>📅 Bộ lọc thời gian</div>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginLeft:'auto' }}>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Tháng</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Năm</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({length:5},(_,i)=> new Date().getFullYear()-2+i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span>Ngày</span>
          <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
            <option value="all">Tất cả</option>
            {Array.from({length: new Date(year, month, 0).getDate()}, (_,i)=> i+1).map(d => (
              <option key={d} value={String(d)}>{d}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
