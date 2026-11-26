// 同頻轉盤：連線層
// - mockJoin：?local 時用同瀏覽器分頁模擬（測試用）
// - relayJoin：正式版，兩台公共 MQTT 伺服器為主、P2P 直連為備援，內容以房號加密
// - lobbyConnect：公開房間大廳頻道
// - localRoom：離線輪流模式（同一支手機）
export const params = new URLSearchParams(location.search);
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- 連線層：正式版用 Trystero（瀏覽器直連），?local 用同瀏覽器分頁模擬 ----------
export function mockJoin(code) {
  const bc = new BroadcastChannel('wl-mock-' + code);
  const uid = 'u' + Math.random().toString(36).slice(2, 9);
  const S = {}, U = {}, sl = {}, ul = {}, peers = {}, jl = [], ll = [];
  let clock = 0;
  const ts = () => Math.max(Date.now(), ++clock);
  const post = m => bc.postMessage({ ...m, from: uid });
  const newer = (a, b) => !b || a.ts > b.ts || (a.ts === b.ts && a.by > b.by);
  const applyS = (ns, rec) => { if (newer(rec, S[ns])) { const prev = S[ns]?.val; S[ns] = rec; (sl[ns] || []).forEach(f => f(rec.val, { userId: rec.by, prev })); } };
  const applyU = (ns, id, rec) => { U[ns] ??= {}; if (newer(rec, U[ns][id])) { U[ns][id] = rec; (ul[ns] || []).forEach(f => f(rec.val, { userId: id, self: id === uid })); } };
  const dump = () => { for (const ns in S) post({ t: 's', ns, rec: S[ns] }); for (const ns in U) if (U[ns][uid]) post({ t: 'u', ns, rec: U[ns][uid] }); };
  bc.onmessage = ({ data: m }) => {
    if (m.t === 'bye') { delete peers[m.from]; ll.forEach(f => f({ userId: m.from })); return; }
    if (!peers[m.from]) { peers[m.from] = 1; jl.forEach(f => f({ userId: m.from })); post({ t: 'hi' }); dump(); }
    if (m.t === 's') applyS(m.ns, m.rec);
    if (m.t === 'u') applyU(m.ns, m.from, m.rec);
  };
  addEventListener('pagehide', () => post({ t: 'bye' }));
  setTimeout(() => post({ t: 'hi' }), 50);
  return {
    ready: Promise.resolve(),
    getSelf: async () => ({ userId: uid }),
    getUsers: () => Object.fromEntries(Object.keys(peers).map(k => [k, {}])),
    onUserJoin: f => jl.push(f), onUserLeave: f => ll.push(f), onError: () => {},
    makeState(ns, init) {
      return {
        get: () => (S[ns] ? S[ns].val : init),
        async set(next) { const v = typeof next === 'function' ? next(S[ns] ? S[ns].val : init) : next; const rec = { val: v, ts: ts(), by: uid }; applyS(ns, rec); post({ t: 's', ns, rec }); },
        onChange: f => { (sl[ns] ??= []).push(f); },
      };
    },
    makeUserState(ns, init) {
      const all = () => Object.fromEntries(Object.entries(U[ns] || {}).map(([k, r]) => [k, r.val]));
      return {
        get: (id = uid) => (U[ns]?.[id] ? U[ns][id].val : init),
        getAll: all,
        async set(next) { const cur = U[ns]?.[uid]?.val ?? init; const v = typeof next === 'function' ? next(cur) : next; const rec = { val: v, ts: ts(), by: uid }; applyU(ns, uid, rec); post({ t: 'u', ns, rec }); },
        onChange: f => { (ul[ns] ??= []).push(f); },
      };
    },
  };
}

