/* ============================================================
   Crypto Early Scanner v13
   ============================================================ */
const C = window.SCANNER_CONFIG;
const $ = id => document.getElementById(id);
const cache = new Map();
let results = [];
let selected = null;

/* ---------- Utilities ---------- */
async function getJSON(url){
  const r = await fetch(url);
  if(!r.ok) throw Error("HTTP " + r.status);
  return r.json();
}
async function klines(symbol, tf, limit = 250){
  const key = symbol + "_" + tf + "_" + limit;
  if(cache.has(key)) return cache.get(key);
  const d = await getJSON(`${C.futuresBase}/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`);
  const x = d.map(a => ({ t:a[0], o:+a[1], h:+a[2], l:+a[3], c:+a[4], v:+a[5], q:+a[7], tr:+a[8], tb:+a[9] }));
  cache.set(key, x);
  return x;
}
function ema(a, n){
  let k = 2/(n+1), e = a[0];
  return a.map((x, i) => i ? x*k + e*(1-k) : (e = x));
}
function atr(k, n = 14){
  let tr = k.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - k[i-1].c), Math.abs(x.l - k[i-1].c)) : x.h - x.l);
  return tr.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, tr.length);
}
function atrVal(k, n = 14){
  if(!k || k.length < n + 1) return 0;
  let sum = 0;
  for(let i = k.length - n; i < k.length; i++){
    const h = +k[i][2], l = +k[i][3], pc = +k[i-1][4];
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / n;
}
function rsi(c, n = 14){
  if(c.length < n + 1) return 50;
  let g = 0, l = 0;
  for(let i = c.length - n; i < c.length; i++){
    let d = c[i] - c[i-1];
    if(d > 0) g += d; else l -= d;
  }
  return l === 0 ? 100 : 100 - 100/(1 + g/l);
}
function linSlope(c, n = 20){
  let a = c.slice(-n);
  let x = a.map((_, i) => i), mx = (n-1)/2, my = a.reduce((s, v) => s + v, 0)/n;
  let num = 0, den = 0;
  for(let i = 0; i < n; i++){ num += (x[i]-mx)*(a[i]-my); den += (x[i]-mx)**2; }
  return den ? num/den : 0;
}
function compression(k){
  let ranges = k.slice(-20).map(x => x.h - x.l);
  let avg = ranges.reduce((s, v) => s + v, 0)/ranges.length;
  let recent = ranges.slice(-5).reduce((s, v) => s + v, 0)/5;
  return Math.max(0, Math.min(100, 100 - (recent/(avg || 1))*100 + 55));
}
function volRatio(k){
  let v = k[k.length-1].v;
  let base = k.slice(-21, -1).reduce((s, x) => s + x.v, 0)/20;
  return base ? v/base : 1;
}
function breakoutScore(k){
  let x = k[k.length-1], prev = k.slice(-21, -1);
  let hi = Math.max(...prev.map(a => a.h)), a = atr(k, 14);
  return a ? Math.max(-1, Math.min(2, (x.c - hi)/a)) : 0;
}
function trend(k){
  let c = k.map(x => x.c), e20 = ema(c, 20).at(-1), e50 = ema(c, 50).at(-1);
  return e20 > e50 && linSlope(c, 20) > 0;
}
function buyPressure(k){
  let x = k.slice(-20);
  let num = x.reduce((s, a) => s + a.tb, 0);
  let den = x.reduce((s, a) => s + a.v, 0);
  return den ? 100*num/den : 50;
}
async function oiNow(symbol){
  try{ let d = await getJSON(`${C.futuresBase}/openInterest?symbol=${symbol}`); return +d.openInterest; }
  catch{ return 0; }
}
async function funding(symbol){
  try{ let d = await getJSON(`${C.futuresBase}/fundingRate?symbol=${symbol}&limit=1`); return +(d[0]?.fundingRate || 0); }
  catch{ return 0; }
}
async function depth(symbol){
  try{ return await getJSON(`${C.futuresBase}/depth?symbol=${symbol}&limit=20`); }
  catch{ return null; }
}
function bookPressure(d){
  if(!d) return 50;
  const b = d.bids.reduce((s, x) => s + (+x[0])*(+x[1]), 0);
  const a = d.asks.reduce((s, x) => s + (+x[0])*(+x[1]), 0);
  return (b + a) ? 100*b/(b + a) : 50;
}
function entryLevels(k, phase){
  const x = k.at(-1), a = atr(k, 14);
  const recentLow = Math.min(...k.slice(-12).map(z => z.l));
  const hi = Math.max(...k.slice(-12).map(z => z.h));
  const breakout = hi;
  const center = phase === "WATCH" ? x.c : Math.max(x.c, breakout);
  const low = center - 0.15*a, high = center + 0.15*a;
  const invalid = Math.min(recentLow, low - 0.75*a);
  const r = Math.max(0.15*a, center - invalid);
  return { low, high, invalid, tp1: center + r, tp2: center + 2*r, tp3: center + 3*r, r, center };
}
async function longShort(symbol){
  try{
    const pair = symbol.replace("USDT", "");
    const d = await getJSON(`${C.futuresBase}/globalLongShortAccountRatio?pair=${pair}&period=15m&limit=1`);
    const x = d?.[0] || {};
    return { ratio: +x.longShortRatio || 1, long: +x.longAccount*100 || 50, short: +x.shortAccount*100 || 50 };
  }catch{ return { ratio: 1, long: 50, short: 50 }; }
}
async function topPosition(symbol){
  try{
    const pair = symbol.replace("USDT", "");
    const d = await getJSON(`${C.futuresBase}/topLongShortPositionRatio?pair=${pair}&period=15m&limit=1`);
    const x = d?.[0] || {};
    return { ratio: +x.longShortRatio || 1, long: +x.longPosition*100 || 50, short: +x.shortPosition*100 || 50 };
  }catch{ return { ratio: 1, long: 50, short: 50 }; }
}

/* ---------- Structure (SMC heuristics) ---------- */
function structureMetrics(k){
  if(!k || k.length < 30) return { sweep:0, fvg:0, retest:0, structure:0, quality:0, atr:0 };
  const c = k.map(x => ({ t:+x[0], o:+x[1], h:+x[2], l:+x[3], cl:+x[4], v:+x[5] }));
  const last = c.at(-1), prev = c.slice(-25, -1);
  const hi = Math.max(...prev.map(x => x.h)), lo = Math.min(...prev.map(x => x.l));
  const atr = atrVal(k, 14) || Math.max(hi - lo, 1);
  const sweep = last.l < lo && last.cl > lo ? 1 : (last.h > hi && last.cl < hi ? -1 : 0);
  const bullFvg = c.length >= 4 && c.at(-3).h < c.at(-1).l ? 1 : 0;
  const bearFvg = c.length >= 4 && c.at(-3).l > c.at(-1).h ? -1 : 0;
  const fvg = bullFvg || bearFvg;
  const priorHigh = Math.max(...c.slice(-12, -3).map(x => x.h));
  const priorLow = Math.min(...c.slice(-12, -3).map(x => x.l));
  const breakoutUp = last.cl > priorHigh;
  const breakoutDown = last.cl < priorLow;
  const retest = (breakoutUp && last.l <= priorHigh*1.002 && last.cl > priorHigh) ? 1
               : (breakoutDown && last.h >= priorLow*0.998 && last.cl < priorLow) ? -1 : 0;
  const structureScore = (last.cl > hi ? 1 : last.cl < lo ? -1 : 0);
  let q = 50;
  if(sweep > 0) q += 12; else if(sweep < 0) q -= 12;
  if(fvg > 0) q += 10; else if(fvg < 0) q -= 10;
  if(retest > 0) q += 18; else if(retest < 0) q -= 18;
  if(structureScore > 0) q += 10; else if(structureScore < 0) q -= 10;
  return { sweep, fvg, retest, structure: structureScore, quality: Math.max(0, Math.min(100, q)), atr };
}
function signalQuality(m){
  const q = m.quality || 50;
  return q >= 75 ? "A" : q >= 60 ? "B" : q >= 45 ? "C" : "D";
}
function advancedStructure(k){
  if(!k || k.length < 30) return { bos:0, choch:0, ob:0, obHigh:0, obLow:0, structureEntry:0 };
  const c = k.map(x => ({ t:+x[0], o:+x[1], h:+x[2], l:+x[3], cl:+x[4] }));
  const last = c.at(-1);
  const atr = atrVal(k, 14) || Math.max(...c.slice(-20).map(x => x.h)) - Math.min(...c.slice(-20).map(x => x.l));
  const prevHigh = Math.max(...c.slice(-20, -1).map(x => x.h));
  const prevLow  = Math.min(...c.slice(-20, -1).map(x => x.l));
  const bos = last.cl > prevHigh ? 1 : last.cl < prevLow ? -1 : 0;
  const e20 = ema(c.map(x => x.cl), 20).at(-1);
  const e50 = ema(c.map(x => x.cl), 50).at(-1);
  const trendUp = e20 > e50;
  const choch = (trendUp && last.cl < prevLow) ? -1 : (!trendUp && last.cl > prevHigh) ? 1 : 0;
  let ob = 0, obHigh = 0, obLow = 0;
  for(let i = c.length - 3; i >= Math.max(0, c.length - 20); i--){
    const bar = c[i], next = c[i+1];
    if(!bar || !next) continue;
    const body = Math.abs(next.cl - next.o);
    if(body > atr*1.2){
      if(next.cl > next.o && bar.cl < bar.o){ ob = 1; obHigh = bar.h; obLow = bar.l; break; }
      if(next.cl < next.o && bar.cl > bar.o){ ob = -1; obHigh = bar.h; obLow = bar.l; break; }
    }
  }
  const structureEntry = last.cl;
  return { bos, choch, ob, obHigh, obLow, structureEntry };
}

/* ---------- Journal ---------- */
const JOURNAL_KEY = "ces_v9_journal";
function journal(){ return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]"); }
function saveSignal(x){
  if(!["TRIGGER","CONFIRMED"].includes(x.phase)) return;
  const h = journal();
  const entry = (x.levels.low + x.levels.high)/2;
  const id = x.symbol + "_" + Math.floor(Date.now()/300000) + "_" + Math.round(entry*1000);
  if(h.some(z => z.id === id)) return;
  h.unshift({
    id, time: Date.now(), symbol: x.symbol, phase: x.phase, score: x.score,
    entry, sl: x.levels.invalid, tp1: x.levels.tp1, tp2: x.levels.tp2, tp3: x.levels.tp3,
    status: "OPEN", resultR: null, resultAt: null, hit: null
  });
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(h.slice(0, 500)));
  if(C.journalApi) cloudRequest("/journal/signal", "POST", h[0]).catch(() => {});
}
function classifyJournalTrade(x, k){
  let status = "OPEN", hit = null, resultR = null, resultAt = null;
  const bars = k.filter(q => q.t > x.time);
  for(const q of bars){
    if(q.l <= x.sl){ status = "SL"; hit = "SL"; resultR = (x.sl - x.entry)/(x.entry - x.sl); resultAt = q.t; break; }
    if(q.h >= x.tp3){ status = "TP3"; hit = "TP3"; resultR = (x.tp3 - x.entry)/(x.entry - x.sl); resultAt = q.t; break; }
    if(q.h >= x.tp2){ status = "TP2"; hit = "TP2"; resultR = (x.tp2 - x.entry)/(x.entry - x.sl); resultAt = q.t; break; }
    if(q.h >= x.tp1){ status = "TP1"; hit = "TP1"; resultR = (x.tp1 - x.entry)/(x.entry - x.sl); resultAt = q.t; break; }
  }
  const last = k.at(-1)?.t || Date.now();
  if(status === "OPEN" && last - x.time >= 24*60*60*1000){
    status = "EXPIRED"; hit = "TIME";
    resultR = (k.at(-1).c - x.entry)/(x.entry - x.sl);
    resultAt = last;
  }
  return { status, hit, resultR, resultAt };
}
async function updateJournal(){
  let h = journal(), changed = false;
  for(const x of h.slice(0, 250)){
    if(x.status !== "OPEN") continue;
    try{
      const k = await klines(x.symbol, "15m", 120);
      const r = classifyJournalTrade(x, k);
      if(r.status !== "OPEN"){ Object.assign(x, r); changed = true; }
    }catch(e){}
  }
  if(changed) localStorage.setItem(JOURNAL_KEY, JSON.stringify(h));
  if(changed && C.journalApi) syncJournal();
  renderJournal();
}
function renderJournal(){
  const h = journal();
  const done = h.filter(x => x.status !== "OPEN");
  const wins = done.filter(x => x.resultR > 0);
  const net = done.reduce((s, x) => s + (Number(x.resultR) || 0), 0);
  const avg = done.length ? net/done.length : 0;
  const winRate = done.length ? wins.length/done.length*100 : 0;
  $("journalStats").innerHTML = [
    ["Signals", h.length], ["Closed", done.length], ["Open", h.filter(x => x.status === "OPEN").length],
    ["Win Rate", done.length ? winRate.toFixed(1) + "%" : "—"],
    ["Net R", done.length ? net.toFixed(2) : "—"],
    ["Avg R", done.length ? avg.toFixed(3) : "—"]
  ].map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join("");
  renderPerformance();
  $("journalTable").innerHTML = h.slice(0, 150).map(x => {
    const cls = x.status === "SL" ? "j-loss" : x.status.startsWith("TP") ? "j-tp" : "j-open";
    const age = Math.max(0, (Date.now() - x.time)/3600000);
    return `<tr><td>${new Date(x.time).toLocaleString("fa-IR")}</td><td>${x.symbol.replace("USDT","")}</td>
      <td>${x.phase}</td><td>${x.score.toFixed(1)}</td><td>${n(x.entry)}</td><td>${n(x.sl)}</td>
      <td>${n(x.tp1)}</td><td>${n(x.tp2)}</td><td>${n(x.tp3)}</td>
      <td class="${cls}">${x.status}</td><td>${x.resultR == null ? "—" : x.resultR.toFixed(2)}</td><td>${age.toFixed(1)}h</td></tr>`;
  }).join("") || `<tr><td colspan="12" class="muted">Journal هنوز سیگنالی ندارد.</td></tr>`;
}
function renderPerformance(){
  const h = journal();
  const closed = h.filter(x => x.status !== "OPEN" && Number.isFinite(+x.resultR));
  const net = closed.reduce((s, x) => s + (+x.resultR || 0), 0);
  let eq = 0, peak = 0, maxdd = 0;
  [...closed].sort((a, b) => a.time - b.time).forEach(x => {
    eq += +x.resultR || 0;
    peak = Math.max(peak, eq);
    maxdd = Math.max(maxdd, peak - eq);
  });
  const wins = closed.filter(x => +x.resultR > 0).length;
  const w = closed.filter(x => x.resultR > 0).reduce((a, x) => a + x.resultR, 0);
  const l = -closed.filter(x => x.resultR < 0).reduce((a, x) => a + x.resultR, 0);
  $("perfStats").innerHTML = [
    ["Closed", closed.length],
    ["Win Rate", closed.length ? (wins/closed.length*100).toFixed(1) + "%" : "—"],
    ["Net R", net.toFixed(2)],
    ["Avg R", closed.length ? (net/closed.length).toFixed(3) : "—"],
    ["Max DD", maxdd.toFixed(2) + "R"],
    ["Profit Factor", l ? (w/l).toFixed(2) : "—"]
  ].map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join("");
  const phases = ["TRIGGER", "CONFIRMED"];
  $("phasePerf").innerHTML = phases.map(ph => {
    const a = closed.filter(x => x.phase === ph);
    const w2 = a.filter(x => x.resultR > 0).length;
    const n2 = a.reduce((s, x) => s + (+x.resultR || 0), 0);
    return `<div class="stat"><small>${ph}</small><b>${a.length ? ((w2/a.length)*100).toFixed(1) + "% | " + n2.toFixed(2) + "R" : "—"}</b></div>`;
  }).join("");
  const by = {};
  closed.forEach(x => {
    (by[x.symbol] ??= { n:0, w:0, r:0 });
    by[x.symbol].n++;
    by[x.symbol].w += x.resultR > 0 ? 1 : 0;
    by[x.symbol].r += +x.resultR || 0;
  });
  const arr = Object.entries(by).sort((a, b) => b[1].r - a[1].r);
  $("symbolPerf").innerHTML = `<table><thead><tr><th>Symbol</th><th>N</th><th>Win%</th><th>Net R</th></tr></thead><tbody>` +
    arr.map(([sym, v]) => `<tr><td>${sym.replace("USDT","")}</td><td>${v.n}</td><td>${(v.w/v.n*100).toFixed(1)}%</td><td>${v.r.toFixed(2)}</td></tr>`).join("") +
    `</tbody></table>`;
}
function exportJournal(){
  const h = journal();
  const rows = [["time","symbol","phase","score","entry","sl","tp1","tp2","tp3","status","resultR","resultAt"]];
  h.forEach(x => rows.push([new Date(x.time).toISOString(), x.symbol, x.phase, x.score, x.entry, x.sl, x.tp1, x.tp2, x.tp3, x.status, x.resultR ?? "", x.resultAt ? new Date(x.resultAt).toISOString() : ""]));
  const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "crypto-signal-journal-v13.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Cloud Journal ---------- */
async function cloudRequest(path, method = "GET", body = null){
  if(!C.journalApi) return null;
  const opt = { method, headers: { "content-type": "application/json" } };
  if(C.journalApiKey) opt.headers["x-api-key"] = C.journalApiKey;
  if(body) opt.body = JSON.stringify(body);
  const r = await fetch(C.journalApi.replace(/\/$/, "") + path, opt);
  if(!r.ok) throw Error("Cloud " + r.status);
  return r.json();
}
async function syncJournal(){
  if(!C.journalApi){
    $("cloudStatus").textContent = "Local Journal — API تنظیم نشده";
    $("cloudStatus").className = "muted sync-off";
    return;
  }
  try{
    const h = journal();
    const out = await cloudRequest("/journal/sync", "POST", { signals: h });
    $("cloudStatus").textContent = `Cloud synced: ${out?.count ?? h.length}`;
    $("cloudStatus").className = "sync-ok";
  }catch(e){
    $("cloudStatus").textContent = "Cloud Sync Error";
    $("cloudStatus").className = "sync-bad";
  }
}
async function loadCloudJournal(){
  if(!C.journalApi) return;
  try{
    const out = await cloudRequest("/journal");
    if(Array.isArray(out?.signals)){
      const local = journal();
      const map = new Map(local.map(x => [x.id, x]));
      out.signals.forEach(x => map.set(x.id, { ...map.get(x.id), ...x }));
      const merged = [...map.values()].sort((a, b) => b.time - a.time).slice(0, 1000);
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(merged));
      renderJournal();
      renderPerformance();
    }
    $("cloudStatus").textContent = "Cloud Journal connected";
    $("cloudStatus").className = "sync-ok";
  }catch(e){
    $("cloudStatus").textContent = "Cloud unavailable";
    $("cloudStatus").className = "sync-bad";
  }
}

