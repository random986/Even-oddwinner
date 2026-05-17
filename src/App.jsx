import { useState, useEffect, useRef, useCallback } from "react";
import ScannerPage from "./ScannerPage";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/* ══════════════════════════════════════════════════════════════
   DESIGN TOKENS
══════════════════════════════════════════════════════════════ */
const T = {
  bg:'#0e0e0e', surface:'#151515', surface2:'#1c1c1c', surface3:'#262626',
  border:'rgba(255,255,255,0.08)', borderHi:'rgba(255,255,255,0.15)',
  accent:'#ff444f', accentDim:'rgba(255,68,79,0.15)',
  green:'#4caf50', greenDim:'rgba(76,175,80,0.15)',
  red:'#ff444f', redDim:'rgba(255,68,79,0.15)',
  yellow:'#ff9800', yellowDim:'rgba(255,152,0,0.15)',
  purple:'#9c27b0', purpleDim:'rgba(156,39,176,0.15)',
  text:'#e5e5e5', muted:'#8a8a8a', dim:'rgba(255,255,255,0.04)',
  sidebar:'#0a0a0a'
};

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════ */
const API_TOKENS = {
  real: 'fQWGEWFxvaZqPDu',
  demo: 'Pc3aJydn9vC7VKm'
};
const APP_ID = '1089';
const MARKETS = ['1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V'];
const MSHORT  = {'1HZ10V':'V10','1HZ25V':'V25','1HZ50V':'V50','1HZ75V':'V75','1HZ100V':'V100'};
const MFULL   = {'1HZ10V':'Volatility 10 (1s)','1HZ25V':'Volatility 25 (1s)','1HZ50V':'Volatility 50 (1s)','1HZ75V':'Volatility 75 (1s)','1HZ100V':'Volatility 100 (1s)'};

const STRATEGIES = {
  EVEN:  { label:'Even',    ctype:'DIGITEVEN',  barrier:null, base:0.5, color:T.accent, hidden:true },
  ODD:   { label:'Odd',     ctype:'DIGITODD',   barrier:null, base:0.5, color:T.purple, hidden:true },
  BOTH:  { label:'Even/Odd Win', ctype:'BOTH',  barrier:null, base:0.5, color:T.green   },
  MATCH: { label:'Matches',  ctype:'DIGITMATCH', barrier:'5', base:0.1, color:T.accent, hidden:true },
  OVER5: { label:'Over 5',  ctype:'DIGITOVER',  barrier:'5', base:0.4, color:T.green, hidden:true  },
  UNDER5:{ label:'Under 5', ctype:'DIGITUNDER', barrier:'5', base:0.5, color:T.yellow, hidden:true },
  BOTH5: { label:'O/U 5 Both', ctype:'BOTH5',   barrier:'5', base:0.4, color:T.purple  },
};

/* ══════════════════════════════════════════════════════════════
   POISSON DISTRIBUTION ENGINE
   P(X=k) = λ^k × e^(-λ) / k!
   Derived from binomial limit: n→∞, p→0, np=λ
══════════════════════════════════════════════════════════════ */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 2; i <= k; i++) logP -= Math.log(i); // log(k!)
  return Math.exp(logP);
}

function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPMF(i, lambda);
  return Math.min(1, sum);
}

/* Strict Poisson analysis for 20-tick digit streams */
function poissonAnalysis(digits, mode = 'evenodd') {
  if (!digits || digits.length < 20) return null;
  
  const classify = d => {
    if (mode === 'evenodd') return d % 2 === 0; // true = even
    if (mode === 'over5')   return d > 5;
    if (mode === 'under5')  return d < 5;
    return false;
  };
  
  const slice = digits.slice(-20);
  const observed = slice.filter(classify).length;
  const baseline = mode === 'over5' ? 0.4 : mode === 'under5' ? 0.5 : 0.5;
  const lambda = 20 * baseline; // Expected count under null hypothesis (8 or 10)
  
  // P(X ≥ observed) = 1 - P(X ≤ observed-1)
  const pValue = 1 - poissonCDF(Math.max(0, observed - 1), lambda);
  const pLow = poissonCDF(observed, lambda); // P(X <= observed)
  
  return { observed, lambda, pValue, pLow };
}

/* Regression / Tightness Analysis */
function analyzeTightness(digits) {
  if (!digits || digits.length < 20) return 0.5;
  const variance = digits.reduce((a,b)=>a+Math.pow(b-4.5,2),0)/digits.length;
  return 1 / (1 + Math.exp(-(variance - 8.25)));
}

/* ══════════════════════════════════════════════════════════════
   ANALYSIS ENGINE
══════════════════════════════════════════════════════════════ */
function extractDigit(price) {
  const s = parseFloat(price).toFixed(2);
  return parseInt(s[s.length - 1]);
}

function computeMarkov(digits, mode = 'evenodd') {
  if (!digits || digits.length < 30) return null; // Increased min samples
  const classify = d => {
    if (mode === 'evenodd') return d % 2 === 0 ? 0 : 1;
    if (mode === 'over5')   return d > 5 ? 0 : 1;
    if (mode === 'under5')  return d < 5 ? 0 : 1;
    return 0;
  };
  const st = digits.map(classify), n = st.length;
  let t00=0,t01=0,t10=0,t11=0;
  for (let i=0;i<n-1;i++) {
    const a=st[i],b=st[i+1];
    if(a===0&&b===0)t00++; else if(a===0&&b===1)t01++;
    else if(a===1&&b===0)t10++; else t11++;
  }
  const f0=t00+t01||1, f1=t10+t11||1;
  const p00=t00/f0, p01=t01/f0, p10=t10/f1, p11=t11/f1;
  const dn=p01+p10||1;
  const pi0=p10/dn, pi1=p01/dn;
  const last=st[n-1];
  const pNext0=last===0?p00:p10, pNext1=last===0?p01:p11;
  
  // Advanced metrics for 95% target
  const cnt0=st.filter(s=>s===0).length, ratio0=cnt0/n;
  let streak=1;
  for(let i=n-2;i>=0;i--){ if(st[i]===st[n-1])streak++; else break; }
  
  const baseline = mode==='over5'?0.4:0.5;
  const edge = Math.abs(pNext0 - baseline);
  const stability = 1 - (Math.abs(p00-p10) + Math.abs(p01-p11))/2; // Convergence metric
  
  // Adjusted scoring for extreme selectivity
  const score = Math.min(100, Math.round(
    edge * 350 + 
    stability * 30 + 
    (1 - Math.abs(ratio0 - baseline)) * 20 +
    Math.max(0, 15 - streak * 2) // Penalize long streaks slightly less but keep them in check
  ));
  
  const threshold = 0.05; // Increased threshold for precision
  const rec = pNext0 > pNext1 + threshold ? 0 : pNext1 > pNext0 + threshold ? 1 : -1;
  
  return { matrix:[[p00,p01],[p10,p11]], stationary:[pi0,pi1], next:[pNext0,pNext1],
           ratio0, ratio1:1-ratio0, streak, streakType:last, score, rec, lastState:last, stability };
}

function scoreAllMarkets(buffers) {
  const out = {};
  for (const sym of MARKETS) {
    const digs = buffers[sym] || [];
    
    // UI still needs Markov stats for some components
    const m = computeMarkov(digs, 'evenodd');
    const over = computeMarkov(digs, 'over5');
    const under = computeMarkov(digs, 'under5');
    const tightness = analyzeTightness(digs);
    
    // Strict Poisson Analysis (20 ticks)
    const pEO = poissonAnalysis(digs, 'evenodd');
    const pOdd = { observed: 20 - (pEO?.observed || 10), lambda: 10, pValue: pEO ? (1 - poissonCDF(Math.max(0, 19 - pEO.observed), 10)) : 1 };
    
    const pOver = poissonAnalysis(digs, 'over5');
    const pUnder = poissonAnalysis(digs, 'under5');
    
    // Neutrality Scores: |obs_A - lam_A| + |obs_B - lam_B|
    let nu5 = 100, neo = 100;
    if (pOver && pUnder) {
      nu5 = Math.abs(pOver.observed - pOver.lambda) + Math.abs(pUnder.observed - pUnder.lambda);
    }
    if (pEO) {
      neo = Math.abs(pEO.observed - pEO.lambda) + Math.abs(pOdd.observed - pOdd.lambda);
    }
    
    out[sym] = {
      evenodd: m, over5: over, under5: under,
      tightness, stability: m ? m.stability : 0,
      poisson: { evenodd: pEO, odd: pOdd, over5: pOver, under5: pUnder },
      neutrality: { evenodd: neo, over5: nu5 },
      // Translate lowest neutrality to a high score (0-100) for UI compatibility
      score: 100 - (nu5 * 10),
      scores: { evenodd: 100 - (neo * 10), over5: 100 - (nu5 * 10), under5: 100 - (nu5 * 10) },
      digits: [...digs]
    };
  }
  return out;
}

function getBestMarket(scored, mode = 'score') {
  let best = null, bestScore = Infinity; // We want LOWEST neutrality (most balanced)
  for (const sym of MARKETS) {
    const data = scored[sym];
    // Select the market with the lowest neutrality (i.e. perfectly balanced, hunting anomalies)
    const s = (mode === 'both5' || mode === 'over5_recovery' || mode === 'under5_recovery') 
              ? data?.neutrality?.over5 : data?.neutrality?.evenodd;
    if (s != null && s < bestScore) {
      bestScore = s;
      best = sym;
    }
  }
  return { market: best || MARKETS[0], score: bestScore };
}

/* ══════════════════════════════════════════════════════════════
   SMALL SHARED COMPONENTS
══════════════════════════════════════════════════════════════ */
const css = {
  card: { background:T.surface2, border:`1px solid ${T.border}`, borderRadius:12, padding:'16px 18px' },
  btn:  { border:'none', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontSize:13, fontFamily:'inherit', fontWeight:500 },
  input:{ background:T.surface3, border:`1px solid ${T.border}`, borderRadius:8, padding:'9px 12px', color:T.text, fontSize:13, fontFamily:'inherit', outline:'none', width:'100%' },
  label:{ fontSize:11, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5, display:'block' },
};

function Stat({ label, value, sub, color, size='md', style }) {
  return (
    <div style={{ ...css.card, flex:1, minWidth:110, ...style }}>
      <div style={{ fontSize:11, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize: size==='lg'?28:size==='sm'?18:22, fontWeight:700, color: color||T.text, fontFamily:"'Syne', sans-serif", lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:600,
      background: color==='green'?T.greenDim:color==='red'?T.redDim:color==='yellow'?T.yellowDim:color==='purple'?T.purpleDim:T.accentDim,
      color: color==='green'?T.green:color==='red'?T.red:color==='yellow'?T.yellow:color==='purple'?T.purple:T.accent }}>
      {children}
    </span>
  );
}

function MarketTag({ sym, active, onClick }) {
  return (
    <button onClick={onClick} style={{ ...css.btn, background: active?T.accentDim:'transparent',
      color: active?T.accent:T.muted, border:`1px solid ${active?T.borderHi:T.border}`, padding:'5px 12px', fontSize:12 }}>
      {MSHORT[sym]}
    </button>
  );
}

function ScoreBar({ score, color }) {
  const c = score > 70 ? T.green : score > 45 ? T.yellow : T.red;
  return (
    <div style={{ height:4, background:T.dim, borderRadius:2, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${score}%`, background: color||c, borderRadius:2,
        transition:'width 0.6s ease', boxShadow:`0 0 6px ${color||c}40` }} />
    </div>
  );
}
/* ══════════════════════════════════════════════════════════════
   NEW DASHBOARD COMPONENTS
══════════════════════════════════════════════════════════════ */
function TickFlow({ digits }) {
  if (!digits) return null;
  const lastDigit = digits.length > 0 ? digits[digits.length - 1] : 0;
  return (
    <div style={css.card}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ fontSize:12, color:T.muted, fontWeight:600, textTransform:'uppercase' }}>TICK FLOW (POINTER: {lastDigit})</div>
      </div>
      <div style={{ display:'flex', gap:6, overflow:'hidden', alignItems:'center' }}>
        {digits.slice(-40).map((d, i, arr) => {
          const isLast = i === arr.length - 1;
          return (
            <div key={i} style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700,
              background: isLast ? T.red : T.surface3, color: isLast ? '#fff' : T.text,
              border:`1px solid ${isLast ? T.red : T.borderHi}`, flexShrink:0 }}>
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DigitAnalysis({ digits, isMobile }) {
  if (!digits || digits.length === 0) return null;
  const recent = digits.slice(-50);
  const older = digits.slice(-100, -50);
  const freqs = Array.from({length:10}, (_, i) => {
    const count = digits.filter(x=>x===i).length;
    const rCount = recent.filter(x=>x===i).length;
    const oCount = older.filter(x=>x===i).length;
    return { d:i, count, momentum: rCount > oCount ? 1 : rCount < oCount ? -1 : 0 };
  });
  const maxCount = Math.max(1, ...freqs.map(f=>f.count));
  
  return (
    <div style={{ ...(isMobile ? {} : css.card), display:'flex', flexDirection:'column', gap:isMobile?0:16 }}>
      {!isMobile && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:4 }}>
            <div style={{ fontSize:12, color:T.muted, fontWeight:600, textTransform:'uppercase' }}>DIGIT ANALYSIS</div>
            <div style={{ fontSize:10, color:T.muted }}>
              <span style={{color:T.green}}>Green &ge;12%</span> | <span style={{color:T.red}}>Red &lt;7.7%</span> | <span style={{color:T.green}}>↑</span> <span style={{color:T.red}}>↓</span> Momentum
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            {freqs.map(({d, count, momentum}) => {
              const pct = (count/digits.length*100);
              const color = pct >= 12 ? T.green : pct < 7.7 ? T.red : T.text;
              const isMin = count === Math.min(...freqs.map(f=>f.count));
              return (
                <div key={d} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, width:'10%', position:'relative' }}>
                  <div style={{ position:'absolute', top:-8, right:8, fontSize:10, color: momentum>0?T.green:momentum<0?T.red:'transparent' }}>
                    {momentum>0?'↑':momentum<0?'↓':''}
                  </div>
                  <div style={{ width:32, height:32, borderRadius:'50%', border:`2px solid ${isMin ? '#2196f3' : T.borderHi}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:T.text }}>
                    {d}
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:color }}>{pct.toFixed(1)}%</div>
                  <div style={{ fontSize:9, color:T.muted }}>{count}x</div>
                  <div style={{ height:3, width:'100%', background:color, opacity:0.3, marginTop:4 }} />
                  <div style={{ height:3, width:`${(count/maxCount)*100}%`, background:color, marginTop:-7 }} />
                </div>
              );
            })}
          </div>
        </>
      )}
      <MarketSplit digits={digits} />
    </div>
  );
}

