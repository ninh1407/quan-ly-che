import React, { useEffect, useState } from 'react'

let emit
export function toast(message, type='info') { if (emit) emit({ message, type }) }

export default function ToastContainer() {
  const [queue, setQueue] = useState([])
  useEffect(() => { emit = (t) => setQueue((q) => [...q, { id: Date.now(), ...t }]) }, [])
  useEffect(() => { const timer = setInterval(() => setQueue((q) => q.slice(1)), 3000); return () => clearInterval(timer) }, [])
  if (!queue.length) return null
  return (
    <div style={{ position:'fixed', right:20, bottom:20, display:'flex', flexDirection:'column', gap:8, zIndex:2100 }}>
      {queue.map(t => (
        <div key={t.id} className="shadow-3" style={{ background:'var(--surface)', color:'var(--text)', border:'1px solid var(--border)', padding:'10px 14px', borderRadius:10 }}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