/* ---------- Radar ---------- */
async function runRadar(){
  $("radarTable").innerHTML = `<tr><td colspan="7">در حال دریافت داده...</td></tr>`;
  const out = [];
  for(const symbol of C.symbols){
    try{
      const [ls, pos, oi, fund] = await Promise.all([longShort(symbol), topPosition(symbol), oiNow(symbol), funding(symbol)]);
      const prev = +localStorage.getItem("radar_oi_" + symbol) || oi;
      const oid = prev ? ((oi - prev)/prev*100) : 0;
      localStorage.setItem("radar_oi_" + symbol, String(oi));
      let p = ls.long > 55 ? "LONG HEAVY" : ls.short > 55 ? "SHORT HEAVY" : "BALANCED";
      out.push({ symbol, ls, pos, oid, fund, p });
    }catch{}
  }
  out.sort((a, b) => Math.abs(b.ls.long - 50) - Math.abs(a.ls.long - 50));
  $("radarTable").innerHTML = out.map(x => `<tr><td>${x.symbol.replace("USDT","")}</td><td class="radar-long">${x.ls.long.toFixed(1)}%</td><td class="radar-short">${x.ls.short.toFixed(1)}%</td><td>${x.ls.ratio.toFixed(2)}</td><td>${x.oid.toFixed(2)}%</td><td>${(x.fund*100).toFixed(4)}%</td><td>${x.p}</td></tr>`).join("");
  $("radarSummary").innerHTML = [
    ["Long Heavy", out.filter(x => x.p === "LONG HEAVY").length],
    ["Short Heavy", out.filter(x => x.p === "SHORT HEAVY").length],
    ["Balanced", out.filter(x => x.p === "BALANCED").length],
    ["OI Δ avg", out.length ? (out.reduce((s, x) => s + x.oid, 0)/out.length).toFixed(2) + "%" : "—"]
  ].map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join("");
}

