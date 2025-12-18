import React, { useEffect, useMemo, useRef, useState } from 'react'

type LogLine = { t: string; msg: string }
const now = () => new Date().toLocaleTimeString()

export default function App() {
  const [serverUrl, setServerUrl] = useState('http://localhost:8080')
  const [clientId, setClientId] = useState(`react-${Math.random().toString(16).slice(2, 6)}`)
  const [role, setRole] = useState('react')
  const [connected, setConnected] = useState(false)

  const [toId, setToId] = useState('')
  const [room, setRoom] = useState('store-101')
  const [text, setText] = useState('hello from react')

  const [logs, setLogs] = useState<LogLine[]>([])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)

  const iceServers = useMemo(
    () => ({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    }),
    [],
  )

  const log = (msg: string) => setLogs((p) => [...p, { t: now(), msg }])

  async function connect() {
    if (pcRef.current) return log('already connected (disconnect first)')

    const pc = new RTCPeerConnection(iceServers)
    pcRef.current = pc

    pc.onconnectionstatechange = () => {
      log(`pc.connectionState=${pc.connectionState}`)
      setConnected(pc.connectionState === 'connected')
    }
    pc.oniceconnectionstatechange = () => log(`pc.iceConnectionState=${pc.iceConnectionState}`)

    // Client creates DataChannel -> server receives "datachannel" event
    const dc = pc.createDataChannel('hub', { ordered: true })
    dcRef.current = dc

    dc.onopen = () => {
      log('datachannel open')
      sendJson({ type: 'hello', role, meta: { ua: navigator.userAgent } })
    }
    dc.onclose = () => log('datachannel close')
    dc.onerror = (e) => log(`datachannel error: ${String(e)}`)
    dc.onmessage = (ev) => log(`recv: ${ev.data}`)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGatheringComplete(pc)

    const base = serverUrl.replace(/\/$/, '')
    const url = `${base}/offer?client_id=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pc.localDescription),
    })
    if (!res.ok) throw new Error(`offer failed: ${res.status} ${res.statusText}`)
    const answer = (await res.json()) as RTCSessionDescriptionInit
    await pc.setRemoteDescription(answer)
    log('setRemoteDescription(answer) done')
  }

  async function disconnect() {
    setConnected(false)
    dcRef.current?.close()
    dcRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    log('disconnected')
  }

  function sendJson(obj: any) {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return log('datachannel not open')
    dc.send(JSON.stringify(obj))
    log(`sent(json): ${JSON.stringify(obj)}`)
  }

  function sendDirect() {
    if (!toId) return log('toId is empty')
    sendJson({ type: 'send', to: toId, payload: { text } })
  }

  function joinRoom() {
    sendJson({ type: 'join', room })
  }

  function broadcast() {
    sendJson({ type: 'broadcast', room, payload: { text } })
  }

  useEffect(() => {
    return () => {
      dcRef.current?.close()
      pcRef.current?.close()
    }
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <h2>WebRTC Hub Client (React ↔ Python)</h2>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Server URL&nbsp;
          <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} style={{ padding: 8, width: 260 }} />
        </label>
        <label>
          client_id&nbsp;
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ padding: 8, width: 180 }} />
        </label>
        <label>
          role&nbsp;
          <input value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: 8, width: 120 }} />
        </label>

        {!connected ? (
          <button onClick={connect} style={{ padding: '8px 12px' }}>Connect</button>
        ) : (
          <button onClick={disconnect} style={{ padding: '8px 12px' }}>Disconnect</button>
        )}
        <a href={`${serverUrl.replace(/\/$/, '')}/who`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
          /who
        </a>
      </div>

      <hr style={{ margin: '16px 0' }} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          to (client_id)&nbsp;
          <input value={toId} onChange={(e) => setToId(e.target.value)} style={{ padding: 8, width: 180 }} />
        </label>
        <label>
          room&nbsp;
          <input value={room} onChange={(e) => setRoom(e.target.value)} style={{ padding: 8, width: 180 }} />
        </label>
        <label>
          text&nbsp;
          <input value={text} onChange={(e) => setText(e.target.value)} style={{ padding: 8, width: 320 }} />
        </label>

        <button onClick={sendDirect} disabled={!connected} style={{ padding: '8px 12px' }}>
          Send to
        </button>
        <button onClick={joinRoom} disabled={!connected} style={{ padding: '8px 12px' }}>
          Join room
        </button>
        <button onClick={broadcast} disabled={!connected} style={{ padding: '8px 12px' }}>
          Broadcast room
        </button>

        <span style={{ opacity: 0.7 }}>status: {connected ? 'connected' : 'disconnected'}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Logs</h3>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, height: 360, overflow: 'auto', background: '#fafafa' }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13 }}>
              <span style={{ opacity: 0.6 }}>[{l.t}]</span> {l.msg}
            </div>
          ))}
        </div>
      </div>

      <p style={{ marginTop: 12, opacity: 0.75 }}>
        Tip: open two browser tabs with different client_id, connect both, then use "Send to" or "Broadcast room".
      </p>
    </div>
  )
}

async function waitForIceGatheringComplete(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(check, 0)
  })
}
