// Crypto Early Scanner v13 - Cloudflare Worker
const API = "https://fapi.binance.com/fapi/v1";
const SYMBOLS = ["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","TRXUSDT","TONUSDT","SUIUSDT","LTCUSDT","BCHUSDT","NEARUSDT","APTUSDT","ICPUSDT","FILUSDT","ARBUSDT","OPUSDT","ATOMUSDT","INJUSDT","ETCUSDT","AAVEUSDT","UNIUSDT","XLMUSDT","HBARUSDT","MATICUSDT","SEIUSDT"];
const j = async u => { const r = await fetch(u); if(!r.ok) throw Error("HTTP " + r.status); return r.json(); };
const avg = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
function atrLocal(k, n = 14){ if(k.length < n + 2) return 0; let a = 0; for(let i = k.length - n; i < k.length; i++){ const h = +k[i][2], l = +k[i][3], pc = +k[i-1][4]; a += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); } return a / n; }
function trend(k){ let c = k.map(x => +x[4]); let e20 = ema(c, 20).at(-1), e50 = ema(c, 50).at(-1); return e20 > e50; }
function ema(a, n){ let k = 2/(n + 1), e = a[0]; return a.map((x, i) => i ? x*k + e*(1 - k) : (e = x)); }
function vol(k){ let v = +k.at(-1)[5]; let b = avg(k.slice(-21, -1).map(x => +x[5])); return b ? v/b : 1; }
function rsi(k, n = 14){ let c = k.map(x => +x[4]), g = 0, l = 0; for(let i = c.length - n; i < c.length; i++){ let d = c[i] - c[i-1]; if(d > 0) g += d; else l -= d; } return l ? 100 - 100/(1 + g/l) : 100; }
function structureLocal(k){ if(k.length < 30) return { sweep:0, fvg:0, retest:0, structure:0, quality:50 }; const last = k.at(-1), prev = k.slice(-25, -1); const hi = Math.max(...prev.map(x => +x[2])); const lo = Math.min(...prev.map(x => +x[3])); const cl = +last[4], atr = atrLocal(k); const sweep = +last[3] < lo && cl > lo ? 1 : (+last[2] > hi && cl < hi ? -1 : 0); const bullFvg = +k.at(-3)[2] < +last[3] ? 1 : 0; const bearFvg = +k.at(-3)[3] > +last[2] ? -1 : 0; const fvg = bullFvg || bearFvg; const ph = Math.max(...k.slice(-12, -3).map(x => +x[2])); const pl = Math.min(...k.slice(-12, -3).map(x => +x[3])); const retest = cl > ph && +last[3] <= ph*1.002 ? 1 : (cl < pl && +last[2] >= pl*0.998 ? -1 : 0); const structure = cl > hi ? 1 : cl < lo ? -1 : 0; let quality = 50; if(sweep > 0) quality += 12; else if(sweep < 0) quality -= 12; if(fvg > 0) quality += 10; else if(fvg < 0) quality -= 10; if(retest > 0) quality += 18; else if(retest < 0) quality -= 18; if(structure > 0) quality += 10; else if(structure < 0) quality -= 10; return { sweep, fvg, retest, structure, quality: Math.max(0, Math.min(100, quality)), atr }; }
function jsonResp(data, status = 200){ return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-api-key", "access-control-allow-methods": "GET,POST,OPTIONS" } }); }
async function authorized(req, env){ const key = env.JOURNAL_API_KEY || ""; return !key || req.headers.get("x-api-key") === key; }
async function journalList(env){ const raw = await env.STATE.get("journal:all"); return raw ? JSON.parse(raw) : []; }
async function journalSave(env, list){ await env.STATE.put("journal:all", JSON.stringify(list.slice(0, 1000))); }
async function processJournal(env){
  const list = await journalList(env); let changed = false;
  for(const x of list){
    if(x.status !== "OPEN") continue;
    try{
      const k = await j(`${API}/klines?symbol=${x.symbol}&interval=15m&limit=120`);
      const bars = k.filter(q => +q[0] > x.time);
      for(const q of bars){
        const lo = +q[3], hi = +q[2], t = +q[0];
        if(lo <= x.sl){ x.status = "SL"; x.resultR = (x.sl - x.entry)/(x.entry - x.sl); x.resultAt = t; changed = true; break; }
        if(hi >= x.tp3){ x.status = "TP3"; x.resultR = (x.tp3 - x.entry)/(x.entry - x.sl); x.resultAt = t; changed = true; break; }
        if(hi >= x.tp2){ x.status = "TP2"; x.resultR = (x.tp2 - x.entry)/(x.entry - x.sl); x.resultAt = t; changed = true; break; }
        if(hi >= x.tp1){ x.status = "TP1"; x.resultR = (x.tp1 - x.entry)/(x.entry - x.sl); x.resultAt = t; changed = true; break; }
      }
      const last = +k.at(-1)[0];
      if(x.status === "OPEN" && last - x.time >= 24*60*60*1000){ x.status = "EXPIRED"; x.resultR = (+k.at(-1)[4] - x.entry)/(x.entry - x.sl); x.resultAt = last; changed = true; }
    }catch(e){}
  }
  if(changed) await journalSave(env, list);
  return list;
}
async function longShort(symbol){ try{ const pair = symbol.replace("USDT", ""); const d = await j(`${API}/globalLongShortAccountRatio?pair=${pair}&period=15m&limit=1`); const x = d?.[0] || {}; return { ratio: +x.longShortRatio || 1, long: +x.longAccount*100 || 50, short: +x.shortAccount*100 || 50 }; }catch{ return { ratio: 1, long: 50, short: 50 }; } }
async function deep(symbol, env){
  const k = await j(`${API}/klines?symbol=${symbol}&interval=15m&limit=120`);
  const d = await j(`${API}/depth?symbol=${symbol}&limit=20`);
  const oi = await j(`${API}/openInterest?symbol=${symbol}`);
  const book = (d.bids.reduce((s, x) => s + (+x[0])*(+x[1]), 0)) / (d.bids.reduce((s, x) => s + (+x[0])*(+x[1]), 0) + d.asks.reduce((s, x) => s + (+x[0])*(+x[1]), 0)) * 100;
  const v = vol(k), a = atrLocal(k, 14), close = +k.at(-1)[4];
  const hi = Math.max(...k.slice(-21, -1).map(x => +x[2]));
  const br = (close - hi)/a;
  const comp = Math.max(0, Math.min(100, 100 - avg(k.slice(-5).map(x => +x[2] - +x[3]))/(avg(k.slice(-20).map(x => +x[2] - +x[3])) || 1)*100 + 55));
  const key = "oi:" + symbol;
  const prev = +(await env.STATE.get(key) || oi.openInterest);
  const oid = prev ? ((+oi.openInterest - prev)/prev*100) : 0;
  await env.STATE.put(key, String(oi.openInterest));
  const ls = await longShort(symbol);
  const t = trend(k), rs = rsi(k);
  const setup = comp >= 45 && v >= 1.15 && t;
  const trigger = setup && v >= 1.5 && oid > -0.3 && book >= 52;
  const confirmed = trigger && br >= 0.15 && rs < 78;
  const phase = confirmed ? "CONFIRMED" : trigger ? "TRIGGER" : setup ? "SETUP" : "WATCH";
  const score = Math.min(100, 18*(t ? 1 : 0) + 12*comp/100 + 14*Math.min(2, v)/2 + 12*Math.max(0, Math.min(1, (oid + 1)/4)) + 12*Math.max(0, Math.min(1, (book - 45)/20)) + 10*Math.max(0, Math.min(1, (br + 0.2)/0.8)) + 8*Math.max(0, Math.min(1, (rs - 45)/30)) + 5 + 5);
  return { symbol, score, phase, price: close, v, oid, book, br, rs, ls };
}
async function telegram(text, env){ return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML" }) }); }
export default {
  async fetch(req, env){
    if(req.method === "OPTIONS") return jsonResp({}, 204);
    const u = new URL(req.url);
    if(!await authorized(req, env)) return jsonResp({ error: "unauthorized" }, 401);
    if(u.pathname === "/journal" && req.method === "GET") return jsonResp({ signals: await journalList(env) });
    if(u.pathname === "/journal/sync" && req.method === "POST"){ const body = await req.json(); const incoming = Array.isArray(body.signals) ? body.signals : []; const old = await journalList(env); const map = new Map(old.map(x => [x.id, x])); incoming.forEach(x => map.set(x.id, { ...map.get(x), ...x })); const out = [...map.values()].sort((a, b) => b.time - a.time).slice(0, 1000); await journalSave(env, out); return jsonResp({ ok: true, count: out.length }); }
    if(u.pathname === "/journal/signal" && req.method === "POST"){ const x = await req.json(); if(!x?.id || !x?.symbol) return jsonResp({ error: "bad signal" }, 400); const old = await journalList(env); const map = new Map(old.map(y => [y.id, y])); map.set(x.id, x); const out = [...map.values()].sort((a, b) => b.time - a.time).slice(0, 1000); await journalSave(env, out); return jsonResp({ ok: true }); }
    if(u.pathname === "/journal/process" && req.method === "POST"){ const out = await processJournal(env); return jsonResp({ ok: true, count: out.length }); }
    return new Response("Crypto Early Scanner v13 Worker", { status: 200, headers: { "content-type": "text/plain" } });
  },
  async scheduled(event, env, ctx){
    try{
      const tick = await j(`${API}/ticker/24hr`);
      const allowed = new Set(SYMBOLS);
      const top = tick.filter(x => allowed.has(x.symbol)).sort((a, b) => (+b.quoteVolume) - (+a.quoteVolume)).slice(0, 10);
      for(const t of top){
        try{
          const x = await deep(t.symbol, env);
          if(!["TRIGGER", "CONFIRMED"].includes(x.phase) || x.score < 72) continue;
          const ck = "cool:" + x.symbol;
          const old = +(await env.STATE.get(ck) || 0);
          if(Date.now() - old < 45*60*1000) continue;
          await telegram(`<b>🚨 Early Signal v13</b>\n${x.symbol}\nPhase: ${x.phase}\nScore: ${x.score.toFixed(1)}\nPrice: ${x.price}\nVolume: ${x.v.toFixed(2)}x\nOI Δ: ${x.oid.toFixed(2)}%\nBuy Pressure: ${x.book.toFixed(1)}%\nBreakout: ${x.br.toFixed(2)} ATR\nRSI: ${x.rs.toFixed(1)}\n\nResearch levels are generated client-side; verify before use.`, env);
          await env.STATE.put(ck, String(Date.now()), { expirationTtl: 7200 });
        }catch(e){ console.log(t.symbol, e.message); }
      }
      try{ await processJournal(env); }catch(e){ console.log("journal", e.message); }
    }catch(e){ console.log(e.message); }
  }
};