// ---------- 正式連線：MQTT 中繼為主（兩台伺服器同時用），P2P 直連為備援 ----------
// 每則訊息同時送進所有線路，收到重複的用「最後寫入為準」去重；任何一條通就能玩。
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
const BROKERS = DEV && params.get('brokers') ? params.get('brokers').split(',') : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const MQTT_SRC = DEV && params.get('mqttsrc') ? params.get('mqttsrc') : 'https://cdn.jsdelivr.net/npm/mqtt@5.16.1/dist/mqtt.esm.js';
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function relayJoin(code) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('wl-jz:' + code)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const base = 'wl-jz/v1/' + hash.slice(0, 20);
  const raw = await crypto.subtle.importKey('raw', enc.encode('wavelength:' + code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('wl-jz-salt'), iterations: 50000, hash: 'SHA-256' }, raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const seal = async obj => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)))); return b64(iv) + '.' + b64(ct); };
  const open = async str => { try { const [iv, ct] = String(str).split('.'); return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)))); } catch { return null; } };

  // 身分記在這個瀏覽器：關掉分頁再回來還是同一個座位（?anon 測試用：每個分頁都是新身分）
  const box = params.has('anon') ? sessionStorage : localStorage;
  let uid = null;
  try { uid = box.getItem('wl:uid:' + code); } catch {}
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10); try { box.setItem('wl:uid:' + code, uid); } catch {} }

  // 本地資料：共享狀態、每人狀態、在線名單
  const S = {}, U = {}, sl = {}, ul = {}, jl = [], ll = [], el = [];
  const heard = {}, gone = {}, online = new Set();
  let clock = 0;
  const tick = () => (clock = Math.max(Date.now(), clock + 1));
  const newer = (a, b) => !b || a.ts > b.ts || (a.ts === b.ts && a.by > b.by);
  const applyS = (ns, rec) => { if (!rec || typeof rec.ts !== 'number') return; clock = Math.max(clock, rec.ts); if (newer(rec, S[ns])) { S[ns] = rec; (sl[ns] || []).forEach(f => f(rec.val, { userId: rec.by })); } };
  const applyU = (ns, id, rec) => { if (!rec || typeof rec.ts !== 'number') return; clock = Math.max(clock, rec.ts); U[ns] ??= {}; if (newer(rec, U[ns][id])) { U[ns][id] = rec; (ul[ns] || []).forEach(f => f(rec.val, { userId: id, self: id === uid })); } };
  function sweep() {
    const now = Date.now();
    for (const id of Object.keys(heard)) {
      const isOn = id !== uid && !gone[id] && now - heard[id] < 45000;
      if (isOn && !online.has(id)) { online.add(id); jl.forEach(f => f({ userId: id })); }
      if (!isOn && online.has(id)) { online.delete(id); ll.forEach(f => f({ userId: id })); }
    }
  }
  function seen(id, on = true) { if (!id || id === uid) return; heard[id] = Date.now(); gone[id] = !on; sweep(); }
  function handle(m) {
    if (!m || typeof m !== 'object') return;
    if (m.k === 'p') return seen(m.id, !!m.on);
    if (m.k === 's') { seen(m.rec && m.rec.by); return applyS(m.ns, m.rec); }
    if (m.k === 'u') { seen(m.id); return applyU(m.ns, m.id, m.rec); }
    if (m.k === 'hi') { seen(m.id); p2pDump(); }
  }

  // --- MQTT 線路 ---
  const clients = [];
  let mqttLib = null;
  mqttLib = await getMqtt();
  const willMsg = await seal({ k: 'p', id: uid, on: 0 });
  const emitErr = code => el.forEach(f => f({ code }));
  if (mqttLib) for (const url of BROKERS) {
    const c = mqttLib.connect(url, { keepalive: 20, reconnectPeriod: 2500, connectTimeout: 8000, clean: true,
      clientId: 'wl_' + uid + '_' + Math.random().toString(36).slice(2, 6),
      will: { topic: `${base}/p/${uid}`, payload: willMsg, retain: true, qos: 0 } });
    c.on('connect', async () => {
      c.subscribe(base + '/#', { qos: 0 });
      c.publish(`${base}/p/${uid}`, await seal({ k: 'p', id: uid, on: 1 }), { retain: true });
      for (const ns in U) if (U[ns][uid]) c.publish(`${base}/u/${uid}/${ns}`, await seal({ k: 'u', ns, id: uid, rec: U[ns][uid] }), { retain: true });
      // 伺服器若重啟會遺失保留資料，重連時把手上最新的共享狀態補回去（較舊的會被自動忽略）
      for (const ns in S) c.publish(`${base}/s/${ns}`, await seal({ k: 's', ns, rec: S[ns] }), { retain: true });
      changed();
    });
    c.on('message', async (topic, payload) => handle(await open(payload.toString())));
    c.on('offline', () => { emitErr('relay-offline'); changed(); });
    c.on('close', changed);
    c.on('error', () => emitErr('relay-error'));
    clients.push(c);
  }
  const relayUp = () => clients.filter(c => c.connected).length;

  // --- P2P 線路（備援，載入失敗也不影響） ---
  let p2pSend = null, p2pPeers = 0;
  async function p2pDump() {
    if (!p2pSend) return;
    for (const ns in S) p2pSend(await seal({ k: 's', ns, rec: S[ns] }));
    for (const ns in U) if (U[ns][uid]) p2pSend(await seal({ k: 'u', ns, id: uid, rec: U[ns][uid] }));
  }
  if (!params.has('nop2p')) (async () => {
    try {
      const { joinRoom } = await import('https://cdn.jsdelivr.net/npm/trystero@0.27.0/+esm');
      const r = joinRoom({ appId: 'josephinezulin.github.io/my-games/wavelength', password: 'wl-' + code }, code);
      const act = r.makeAction('m');
      p2pSend = data => { try { act.send(data); } catch {} };
      act.onMessage(async data => handle(await open(data)));
      r.onPeerJoin(async () => { p2pPeers++; changed(); p2pSend(await seal({ k: 'hi', id: uid })); p2pDump(); });
      r.onPeerLeave(() => { p2pPeers = Math.max(0, p2pPeers - 1); changed(); });
      r.onError(() => {});
    } catch (e) { console.warn('p2p unavailable', e); }
  })();

  async function broadcast(topic, obj, retain) {
    const data = await seal(obj);
    for (const c of clients) if (c.connected) c.publish(topic, data, { retain, qos: 0 });
    if (p2pSend) p2pSend(data);
  }
  const statusL = [];
  function changed() { statusL.forEach(f => f()); }
  // 心跳：讓其他人知道我還在
  setInterval(() => { broadcast(`${base}/p/${uid}`, { k: 'p', id: uid, on: 1 }, true); sweep(); }, 15000);
  setInterval(sweep, 5000);
  addEventListener('pagehide', () => { broadcast(`${base}/p/${uid}`, { k: 'p', id: uid, on: 0 }, true); });

  // 等第一台伺服器連上（最多 8 秒），讓保留的遊戲狀態先送到
  await new Promise(res => {
    if (!clients.length) return res();
    const t = setTimeout(res, 8000);
    clients.forEach(c => c.once('connect', () => setTimeout(() => { clearTimeout(t); res(); }, 600)));
  });

  return {
    getSelf: async () => ({ userId: uid }),
    getUsers: () => Object.fromEntries([...online].map(k => [k, {}])),
    onUserJoin: f => jl.push(f), onUserLeave: f => ll.push(f), onError: f => el.push(f),
    onStatus: f => statusL.push(f),
    status: () => ({ relays: relayUp(), relayTotal: clients.length, p2p: p2pPeers }),
    makeState(ns, init) {
      return {
        get: () => (S[ns] ? S[ns].val : init),
        async set(next) {
          const v = typeof next === 'function' ? next(S[ns] ? S[ns].val : init) : next;
          const rec = { val: v, ts: tick(), by: uid }; applyS(ns, rec);
          await broadcast(`${base}/s/${ns}`, { k: 's', ns, rec }, true);
        },
        onChange: f => { (sl[ns] ??= []).push(f); },
      };
    },
    makeUserState(ns, init) {
      return {
        get: (id = uid) => (U[ns]?.[id] ? U[ns][id].val : init),
        getAll: () => Object.fromEntries(Object.entries(U[ns] || {}).map(([k, r]) => [k, r.val])),
        async set(next) {
          const cur = U[ns]?.[uid]?.val ?? init; const v = typeof next === 'function' ? next(cur) : next;
          const rec = { val: v, ts: tick(), by: uid }; applyU(ns, uid, rec);
          await broadcast(`${base}/u/${uid}/${ns}`, { k: 'u', ns, id: uid, rec }, true);
        },
        onChange: f => { (ul[ns] ??= []).push(f); },
      };
    },
  };
}