/* ---------- Analyze ---------- */
async function analyze(symbol, btcRegime){
  const [k15, k1, k4, oi, fund, d, ls] = await Promise.all([
    klines(symbol, "15m"), klines(symbol, "1h"), klines(symbol, "4h"),
    oiNow(symbol), funding(symbol), depth(symbol), longShort(symbol)
  ]);
  const v = volRatio(k15), comp = compression(k15), bp = buyPressure(k15);
  const br = breakoutScore(k15), r = rsi(k15.map(x => x.c));
  const t1 = trend(k1), t4 = trend(k4), book = bookPressure(d);
  const prev = +localStorage.getItem("oi_" + symbol) || oi;
  const oid = prev ? ((oi - prev)/prev*100) : 0;
  localStorage.setItem("oi_" + symbol, String(oi));
  const fake = (br > 0.15 && (!t1 || bp < 50)) ? 70 : Math.max(5, Math.min(90, 50 - br*20 + (r > 78 ? 20 : 0)));
  let score = 0;
  score += t1 && t4 ? C.weights.mtf : t1 ? 10 : 0;
  score += C.weights.compression * (comp/100);
  score += C.weights.volume * Math.min(2, v)/2;
  score += C.weights.oi * Math.max(0, Math.min(1, (oid + 1)/4));
  score += C.weights.book * Math.max(0, Math.min(1, (book - 45)/20));
  score += C.weights.breakout * Math.max(0, Math.min(1, (br + 0.2)/0.8));
  score += C.weights.momentum * Math.max(0, Math.min(1, (r - 45)/30));
  score += C.weights.funding * (fund < 0.001 ? 1 : 0.3);
  score += C.weights.btc * (btcRegime === "BULL" ? 1 : btcRegime === "NEUTRAL" ? 0.6 : 0.1);
  score += C.weights.liquidity;
  score = Math.max(0, Math.min(100, score));
  const setup = comp >= 45 && v >= 1.15 && t1 && btcRegime !== "BEAR";
  const trigger = setup && v >= 1.5 && oid > -0.3 && book >= 52;
  const confirmed = trigger && br >= 0.15 && r < 78 && t4;
  const phase = confirmed ? "CONFIRMED" : trigger ? "TRIGGER" : setup ? "SETUP" : "WATCH";
  const confirmations = [comp >= 55, v >= 1.5, oid > 0, book >= 52, br >= 0.15, t1, t4, r < 78].filter(Boolean).length;
  return { symbol, score, phase, comp, v, oid, bp: book, br, r, t1, t4, fund, fake, oi, ls, levels: entryLevels(k15, phase), k15, k1, k4, confirmations };
}
async function btcRegime(){
  const k = await klines("BTCUSDT", "1h", 120);
  const c = k.map(x => x.c);
  const e20 = ema(c, 20).at(-1), e50 = ema(c, 50).at(-1);
  const reg = e20 > e50 && linSlope(c, 30) > 0 ? "BULL" : e20 < e50 && linSlope(c, 30) < 0 ? "BEAR" : "NEUTRAL";
  $("btcPrice").textContent = c.at(-1).toLocaleString("en-US", { maximumFractionDigits: 2 });
  $("btcRegime").textContent = reg;
  return reg;
}
function n(x){ return Number.isFinite(x) ? x.toFixed(x > 100 ? 2 : 4) : "—"; }

