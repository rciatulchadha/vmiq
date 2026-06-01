'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'How many ITCC VMs are there?',
  'Which vCenter has the most VMs?',
  'How many VMs are powered off?',
  'Show me the risk summary',
  'How many ghost VMs in CMDB?',
  'What is the OS breakdown?',
]

export default function Chatbot() {
  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m EVIT Assistant. Ask me anything about your VMware estate — VM counts, risks, CMDB status, OS distribution, or vCenter breakdowns.',
    },
  ])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function send(text?: string) {
    const content = (text || input).trim()
    if (!content || loading) return

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content },
    ]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/v1/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: newMessages }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: data.response || data.error || 'Sorry, something went wrong.',
      }])
    } catch {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: 'Connection error. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position:     'fixed',
          bottom:       24,
          right:        24,
          width:        52,
          height:       52,
          borderRadius: '50%',
          background:   'var(--blue)',
          color:        '#fff',
          border:       'none',
          fontSize:     22,
          cursor:       'pointer',
          boxShadow:    '0 4px 12px rgba(0,0,0,.2)',
          zIndex:       100,
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          transition:   'transform .15s',
        }}
        title="EVIT Assistant"
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat window */}
      {open && (
        <div style={{
          position:     'fixed',
          bottom:       88,
          right:        24,
          width:        380,
          height:       520,
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 12,
          boxShadow:    '0 8px 32px rgba(0,0,0,.15)',
          zIndex:       100,
          display:      'flex',
          flexDirection:'column',
          overflow:     'hidden',
        }}>

          {/* Header */}
          <div style={{
            padding:    '14px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--blue)',
            color:      '#fff',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>EVIT Assistant</div>
            <div style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>
              Ask about your VMware estate
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex:     1,
            overflowY:'auto',
            padding:  '12px 14px',
            display:  'flex',
            flexDirection: 'column',
            gap:      10,
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display:       'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth:     '85%',
                  padding:      '9px 12px',
                  borderRadius: m.role === 'user'
                    ? '12px 12px 2px 12px'
                    : '12px 12px 12px 2px',
                  background:   m.role === 'user'
                    ? 'var(--blue)'
                    : 'var(--surface2)',
                  color:        m.role === 'user' ? '#fff' : 'var(--text)',
                  fontSize:     13,
                  lineHeight:   1.5,
                  whiteSpace:   'pre-wrap',
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '9px 14px',
                  borderRadius: '12px 12px 12px 2px',
                  background: 'var(--surface2)',
                  fontSize: 13, color: 'var(--text3)',
                }}>
                  Thinking...
                </div>
              </div>
            )}

            {/* Suggestion chips — show only at start */}
            {messages.length === 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      padding:      '5px 10px',
                      borderRadius: 20,
                      border:       '1px solid var(--border)',
                      background:   'var(--bg)',
                      fontSize:     11,
                      cursor:       'pointer',
                      color:        'var(--text2)',
                      textAlign:    'left',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding:      '10px 12px',
            borderTop:    '1px solid var(--border)',
            display:      'flex',
            gap:          8,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ask about your estate..."
              disabled={loading}
              style={{
                flex:         1,
                padding:      '8px 12px',
                borderRadius: 'var(--radius)',
                border:       '1px solid var(--border)',
                fontSize:     13,
                background:   'var(--bg)',
                color:        'var(--text)',
                outline:      'none',
              }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{
                padding:      '8px 14px',
                borderRadius: 'var(--radius)',
                background:   loading || !input.trim()
                  ? 'var(--surface2)' : 'var(--blue)',
                color:        loading || !input.trim()
                  ? 'var(--text3)' : '#fff',
                border:       'none',
                fontSize:     13,
                cursor:       loading || !input.trim() ? 'default' : 'pointer',
                fontWeight:   500,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