// ---------- 公開房間大廳：所有公開房間把簡介貼到同一個頻道 ----------
export const LOBBY = 'wl-jz/v1/lobby';
let lobbyBusP = null;
export function getMqtt() { if (!getMqtt.p) getMqtt.p = import(MQTT_SRC).then(m => m.default).catch(() => null); return getMqtt.p; }
export function lobbyConnect() {
  if (lobbyBusP) return lobbyBusP;
  lobbyBusP = (async () => {
    const subs = [];
    if (params.has('local')) {
      const bc = new BroadcastChannel('wl-mock-lobby'), mine = {};
      bc.onmessage = ({ data: m }) => { if (m.t === 'req') { for (const c in mine) bc.postMessage({ t: 'a', code: c, info: mine[c] }); } else if (m.t === 'a') subs.forEach(f => f(m.code, m.info)); };
      return { publish(code, info) { if (info) mine[code] = info; else delete mine[code]; bc.postMessage({ t: 'a', code, info }); }, on(f) { subs.push(f); bc.postMessage({ t: 'req' }); } };
    }
    const mqtt = await getMqtt(), clients = [];
    if (mqtt) for (const url of BROKERS) {
      const c = mqtt.connect(url, { keepalive: 30, reconnectPeriod: 3000, connectTimeout: 8000, clientId: 'wlL_' + Math.random().toString(36).slice(2, 10) });
      c.on('connect', () => c.subscribe(LOBBY + '/+'));
      c.on('message', (t, p) => { const code = t.split('/').pop(); let info = null; try { const str = p.toString(); info = str ? JSON.parse(str) : null; } catch {} subs.forEach(f => f(code, info)); });
      clients.push(c);
    }
    return { publish(code, info) { for (const c of clients) if (c.connected) c.publish(LOBBY + '/' + code, info ? JSON.stringify(info) : '', { retain: true }); }, on(f) { subs.push(f); } };
  })();
  return lobbyBusP;
}