/* ---------- Render Signals ---------- */
function render(){
  const min = +$("minScore").value || 0;
  const list = results.filter(x => x.score >= min).sort((a, b) => b.score - a.score);
  $("signals").innerHTML = list.map(x => {
    const rr1 = (x.levels.tp1 - x.levels.center) / x.levels.r;
    const rr2 = (x.levels.tp2 - x.levels.center) / x.levels.r;
    const rr3 = (x.levels.tp3 - x.levels.center) / x.levels.r;
    return `<tr onclick="selectSymbol('${x.symbol}')">
      <td><b>${x.symbol.replace("USDT","")}</b></td>
      <td><span class="phase ${x.phase}">${x.phase}</span></td>
      <td><b>${x.score.toFixed(1)}</b></td>
      <td>${n(x.levels.low)} – ${n(x.levels.high)}</td>
      <td>${n(x.levels.invalid)}</td>
      <td>${n(x.levels.tp1)}</td><td>${n(x.levels.tp2)}</td><td>${n(x.levels.tp3)}</td>
      <td>1:${rr1.toFixed(0)} / 1:${rr2.toFixed(0)} / 1:${rr3.toFixed(0)}</td>
      <td>${x.confirmations}/8</td>
      <td class="${x.fake > 60 ? 'bad' : 'good'}">${x.fake.toFixed(0)}%</td></tr>`;
  }).join("") || `<tr><td colspan="11" class="muted">سیگنالی با این حداقل امتیاز وجود ندارد.</td></tr>`;
  $("signalCount").textContent = results.filter(x => x.phase === "TRIGGER" || x.phase === "CONFIRMED").length;
}
window.selectSymbol = function(sym){
  selected = results.find(x => x.symbol === sym);
  if(!selected) return;
  const x = selected;
  $("selectedTitle").textContent = x.symbol;
  $("detail").classList.remove("empty");
  $("detail").innerHTML = [
    ["Phase", x.phase], ["Score", x.score.toFixed(1)], ["Compression", x.comp.toFixed(1)],
    ["Volume", x.v.toFixed(2) + "x"], ["OI Δ", x.oid.toFixed(2) + "%"],
    ["Buy Pressure", x.bp.toFixed(1) + "%"], ["Breakout", x.br.toFixed(2) + " ATR"],
    ["RSI", x.r.toFixed(1)], ["Funding", (x.fund*100).toFixed(4) + "%"],
    ["Fake Risk", x.fake.toFixed(1) + "%"],
    ["Entry Zone", n(x.levels.low) + " – " + n(x.levels.high)],
    ["Invalidation", n(x.levels.invalid)],
    ["TP1", n(x.levels.tp1)], ["TP2", n(x.levels.tp2)], ["TP3", n(x.levels.tp3)],
    ["Confirmations", x.confirmations + "/8"]
  ].map(([a, b]) => `<div class="metric"><span class="muted">${a}</span><b>${b}</b></div>`).join("");
  const phases = ["WATCH", "SETUP", "TRIGGER", "CONFIRMED"];
  const idx = phases.indexOf(x.phase);
  $("pipeline").innerHTML = phases.map((p, i) => `<div class="${i <= idx ? 'active' : ''}">${p}</div>`).join("");
  $("reasons").innerHTML = `15m: volume ${x.v.toFixed(2)}x، compression ${x.comp.toFixed(0)}، breakout ${x.br.toFixed(2)} ATR<br>
  MTF: 1h ${x.t1 ? "صعودی" : "خنثی/نزولی"}، 4h ${x.t4 ? "صعودی" : "خنثی/نزولی"}<br>
  ساختار: buy pressure ${x.bp.toFixed(1)}%، OI Δ ${x.oid.toFixed(2)}%، RSI ${x.r.toFixed(1)}`;
};

