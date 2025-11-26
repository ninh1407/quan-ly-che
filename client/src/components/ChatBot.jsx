import React, { useEffect, useRef, useState } from 'react'
import api from '../api.js'

export default function ChatBot() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatbot_msgs')||'[]') } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const listRef = useRef(null)
  useEffect(() => { try { localStorage.setItem('chatbot_msgs', JSON.stringify(msgs)) } catch {} }, [msgs])
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [open, msgs])

  const handleAction = async (a) => {
    try {
      if (a.type === 'open_url') {
        const origin = window.location.origin
        const url = `${origin}${a.path}?t=${encodeURIComponent(localStorage.getItem('token')||'')}`
        window.open(url, '_blank')
      } else if (a.type === 'navigate') {
        window.dispatchEvent(new CustomEvent('chatbot:navigate', { detail: a.tab }))
        setOpen(false)
      } else if (a.type === 'prefill_sales') {
        localStorage.setItem('prefill_sales', JSON.stringify(a.payload||{}))
        window.dispatchEvent(new CustomEvent('chatbot:navigate', { detail: 'sales' }))
        setOpen(false)
      } else if (a.type === 'prefill_purchases') {
        localStorage.setItem('prefill_purchases', JSON.stringify(a.payload||{}))
        window.dispatchEvent(new CustomEvent('chatbot:navigate', { detail: 'purchases' }))
        setOpen(false)
      } else if (a.type === 'prefill_expenses') {
        localStorage.setItem('prefill_expenses', JSON.stringify(a.payload||{}))
        window.dispatchEvent(new CustomEvent('chatbot:navigate', { detail: 'expenses' }))
        setOpen(false)
      } else if (a.type === 'post_api') {
        try {
          const method = (a.method||'post').toLowerCase()
          const r = await api.request({ method, url: a.path, data: a.payload||{} })
          setMsgs(m => [...m, { role:'bot', text: 'Đã thực hiện xong', actions: [] }])
        } catch (e) {
          setMsgs(m => [...m, { role:'bot', text: 'Thực hiện lỗi', actions: [] }])
        }
      }
    } catch {}
  }

  const send = async () => {
    const text = input.trim(); if (!text) return
    setMsgs(m => [...m, { role:'user', text }]); setInput('')
    try {
      setLoading(true)
      const r = await api.post('/bot', { message: text })
      const data = r.data || {}
      setMsgs(m => [...m, { role:'bot', text: data.reply || 'Không có phản hồi', actions: data.actions || [] }])
    } catch (e) {
      setMsgs(m => [...m, { role:'bot', text: 'Bot lỗi, thử lại sau' }])
    } finally { setLoading(false) }
  }

  return (
    <div className="chatbot">
      <button className="chatbot-toggle" onClick={() => setOpen(o=>!o)}>{open ? '×' : '🤖 Bot'}</button>
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">Trợ lý Web</div>
          <div className="chatbot-list" ref={listRef}>
            {msgs.map((m,i) => (
              <div key={i}>
                <div className={`msg ${m.role}`}>{m.text}</div>
                {m.role==='bot' && Array.isArray(m.actions) && m.actions.length>0 && (
                  <div style={{ display:'flex', gap:6, margin:'6px 8px' }}>
                    {m.actions.map((a,idx) => (
                      <button key={idx} className="btn" onClick={() => handleAction(a)}>{a.label || 'Thực hiện'}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="msg bot">Đang gõ...</div>}
          </div>
          <div style={{ padding:'6px 10px', display:'flex', gap:6 }}>
            <button className="btn" onClick={() => { setInput('Báo cáo tháng '+(new Date().getMonth()+1)); send() }}>Báo cáo</button>
            <button className="btn" onClick={() => { setInput('Nhắc việc'); send() }}>Nhắc việc</button>
            <button className="btn" onClick={() => { setInput('Tìm HĐ 00123'); send() }}>Tìm HĐ</button>
          </div>
          <div className="chatbot-input">
            <input placeholder="Nhập câu hỏi..." value={input} onChange={(e)=> setInput(e.target.value)} onKeyDown={(e)=> { if (e.key==='Enter') send() }} />
            <button className="btn" onClick={send}>Gửi</button>
          </div>
        </div>
      )}
    </div>
  )
}