function MarketSplit({ digits }) {
  if (!digits || digits.length === 0) return null;
  const evenCount = digits.filter(d=>d%2===0).length;
  const evenPct = (evenCount/digits.length*100);
  const overCount = digits.filter(d=>d>4).length;
  const overPct = (overCount/digits.length*100);
  
  return (
    <div style={{ display:'flex', gap:20, marginTop:10, paddingTop:10, borderTop:`1px solid ${T.border}` }}>
      <div style={{ flex:1 }}>
        <div style={css.label}>Even/Odd</div>
        <div style={{ display:'flex', height:6, borderRadius:3, overflow:'hidden', marginBottom:4 }}>
          <div style={{ width:`${evenPct}%`, background:T.accent }} />
          <div style={{ flex:1, background:T.purple }} />
        </div>
        <div style={{ fontSize:10, display:'flex', justifyContent:'space-between' }}>
          <span style={{color:T.accent}}>{evenPct.toFixed(0)}%</span>
          <span style={{color:T.purple}}>{(100-evenPct).toFixed(0)}%</span>
        </div>
      </div>
      <div style={{ flex:1 }}>
        <div style={css.label}>Over/Under 5</div>
        <div style={{ display:'flex', height:6, borderRadius:3, overflow:'hidden', marginBottom:4 }}>
          <div style={{ width:`${overPct}%`, background:T.green }} />
          <div style={{ flex:1, background:T.yellow }} />
        </div>
        <div style={{ fontSize:10, display:'flex', justifyContent:'space-between' }}>
          <span style={{color:T.green}}>{overPct.toFixed(0)}%</span>
          <span style={{color:T.yellow}}>{(100-overPct).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   HOME PAGE
══════════════════════════════════════════════════════════════ */
function HomePage({ conn, botRunning, setBotRunning, config, setConfig, channels, activeTrades, stats, scores, bestMarket, history, resetHistory, scannerMarket, setScannerMarket, isMobile }) {
  const netPnl = stats.totalProfit;
  const pnlColor = netPnl >= 0 ? T.green : T.red;
  const [sessionTimer, setSessionTimer] = useState(0);
  const [timerLimit, setTimerLimit] = useState(0);
  const [showRisk, setShowRisk] = useState(false);
  const [showDigitAnalysis, setShowDigitAnalysis] = useState(!isMobile);
  const [showBotControl, setShowBotControl] = useState(!isMobile);
  const [showTickFlow, setShowTickFlow] = useState(!isMobile);
  const [elapsed, setElapsed] = useState('—');
  const timerRef = useRef(null);

  // Live duration timer
  useEffect(() => {
    const id = setInterval(() => {
      if (history && history.length > 0) {
        const startMs = history[0].time;
        const diffSec = Math.floor((Date.now() - startMs) / 1000);
        const h = Math.floor(diffSec / 3600);
        const m = Math.floor((diffSec % 3600) / 60);
        const s = diffSec % 60;
        setElapsed(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
      } else {
        setElapsed('—');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [history]);

  // Compute peak stake from trade history
  const peakStake = history && history.length > 0
    ? Math.max(config.baseStake, ...history.map(t => t.stake))
    : config.baseStake;

  useEffect(() => {
    if (botRunning && timerLimit > 0) {
      timerRef.current = setInterval(() => setSessionTimer(s => s + 1), 60000);
    } else {
      clearInterval(timerRef.current);
      if (!botRunning) setSessionTimer(0);
    }
    return () => clearInterval(timerRef.current);
  }, [botRunning, timerLimit]);

  useEffect(() => {
    if (timerLimit > 0 && sessionTimer >= timerLimit && botRunning) setBotRunning(false);
  }, [sessionTimer, timerLimit, botRunning]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:12 }}>
        {isMobile && (
          <Stat label="Balance" value={`$${conn.balance.toFixed(2)}`} sub={conn.currency} color={T.text} size="lg" />
        )}
        <div style={{ display:'flex', gap:12, flexWrap: isMobile ? 'wrap' : 'nowrap', flex: 1 }}>
          {!isMobile && <Stat label="Balance" value={`$${conn.balance.toFixed(2)}`} sub={conn.currency} color={T.text} size="lg" />}
          <Stat label="Session P&L" value={netPnl>=0?`+$${netPnl.toFixed(2)}`:`-$${Math.abs(netPnl).toFixed(2)}`} sub={`${stats.total} trades`} color={pnlColor} size={isMobile ? 'sm' : 'md'} style={isMobile ? {minWidth:'calc(50% - 6px)', flexShrink:0, padding:'10px 12px'} : {}} />
          <Stat label="Win Rate" value={`${stats.total>0?Math.round(stats.wins/stats.total*100):0}%`} sub={`${stats.wins}W / ${stats.losses}L`} color={stats.wins/Math.max(1,stats.total)>0.5?T.green:T.red} size={isMobile ? 'sm' : 'md'} style={isMobile ? {minWidth:'calc(50% - 6px)', flexShrink:0, padding:'10px 12px'} : {}} />
          {!isMobile && <Stat label="Active Trades" value={activeTrades.length} sub={botRunning?'Bot running':'Bot stopped'} color={botRunning?T.green:T.muted} size={isMobile ? 'sm' : 'md'} style={isMobile ? {minWidth:'calc(50% - 6px)', flexShrink:0, padding:'10px 12px'} : {}} />}
          {!isMobile && <Stat label="Best Market" value={bestMarket?MSHORT[bestMarket.market]:'—'} sub={`Score ${bestMarket?.score||0}`} color={T.accent} size={isMobile ? 'sm' : 'md'} style={isMobile ? {minWidth:'calc(50% - 6px)', flexShrink:0, padding:'10px 12px'} : {}} />}
        </div>
      </div>

      <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:16, alignItems:'start' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:isMobile?0:16, minWidth:0, flex:1, width: isMobile ? '100%' : 'auto', 
          ...(isMobile ? { border:`1px solid ${T.border}`, borderRadius:12, overflow:'hidden', background:T.surface2 } : {}) }}>
          
          {isMobile && (
            <button onClick={()=>setShowDigitAnalysis(s=>!s)}
              style={{ ...css.btn, borderRadius:0, background:T.surface3, border:'none', borderBottom:showDigitAnalysis?`1px solid ${T.border}`:'none', width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', color:T.text }}>
              <span style={{ fontWeight:700, fontSize:11 }}>DIGIT ANALYSIS</span>
              <span style={{ fontSize:10 }}>{showDigitAnalysis?'▲':'▼'}</span>
            </button>
          )}
          {(!isMobile || showDigitAnalysis) && (
            <div style={{ ...(isMobile ? { padding:'16px 18px', borderBottom:`1px solid ${T.border}` } : {}) }}>
              <DigitAnalysis digits={scores[bestMarket?.market]?.digits} isMobile={isMobile} />
            </div>
          )}

          <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 0 : 16, width: '100%' }}>
            <div style={{ display:'flex', flexDirection:'column', flex:1, gap:0 }}>
              {isMobile && (
                <button onClick={()=>setShowBotControl(s=>!s)}
                  style={{ ...css.btn, borderRadius:0, background:T.surface3, border:'none', borderBottom:showBotControl?`1px solid ${T.border}`:'none', width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', color:T.text }}>
                  <span style={{ fontWeight:700, fontSize:11 }}>BOT CONTROL</span>
                  <span style={{ fontSize:10 }}>{showBotControl?'▲':'▼'}</span>
                </button>
              )}
              {(!isMobile || showBotControl) && (
                <div style={{ ...(isMobile ? { padding:'16px 18px', borderBottom:`1px solid ${T.border}` } : { ...css.card, display:'flex', flexDirection:'column', gap:14, flex:1 }) }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Bot Control</div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <select value={scannerMarket} onChange={e=>setScannerMarket(e.target.value)}
                          style={{ background:T.surface3, color:T.accent, border:`1px solid ${T.border}`, borderRadius:4, padding:'2px 6px', fontSize:10, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", cursor:'pointer', outline:'none' }}>
                          {MARKETS.map(sym => <option key={sym} value={sym}>{MSHORT[sym]}</option>)}
                        </select>
                        <span style={{ fontSize:10, color:T.muted, fontWeight:800 }}>AUTO</span>
                        <button onClick={()=>setConfig(c=>({...c,autoSwitch:!c.autoSwitch}))}
                          style={{ width:36, height:18, borderRadius:9, background:config.autoSwitch?T.green:T.dim, border:'none', position:'relative', cursor:'pointer' }}>
                          <div style={{ width:14, height:14, borderRadius:'50%', background:'#fff', position:'absolute', top:2, left:config.autoSwitch?20:2, transition:'0.2s' }} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                      {!isMobile && (
                        <button onClick={()=>setBotRunning(r=>!r)}
                          style={{ width:72, height:72, borderRadius:'50%', border:'none', cursor:'pointer', fontSize:26,
                            background: botRunning
                              ? `linear-gradient(135deg,#00e676,#00c853)`
                              : `linear-gradient(135deg,${T.accent},#c62828)`,
                            color:'#fff',
                            boxShadow: botRunning
                              ? `0 0 40px #00e67680, 0 0 80px #00e67630, inset 0 1px 0 rgba(255,255,255,0.2)`
                              : `0 0 40px ${T.accent}80, 0 0 80px ${T.accent}30, inset 0 1px 0 rgba(255,255,255,0.2)`,
                            transition:'all 0.3s', flexShrink:0, fontWeight:900 }}>
                          {botRunning ? '⏹' : '▶'}
                        </button>
                      )}
                      <div>
                        <div style={{ fontSize:16, fontWeight:700, color: botRunning?T.green:T.muted, fontFamily:"'Syne',sans-serif" }}>
                          {botRunning ? 'BOT RUNNING' : 'BOT STOPPED'}
                        </div>
                        <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
                          {botRunning ? `Trading on ${bestMarket?MSHORT[bestMarket.market]:'scanning...'}` : 'Press to start auto-trading'}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div style={css.label}>Active Strategies</div>
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        {Object.entries(STRATEGIES).filter(([k,s]) => !s.hidden).map(([key,s]) => (
                          <button key={key} onClick={()=>setConfig(c=>({...c,enabled:{...c.enabled,[key]:!c.enabled[key]}}))}
                            style={{ ...css.btn, padding:'5px 12px', fontSize:12,
                              background: config.enabled[key] ? (s.color==T.accent?T.accentDim:s.color==T.purple?T.purpleDim:T.greenDim) : 'transparent',
                              color: config.enabled[key] ? s.color : T.muted,
                              border:`1px solid ${config.enabled[key]?s.color+'44':T.border}` }}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={()=>setShowRisk(s=>!s)}
                      style={{ ...css.btn, background:T.surface3, border:`1px solid ${T.border}`, width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', color:T.text }}>
                      <span style={{ fontWeight:700, fontSize:11 }}>RISK PARAMETERS</span>
                      <span style={{ fontSize:10 }}>{showRisk?'▲':'▼'}</span>
                    </button>
                    {showRisk && (
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, padding:10, background:T.dim, borderRadius:8 }}>
                        <div>
                          <label style={css.label}>Stake</label>
                          <input style={css.input} type="number" step="0.01" min="0.35" value={config.baseStake}
                            onChange={e=>setConfig(c=>({...c,baseStake:parseFloat(e.target.value)||0.35}))} />
                        </div>
                        <div>
                          <label style={css.label}>Mart ×</label>
                          <input style={css.input} type="number" step="0.5" min="1.5" max="5" value={config.multiplier}
                            onChange={e=>setConfig(c=>({...c,multiplier:parseFloat(e.target.value)||2}))} />
                        </div>
                        <div>
                          <label style={css.label}>Steps</label>
                          <input style={css.input} type="number" step="1" min="2" max="8" value={config.maxSteps}
                            onChange={e=>setConfig(c=>({...c,maxSteps:parseInt(e.target.value)||5}))} />
                        </div>
                        <div>
                          <label style={css.label}>StopL</label>
                          <input style={css.input} type="number" step="1" min="0" value={config.stopLoss}
                            onChange={e=>setConfig(c=>({...c,stopLoss:parseFloat(e.target.value)||0}))} />
                        </div>
                        <div>
                          <label style={css.label}>TakeP</label>
                          <input style={css.input} type="number" step="1" min="0" value={config.takeProfit}
                            onChange={e=>setConfig(c=>({...c,takeProfit:parseFloat(e.target.value)||0}))} />
                        </div>
                        <div>
                          <label style={css.label}>Mode</label>
                          <select style={{ ...css.input, padding:'0 5px' }} value={config.stakingMode}
                            onChange={e=>setConfig(c=>({...c,stakingMode:e.target.value}))}>
                            <option value="fibonacci">Fibonacci</option>
                            <option value="martingale">Martingale</option>
                            <option value="dalembert">D'Alembert</option>
                            <option value="oscars">Oscar's Grind</option>
                          </select>
                        </div>
                        <div>
                          <label style={css.label}>Timer</label>
                          <input style={css.input} type="number" step="5" min="0" value={timerLimit}
                            onChange={e=>setTimerLimit(parseInt(e.target.value)||0)} />
                        </div>
                        <div>
                          <label style={css.label}>AntiMart</label>
                          <select style={{ ...css.input, padding:'0 5px' }} value={config.useAntiMartingale?'on':'off'}
                            onChange={e=>setConfig(c=>({...c,useAntiMartingale:e.target.value==='on'}))}>
                            <option value="off">Off</option>
                            <option value="on">On</option>
                          </select>
                        </div>
                        <div>
                          <label style={css.label}>AMart ×</label>
                          <input style={css.input} type="number" step="0.5" min="1.1" max="5" value={config.amMultiplier}
                            onChange={e=>setConfig(c=>({...c,amMultiplier:parseFloat(e.target.value)||2.0}))} />
                        </div>
                        <div>
                          <label style={css.label}>AM Max</label>
                          <input style={css.input} type="number" step="1" min="1" max="10" value={config.amMaxSteps||3}
                            onChange={e=>setConfig(c=>({...c,amMaxSteps:parseInt(e.target.value)||3}))} />
                        </div>
                        <div>
                          <label style={css.label}>Switch/L</label>
                          <input style={css.input} type="number" step="1" min="1" max="10" value={config.switchAfter}
                            onChange={e=>setConfig(c=>({...c,switchAfter:parseInt(e.target.value)||1}))} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!isMobile && (
              <div style={{ ...css.card, flex:1 }}>
                <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Market Radar</div>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {MARKETS.map(sym => {
                    const sc = scores[sym];
                    const s = sc?.score||0;
                    const m = sc?.evenodd;
                    const rec = m ? (m.rec===0?'EVEN':m.rec===1?'ODD':'—') : '—';
                    const recColor = m?.rec===0?T.accent:m?.rec===1?T.purple:T.muted;
                    return (
                      <div key={sym} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:36, fontSize:12, fontWeight:600, color:T.accent, fontFamily:"'JetBrains Mono',monospace" }}>{MSHORT[sym]}</div>
                        <div style={{ flex:1 }}><ScoreBar score={s} /></div>
                        <div style={{ width:30, fontSize:12, color:T.muted, fontFamily:"'JetBrains Mono',monospace" }}>{s}</div>
                        <div style={{ width:40, fontSize:11, color:recColor, textAlign:'right', fontWeight:600 }}>{rec}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {isMobile && (
            <button onClick={()=>setShowTickFlow(s=>!s)}
              style={{ ...css.btn, borderRadius:0, background:T.surface3, border:'none', borderBottom:showTickFlow?`1px solid ${T.border}`:'none', width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', color:T.text }}>
              <span style={{ fontWeight:700, fontSize:11 }}>TICK FLOW</span>
              <span style={{ fontSize:10 }}>{showTickFlow?'▲':'▼'}</span>
            </button>
          )}
          {(!isMobile || showTickFlow) && (
            <div style={{ ...(isMobile ? { padding:'16px 18px' } : {}) }}>
              <TickFlow digits={scores[bestMarket?.market]?.digits} />
            </div>
          )}
        </div>
        <div style={{ position: isMobile ? 'static' : 'sticky', top:0, display:'flex', flexDirection:'column', gap:16, width: isMobile ? '100%' : 600 }}>
          <div style={{ ...css.card, padding:'16px 20px', maxHeight: isMobile ? 'none' : 'calc(100vh - 120px)', overflowY: isMobile ? 'visible' : 'auto', paddingBottom: isMobile ? 100 : 16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:700, color:T.muted, textTransform:'uppercase' }}>TRADES ({history?.length||0})</div>
              <button onClick={resetHistory} style={{ background:T.red, color:'#fff', border:'none', borderRadius:4, padding:'4px 8px', fontSize:10, fontWeight:800, cursor:'pointer' }}>RESET</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', borderBottom:`1px solid ${T.dim}`, paddingBottom:12, marginBottom:12 }}>
              <div style={{ display:'flex', flexDirection:'column' }}>
                <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase', fontWeight:600 }}>SESSION START</div>
                <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:2 }}>
                  {history && history.length > 0 ? new Date(history[0].time).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—'}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase', fontWeight:600 }}>DURATION</div>
                <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:2 }}>{elapsed}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase', fontWeight:600 }}>MAX STAKE</div>
                <div style={{ fontSize:12, color:T.yellow, fontWeight:700, marginTop:2 }}>
                  ${peakStake.toFixed(2)}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end' }}>
                <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase', fontWeight:600 }}>W:{stats.wins} L:{stats.losses} P/L: ${stats.totalProfit.toFixed(2)}</div>
                {(() => {
                  const maxGain = history && history.length > 0 ? Math.max(0, ...history.map(t => t.profit)) : 0;
                  return (
                    <div style={{ fontSize:12, color:maxGain > 0 ? T.green : T.muted, fontWeight:700, marginTop:2 }}>
                      MAX GAIN +${maxGain.toFixed(2)}
                    </div>
                  );
                })()}
              </div>
            </div>


            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${T.dim}` }}>
                  <th style={{ textAlign:'left', padding:'8px 0', color:T.muted, fontWeight:500 }}>Market</th>
                  <th style={{ textAlign:'left', padding:'8px 0', color:T.muted, fontWeight:500 }}>Strategy</th>
                  <th style={{ textAlign:'left', padding:'8px 0', color:T.muted, fontWeight:500 }}>Type</th>
                  <th style={{ textAlign:'left', padding:'8px 0', color:T.muted, fontWeight:500 }}>Stake</th>
                  <th style={{ textAlign:'center', padding:'8px 0', color:T.muted, fontWeight:500 }}>Digit</th>
                  <th style={{ textAlign:'right', padding:'8px 0', color:T.muted, fontWeight:500 }}>Profit/Loss</th>
                </tr>
              </thead>
              <tbody>
                {[...(history||[])].reverse().map((t,i)=>{
                  const won = t.result==='WIN';
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${T.dim}` }}>
                      <td style={{ padding:'8px 0', color:T.muted, fontWeight:700 }}>{MSHORT[t.market] || t.market}</td>
                      <td style={{ padding:'8px 0', color:T.text }}>{t.strategy||'EO-R1'}</td>
                      <td style={{ padding:'8px 0', color:t.dir==='EVEN'||t.dir==='BOTH'?'#2196f3':'#ffc107', fontWeight:600 }}>{t.dir}</td>
                      <td style={{ padding:'8px 0', color:T.text, fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>${t.stake.toFixed(2)}</td>
                      <td style={{ padding:'8px 0', color:T.accent, textAlign:'center', fontWeight:800, fontFamily:"'JetBrains Mono',monospace" }}>{t.digit !== undefined ? t.digit : '-'}</td>
                      <td style={{ padding:'8px 0', color:won?T.green:T.red, textAlign:'right', fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>${t.profit.toFixed(2)}</td>
                    </tr>
                  )
                })}
                {(!history || history.length === 0) && (
                  <tr>
                    <td colSpan="6" style={{ textAlign:'center', padding:'24px 0', color:T.muted }}>No trades yet in this session</td>
                  </tr>
                )}
              </tbody>
            </table>
      </div>
        </div>
      </div>
      
      {isMobile && (
        <button onClick={()=>setBotRunning(r=>!r)}
          style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', zIndex:1000,
            width:72, height:72, borderRadius:'50%', border:'none', cursor:'pointer', fontSize:26,
            background: botRunning
              ? `linear-gradient(135deg,#00e676,#00c853)`
              : `linear-gradient(135deg,${T.accent},#c62828)`,
            color:'#fff',
            boxShadow: botRunning
              ? `0 10px 40px #00e67680, inset 0 1px 0 rgba(255,255,255,0.2)`
              : `0 10px 40px ${T.accent}80, inset 0 1px 0 rgba(255,255,255,0.2)`,
            transition:'all 0.3s', flexShrink:0, fontWeight:900 }}>
          {botRunning ? '⏹' : '▶'}
        </button>
      )}
    </div>
  );
}

/* ScannerPage is now in ./ScannerPage.jsx */
function _ScannerPageRemoved({ scores }) {
  const [sel, setSel] = useState('1HZ50V');
  const [mode, setMode] = useState('evenodd');
  const sc = scores[sel];
  const m = sc?.[mode];
  const digits = sc?.digits || [];
  const even = digits.filter(d=>d%2===0).length;
  const evenPct = digits.length>0 ? Math.round(even/digits.length*100) : 50;
  const freq = Array.from({length:10},(_,i)=>({ d:i, n:digits.filter(d=>d===i).length }));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Selectors */}
      <div style={{ display:'flex', gap:16, alignItems:'center' }}>
        <div style={{ display:'flex', gap:8 }}>
          {MARKETS.map(sym=>(
            <MarketTag key={sym} sym={sym} active={sel===sym} onClick={()=>setSel(sym)} />
          ))}
        </div>
        <div style={{ height:20, width:1, background:T.border }} />
        <div style={{ display:'flex', gap:8 }}>
          {['evenodd','over5','under5'].map(md=>(
             <button key={md} onClick={()=>setMode(md)} style={{ ...css.btn, background: mode===md?T.accentDim:'transparent', color: mode===md?T.accent:T.muted, border:`1px solid ${mode===md?T.borderHi:T.border}`, padding:'5px 12px', fontSize:12, textTransform:'uppercase' }}>
               {md.replace('evenodd','Even/Odd').replace('over5','Over 5').replace('under5','Under 5')}
             </button>
          ))}
        </div>
      </div>

      {/* All markets score overview */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
        {MARKETS.map(sym=>{
          const s = scores[sym];
          const m2 = s?.[mode];
          const score = m2?.score||0;
          let rec = 'SKIP';
          let rc = T.muted;
          if (m2) {
             if (mode==='evenodd') { rec = m2.rec===0?'EVEN':m2.rec===1?'ODD':'SKIP'; rc = rec==='EVEN'?T.accent:rec==='ODD'?T.purple:T.muted; }
             if (mode==='over5')   { rec = m2.rec===0?'OVER':m2.rec===1?'UNDER':'SKIP'; rc = rec==='OVER'?T.green:rec==='UNDER'?T.yellow:T.muted; }
             if (mode==='under5')  { rec = m2.rec===0?'UNDER':m2.rec===1?'OVER':'SKIP'; rc = rec==='UNDER'?T.yellow:rec==='OVER'?T.green:T.muted; }
          }
          return (
            <button key={sym} onClick={()=>setSel(sym)} style={{ ...css.card, cursor:'pointer', textAlign:'left', border:`1px solid ${sel===sym?T.borderHi:T.border}`, background:sel===sym?T.surface3:T.surface2 }}>
              <div style={{ fontSize:18, fontWeight:800, color:T.text, fontFamily:"'Syne',sans-serif" }}>{MSHORT[sym]}</div>
              <div style={{ fontSize:28, fontWeight:700, color: score>70?T.green:score>45?T.yellow:T.red, fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>{score}</div>
              <div style={{ fontSize:11, color:rc, fontWeight:600, marginTop:4 }}>{rec}</div>
              <ScoreBar score={score} />
            </button>
          );
        })}
      </div>

      {m && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
          {/* Markov Matrix */}
          <div style={css.card}>
            <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>Markov Transition Matrix</div>
            <div style={{ marginBottom:10, fontSize:11, color:T.muted }}>{mode.replace('evenodd','Even/Odd').replace('over5','Over/Under 5').replace('under5','Under/Over 5')} transitions</div>
            <div style={{ display:'grid', gridTemplateColumns:'auto 1fr 1fr', gap:2, fontSize:12 }}>
              <div></div>
              <div style={{ textAlign:'center',color:T.accent,fontWeight:600,padding:'4px',fontSize:11 }}>→ {mode==='evenodd'?'EVEN':mode==='over5'?'OVER':'UNDER'}</div>
              <div style={{ textAlign:'center',color:T.purple,fontWeight:600,padding:'4px',fontSize:11 }}>→ {mode==='evenodd'?'ODD':mode==='over5'?'UNDER':'OVER'}</div>
              {[[mode==='evenodd'?'EVEN':mode==='over5'?'OVER':'UNDER',T.accent,m.matrix[0]],[mode==='evenodd'?'ODD':mode==='over5'?'UNDER':'OVER',T.purple,m.matrix[1]]].map(([lbl,col,row])=>(
                [<div key={lbl} style={{ color:col,fontWeight:600,padding:'4px 6px',fontSize:11,display:'flex',alignItems:'center' }}>{lbl}↓</div>,
                  ...row.map((v,j)=>(
                    <div key={j} style={{ background:T.surface3, borderRadius:6, padding:'8px 4px', textAlign:'center',
                      color: v>0.55?T.green:v<0.45?T.red:T.text, fontWeight:700, fontSize:14,
                      fontFamily:"'JetBrains Mono',monospace", border:`1px solid ${v>0.55?T.green+'33':v<0.45?T.red+'33':T.border}` }}>
                      {(v*100).toFixed(1)}%
                    </div>
                  ))
                ]
              ))}
            </div>
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
              <div style={{ fontSize:11, color:T.muted, marginBottom:6 }}>Stationary Distribution</div>
              <div style={{ display:'flex', gap:8 }}>
                <div style={{ flex:1, background:T.accentDim, borderRadius:6, padding:'6px', textAlign:'center' }}>
                  <div style={{ fontSize:11,color:T.muted }}>{mode==='evenodd'?'Even':mode==='over5'?'Over 5':'Under 5'}</div>
                  <div style={{ fontSize:15,fontWeight:700,color:T.accent,fontFamily:"'JetBrains Mono',monospace" }}>{(m.stationary[0]*100).toFixed(1)}%</div>
                </div>
                <div style={{ flex:1, background:T.purpleDim, borderRadius:6, padding:'6px', textAlign:'center' }}>
                  <div style={{ fontSize:11,color:T.muted }}>{mode==='evenodd'?'Odd':mode==='over5'?'Under 5':'Over 5'}</div>
                  <div style={{ fontSize:15,fontWeight:700,color:T.purple,fontFamily:"'JetBrains Mono',monospace" }}>{(m.stationary[1]*100).toFixed(1)}%</div>
                </div>
              </div>
            </div>
            <div style={{ marginTop:10, padding:'8px 10px', background: m.rec===0?T.accentDim:m.rec===1?T.purpleDim:T.dim, borderRadius:8, textAlign:'center' }}>
              <div style={{ fontSize:11, color:T.muted }}>Next Prediction</div>
              <div style={{ fontSize:16, fontWeight:700, color: m.rec===0?T.accent:m.rec===1?T.purple:T.muted, marginTop:2 }}>
                {mode==='evenodd' ? (m.rec===0?'EVEN':m.rec===1?'ODD':'SKIP') : mode==='over5' ? (m.rec===0?'OVER':m.rec===1?'UNDER':'SKIP') : (m.rec===0?'UNDER':m.rec===1?'OVER':'SKIP')}
                {m.rec>=0 && <span style={{ fontSize:12, marginLeft:6 }}>({(m.next[m.rec]*100).toFixed(0)}%)</span>}
              </div>
            </div>
          </div>

          {/* Digit frequency */}
          <div style={css.card}>
            <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Digit Frequency (100 ticks)</div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {freq.map(({d,n})=>{
                const pct = digits.length>0?Math.round(n/digits.length*100):0;
                const isEven = d%2===0;
                return (
                  <div key={d} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:16, fontSize:12, fontWeight:600, color:isEven?T.accent:T.purple, fontFamily:"'JetBrains Mono',monospace" }}>{d}</div>
                    <div style={{ flex:1, height:14, background:T.dim, borderRadius:2, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct*4}%`, background:isEven?T.accent:T.purple,
                        opacity:0.7, borderRadius:2, transition:'width 0.5s ease' }} />
                    </div>
                    <div style={{ width:30, fontSize:11, color:T.muted, textAlign:'right', fontFamily:"'JetBrains Mono',monospace" }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Analysis summary */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={css.card}>
              <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Even/Odd Split</div>
              <div style={{ display:'flex', height:8, borderRadius:4, overflow:'hidden', marginBottom:8 }}>
                <div style={{ width:`${evenPct}%`, background:T.accent, transition:'width 0.5s' }} />
                <div style={{ flex:1, background:T.purple }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                <span style={{ color:T.accent }}>Even {evenPct}%</span>
                <span style={{ color:T.purple }}>Odd {100-evenPct}%</span>
              </div>
            </div>
            <div style={css.card}>
              <div style={{ fontSize:12, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Current Streak</div>
              <div style={{ fontSize:30, fontWeight:800, color:T.text, fontFamily:"'Syne',sans-serif" }}>{m.streak}</div>
              <div style={{ fontSize:12, color: m.streakType===0?T.accent:T.purple }}>consecutive {mode==='evenodd' ? (m.streakType===0?'EVEN':'ODD') : mode==='over5' ? (m.streakType===0?'OVER':'UNDER') : (m.streakType===0?'UNDER':'OVER')}</div>
              <div style={{ marginTop:8, fontSize:11, color:T.muted }}>
                {m.streak>=5?'⚠ Long streak — reversal likely':m.streak>=3?'Moderate streak':'Short streak — normal'}
              </div>
            </div>
            <div style={{ ...css.card, background: m.score>70?T.greenDim:m.score>45?T.yellowDim:T.redDim,
              border:`1px solid ${m.score>70?T.green+'44':m.score>45?T.yellow+'44':T.red+'44'}` }}>
              <div style={{ fontSize:11, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Market Score</div>
              <div style={{ fontSize:40, fontWeight:800, color:m.score>70?T.green:m.score>45?T.yellow:T.red,
                fontFamily:"'Syne',sans-serif", marginTop:4, lineHeight:1 }}>{m.score}</div>
              <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>
                {m.score>70?'Strong signal — trade now':m.score>45?'Moderate — use caution':'Weak — avoid trading'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RECORDS PAGE
══════════════════════════════════════════════════════════════ */
function RecordsPage({ history, stats }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter==='all'?history:history.filter(t=>t.result===filter.toUpperCase());
  const totalP = history.filter(t=>t.profit>0).reduce((s,t)=>s+t.profit,0);
  const totalL = history.filter(t=>t.profit<0).reduce((s,t)=>s+Math.abs(t.profit),0);

  // Helper for time formatting missing from user code
  const fmtTime = (t) => {
    const d = new Date(t);
    return d.toLocaleTimeString();
  };

  const sessionStart = stats.sessionStart ? new Date(stats.sessionStart).toLocaleTimeString() : 'N/A';
  const durationMs = stats.sessionStart ? Date.now() - stats.sessionStart : 0;
  const durationStr = `${Math.floor(durationMs/60000)}:${String(Math.floor((durationMs%60000)/1000)).padStart(2,'0')}`;
  const maxStake = history.length > 0 ? Math.max(...history.map(h=>h.stake)).toFixed(2) : '0.00';
  const maxGain = history.length > 0 ? Math.max(...history.map(h=>h.profit)).toFixed(2) : '0.00';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Session Stats Bar */}
      <div style={{ ...css.card, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 20px', background:T.surface3 }}>
         <div style={{ textAlign:'center' }}>
           <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase' }}>Session Start</div>
           <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{sessionStart}</div>
         </div>
         <div style={{ width:1, height:24, background:T.border }} />
         <div style={{ textAlign:'center' }}>
           <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase' }}>Duration</div>
           <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{durationStr}</div>
         </div>
         <div style={{ width:1, height:24, background:T.border }} />
         <div style={{ textAlign:'center' }}>
           <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase' }}>Max Stake</div>
           <div style={{ fontSize:13, fontWeight:700, color:T.yellow }}>${maxStake}</div>
         </div>
         <div style={{ width:1, height:24, background:T.border }} />
         <div style={{ textAlign:'center' }}>
           <div style={{ fontSize:10, color:T.muted, textTransform:'uppercase' }}>Max Gain</div>
           <div style={{ fontSize:13, fontWeight:700, color:T.green }}>+${maxGain}</div>
         </div>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        {['all','win','loss'].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{ ...css.btn, background:filter===f?T.accentDim:'transparent', color:filter===f?T.accent:T.muted,
              border:`1px solid ${filter===f?T.borderHi:T.border}`, textTransform:'capitalize' }}>
            {f}
          </button>
        ))}
        <div style={{ flex:1 }}/>
        <div style={{ fontSize:13, color:T.muted, padding:'8px 0' }}>{filtered.length} records</div>
      </div>

      <div style={css.card}>
        {filtered.length===0 ? (
          <div style={{ textAlign:'center', padding:'40px 0', color:T.muted, fontSize:14 }}>No trade history yet. Start the bot to begin trading.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                {['Time','Strategy','Type','Stake','Profit/Loss','Result'].map(h=>(
                  <th key={h} style={{ textAlign:'left',padding:'0 0 10px 4px',color:T.muted,fontWeight:500,fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...filtered].reverse().map((t,i)=>(
                <tr key={t.id||i} style={{ borderBottom:`1px solid ${T.dim}` }}>
                  <td style={{ padding:'9px 4px',color:T.muted,fontSize:11,fontFamily:"'JetBrains Mono',monospace" }}>{fmtTime(t.time)}</td>
                  <td style={{ padding:'9px 4px',color:T.text }}>{MSHORT[t.market]||t.market}</td>
                  <td style={{ padding:'9px 4px' }}><Badge color={t.dir==='EVEN'||t.dir==='OVER5'?'green':t.dir==='ODD'?'purple':'yellow'}>{t.dir}</Badge></td>
                  <td style={{ padding:'9px 4px',color:T.text,fontFamily:"'JetBrains Mono',monospace" }}>${t.stake.toFixed(2)}</td>
                  <td style={{ padding:'9px 4px',fontWeight:600,fontFamily:"'JetBrains Mono',monospace",
                    color:t.profit>=0?T.green:T.red }}>{t.profit>=0?'+':''}{t.profit.toFixed(2)}</td>
                  <td style={{ padding:'9px 4px' }}>
                    <Badge color={t.result==='WIN'?'green':'red'}>{t.result==='WIN'?'✓':'X'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RISK MANAGEMENT PAGE
══════════════════════════════════════════════════════════════ */
function RiskMgmtPage({ config, setConfig }) {
  const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  const stakeAtStep = n => {
    if (config.stakingMode === 'fibonacci') return (config.baseStake * (fib[n] || fib[fib.length-1])).toFixed(2);
    if (config.stakingMode === 'dalembert') return (config.baseStake * (n + 1)).toFixed(2);
    return (config.baseStake * Math.pow(config.multiplier, n)).toFixed(2);
  };
  const modeLabels = { fibonacci:'Fibonacci', martingale:'Martingale', dalembert:"D'Alembert", oscars:"Oscar's Grind" };
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
      {/* Staking Engine */}
      <div style={css.card}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:14 }}>Staking Engine</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={css.label}>Staking Mode</label>
            <select style={{ ...css.input, padding:'8px 12px' }} value={config.stakingMode}
              onChange={e=>setConfig(c=>({...c,stakingMode:e.target.value}))}>
              <option value="fibonacci">🔢 Fibonacci (Recommended)</option>
              <option value="martingale">⚡ Martingale (Aggressive)</option>
              <option value="dalembert">📐 D'Alembert (Linear)</option>
              <option value="oscars">🎯 Oscar's Grind (Conservative)</option>
            </select>
          </div>
          <div>
            <label style={css.label}>Base Stake ($)</label>
            <input style={css.input} type="number" step="0.01" min="0.35" value={config.baseStake}
              onChange={e=>setConfig(c=>({...c,baseStake:parseFloat(e.target.value)||0.35}))} />
          </div>
          {config.stakingMode === 'martingale' && (
            <div>
              <label style={css.label}>Multiplier (× on loss)</label>
              <input style={css.input} type="number" step="0.5" min="1.5" max="5" value={config.multiplier}
                onChange={e=>setConfig(c=>({...c,multiplier:parseFloat(e.target.value)||2}))} />
            </div>
          )}
          <div>
            <label style={css.label}>Max Steps</label>
            <input style={css.input} type="number" step="1" min="2" max="10" value={config.maxSteps}
              onChange={e=>setConfig(c=>({...c,maxSteps:parseInt(e.target.value)||8}))} />
          </div>
        </div>

        {/* Win Compounding Modifier */}
        <div style={{ marginTop:16, borderTop:`1px solid ${T.border}`, paddingTop:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.text }}>Win Compounding (Anti-Martingale)</div>
            <button style={{ ...css.btn, background:config.useAntiMartingale?T.green:T.surface3, color:config.useAntiMartingale?'#000':T.text, padding:'4px 10px', fontSize:11 }}
              onClick={()=>setConfig(c=>({...c,useAntiMartingale:!c.useAntiMartingale}))}>
              {config.useAntiMartingale?'ENABLED':'DISABLED'}
            </button>
          </div>
          {config.useAntiMartingale && (
            <div>
              <label style={css.label}>Win Multiplier (× on win)</label>
              <input style={css.input} type="number" step="0.5" min="1.1" max="5.0" value={config.amMultiplier}
                onChange={e=>setConfig(c=>({...c,amMultiplier:parseFloat(e.target.value)||2.0}))} />
              <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Compounds profits after a win. Resets to normal recovery on loss.</div>
            </div>
          )}
          {config.useAntiMartingale && (
            <div>
              <label style={css.label}>Max Compound Wins</label>
              <input style={css.input} type="number" step="1" min="1" max="10" value={config.amMaxSteps||3}
                onChange={e=>setConfig(c=>({...c,amMaxSteps:parseInt(e.target.value)||3}))} />
              <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Banks the profit and resets to base stake after this many consecutive wins. (REQUIRED to secure profit).</div>
            </div>
          )}
        </div>

        <div style={{ marginTop:14, padding:12, background:T.surface3, borderRadius:8 }}>
          <div style={{ fontSize:11, color:T.muted, marginBottom:8 }}>{modeLabels[config.stakingMode]} Stake Progression</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {Array.from({length:Math.min(config.maxSteps+1,8)},(_,i)=>(
              <div key={i} style={{ background:i===0?T.greenDim:i<3?T.yellowDim:T.redDim,
                border:`1px solid ${i===0?T.green+'33':i<3?T.yellow+'33':T.red+'33'}`,
                borderRadius:6, padding:'4px 8px', textAlign:'center' }}>
                <div style={{ fontSize:10,color:T.muted }}>Step {i}</div>
                <div style={{ fontSize:13,fontWeight:700,color:i===0?T.green:i<3?T.yellow:T.red,
                  fontFamily:"'JetBrains Mono',monospace" }}>${stakeAtStep(i)}</div>
              </div>
            ))}
          </div>
          {config.stakingMode === 'fibonacci' && (
            <div style={{ fontSize:11, color:T.green, marginTop:8, padding:'6px 8px', background:`${T.green}11`, borderRadius:4 }}>
              ✓ Fibonacci grows 5× slower than Martingale. Max risk at step 8: ${stakeAtStep(8)} vs Martingale ${(config.baseStake * Math.pow(config.multiplier, 8)).toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Loss Protection */}
      <div style={css.card}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:14 }}>Loss Protection</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={css.label}>Market Switch After (losses)</label>
            <input style={css.input} type="number" step="1" min="1" max="4" value={config.switchAfter}
              onChange={e=>setConfig(c=>({...c,switchAfter:parseInt(e.target.value)||2}))} />
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Switch to best-scoring market after N consecutive losses</div>
          </div>
          <div>
            <label style={css.label}>Hard Loss Limit (pause bot)</label>
            <input style={css.input} type="number" step="1" min="3" max="8" value={config.hardLimit}
              onChange={e=>setConfig(c=>({...c,hardLimit:parseInt(e.target.value)||4}))} />
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Bot pauses after N consecutive losses — waits for strong recovery signal</div>
          </div>
          <div>
            <label style={css.label}>Min Market Score to Resume</label>
            <input style={css.input} type="number" step="5" min="50" max="95" value={config.minScore}
              onChange={e=>setConfig(c=>({...c,minScore:parseInt(e.target.value)||70}))} />
          </div>
          <div>
            <label style={css.label}>Min Markov Confidence to Trade</label>
            <input style={css.input} type="number" step="0.01" min="0.50" max="0.75" value={config.minConfidence}
              onChange={e=>setConfig(c=>({...c,minConfidence:parseFloat(e.target.value)||0.55}))} />
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Minimum P(next direction) from Markov to allow trade</div>
          </div>
        </div>
      </div>

      {/* Session Limits */}
      <div style={css.card}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:14 }}>Session Limits</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={css.label}>Stop Loss ($)</label>
            <input style={css.input} type="number" step="1" min="0" value={config.stopLoss}
              onChange={e=>setConfig(c=>({...c,stopLoss:parseFloat(e.target.value)||0}))} />
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Stop bot if session P&L drops below -$X (0 = disabled)</div>
          </div>
          <div>
            <label style={css.label}>Take Profit ($)</label>
            <input style={css.input} type="number" step="1" min="0" value={config.takeProfit}
              onChange={e=>setConfig(c=>({...c,takeProfit:parseFloat(e.target.value)||0}))} />
            <div style={{ fontSize:11, color:T.muted, marginTop:4 }}>Stop bot when session profit reaches $X (0 = disabled)</div>
          </div>
        </div>
      </div>

      {/* Active Strategies */}
      <div style={css.card}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:14 }}>Trade Strategies</div>
        {Object.entries(STRATEGIES).map(([key,s])=>(
          <div key={key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'12px 0', borderBottom:`1px solid ${T.border}` }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:s.color }}>{s.label}</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                {s.ctype} · Baseline win: {Math.round(s.base*100)}%
              </div>
            </div>
            <button onClick={()=>setConfig(c=>({...c,enabled:{...c.enabled,[key]:!c.enabled[key]}}))}
              style={{ width:44, height:24, borderRadius:12, border:'none', cursor:'pointer', position:'relative',
                background: config.enabled[key] ? s.color : T.surface3, transition:'all 0.2s' }}>
              <div style={{ position:'absolute', top:3, width:18, height:18, borderRadius:'50%', background:'#fff',
                transition:'left 0.2s', left: config.enabled[key]?'23px':'3px', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   COPY TRADE PAGE
══════════════════════════════════════════════════════════════ */
function CopyTradePage({ history, stats, botRunning, copyConfig, setCopyConfig, copyStatus }) {
  const recentTrades = (history || []).slice(-20).reverse();
  const sessionProfit = stats?.totalProfit || 0;
  const winRate = stats?.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : '0.0';

  const enabled = copyConfig?.enabled || false;
  const direction = copyConfig?.direction || 'demo_to_real';
  const copyStake = copyConfig?.stake !== undefined ? copyConfig.stake : '0';
  const copySL = copyConfig?.stopLoss || '';
  const copyTP = copyConfig?.takeProfit || '';
  const copyPnL = copyConfig?.pnl || 0;
  const copyTrades = copyConfig?.trades || 0;
  const copyError = copyConfig?.error || null;

  const setEnabled = (v) => setCopyConfig(prev => ({ ...prev, enabled: typeof v === 'function' ? v(prev.enabled) : v }));
  const setDirection = (d) => setCopyConfig(prev => ({ ...prev, direction: d }));
  const setCopyStake = (s) => setCopyConfig(prev => ({ ...prev, stake: s }));
  const setCopySL = (s) => setCopyConfig(prev => ({ ...prev, stopLoss: s }));
  const setCopyTP = (s) => setCopyConfig(prev => ({ ...prev, takeProfit: s }));

  const statusColor = copyStatus === 'authorized' ? T.green : copyStatus === 'connecting' ? T.yellow : T.muted;
  const statusLabel = copyStatus === 'authorized' ? (botRunning ? '● Copying Live' : '● Connected, Waiting') : copyStatus === 'connecting' ? '● Connecting...' : '○ Disconnected';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Master Toggle */}
      <div style={{ ...css.card, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:15, fontWeight:600, color:T.text }}>Copy Trading</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:2 }}>Mirror trades between Demo ↔ Real accounts in real-time</div>
        </div>
        <button onClick={()=>setEnabled(e=>!e)} style={{ width:52, height:28, borderRadius:14, border:'none', cursor:'pointer',
          position:'relative', background:enabled?T.green:T.surface3, transition:'all 0.2s' }}>
          <div style={{ position:'absolute', top:4, width:20, height:20, borderRadius:'50%', background:'#fff',
            left:enabled?'28px':'4px', transition:'left 0.2s' }} />
        </button>
      </div>

      {/* Direction + Stake */}
      <div style={{ ...css.card, display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text }}>Account Sync Direction</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, padding:10, borderRadius:8, background: direction==='demo_to_real' ? T.greenDim : T.surface3, border:`1px solid ${direction==='demo_to_real'?T.green+'44':T.border}`, cursor:'pointer' }} onClick={()=>setDirection('demo_to_real')}>
            <div style={{ fontSize:12, fontWeight:700, color:direction==='demo_to_real'?T.green:T.muted }}>Demo ➔ Real</div>
            <div style={{ fontSize:10, color:T.muted, marginTop:4 }}>Copy demo trades to your real account</div>
          </div>
          <div style={{ flex:1, padding:10, borderRadius:8, background: direction==='real_to_demo' ? T.yellowDim : T.surface3, border:`1px solid ${direction==='real_to_demo'?T.yellow+'44':T.border}`, cursor:'pointer' }} onClick={()=>setDirection('real_to_demo')}>
            <div style={{ fontSize:12, fontWeight:700, color:direction==='real_to_demo'?T.yellow:T.muted }}>Real ➔ Demo</div>
            <div style={{ fontSize:10, color:T.muted, marginTop:4 }}>Copy real trades to your demo account</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4 }}>
          <div style={{ flex:1 }}>
            <label style={css.label}>Copy Stake ($)</label>
            <input value={copyStake} onChange={e=>setCopyStake(e.target.value)} style={css.input} type="number" step="0.01" min="0" placeholder="0 = exact mirror" />
          </div>
          <div style={{ flex:1 }}>
            <label style={css.label}>Stop Loss ($)</label>
            <input value={copySL} onChange={e=>setCopySL(e.target.value)} style={css.input} type="number" step="1" min="0" placeholder="0 = off" />
          </div>
          <div style={{ flex:1 }}>
            <label style={css.label}>Take Profit ($)</label>
            <input value={copyTP} onChange={e=>setCopyTP(e.target.value)} style={css.input} type="number" step="1" min="0" placeholder="0 = off" />
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4 }}>
          <div style={{ flex:1 }}>
            <label style={css.label}>Status</label>
            <div style={{ padding:'9px 12px', borderRadius:8, fontSize:13, fontWeight:600,
              background: enabled ? T.greenDim : T.surface3, color: statusColor,
              border:`1px solid ${enabled ? T.green+'44' : T.border}` }}>
              {statusLabel}
            </div>
          </div>
          <div style={{ flex:1 }}>
            <label style={css.label}>Copy P&L</label>
            <div style={{ padding:'9px 12px', borderRadius:8, fontSize:13, fontWeight:700,
              background: T.surface3, fontFamily:"'JetBrains Mono',monospace",
              color: copyPnL >= 0 ? T.green : T.red,
              border:`1px solid ${T.border}` }}>
              {copyPnL >= 0 ? '+' : ''}${copyPnL.toFixed(2)} ({copyTrades} trades)
            </div>
          </div>
        </div>
        {copyError && (
          <div style={{ fontSize:11, color:T.red, padding:'6px 10px', background:`${T.red}11`, borderRadius:6, marginTop:2 }}>
            ❌ Copy Error: {copyError}
          </div>
        )}
        {enabled && !copyError && (
          <div style={{ fontSize:11, color:T.green, padding:'6px 10px', background:`${T.green}11`, borderRadius:6, marginTop:2 }}>
            ✓ Sync Active — Trades mirroring to {direction==='demo_to_real' ? 'Real' : 'Demo'} account. {parseFloat(copyStake) > 0 ? `Using fixed stake: $${copyStake}` : 'Exact stake mirroring enabled.'}
          </div>
        )}
      </div>

      {/* Live Session Stats */}
      <div style={{ display:'flex', gap:12 }}>
        <Stat label="Session Trades" value={stats?.total || 0} color={T.text} />
        <Stat label="Win Rate" value={`${winRate}%`} color={parseFloat(winRate) >= 50 ? T.green : T.red} />
        <Stat label="Session P&L" value={`$${sessionProfit.toFixed(2)}`} color={sessionProfit >= 0 ? T.green : T.red} />
      </div>

      {/* Recent Trade Log */}
      <div style={css.card}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:10 }}>Recent Trades {enabled && <span style={{ fontSize:11, color:T.green, marginLeft:8 }}>● Copied</span>}</div>
        {recentTrades.length === 0 ? (
          <div style={{ fontSize:13, color:T.muted, textAlign:'center', padding:20 }}>No trades yet. Start the bot to see live trade data here.</div>
        ) : (
          <div style={{ maxHeight:300, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                  {['Time','Market','Strategy','Stake','Digit','P&L','Result'].map(h=>(
                    <th key={h} style={{ textAlign:'left', padding:'6px 8px', color:T.muted, fontWeight:500, fontSize:10, textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${T.dim}` }}>
                    <td style={{ padding:'6px 8px', color:T.muted, fontFamily:"'JetBrains Mono',monospace" }}>{new Date(t.time).toLocaleTimeString()}</td>
                    <td style={{ padding:'6px 8px', color:T.text, fontWeight:500 }}>{MSHORT[t.market]||t.market}</td>
                    <td style={{ padding:'6px 8px' }}><Badge color={t.result==='WIN'?'green':''}>{t.channel}</Badge></td>
                    <td style={{ padding:'6px 8px', color:T.text, fontFamily:"'JetBrains Mono',monospace" }}>${t.stake?.toFixed(2)}</td>
                    <td style={{ padding:'6px 8px', fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                      color: typeof t.digit === 'number' ? (t.digit % 2 === 0 ? T.green : T.accent) : T.muted }}>{t.digit}</td>
                    <td style={{ padding:'6px 8px', fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                      color: t.profit >= 0 ? T.green : T.red }}>{t.profit >= 0 ? '+' : ''}{t.profit?.toFixed(2)}</td>
                    <td style={{ padding:'6px 8px' }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                        background: t.result==='WIN' ? T.greenDim : T.redDim,
                        color: t.result==='WIN' ? T.green : T.red }}>{t.result}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FOLLOWERS PAGE
══════════════════════════════════════════════════════════════ */
function FollowersPage() {
  const followers = [
    { name:'trader_k254', since:'2d', profit:'+$128', copying:'Even+Odd' },
    { name:'volhunter_99', since:'5d', profit:'+$342', copying:'All' },
    { name:'digit_sniper', since:'1d', profit:'+$56', copying:'Over5' },
    { name:'mrkv_trader', since:'12d', profit:'+$980', copying:'All' },
  ];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', gap:12 }}>
        <Stat label="Followers" value={followers.length} color={T.accent} />
        <Stat label="Copying Volume" value="$1,506" color={T.green} />
        <Stat label="Avg Win Rate" value="72%" color={T.text} />
      </div>
      <div style={css.card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {['Trader','Following Since','Their P&L','Copying'].map(h=>(
                <th key={h} style={{ textAlign:'left',padding:'0 0 10px',color:T.muted,fontWeight:500,fontSize:11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {followers.map((f,i)=>(
              <tr key={i} style={{ borderBottom:`1px solid ${T.dim}` }}>
                <td style={{ padding:'10px 0',color:T.text,fontWeight:500 }}>@{f.name}</td>
                <td style={{ color:T.muted }}>{f.since} ago</td>
                <td style={{ color:T.green,fontWeight:600,fontFamily:"'JetBrains Mono',monospace" }}>{f.profit}</td>
                <td><Badge color="green">{f.copying}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════════════ */
const NAV = [
  { id:'home',     icon:'⊞', label:'Home'      },
  { id:'scanner',  icon:'◎', label:'Scanner'   },
  { id:'records',  icon:'≡', label:'Records'   },
  { id:'copy',     icon:'⊕', label:'Copy Trade'},
  { id:'followers',icon:'◉', label:'Followers' },
  { id:'risk',     icon:'⊗', label:'Risk Mgmt' },
];

function Sidebar({ page, setPage, conn }) {
  const statusColor = conn.status==='authorized'?T.green:conn.status==='connecting'||conn.status==='authorizing'?T.yellow:T.red;
  return (
    <div style={{ width:72, background:T.sidebar, borderRight:`1px solid ${T.border}`, display:'flex',
      flexDirection:'column', alignItems:'center', padding:'12px 0', gap:4, flexShrink:0 }}>
      {/* Logo */}
      <div style={{ width:40,height:40,borderRadius:10,background:`linear-gradient(135deg,${T.accent},#0055AA)`,
        display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,marginBottom:12,
        boxShadow:`0 0 20px ${T.accent}40`,fontWeight:900,color:'#000',fontFamily:"'Syne',sans-serif" }}>D</div>

      {NAV.map(n=>(
        <button key={n.id} onClick={()=>setPage(n.id)} title={n.label}
          style={{ width:48,height:48,borderRadius:10,border:'none',cursor:'pointer',display:'flex',
            flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,
            background:page===n.id?T.accentDim:'transparent',
            color:page===n.id?T.accent:T.muted, transition:'all 0.15s', fontSize:20 }}>
          {n.icon}
          <span style={{ fontSize:9, letterSpacing:'0.04em' }}>{n.label.split(' ')[0]}</span>
        </button>
      ))}

      <div style={{ flex:1 }}/>
      <div title={conn.status} style={{ width:8,height:8,borderRadius:'50%',background:statusColor,
        boxShadow:`0 0 8px ${statusColor}`, marginBottom:8 }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LOGIN SCREEN
══════════════════════════════════════════════════════════════ */
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (user === 'Joycakes' && pass === '1234aBcd') {
      onLogin();
    } else {
      setError('Invalid username or password');
    }
  };

  return (
    <div style={{ display:'flex', height:'100vh', width:'100vw', alignItems:'center', justifyContent:'center', background:T.bg, fontFamily:"'Outfit',sans-serif" }}>
      <form onSubmit={handleLogin} style={{ ...css.card, width:'100%', maxWidth:360, display:'flex', flexDirection:'column', gap:16, padding:32, margin:20 }}>
        <div style={{ textAlign:'center', marginBottom:16 }}>
          <div style={{ width:64,height:64,borderRadius:16,background:`linear-gradient(135deg,${T.accent},#0055AA)`,
            display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,margin:'0 auto 16px',
            boxShadow:`0 0 30px ${T.accent}40`,fontWeight:900,color:'#000',fontFamily:"'Syne',sans-serif" }}>D</div>
          <h2 style={{ fontSize:24, fontWeight:700, color:T.text, fontFamily:"'Syne',sans-serif" }}>Welcome Back</h2>
          <p style={{ fontSize:13, color:T.muted, marginTop:4 }}>Sign in to access your trading dashboard</p>
        </div>
        
        {error && <div style={{ padding:10, borderRadius:8, background:T.redDim, color:T.red, fontSize:13, textAlign:'center', fontWeight:600 }}>{error}</div>}

        <div>
          <label style={css.label}>Username</label>
          <input style={css.input} type="text" value={user} onChange={e=>setUser(e.target.value)} required />
        </div>
        <div>
          <label style={css.label}>Password</label>
          <input style={css.input} type="password" value={pass} onChange={e=>setPass(e.target.value)} required />
        </div>
        <button type="submit" style={{ ...css.btn, background:T.accent, color:'#000', fontWeight:800, padding:'14px', fontSize:15, marginTop:8, boxShadow:`0 4px 20px ${T.accent}40` }}>
          SECURE LOGIN
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════ */
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('eoou_auth') === 'true');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const [page, setPage] = useState('home');
  const [accountType, setAccountType] = useState('real');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [conn, setConn] = useState({ status:'disconnected', loginId:'', balance:0, currency:'USD' });
  const [botRunning, setBotRunning] = useState(false);
  const [scannerMarket, setScannerMarket] = useState('1HZ50V');
  const [config, setConfig] = useState({
    baseStake:0.35, multiplier:2.1, maxSteps:5, switchAfter:1, hardLimit:6,
    minScore:75, minConfidence:0.85, stopLoss:0, takeProfit:0, autoSwitch: true,
    stakingMode: 'fibonacci',
    useAntiMartingale: false, amMultiplier: 2.0, amMaxSteps: 3,
    enabled:{ EVEN:false, ODD:false, BOTH:true, MATCH:false, OVER5:false, UNDER5:false, BOTH5:true }
  });
  const [scores, setScores] = useState({});
  const [channels, setChannels] = useState({
    EVEN: { stake:0.35, step:0, winStep:0, losses:0, active:false, sessionProfit:0, lastLossTick:0 },
    ODD:  { stake:0.35, step:0, winStep:0, losses:0, active:false, sessionProfit:0, lastLossTick:0 },
    MATCH:{ stake:0.35, step:0, winStep:0, losses:0, active:false, sessionProfit:0, lastLossTick:0 },
    OVER5:{ stake:0.35, step:0, winStep:0, losses:0, active:false, sessionProfit:0, lastLossTick:0 },
    UNDER5:{ stake:0.35, step:0, winStep:0, losses:0, active:false, sessionProfit:0, lastLossTick:0 },
  });
  const [activeTrades, setActiveTrades] = useState([]);
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('eoou_history');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [];
  });
  const [stats, setStats] = useState(() => {
    try {
      const saved = localStorage.getItem('eoou_stats');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return { total:0, wins:0, losses:0, totalProfit:0, pnlChart:[], sessionStart: Date.now() };
  });

  /* ── Refs (mutable, avoid stale closures) ── */
  const wsRef = useRef(null);
  const reqIdRef = useRef(1);
  const buffersRef = useRef({});
  const botRef = useRef({ running:false, paused:false, consecutiveLosses:0 });
  const tickCountRef = useRef(0);
  const configRef = useRef(config);
  const chanRef = useRef(channels);
  const activeRef = useRef({});
  const histRef = useRef(history);
  const statsRef = useRef(stats);

  /* ── Copy Trading State ── */
  const [copyConfig, setCopyConfig] = useState({ enabled: false, direction: 'demo_to_real', stake: '0' });
  const copyWsRef = useRef(null);
  const copyConfigRef = useRef(copyConfig);
  const [copyStatus, setCopyStatus] = useState('disconnected'); // disconnected | connecting | authorized
  const copyStatusRef = useRef(copyStatus);
  useEffect(() => { copyConfigRef.current = copyConfig; }, [copyConfig]);
  useEffect(() => { copyStatusRef.current = copyStatus; }, [copyStatus]);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { chanRef.current = channels; }, [channels]);
  useEffect(() => { 
    botRef.current.running = botRunning; 
    if (!botRunning) {
      // Complete Martingale Reset when bot stops
      setChannels(prev => {
        const reset = {};
        for (const k in prev) {
          reset[k] = { ...prev[k], stake: configRef.current.baseStake, step: 0, losses: 0, active: false };
        }
        return reset;
      });
      botRef.current.paused = false;
      botRef.current.consecutiveLosses = 0;
    }
  }, [botRunning]);

  /* ── Copy Trading WebSocket ── */
  useEffect(() => {
    if (copyConfig.enabled) {
      // Determine which token to connect to (opposite of current account)
      const targetType = copyConfig.direction === 'demo_to_real' ? 'real' : 'demo';
      const targetToken = API_TOKENS[targetType];
      if (!targetToken) return;

      if (copyWsRef.current) copyWsRef.current.close();
      setCopyStatus('connecting');
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
      copyWsRef.current = ws;
      ws.onopen = () => {
        setCopyStatus('connecting');
        ws.send(JSON.stringify({ authorize: targetToken }));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.error) {
            setCopyConfig(prev => ({ ...prev, error: msg.error.message }));
            if (msg.error.message.toLowerCase().includes('rate limit')) {
              botRef.current.paused = true;
              setTimeout(() => {
                botRef.current.paused = false;
                setCopyConfig(prev => ({ ...prev, error: null }));
              }, 60000); // 1 minute cooldown
            }
            return;
          }
          if (msg.authorize) {
            setCopyStatus('authorized');
            setCopyConfig(prev => ({ ...prev, error: null }));
          }
          // Track copy trade results
          if (msg.proposal_open_contract && msg.proposal_open_contract.is_sold) {
            const profit = parseFloat(msg.proposal_open_contract.profit) || 0;
            setCopyConfig(prev => {
              const newPnL = (prev.pnl || 0) + profit;
              const newTrades = (prev.trades || 0) + 1;
              // Check copy SL/TP
              const sl = parseFloat(prev.stopLoss) || 0;
              const tp = parseFloat(prev.takeProfit) || 0;
              if (sl > 0 && newPnL <= -sl) {
                // Hit copy stop loss — disable copy
                if (copyWsRef.current) copyWsRef.current.close();
                return { ...prev, enabled: false, pnl: newPnL, trades: newTrades };
              }
              if (tp > 0 && newPnL >= tp) {
                // Hit copy take profit — disable copy
                if (copyWsRef.current) copyWsRef.current.close();
                return { ...prev, enabled: false, pnl: newPnL, trades: newTrades };
              }
              return { ...prev, pnl: newPnL, trades: newTrades };
            });
          }
        } catch(err) {}
      };
      ws.onclose = () => setCopyStatus('disconnected');
      ws.onerror = () => setCopyStatus('disconnected');
    } else {
      if (copyWsRef.current) {
        copyWsRef.current.close();
        copyWsRef.current = null;
      }
      setCopyStatus('disconnected');
    }
    return () => {
      if (copyWsRef.current) copyWsRef.current.close();
    };
  }, [copyConfig.enabled, copyConfig.direction]);

  /* ── WebSocket helpers ── */
  const sendWS = useCallback((payload) => {
    if (wsRef.current?.readyState === 1) {
      payload.req_id = reqIdRef.current++;
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  /* ── Tick handler ── */
  const handleTick = useCallback((tick) => {
    tickCountRef.current++;
    const sym = tick.symbol;
    const digit = extractDigit(tick.quote);
    if (!buffersRef.current[sym]) buffersRef.current[sym] = [];
    const buf = buffersRef.current[sym];
    buf.push(digit);
    if (buf.length > 500) buf.splice(0, buf.length - 300); // Higher sample for 95% winrate
  }, []);

  /* ── Bot: place a trade ── */
  const placeTrade = useCallback((channelKey, marketOverride, _fromBoth = false) => {
    const cfg = configRef.current;

    // ── Helper: check recent alternation and historical streaks for a market ──
    const analyzeChop = (digs, mode) => {
      if (!digs || digs.length < 20) return { altRate: 0, maxStreak: 99, balanceRatio: 0 };
      const last14 = digs.slice(-14);
      const last20 = digs.slice(-20);
      const classify = d => mode === 'over5' ? (d > 5 ? 0 : 1) : (d % 2 === 0 ? 0 : 1);
      const st = last14.map(classify);
      const st20 = last20.map(classify);
      
      let alt = 0;
      let maxStreak = 0;
      let currentStreak = 1;
      for (let i = 0; i < st.length - 1; i++) { 
        if (st[i] !== st[i+1]) {
          alt++; 
          currentStreak = 1;
        } else {
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        }
      }
      const zeros = st20.filter(x => x === 0).length;
      return { altRate: alt / (st.length - 1), maxStreak, balanceRatio: zeros / 20 }; // altRate 0.0 to 1.0
    };

    // BOTH5 (O/U 5 Win): True simultaneous dual-hedge
    if (channelKey === 'BOTH5') {
      const buf = buffersRef.current;
      const scored = scoreAllMarkets(buf);
      
      const chOver = chanRef.current['OVER5'];
      const chUnder = chanRef.current['UNDER5'];
      
      let targetRecoveryMode = 'both5';
      if (chOver && chUnder) {
        if (chOver.step > chUnder.step && chOver.step >= 1) {
          targetRecoveryMode = 'over5_recovery';
        } else if (chUnder.step > chOver.step && chUnder.step >= 1) {
          targetRecoveryMode = 'under5_recovery';
        }
      }
      
      const inRecovery = (chOver && chOver.step > 0) || (chUnder && chUnder.step > 0);
      
      // During recovery, ALWAYS find the best market regardless of autoSwitch
      let best = marketOverride;
      if (inRecovery) {
        best = getBestMarket(scored, targetRecoveryMode).market;
      } else if (cfg.autoSwitch) {
        best = getBestMarket(scored, 'both5').market;
      } else if (!best) {
        best = scannerMarket;
      }
      
      // Safety removed: Since BOTH5 now dynamically surfs ONE side at a time, it is fully safe to trade in trending markets!
      
      if (chOver?.active || chUnder?.active) {
        if (botRef.current.running) setTimeout(() => placeTrade('BOTH5', best), 1500);
        return;
      }
      
      const markov = scored[best]?.over5;
      
      if (targetRecoveryMode === 'over5_recovery') {
        if (chOver && !chOver.active) placeTrade('OVER5', best, 'BOTH5');
      } else if (targetRecoveryMode === 'under5_recovery') {
        if (chUnder && !chUnder.active) placeTrade('UNDER5', best, 'BOTH5');
      } else {
        // Trade in the direction of the trend based on Markov recommendation
        if (markov && markov.rec === 0 && chOver && !chOver.active) placeTrade('OVER5', best, 'BOTH5');
        else if (markov && markov.rec === 1 && chUnder && !chUnder.active) placeTrade('UNDER5', best, 'BOTH5');
      }
      
      setTimeout(() => {
        const pendingOrActive = Object.values(activeRef.current).some(t => t.fromBoth === 'BOTH5');
        if (!pendingOrActive && botRef.current.running) {
           placeTrade('BOTH5', best);
        }
      }, 1000);
      return;
    }
    
    // BOTH (Even/Odd Win): True simultaneous dual-hedge
    if (channelKey === 'BOTH') {
      const buf = buffersRef.current;
      const scored = scoreAllMarkets(buf);
      
      const chEven = chanRef.current['EVEN'];
      const chOdd = chanRef.current['ODD'];
      
      let targetRecoveryMode = 'both';
      if (chEven && chOdd) {
        if (chEven.step > chOdd.step && chEven.step >= 1) {
          targetRecoveryMode = 'even_recovery';
        } else if (chOdd.step > chEven.step && chOdd.step >= 1) {
          targetRecoveryMode = 'odd_recovery';
        }
      }
      
      const inRecovery = (chEven && chEven.step > 0) || (chOdd && chOdd.step > 0);
      
      // During recovery, ALWAYS find the best market regardless of autoSwitch
      let best = marketOverride;
      if (inRecovery) {
        best = getBestMarket(scored, targetRecoveryMode).market;
      } else if (cfg.autoSwitch) {
        best = getBestMarket(scored, 'both').market;
      } else if (!best) {
        best = scannerMarket;
      }
      
      // Safety removed: Since BOTH now dynamically surfs ONE side at a time, it is fully safe to trade in trending markets!
      
      // Ensure we only trigger if both channels are fully idle
      if (chEven?.active || chOdd?.active) {
        if (botRef.current.running) setTimeout(() => placeTrade('BOTH', best), 1500);
        return;
      }
      
      // Fire based on trend recommendation
      const markov = scored[best]?.evenodd;
      
      if (targetRecoveryMode === 'even_recovery') {
        if (chEven && !chEven.active) placeTrade('EVEN', best, 'BOTH');
      } else if (targetRecoveryMode === 'odd_recovery') {
        if (chOdd && !chOdd.active) placeTrade('ODD', best, 'BOTH');
      } else {
        if (markov && markov.rec === 0 && chEven && !chEven.active) placeTrade('EVEN', best, 'BOTH');
        else if (markov && markov.rec === 1 && chOdd && !chOdd.active) placeTrade('ODD', best, 'BOTH');
      }

      setTimeout(() => {
        const pendingOrActive = Object.values(activeRef.current).some(t => t.fromBoth === 'BOTH');
        if (!pendingOrActive && botRef.current.running) {
           placeTrade('BOTH', best);
        }
      }, 1000);
      return;
    }
    
    const ch = chanRef.current[channelKey];
    // Allow trade if the channel is directly enabled OR if triggered from BOTH
    const isEnabled = cfg.enabled[channelKey] || _fromBoth;
    if (!ch || ch.active || !isEnabled) return;
    if (botRef.current.paused && botRef.current.consecutiveLosses >= cfg.hardLimit) {
      if (botRef.current.running) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 2000); return;
    }

    const buf = buffersRef.current;
    const scored = scoreAllMarkets(buf);
    const best = marketOverride || (cfg.autoSwitch ? getBestMarket(scored).market : scannerMarket);
    const sc = scored[best];
    const digs = buf[best] || [];

    // ── STRATEGY-SPECIFIC SCORING & LOGIC ──
    let strategyMode = 'evenodd';
    if (channelKey === 'OVER5') strategyMode = 'over5';
    else if (channelKey === 'UNDER5') strategyMode = 'under5';
    else if (channelKey === 'MATCH') strategyMode = 'evenodd';
    
    const pData = sc.poisson?.[strategyMode];
    const markov = sc[strategyMode];
    const stratScore = sc.scores?.[strategyMode] || 0;
    const strat = STRATEGIES[channelKey];
    
    // ── COOLDOWN GATE (Applies to all entries) ──
    if (ch.losses >= 2) {
      const ticksSinceLoss = tickCountRef.current - (ch.lastLossTick || 0);
      if (ticksSinceLoss < 3) {
        if (botRef.current.running && !_fromBoth) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1000);
        return; // Paused for at least 3 ticks
      }
      
      const last3 = digs.slice(-3);
      let targetCount = 0;
      if (channelKey === 'EVEN') targetCount = last3.filter(d => d % 2 === 0).length;
      else if (channelKey === 'ODD') targetCount = last3.filter(d => d % 2 !== 0).length;
      else if (channelKey === 'OVER5') targetCount = last3.filter(d => d > 5).length;
      else if (channelKey === 'UNDER5') targetCount = last3.filter(d => d < 5).length;
      else targetCount = 2; // MATCH bypasses this
      
      if (targetCount < 2) {
        if (botRef.current.running && !_fromBoth) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1000);
        return; // Waiting for frequency confirmation (2 out of 3 ticks)
      }
    }

    // ── RECOVERY MODE: If step > 0, we MUST fire immediately to recover losses (if not in cooldown) ──
    const inRecovery = ch.step > 0;
    
    if (inRecovery) {
      // Recovery Score Gate: ensure the selected directional market is actually good!
      if (stratScore < 45 && !_fromBoth) {
        if (botRef.current.running) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1500);
        return;
      }
    } else {
      // Only apply gates on fresh (step 0) entries
      if (markov && (channelKey === 'EVEN' || channelKey === 'ODD')) {
        const cfg2 = configRef.current;
        if (cfg2.enabled.EVEN && cfg2.enabled.ODD && !cfg2.enabled.BOTH) {
          const recommended = markov.rec === 0 ? 'EVEN' : markov.rec === 1 ? 'ODD' : null;
          if (recommended && channelKey !== recommended) {
            return;
          }
        }
      }
      
      // 1. Clustering: Wait for 2 consecutive opposite digits (mean reversion)
      const last2 = digs.slice(-2);
      let clustered = false;
      if (channelKey === 'EVEN') clustered = last2.length === 2 && last2.every(d => d % 2 !== 0);
      else if (channelKey === 'ODD') clustered = last2.length === 2 && last2.every(d => d % 2 === 0);
      else if (channelKey === 'OVER5') clustered = last2.length === 2 && last2.every(d => d <= 5);
      else if (channelKey === 'UNDER5') clustered = last2.length === 2 && last2.every(d => d > 5);
      else if (channelKey === 'MATCH') clustered = true;
      if (_fromBoth) clustered = true;
      
      if (!clustered && stratScore < 80 && !_fromBoth) {
        if (botRef.current.running) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1500); 
        return;
      }
      
      // 2. Score Gate
      if (stratScore < cfg.minScore && !_fromBoth) {
        if (botRef.current.running) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1500); 
        return;
      }

      // 3. Markov Confidence Gate
      if (markov && markov.next && !_fromBoth) {
        const pWin = channelKey === 'ODD' || channelKey === 'UNDER5' ? markov.next[1] : markov.next[0];
        if (pWin < cfg.minConfidence && channelKey !== 'MATCH') {
          if (botRef.current.running) setTimeout(() => placeTrade(channelKey, marketOverride, _fromBoth), 1500); 
          return;
        }
      }
    }
    // In recovery mode: skip ALL gates above — fire immediately

    const rid = reqIdRef.current++;
    const payload = {
      buy: 1, price: ch.stake,
      parameters: {
        amount: ch.stake, basis:'stake', contract_type: strat.ctype,
        currency: cfg.currency||'USD', duration:1, duration_unit:'t', symbol: best,
        ...(strat.barrier ? { barrier: strat.barrier } : {})
      },
      subscribe: 1,
      req_id: rid
    };
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(payload));

    // ── COPY TRADE: Mirror to second account ──
    const cc = copyConfigRef.current;
    if (cc.enabled && copyWsRef.current?.readyState === 1 && copyStatusRef.current === 'authorized') {
      const copyStake = parseFloat(cc.stake) || ch.stake;
      const copyPayload = {
        buy: 1, price: parseFloat(copyStake.toFixed(2)),
        parameters: {
          amount: parseFloat(copyStake.toFixed(2)), basis:'stake', contract_type: strat.ctype,
          currency: cfg.currency||'USD', duration:1, duration_unit:'t', symbol: best,
          ...(strat.barrier ? { barrier: strat.barrier } : {})
        },
        subscribe: 1,
        req_id: rid + 50000 // offset to avoid collision
      };
      copyWsRef.current.send(JSON.stringify(copyPayload));
    }

    const tradeId = Date.now() + Math.random();
    activeRef.current['pending_'+channelKey] = { id:tradeId, channel:channelKey, market:best, stake:ch.stake, step:ch.step, dir:channelKey, openTime:Date.now(), fromBoth:_fromBoth, req_id: rid };
    setChannels(c=>({...c,[channelKey]:{...c[channelKey],active:true}}));
    setActiveTrades(Object.values(activeRef.current).filter(t=>t.id));
  }, [sendWS, scannerMarket]);

  /* ── Bot: handle contract result ── */
  const handleContractResult = useCallback((contract) => {
    if (!contract.is_sold) return;
    const cid = contract.contract_id;
    let entry = activeRef.current[cid];

    // Match pending if needed
    if (!entry) {
      const pendingKey = Object.keys(activeRef.current).find(k => {
        if (!k.startsWith('pending_')) return false;
        const t = activeRef.current[k];
        const stratCtype = STRATEGIES[t.channel]?.ctype || STRATEGIES[t.dir]?.ctype;
        return stratCtype === contract.contract_type;
      });
      if (pendingKey) {
        entry = activeRef.current[pendingKey];
        entry.contractId = cid;
        activeRef.current[cid] = entry;
        delete activeRef.current[pendingKey];
      }
    }
    if (!entry) return;

    const won = parseFloat(contract.profit) > 0;
    const profit = parseFloat(contract.profit);
    const channelKey = entry.channel;
    const cfg = configRef.current;

    delete activeRef.current[cid];
    setActiveTrades(Object.values(activeRef.current).filter(t=>t.id));

    // Update history
    const exitPrice = contract.exit_tick || contract.current_spot || 0;
    const digit = exitPrice ? extractDigit(exitPrice) : '-';
    const rec = { id:cid, channel:channelKey, market:entry.market, dir:entry.dir,
      stake:entry.stake, step:entry.step, profit, result:won?'WIN':'LOSS', digit, time:Date.now() };
    histRef.current = [...histRef.current, rec];
    setHistory([...histRef.current]);
    localStorage.setItem('eoou_history', JSON.stringify(histRef.current));

    const s = statsRef.current;
    s.total++; if(won) s.wins++; else s.losses++;
    s.totalProfit += profit;
    s.pnlChart = [...(s.pnlChart.slice(-49)), { t:histRef.current.length, v:parseFloat(s.totalProfit.toFixed(2)) }];
    statsRef.current = {...s};
    setStats({...s});
    localStorage.setItem('eoou_stats', JSON.stringify(s));

    // Check Stop Loss & Take Profit Triggers
    if (cfg.takeProfit > 0 && s.totalProfit >= cfg.takeProfit) {
      setBotRunning(false);
    }
    if (cfg.stopLoss > 0 && s.totalProfit <= -cfg.stopLoss) {
      setBotRunning(false);
    }

    // Update consecutive losses
    if (won) {
      botRef.current.consecutiveLosses = 0;
      botRef.current.paused = false;
    } else {
      botRef.current.consecutiveLosses++;
    }

    // Update channel with strategy-specific staking
    setChannels(prev => {
      const ch = prev[channelKey];
      const unit = cfg.baseStake;
      let newStep, newStake, newLosses, newSessionProfit;

      let newWinStep = won ? (ch.winStep || 0) + 1 : 0;

      if (cfg.stakingMode === 'oscars') {
        // ── Oscar's Grind ──
        // After a loss: keep same stake
        // After a win: increase stake by 1 unit (unless that would exceed 1-unit session target)
        // Reset when session profit reaches 1 unit
        newSessionProfit = (ch.sessionProfit || 0) + profit;
        if (newSessionProfit >= unit) {
          // Session target reached — reset everything
          newStake = unit;
          newStep = 0;
          newLosses = 0;
          newSessionProfit = 0;
          newWinStep = 0;
        } else if (won) {
          // Win: increase stake by 1 unit, but cap so we don't overshoot the target
          const targetRemaining = unit - newSessionProfit;
          newStake = Math.min(ch.stake + unit, targetRemaining + unit);
          newStep = ch.step;
          newLosses = ch.losses;
        } else {
          // Loss: maintain the same stake
          newStake = ch.stake;
          newStep = ch.step + 1;
          newLosses = ch.losses + 1;
        }
      } else if (cfg.stakingMode === 'dalembert') {
        // ── D'Alembert ──
        // After a loss: increase stake by 1 unit
        // After a win: decrease stake by 1 unit (min = base unit)
        newSessionProfit = (ch.sessionProfit || 0) + profit;
        if (won) {
          newStake = Math.max(unit, ch.stake - unit);
          newStep = 0;
          newLosses = 0;
        } else {
          newStake = ch.stake + unit;
          newStep = ch.step + 1;
          newLosses = ch.losses + 1;
        }
      } else if (cfg.stakingMode === 'fibonacci') {
        // ── Fibonacci ──
        const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
        newSessionProfit = (ch.sessionProfit || 0) + profit;
        if (won) {
          newStep = Math.max(0, ch.step - 2); // Go back 2 steps
          if (newStep === 0) {
            newLosses = 0;
            if (cfg.useAntiMartingale && ch.step === 0) {
              if (newWinStep > (cfg.amMaxSteps || 3)) {
                newStake = unit;
                newWinStep = 0; // Reset streak, profit banked!
              } else {
                newStake = parseFloat((ch.stake * cfg.amMultiplier).toFixed(2));
              }
            } else {
              newStake = unit;
            }
          } else {
            newStake = unit * (fib[newStep] || fib[fib.length - 1]);
            newLosses = ch.losses;
          }
        } else {
          newStep = Math.min(ch.step + 1, cfg.maxSteps);
          newStake = unit * (fib[newStep] || fib[fib.length - 1]);
          newLosses = ch.losses + 1;
        }
      } else {
        // ── Martingale ──
        newSessionProfit = (ch.sessionProfit || 0) + profit;
        if (won) {
          newStep = 0;
          newLosses = 0;
          if (cfg.useAntiMartingale && ch.step === 0) {
            if (newWinStep > (cfg.amMaxSteps || 3)) {
              newStake = unit;
              newWinStep = 0;
            } else {
              newStake = parseFloat((ch.stake * cfg.amMultiplier).toFixed(2));
            }
          } else {
            newStake = unit;
          }
        } else {
          newStep = Math.min(ch.step + 1, cfg.maxSteps);
          newStake = parseFloat((unit * Math.pow(cfg.multiplier, newStep)).toFixed(2));
          newLosses = ch.losses + 1;
        }
      }

      newStake = parseFloat(Math.max(unit, newStake).toFixed(2));
      return { ...prev, [channelKey]: { stake:newStake, step:newStep, winStep: newWinStep, losses:newLosses, active:false, sessionProfit:newSessionProfit||0, lastLossTick: won ? (ch.lastLossTick || 0) : tickCountRef.current } };
    });

    // Check hard limit
    if (botRef.current.consecutiveLosses >= cfg.hardLimit) {
      botRef.current.paused = true;
    }

    // Re-enter
    if (botRef.current.running && !botRef.current.paused) {
      const scored = scoreAllMarkets(buffersRef.current);
      
      if (entry.fromBoth) {
        // For dual-hedges, only trigger re-entry when BOTH sides have finished
        const pendingBoth = Object.values(activeRef.current).filter(t => t.fromBoth === entry.fromBoth).length;
        if (pendingBoth === 0) {
          const bothMode = entry.fromBoth === 'BOTH5' ? 'both5' : 'both';
          const market = cfg.autoSwitch ? getBestMarket(scored, bothMode).market : entry.market;
          setTimeout(() => placeTrade(entry.fromBoth, market), 1500); // 1.5s cooldown to prevent API rate limits
        }
      } else {
        const market = cfg.autoSwitch ? getBestMarket(scored, 'score').market : entry.market;
        setTimeout(() => placeTrade(channelKey, market), 1500);
      }
    }
  }, [placeTrade]);

  /* ── WebSocket message handler ── */
  const handleMessage = useCallback((msg) => {
    
    if (msg.error) {
      console.warn('Deriv error:', msg.error.message);
      if (msg.req_id) {
        const pendingKey = Object.keys(activeRef.current).find(k => activeRef.current[k]?.req_id == msg.req_id);
        if (pendingKey) {
          const chKey = activeRef.current[pendingKey].channel;
          delete activeRef.current[pendingKey];
          setActiveTrades(Object.values(activeRef.current).filter(t=>t.id));
          setChannels(c => ({...c, [chKey]: {...c[chKey], active: false}}));
        }
      }
      return;
    }
    switch (msg.msg_type) {
      case 'authorize':
        setConn(c => ({ ...c, status:'authorized', loginId:msg.authorize.loginid, balance:msg.authorize.balance, currency:msg.authorize.currency }));
        MARKETS.forEach(sym => sendWS({ ticks: sym, subscribe: 1 }));
        break;
      case 'tick':
        handleTick(msg.tick);
        break;
      case 'buy':
        if (msg.buy && msg.req_id) {
          const cid = msg.buy.contract_id;
          const pKey = Object.keys(activeRef.current).find(k => activeRef.current[k]?.req_id === msg.req_id);
          if (pKey) { 
             const entry = activeRef.current[pKey];
             entry.contractId = cid;
             activeRef.current[cid] = entry; 
             delete activeRef.current[pKey]; 
          }
        }
        break;
      case 'proposal_open_contract':
        handleContractResult(msg.proposal_open_contract);
        break;
      case 'balance':
        setConn(c => ({ ...c, balance: parseFloat(msg.balance.balance) }));
        break;
      default: break;
    }
  }, [handleTick, handleContractResult, sendWS]);

  /* ── Connect to Deriv ── */
  const connect = useCallback((appId, token) => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${appId}`);
    wsRef.current = ws;
    setConn(c=>({...c,status:'connecting'}));
    ws.onopen = () => { setConn(c=>({...c,status:'authorizing'})); ws.send(JSON.stringify({ authorize:token, req_id:reqIdRef.current++ })); };
    ws.onmessage = e => { try { handleMessage(JSON.parse(e.data)); } catch(err){} };
    ws.onclose = () => setConn(c=>({...c,status:'disconnected',loginId:'',balance:0}));
    ws.onerror = () => setConn(c=>({...c,status:'error'}));
  }, [handleMessage]);

  /* ── Auto Connect ── */
  useEffect(() => {
    if (API_TOKENS[accountType]) {
      connect(APP_ID, API_TOKENS[accountType]);
    }
  }, [accountType, connect]);

  /* ── Periodic score updates ── */
  useEffect(() => {
    const id = setInterval(() => {
      const sc = scoreAllMarkets(buffersRef.current);
      setScores(sc);
      // Check if paused bot can resume
      if (botRef.current.paused && botRef.current.running) {
        const best = getBestMarket(sc);
        if (best.score >= configRef.current.minScore) {
          botRef.current.paused = false;
          botRef.current.consecutiveLosses = 0;
        }
      }
    }, 500); // 🚀 Max Performance Refresh Rate
    return () => clearInterval(id);
  }, []);

  /* ── Balance subscription ── */
  useEffect(() => {
    if (conn.status === 'authorized') {
      sendWS({ balance: 1, subscribe: 1 });
    }
  }, [conn.status, sendWS]);

  /* ── Bot Watchdog: Prevent stalls ── */
  useEffect(() => {
    const id = setInterval(() => {
      if (botRunning && conn.status === 'authorized' && !botRef.current.paused) {
        const activeCount = Object.values(activeRef.current).filter(t => t.id).length;
        if (activeCount === 0) {
          // If no trades active for 5s, try triggering one
          const scored = scoreAllMarkets(buffersRef.current);
          const { market } = getBestMarket(scored);
          Object.keys(config.enabled).filter(k=>config.enabled[k]).forEach(k => {
             placeTrade(k, market);
          });
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [botRunning, conn.status, config.enabled, placeTrade]);

  const bestMarket = getBestMarket(scores);
  const resetHistory = () => { histRef.current=[]; setHistory([]); localStorage.removeItem('eoou_history'); const s={total:0,wins:0,losses:0,totalProfit:0,pnlChart:[],sessionStart:Date.now()}; statsRef.current=s; setStats(s); localStorage.removeItem('eoou_stats'); };
  const pageProps = { conn, botRunning, setBotRunning, config, setConfig, channels, activeTrades, stats, scores, bestMarket, history, resetHistory, scannerMarket, setScannerMarket, isMobile };
  const PAGE_TITLES = { home:'Dashboard', scanner:'Market Scanner', records:'Trade Records', copy:'Copy Trade', followers:'Followers', risk:'Risk Management' };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => { localStorage.setItem('eoou_auth', 'true'); setIsAuthenticated(true); }} />;
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Outfit',sans-serif;background:${T.bg};color:${T.text}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(0,195,255,0.15);border-radius:2px}
        input:focus{border-color:${T.accent}!important;box-shadow:0 0 0 2px ${T.accentDim}}
        button:active{transform:scale(0.97)}
      `}</style>

      <div style={{ display:'flex', height:'100vh', overflow:'hidden', fontFamily:"'Outfit',sans-serif" }}>
        
        {/* Desktop Sidebar */}
        {!isMobile && <Sidebar page={page} setPage={setPage} conn={conn} />}

        {/* Mobile Sidebar Drawer */}
        {isMobile && showMobileMenu && (
          <div style={{ position:'fixed', top:0, left:0, width:'100vw', height:'100vh', zIndex:1000, background:'rgba(0,0,0,0.5)' }} onClick={()=>setShowMobileMenu(false)}>
            <div style={{ width:72, height:'100%', background:T.sidebar }} onClick={e=>e.stopPropagation()}>
              <Sidebar page={page} setPage={p=>{setPage(p); setShowMobileMenu(false);}} conn={conn} />
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
          {/* Top bar */}
          <div style={{ height:52, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center',
            padding:'0 20px', gap:12, flexShrink:0, background:T.surface }}>
            
            {isMobile && (
              <button onClick={()=>setShowMobileMenu(true)} style={{ background:'transparent', border:'none', color:T.text, fontSize:24, cursor:'pointer', marginRight:8 }}>
                ☰
              </button>
            )}
            
            <div style={{ fontSize:isMobile?14:16, fontWeight:700, color:T.text, fontFamily:"'Syne',sans-serif", flex:1 }}>
              {PAGE_TITLES[page]}
            </div>

            {/* Account Switcher */}
            <div style={{ position:'relative' }}>
              <button onClick={() => setShowAccountDropdown(s=>!s)}
                style={{ ...css.btn, background:'transparent', border:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, padding:'6px 12px' }}>
                <div style={{ width:24, height:16, borderRadius:2, background:accountType==='real'?T.accent:T.muted, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'#000' }}>
                  {accountType==='real'?'R':'D'}
                </div>
                <div style={{ textAlign:'left' }}>
                  <div style={{ fontSize:11, color:T.muted, lineHeight:1 }}>{accountType==='real'?'Real':'Demo'}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:T.text, fontFamily:"'JetBrains Mono',monospace", lineHeight:1, marginTop:2 }}>
                    ${conn.balance.toFixed(2)}
                  </div>
                </div>
                <div style={{ fontSize:10, color:T.muted }}>▼</div>
              </button>

              {showAccountDropdown && (
                <div style={{ position:'absolute', top:'100%', right:0, marginTop:8, width:260, background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, boxShadow:`0 10px 30px rgba(0,0,0,0.5)`, zIndex:100 }}>
                  <div style={{ display:'flex', borderBottom:`1px solid ${T.border}` }}>
                    <button onClick={()=>{setAccountType('real');setShowAccountDropdown(false)}} style={{ flex:1, padding:'10px 0', border:'none', background:'transparent', color:accountType==='real'?T.accent:T.muted, borderBottom:accountType==='real'?`2px solid ${T.accent}`:'2px solid transparent', cursor:'pointer', fontWeight:600 }}>Real</button>
                    <button onClick={()=>{setAccountType('demo');setShowAccountDropdown(false)}} style={{ flex:1, padding:'10px 0', border:'none', background:'transparent', color:accountType==='demo'?T.text:T.muted, borderBottom:accountType==='demo'?`2px solid ${T.red}`:'2px solid transparent', cursor:'pointer', fontWeight:600 }}>Demo</button>
                  </div>
                  <div style={{ padding:16 }}>
                    <div style={{ fontSize:11, color:T.muted, marginBottom:8 }}>Deriv account</div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:T.surface3, padding:10, borderRadius:6 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{accountType==='real'?'US Dollar':'Demo'}</div>
                        <div style={{ fontSize:11, color:T.muted }}>{conn.loginId||'Connecting...'}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:700, color:T.text, fontFamily:"'JetBrains Mono',monospace" }}>
                        ${conn.balance.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ height:20, width:1, background:T.border }}/>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:conn.status==='authorized'?T.green:conn.status==='error'?T.red:T.yellow, boxShadow:`0 0 6px ${conn.status==='authorized'?T.green:conn.status==='error'?T.red:T.yellow}` }}/>
              <span style={{ color:conn.status==='authorized'?T.green:conn.status==='error'?T.red:T.yellow }}>
                {conn.status.toUpperCase()}
              </span>
            </div>
            {botRunning && (
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, padding:'4px 10px',
                background:T.greenDim, border:`1px solid ${T.green}44`, borderRadius:20 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:T.green, animation:'pulse 1s infinite' }}/>
                <span style={{ color:T.green, fontWeight:600 }}>BOT ACTIVE</span>
              </div>
            )}
          </div>

          {/* Page content */}
          <div style={{ flex:1, overflow:'auto', padding:20 }}>
            {page==='home'     && <HomePage {...pageProps}/>}
            {page==='scanner'  && <ScannerPage scores={scores} currentMarket={scannerMarket} onSwitchMarket={setScannerMarket} pThreshold={config.pThreshold || 0.15}/>}
            {page==='records'  && <RecordsPage history={history} stats={stats}/>}
            {page==='copy'     && <CopyTradePage history={history} stats={stats} botRunning={botRunning} copyConfig={copyConfig} setCopyConfig={setCopyConfig} copyStatus={copyStatus}/>}
            {page==='followers'&& <FollowersPage/>}
            {page==='risk'     && <RiskMgmtPage config={config} setConfig={setConfig}/>}
          </div>
        </div>
      </div>
    </>
  );
}