/* ---------- Scan ---------- */
async function scan(){
  $("status").textContent = "در حال اسکن...";
  try{
    cache.clear();
    const btc = await btcRegime();
    results = [];
    for(let i = 0; i < C.symbols.length; i++){
      try{ results.push(await analyze(C.symbols[i], btc)); }
      catch(e){ console.warn(C.symbols[i], e); }
      $("status").textContent = `${i+1}/${C.symbols.length}`;
    }
    $("lastScan").textContent = new Date().toLocaleTimeString("fa-IR");
    results.filter(x => x.phase === "TRIGGER" || x.phase === "CONFIRMED").forEach(saveSignal);
    render();
    renderJournal();
    if(results.length) selectSymbol(results.sort((a, b) => b.score - a.score)[0].symbol);
    $("status").textContent = "تکمیل شد";
  }catch(e){
    $("status").textContent = "خطا: " + e.message;
  }
}

/* ---------- Backtest ---------- */
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function backtestSymbol(symbol, tf, days, fee, slip){
  const perDay = { "15m":96, "1h":24, "4h":6 }[tf];
  const limit = Math.min(1500, days*perDay + 80);
  const k = await klines(symbol, tf, limit);
  let trades = [], equity = 0, peak = 0, dd = 0;
  const start = Math.max(60, k.length - days*perDay - 1);
  for(let i = start; i < k.length - 25; i++){
    const hist = k.slice(0, i + 1);
    const c = hist.map(x => x.c);
    const a = atr(hist, 14), vr = volRatio(hist), rs = rsi(c);
    const br = breakoutScore(hist), tr = trend(hist);
    const comp = compression(hist), t4 = tf === "4h" ? tr : true;
    const setup = comp >= 45 && vr >= 1.15 && tr;
    const trigger = setup && vr >= 1.5;
    const confirmed = trigger && br >= 0.15 && rs < 78 && t4;
    if(!confirmed) continue;
    const entry = k[i+1].o * (1 + slip/100);
    const invalid = Math.min(Math.min(...hist.slice(-12).map(z => z.l)), entry - 0.9*a);
    const R = Math.max(0.15*a, entry - invalid);
    const tp1 = entry + R, tp2 = entry + 2*R, tp3 = entry + 3*R;
    let resultR = -1, hit = 0;
    for(let j = i + 1; j < Math.min(k.length, i + 25); j++){
      const q = k[j];
      if(q.l <= invalid){ resultR = -1; hit = 0; break; }
      if(q.h >= tp3){ resultR = 3; hit = 3; break; }
      if(q.h >= tp2){ resultR = 2; hit = 2; break; }
      if(q.h >= tp1){ resultR = 1; hit = 1; break; }
    }
    resultR -= fee/100 * entry / R * 2;
    trades.push({ r: resultR, hit });
    equity += resultR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
    i += 2;
  }
  const wins = trades.filter(t => t.r > 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = -trades.filter(t => t.r < 0).reduce((s, t) => s + t.r, 0);
  return {
    symbol, trades: trades.length,
    win: trades.length ? 100*wins.length/trades.length : 0,
    avg: trades.length ? equity/trades.length : 0,
    net: equity, pf: grossLoss ? grossWin/grossLoss : 0, dd,
    tp1: trades.filter(t => t.hit >= 1).length,
    tp2: trades.filter(t => t.hit >= 2).length,
    tp3: trades.filter(t => t.hit >= 3).length
  };
}
async function runBacktest(){
  const tf = $("btTf").value, days = +$("btDays").value;
  const fee = +$("fee").value, slip = +$("slip").value;
  $("btTable").innerHTML = "";
  $("btSummary").innerHTML = "";
  $("btProgress span").style.width = "0%";
  let all = [];
  for(let i = 0; i < C.symbols.length; i++){
    try{ all.push(await backtestSymbol(C.symbols[i], tf, days, fee, slip)); }
    catch(e){ console.warn("BT", C.symbols[i], e); }
    $("btProgress span").style.width = ((i+1)/C.symbols.length*100) + "%";
    await sleep(40);
  }
  $("btTable").innerHTML = all.sort((a, b) => b.net - a.net).map(x => `<tr><td>${x.symbol.replace("USDT","")}</td><td>${x.trades}</td><td>${x.win.toFixed(1)}%</td><td>${x.avg.toFixed(2)}R</td><td>${x.net.toFixed(2)}R</td><td>${x.pf.toFixed(2)}</td><td>${x.dd.toFixed(2)}R</td><td>${x.tp1}</td><td>${x.tp2}</td><td>${x.tp3}</td></tr>`).join("");
  const T = all.reduce((s, x) => s + x.trades, 0);
  const net = all.reduce((s, x) => s + x.net, 0);
  const wins = all.reduce((s, x) => s + x.win*x.trades/100, 0);
  const avg = T ? net/T : 0;
  $("btSummary").innerHTML = [
    ["Trades", T],
    ["Win Rate", T ? (100*wins/T).toFixed(1) + "%" : "—"],
    ["Net R", net.toFixed(2)],
    ["Avg R", avg.toFixed(3)],
    ["Symbols", all.length],
    ["Fee+Slip", fee + "% + " + slip + "%"]
  ].map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join("");
}

/* ============================================================
   Terminal v13 — TradingView Lightweight Charts + MTF Map
   ============================================================ */
let tvChart = null, tvCandles = null, tvPriceLines = [];
let terminalBars = [], terminalInfo = {};

function initTVChart(){
  const container = $("tvChart");
  if(!container || !window.LightweightCharts) return;
  if(tvChart) return;
  tvChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 430,
    layout: { background: { color: '#07101f' }, textColor: '#d1d4dc', fontSize: 11 },
    grid: { vertLines: { color: '#1a2740' }, horzLines: { color: '#1a2740' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#1d2a42' },
    rightPriceScale: { borderColor: '#1d2a42' },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });
  tvCandles = tvChart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350'
  });
  window.addEventListener("resize", () => {
    if(tvChart && container) tvChart.applyOptions({ width: container.clientWidth });
  });
}
function clearPriceLines(){
  tvPriceLines.forEach(l => { try{ tvCandles.removePriceLine(l); }catch(e){} });
  tvPriceLines = [];
}
function addPriceLine(price, color, title, style = LightweightCharts.LineStyle.Solid){
  if(!Number.isFinite(price)) return;
  const line = tvCandles.createPriceLine({
    price, color, lineWidth: 1, lineStyle: style,
    axisLabelVisible: true, title
  });
  tvPriceLines.push(line);
}
function biasFromStructure(s){
  const bull = [s.sweep > 0, s.fvg > 0, s.retest > 0, s.structure > 0].filter(Boolean).length;
  const bear = [s.sweep < 0, s.fvg < 0, s.retest < 0, s.structure < 0].filter(Boolean).length;
  if(bull >= 2 && bull > bear) return "BULLISH";
  if(bear >= 2 && bear > bull) return "BEARISH";
  return "NEUTRAL";
}
async function computeMTFStructure(symbol){
  const timeframes = ["15m", "1h", "4h"];
  const map = {};
  for(const tf of timeframes){
    const k = await klines(symbol, tf, 120);
    const raw = k.map(a => [a.t, a.o, a.h, a.l, a.c, a.v]);
    const s = structureMetrics(raw);
    map[tf] = { bias: biasFromStructure(s), ...s };
  }
  return map;
}
function renderMTFMap(map){
  const el = $("mtfMap");
  if(!el) return;
  const tfs = ["15m", "1h", "4h"];
  el.innerHTML = tfs.map(tf => {
    const m = map[tf];
    const biasClass = m.bias === "BULLISH" ? "bull" : m.bias === "BEARISH" ? "bear" : "neut";
    const cardClass = m.bias === "BULLISH" ? "bullish" : m.bias === "BEARISH" ? "bearish" : "neutral";
    const fvgDir = m.fvg > 0 ? "Bull" : m.fvg < 0 ? "Bear" : "—";
    const retestDir = m.retest > 0 ? "Bull" : m.retest < 0 ? "Bear" : "—";
    const sweepDir = m.sweep > 0 ? "Bull" : m.sweep < 0 ? "Bear" : "—";
    return `<div class="mtf-tf ${cardClass}">
      <div class="label">${tf.toUpperCase()}</div>
      <div class="bias ${biasClass}">${m.bias}</div>
      <div class="detail">
        Quality: ${m.quality.toFixed(0)}<br>
        FVG: ${fvgDir} · Retest: ${retestDir}<br>
        Sweep: ${sweepDir}
      </div>
    </div>`;
  }).join("");
  const biases = tfs.map(tf => map[tf].bias);
  const bulls = biases.filter(b => b === "BULLISH").length;
  const bears = biases.filter(b => b === "BEARISH").length;
  let alignClass = "mixed", alignText = "";
  if(bulls === 3){ alignClass = "strong"; alignText = "🟢 هم‌راستایی کامل صعودی — 15m + 1H + 4H BULLISH"; }
  else if(bears === 3){ alignClass = "strong"; alignText = "🔴 هم‌راستایی کامل نزولی — 15m + 1H + 4H BEARISH"; }
  else if(bulls === 2 && bears === 0){ alignClass = "mixed"; alignText = "🟡 تمایل صعودی — دو تایم‌فریم Bullish"; }
  else if(bears === 2 && bulls === 0){ alignClass = "mixed"; alignText = "🟡 تمایل نزولی — دو تایم‌فریم Bearish"; }
  else if(bulls > 0 && bears > 0){ alignClass = "weak"; alignText = "⚠️ تضاد ساختاری — 15m: " + biases[0] + " / 1H: " + biases[1] + " / 4H: " + biases[2]; }
  else { alignClass = "mixed"; alignText = "⚪ ساختار خنثی در همه تایم‌فریم‌ها"; }
  const alignEl = document.createElement("div");
  alignEl.className = "mtf-alignment " + alignClass;
  alignEl.textContent = alignText;
  el.appendChild(alignEl);
}
async function loadTerminal(){
  const sym = $("terminalSymbol")?.value;
  if(!sym) return;
  const tf = $("terminalTf")?.value || "15m";
  try{
    const k = await klines(sym, tf, 200);
    terminalBars = k.map(x => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c }));
    if(!tvChart) initTVChart();
    if(tvCandles){
      const data = terminalBars.map(b => ({
        time: Math.floor(b.t / 1000),
        open: b.o, high: b.h, low: b.l, close: b.c
      }));
      tvCandles.setData(data);
      tvChart.timeScale().fitContent();
    }
    const raw = k.map(a => [a.t, a.o, a.h, a.l, a.c, a.v]);
    const st = structureMetrics(raw);
    const a = advancedStructure(raw);
    const price = terminalBars.at(-1).c;
    const atr = atrVal(raw, 14) || price * 0.01;
    const entry = a.structureEntry || price;
    const sl = (a.ob > 0 && a.obLow)
      ? Math.min(a.obLow - atr*0.15, entry - atr*0.5)
      : Math.min(...terminalBars.slice(-12).map(x => x.l)) - atr*0.15;
    const risk = Math.max(entry - sl, atr*0.35);
    terminalInfo = { entry, sl, tp1: entry + risk, tp2: entry + 2*risk, tp3: entry + 3*risk, obHigh: a.obHigh, obLow: a.obLow };
    clearPriceLines();
    addPriceLine(entry, "#f0c96b", "Entry");
    addPriceLine(sl, "#ff7182", "SL");
    addPriceLine(entry + risk, "#65a8ff", "TP1", LightweightCharts.LineStyle.Dashed);
    addPriceLine(entry + 2*risk, "#65a8ff", "TP2", LightweightCharts.LineStyle.Dashed);
    addPriceLine(entry + 3*risk, "#65a8ff", "TP3", LightweightCharts.LineStyle.Dashed);
    $("terminalSummary").innerHTML = [
      ["Quality", signalQuality(st)],
      ["BOS", a.bos > 0 ? "Bullish" : a.bos < 0 ? "Bearish" : "—"],
      ["CHOCH", a.choch > 0 ? "Bullish" : a.choch < 0 ? "Bearish" : "—"],
      ["OB", a.ob > 0 ? "Bullish" : a.ob < 0 ? "Bearish" : "—"],
      ["FVG", st.fvg > 0 ? "Bullish" : st.fvg < 0 ? "Bearish" : "—"],
      ["Retest", st.retest > 0 ? "Bullish" : st.retest < 0 ? "Bearish" : "—"]
    ].map(x => `<div class="stat"><small>${x[0]}</small><b>${x[1]}</b></div>`).join("");
    $("terminalLevels").innerHTML = [
      ["Entry", entry], ["SL", sl],
      ["TP1", entry + risk], ["TP2", entry + 2*risk], ["TP3", entry + 3*risk]
    ].map(x => `<div class="stat"><small>${x[0]}</small><b>${x[1].toFixed(6)}</b></div>`).join("");
    const mtfMap = await computeMTFStructure(sym);
    renderMTFMap(mtfMap);
  }catch(e){
    console.error("Terminal load error:", e);
    $("terminalSummary").innerHTML = `<div class="stat"><small>Error</small><b>${e.message}</b></div>`;
  }
}
function initTerminal(){
  const sel = $("terminalSymbol");
  if(!sel) return;
  const syms = C.symbols || [];
  sel.innerHTML = syms.map(x => `<option value="${x}">${x.replace("USDT","")}</option>`).join("");
  $("terminalLoad").onclick = loadTerminal;
  $("terminalTf").onchange = loadTerminal;
  sel.onchange = loadTerminal;
}
function updateHistory(){
  try{
    renderJournal();
    renderPerformance();
  }catch(e){ console.warn("updateHistory", e); }
}

/* ---------- Event wiring ---------- */
$("scanBtn").onclick = scan;
$("btBtn").onclick = runBacktest;
$("runBt").onclick = runBacktest;
$("minScore").oninput = render;
$("radarBtn").onclick = runRadar;
$("journalRefresh").onclick = updateJournal;
$("syncJournal").onclick = syncJournal;
$("journalExport").onclick = exportJournal;
$("clearHistory").onclick = () => {
  if(confirm("تاریخچه ژورنال پاک شود؟")){
    localStorage.removeItem(JOURNAL_KEY);
    renderJournal();
  }
};

/* ---------- Boot ---------- */
renderJournal();
loadCloudJournal();
initTerminal();
runRadar();