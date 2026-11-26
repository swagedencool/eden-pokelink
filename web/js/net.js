// Client de room (WebSocket). Même interface que la simulation utilisée par la preview :
//   net.id · net.on(type, fn) · net.send(type, data)
// Positions envoyées à 15 Hz, interpolées chez les autres avec 100 ms de retard.
export class RoomClient {
  constructor() { this.h = new Map(); this.id = null; this.queue = []; }
  on(t, f) { (this.h.get(t) || this.h.set(t, []).get(t)).push(f); return this; }
  emit(t, m) { (this.h.get(t) || []).forEach(f => f(m)); }
  /** action : 'create' ou 'join' (avec code). Résout avec { code, id, peers }. */
  connect(url, action, code) {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(url));
      ws.onopen = () => ws.send(JSON.stringify({ t: action, code }));
      ws.onerror = () => reject(new Error('Serveur injoignable'));
      ws.onclose = () => this.emit('disconnected', {});
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'joined') {
          this.id = m.id; this.code = m.code;
          this.queue.splice(0).forEach(q => ws.send(q));
          this.pinger = setInterval(() => this.send('ping', { c: performance.now() }), 2000);
          return resolve(m);
        }
        if (m.t === 'error') return reject(new Error(m.error));
        if (m.t === 'pong') return this.emit('ping', { ms: Math.round(performance.now() - m.c) });
        this.emit(m.t, m);
      };
    });
  }
  send(t, d = {}) {
    const s = JSON.stringify({ t, ...d });
    if (this.ws?.readyState === 1 && this.id) this.ws.send(s); else this.queue.push(s);
  }
  close() { clearInterval(this.pinger); this.ws?.close(); }
}
