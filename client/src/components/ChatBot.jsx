import React, { useEffect, useRef, useState } from 'react'
import api from '../api.js'

export default function ChatBot() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatbot_msgs')||'[]') } catch { return [] }
  })
  const listRef = useRef(null)
  const [currentTab, setCurrentTab] = useState(() => { try { return localStorage.getItem('current_tab')||'dashboard' } catch { return 'dashboard' } })
  const [loading, setLoading] = useState(false)
  useEffect(() => { try { localStorage.setItem('chatbot_msgs', JSON.stringify(msgs)) } catch {} }, [msgs])
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [open, msgs])
  useEffect(() => { if (open) { try { setCurrentTab(localStorage.getItem('current_tab')||'dashboard') } catch {} } }, [open])

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
      } else if (a.type === 'function_call') {
        const name = String(a.name||'')
        const args = a.args||{}
        const call = async () => {
          if (name === 'create_sale') return api.post('/sales', args)
          if (name === 'update_sale') return api.put(`/sales/${args.id}`, args)
          if (name === 'delete_sale') return api.delete(`/sales/${args.id}`)
          if (name === 'mark_sale_paid') return api.put(`/sales/${args.id}`, { payment_status:'paid', receipt_data: args.receipt_data, receipt_name: args.receipt_name })
          if (name === 'create_purchase') return api.post('/purchases', args)
          if (name === 'update_purchase') return api.put(`/purchases/${args.id}`, args)
          if (name === 'delete_purchase') return api.delete(`/purchases/${args.id}`)
          if (name === 'mark_purchase_paid') return api.put(`/purchases/${args.id}`, { payment_status:'paid', receipt_data: args.receipt_data, receipt_name: args.receipt_name })
          if (name === 'create_expense') return api.post('/expenses', args)
          if (name === 'update_expense') return api.put(`/expenses/${args.id}`, args)
          if (name === 'delete_expense') return api.delete(`/expenses/${args.id}`)
          throw new Error('Hành động không hỗ trợ')
        }
        try { await call(); setMsgs(m => [...m, { role:'bot', text: 'Đã thực hiện xong', actions: [] }]) }
        catch { setMsgs(m => [...m, { role:'bot', text: 'Thực hiện lỗi', actions: [] }]) }
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

  const suggestions = () => {
    const t = currentTab
    if (t === 'sales') return [
      { label:'Thêm đơn bán', text:'Thêm đơn bán 20kg giá 100k cho Khách A ngày 25/11' },
      { label:'Báo cáo', text:'Báo cáo tháng '+(new Date().getMonth()+1) }
    ]
    if (t === 'purchases') return [
      { label:'Thêm đơn nhập', text:'Thêm đơn nhập 50kg giá 70k cho NCC B ngày 24/11' },
      { label:'Top NCC', text:'top NCC tháng '+(new Date().getMonth()+1) }
    ]
    if (t === 'expenses') return [
      { label:'Thêm chi phí', text:'Thêm chi phí 500k cho tiền điện ngày 25/11' },
      { label:'Nhắc việc', text:'Nhắc việc' }
    ]
    if (t === 'receipts') return [
      { label:'Tìm HĐ', text:'Tìm HĐ 00123' },
      { label:'Báo cáo', text:'Báo cáo tháng '+(new Date().getMonth()+1) }
    ]
    return [
      { label:'Báo cáo', text:'Báo cáo tháng '+(new Date().getMonth()+1) },
      { label:'Nhắc việc', text:'Nhắc việc' },
      { label:'Tìm HĐ', text:'Tìm HĐ 00123' }
    ]
  }

  const [listening, setListening] = useState(false)
  const startVoice = () => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SR) return
      const recog = new SR(); recog.lang = 'vi-VN'; recog.interimResults = false; setListening(true)
      recog.onresult = (e) => { const txt = Array.from(e.results).map(r => r[0].transcript).join(' '); setInput(txt); setListening(false); setTimeout(send, 50) }
      recog.onerror = () => setListening(false)
      recog.onend = () => setListening(false)
      recog.start()
    } catch {}
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
                {m.role==='bot' && Array.isArray(m.cards) && m.cards.length>0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8, margin:'6px 8px' }}>
                    {m.cards.map((c,ci) => (
                      <div key={ci} className="card" style={{ padding:10 }}>
                        <div style={{ fontWeight:700, marginBottom:6 }}>{c.title||'Hướng dẫn'}</div>
                        {Array.isArray(c.bullets) && c.bullets.map((b,bi)=> (<div key={bi} className="muted">• {b}</div>))}
                      </div>
                    ))}
                  </div>
                )}
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
          <div style={{ padding:'6px 10px', display:'flex', flexWrap:'wrap', gap:6 }}>
            {suggestions().map((s,i) => (
              <button key={i} className="btn" onClick={() => { setInput(s.text); send() }}>{s.label}</button>
            ))}
            <button className="btn" onClick={startVoice}>{listening ? '🎙️ Đang nghe...' : '🎙️ Nói'}</button>
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