export async function connect(code) {
  if (params.has('local')) return mockJoin(code);
  return relayJoin(code);
}

// ---------- 離線輪流模式：所有玩家都在這支手機上，資料存在本機 ----------
export function localRoom() {
  let data = null;
  try { data = JSON.parse(store.get('wl:offline') || 'null'); } catch {}
  if (!data || typeof data !== 'object' || !Array.isArray(data.players)) data = { S: {}, U: {}, players: [] };
  data.S ??= {}; data.U ??= {};
  const sl = {}, ul = {};
  let cur = data.players[0] || 'nobody';
  const save = () => store.set('wl:offline', JSON.stringify(data));
  const fireU = ns => (ul[ns] || []).forEach(f => f());
  return {
    offline: true,
    players: () => [...data.players],
    addPlayer(prof) { const id = 'o' + Math.random().toString(36).slice(2, 8); data.players.push(id); (data.U.profile ??= {})[id] = prof; if (cur === 'nobody') cur = id; save(); fireU('profile'); return id; },
    removePlayer(id) { data.players = data.players.filter(x => x !== id); for (const ns in data.U) delete data.U[ns][id]; if (cur === id) cur = data.players[0] || 'nobody'; save(); fireU('profile'); },
    setProfile(id, prof) { (data.U.profile ??= {})[id] = prof; save(); fireU('profile'); },
    setSelf(id) { cur = id; },
    self: () => cur,
    wipe() { store.del('wl:offline'); },
    getSelf: async () => ({ userId: cur }),
    getUsers: () => Object.fromEntries(data.players.filter(id => id !== cur).map(id => [id, {}])),
    onUserJoin() {}, onUserLeave() {}, onError() {},
    makeState(ns, init) {
      return {
        get: () => (ns in data.S ? data.S[ns] : init),
        async set(next) { const v = typeof next === 'function' ? next(ns in data.S ? data.S[ns] : init) : next; data.S[ns] = v; save(); (sl[ns] || []).forEach(f => f(v)); },
        onChange: f => { (sl[ns] ??= []).push(f); },
      };
    },
    makeUserState(ns, init) {
      return {
        get: (id = cur) => (data.U[ns] && id in data.U[ns] ? data.U[ns][id] : init),
        getAll: () => ({ ...(data.U[ns] || {}) }),
        async set(next) { const c = data.U[ns]?.[cur] ?? init; const v = typeof next === 'function' ? next(c) : next; (data.U[ns] ??= {})[cur] = v; save(); fireU(ns); },
        onChange: f => { (ul[ns] ??= []).push(f); },
      };
    },
  };
}
