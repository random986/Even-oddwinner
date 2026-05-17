import { useState, useEffect, useRef } from "react";

const T = {
  bg:'#0e0e0e', surface:'#151515', surface2:'#1c1c1c', surface3:'#262626',
  border:'rgba(255,255,255,0.08)', borderHi:'rgba(255,255,255,0.15)',
  accent:'#ff444f', accentDim:'rgba(255,68,79,0.15)',
  green:'#4caf50', greenDim:'rgba(76,175,80,0.15)',
  red:'#ff444f', redDim:'rgba(255,68,79,0.15)',
  yellow:'#ff9800', yellowDim:'rgba(255,152,0,0.15)',
  purple:'#9c27b0', purpleDim:'rgba(156,39,176,0.15)',
  text:'#e5e5e5', muted:'#8a8a8a', dim:'rgba(255,255,255,0.04)',
};

const MARKETS = ['1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V'];
const MSHORT  = {'1HZ10V':'V10','1HZ25V':'V25','1HZ50V':'V50','1HZ75V':'V75','1HZ100V':'V100'};
const MFULL   = {'1HZ10V':'Volatility 10 (1s)','1HZ25V':'Volatility 25 (1s)','1HZ50V':'Volatility 50 (1s)','1HZ75V':'Volatility 75 (1s)','1HZ100V':'Volatility 100 (1s)'};

const css = {
  card:{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:12, padding:'16px 18px' },
  btn:{ border:'none', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontSize:13, fontFamily:'inherit', fontWeight:500 },
};

function getStreak(digits, test) {
  let streak = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    if (test(digits[i])) streak++;
    else break;
  }
  return streak;
}

function extractScannerStats(data, partition, side, pThreshold = 0.15) {
  if (!data || !data.poisson) return { score: 0, neutrality: 100, pTarget: 1, pOpposite: 1, signal: '--' };
  
  let neutrality = 100;
  let pTarget = 1;
  let pOpposite = 1;
  let score = 0;
  
  if (partition === 'evenodd') {
    neutrality = data.neutrality?.evenodd || 100;
    score = data.scores?.evenodd || 0;
    pTarget = side === 'EVEN' ? data.poisson?.evenodd?.pValue : data.poisson?.odd?.pValue;
    pOpposite = side === 'EVEN' ? data.poisson?.odd?.pValue : data.poisson?.evenodd?.pValue;
  } else {
    neutrality = data.neutrality?.over5 || 100;
    score = data.scores?.over5 || 0;
    pTarget = side === 'OVER' ? data.poisson?.over5?.pValue : data.poisson?.under5?.pValue;
    pOpposite = side === 'OVER' ? data.poisson?.under5?.pValue : data.poisson?.over5?.pValue;
  }
  
  let signal = 'WAIT';
  if (neutrality <= 6.0 && pTarget <= pThreshold) signal = 'STRONG BUY';
  else if (neutrality <= 6.0 && pOpposite <= pThreshold) signal = 'OPP. BUY';
  
  return { score, neutrality, pTarget, pOpposite, signal };
}

function ScoreBar({ score }) {
  const c = score > 70 ? T.green : score > 45 ? T.yellow : T.red;
  return (
    <div style={{ height:4, background:T.dim, borderRadius:2, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${score}%`, background:c, borderRadius:2, transition:'width 0.5s ease', boxShadow:`0 0 6px ${c}40` }} />
    </div>
  );
}

function SignalBadge({ signal }) {
  const color = signal==='STRONG' ? T.green : signal==='MODERATE' ? T.yellow : T.muted;
  const bg = signal==='STRONG' ? T.greenDim : signal==='MODERATE' ? T.yellowDim : T.dim;
  return (
    <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, background:bg, color }}>{signal}</span>
  );
}

function RankBadge({ rank }) {
  const colors = ['#FFD700','#C0C0C0','#CD7F32'];
  const c = rank <= 3 ? colors[rank-1] : T.muted;
  return (
    <div style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:12, fontWeight:800, color:c, border:`1px solid ${c}44`, background:`${c}11`, flexShrink:0 }}>
      {rank}
    </div>
  );
}

export default function ScannerPage({ scores, onSwitchMarket, currentMarket, pThreshold = 0.15 }) {
  const [partition, setPartition] = useState('evenodd'); // 'evenodd' | 'overunder'
  const [tradingSide, setTradingSide] = useState({ evenodd:'EVEN', overunder:'OVER' });
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [ranked, setRanked] = useState([]);
  const [activeMarket, setActiveMarket] = useState(currentMarket || '1HZ50V');
  const [stats, setStats] = useState({});
  const intervalRef = useRef(null);
  const autoRef = useRef(autoSwitch);
  useEffect(() => { autoRef.current = autoSwitch; }, [autoSwitch]);

  const recompute = () => {
    const side = partition === 'evenodd' ? tradingSide.evenodd : tradingSide.overunder;
    const rows = MARKETS.map(sym => {
      const data = scores[sym];
      const digits = data?.digits || [];
      const r = extractScannerStats(data, partition, side, pThreshold);
      return { sym, ...r, digits };
    }).sort((a, b) => a.neutrality - b.neutrality);

    rows.forEach((r, i) => { r.rank = i + 1; });
    setRanked(rows);

    const newStats = {};
    rows.forEach(r => { newStats[r.sym] = r; });
    setStats(newStats);

    if (autoRef.current && rows.length > 0) {
      const top = rows[0].sym;
      if (top !== activeMarket) {
        setActiveMarket(top);
        onSwitchMarket && onSwitchMarket(top);
      }
    }
  };

  useEffect(() => {
    if (scanning) {
      recompute();
      intervalRef.current = setInterval(recompute, 500);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [scanning, scores, partition, tradingSide, autoSwitch]);

  const handleManualSwitch = (sym) => {
    setActiveMarket(sym);
    onSwitchMarket && onSwitchMarket(sym);
  };

  const handleReset = () => {
    setRanked([]);
    setStats({});
    setActiveMarket('1HZ50V');
  };

  const side = partition === 'evenodd' ? tradingSide.evenodd : tradingSide.overunder;
  const sideOptions = partition === 'evenodd' ? ['EVEN','ODD'] : ['OVER','UNDER'];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Top partition toggle */}
      <div style={{ display:'flex', gap:0, background:T.surface2, borderRadius:10, padding:4, border:`1px solid ${T.border}`, alignSelf:'flex-start' }}>
        {[{id:'evenodd',label:'⚖ Even/Odd Scanner'},{id:'overunder',label:'📊 Over/Under Scanner'}].map(p => (
          <button key={p.id} onClick={() => setPartition(p.id)}
            style={{ ...css.btn, padding:'8px 20px', borderRadius:8,
              background: partition===p.id ? T.accent : 'transparent',
              color: partition===p.id ? '#fff' : T.muted,
              fontWeight: partition===p.id ? 700 : 500, transition:'all 0.2s' }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        {/* Trade side selector */}
        <div style={{ display:'flex', gap:4, background:T.surface3, borderRadius:8, padding:3 }}>
          {sideOptions.map(s => (
            <button key={s} onClick={() => setTradingSide(prev => ({ ...prev, [partition==='evenodd'?'evenodd':'overunder']:s }))}
              style={{ ...css.btn, padding:'5px 14px', fontSize:12, borderRadius:6,
                background: side===s ? (s==='EVEN'||s==='OVER' ? T.greenDim : T.yellowDim) : 'transparent',
                color: side===s ? (s==='EVEN'||s==='OVER' ? T.green : T.yellow) : T.muted,
                border: side===s ? `1px solid ${s==='EVEN'||s==='OVER' ? T.green+'44' : T.yellow+'44'}` : '1px solid transparent' }}>
              Trading {s}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:28, background:T.border }} />

        {/* Scanner controls */}
        <button onClick={() => setScanning(true)} style={{ ...css.btn, background:scanning ? T.greenDim : T.surface3,
          color: scanning ? T.green : T.muted, border:`1px solid ${scanning ? T.green+'44' : T.border}`, fontSize:12 }}>
          {scanning ? '● SCANNING' : '▶ Start'}
        </button>
        <button onClick={() => setScanning(false)} style={{ ...css.btn, background:!scanning ? T.redDim : T.surface3,
          color: !scanning ? T.red : T.muted, border:`1px solid ${!scanning ? T.red+'44' : T.border}`, fontSize:12 }}>
          ■ Stop
        </button>
        <button onClick={handleReset} style={{ ...css.btn, background:'transparent', color:T.muted, border:`1px solid ${T.border}`, fontSize:12 }}>
          ↺ Reset
        </button>

        <div style={{ width:1, height:28, background:T.border }} />

        {/* Auto-switch */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:12, color:T.muted }}>Auto-Switch</span>
          <button onClick={() => setAutoSwitch(a => !a)}
            style={{ width:44, height:24, borderRadius:12, border:'none', cursor:'pointer', position:'relative',
              background: autoSwitch ? T.accent : T.surface3, transition:'all 0.2s' }}>
            <div style={{ position:'absolute', top:3, width:18, height:18, borderRadius:'50%', background:'#fff',
              transition:'left 0.2s', left: autoSwitch?'23px':'3px', boxShadow:'0 1px 3px rgba(0,0,0,0.4)' }} />
          </button>
          <span style={{ fontSize:11, color: autoSwitch ? T.green : T.muted, fontWeight:600 }}>
            {autoSwitch ? 'ON' : 'OFF'}
          </span>
        </div>

        <div style={{ flex:1 }} />

        {/* Update freq indicator */}
        <div style={{ fontSize:11, color:T.muted, display:'flex', alignItems:'center', gap:4 }}>
          {scanning && <div style={{ width:6, height:6, borderRadius:'50%', background:T.green, animation:'pulse 1s infinite' }} />}
          <span>{scanning ? 'Live · 1s' : 'Paused'}</span>
        </div>
      </div>

      {/* Active market indicator */}
      <div style={{ ...css.card, background:T.surface3, padding:'10px 16px', display:'flex', alignItems:'center', gap:12 }}>
        <span style={{ fontSize:11, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Active Market</span>
        <span style={{ fontSize:15, fontWeight:800, color:T.accent, fontFamily:"'Syne',sans-serif" }}>{MSHORT[activeMarket]}</span>
        <span style={{ fontSize:12, color:T.muted }}>{MFULL[activeMarket]}</span>
        {autoSwitch && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:T.greenDim, color:T.green, fontWeight:600 }}>Auto</span>}
      </div>

      {/* Ranking Table */}
      <div style={css.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:12, color:T.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em' }}>
            {partition === 'evenodd' ? 'Even/Odd' : 'Over/Under'} Ranking — Trading {side}
          </div>
          <div style={{ fontSize:11, color:T.muted }}>{ranked.length} markets</div>
        </div>

        {/* Header */}
        <div style={{ display:'grid', gridTemplateColumns:'30px 60px 80px 90px 70px 70px 100px 110px', gap:8,
          fontSize:10, color:T.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em',
          paddingBottom:10, borderBottom:`1px solid ${T.border}`, marginBottom:4 }}>
          <div>#</div>
          <div>Market</div>
          <div>Neutrality</div>
          <div>Status</div>
          <div style={{textAlign:'center'}}>p-T</div>
          <div style={{textAlign:'center'}}>p-O</div>
          <div style={{textAlign:'center'}}>Signal</div>
          <div style={{textAlign:'right'}}>Action</div>
        </div>

        {ranked.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 0', color:T.muted, fontSize:13 }}>
            {scanning ? 'Collecting data…' : 'Start scanner to see rankings'}
          </div>
        ) : ranked.map((r, i) => {
          const isActive = r.sym === activeMarket;
          const isTop = r.rank === 1;
          return (
            <div key={r.sym} style={{ display:'grid', gridTemplateColumns:'30px 60px 80px 90px 70px 70px 100px 110px', gap:8,
              alignItems:'center', padding:'10px 0', borderBottom:i<ranked.length-1?`1px solid ${T.dim}`:'none',
              background: isActive ? `${T.accent}08` : isTop ? `${T.green}05` : 'transparent',
              borderLeft: isActive ? `2px solid ${T.accent}` : isTop ? `2px solid ${T.green}` : '2px solid transparent',
              paddingLeft: (isActive||isTop) ? 6 : 0, borderRadius: (isActive||isTop) ? 4 : 0,
              transition:'all 0.3s' }}>

              <RankBadge rank={r.rank} />

              <div style={{ display:'flex', flexDirection:'column' }}>
                <span style={{ fontSize:13, fontWeight:700, color:T.text, fontFamily:"'JetBrains Mono',monospace" }}>{MSHORT[r.sym]}</span>
                {isActive && <span style={{ fontSize:9, color:T.accent, fontWeight:600 }}>ACTIVE</span>}
              </div>

              <div style={{ display:'flex', alignItems:'center', gap:6, color:r.neutrality <= 6.0 ? T.green : T.red, fontWeight:600 }}>
                <div style={{ width:16, height:4, borderRadius:2, background:r.neutrality <= 6.0 ? T.green : T.red,
                  opacity: 1 - Math.min(1, r.neutrality/20) }} />
                {r.neutrality?.toFixed(1)}
              </div>

              <div style={{ textAlign:'center', fontSize:10, color:r.neutrality <= 2.5 ? T.green : (r.neutrality <= 6.0 ? T.yellow : T.red) }}>
                {r.neutrality <= 2.5 ? 'BALANCED' : (r.neutrality <= 6.0 ? 'ACCEPTABLE' : 'BIASED')}
              </div>

              <div style={{ textAlign:'center', fontSize:12, color:r.pTarget < 0.15 ? T.green : T.muted, fontWeight:r.pTarget < 0.15 ? 800 : 400 }}>
                {(r.pTarget||1).toFixed(3)}
              </div>

              <div style={{ textAlign:'center', fontSize:12, color:r.pOpposite < 0.15 ? T.red : T.muted }}>
                {(r.pOpposite||1).toFixed(3)}
              </div>

              <div style={{ textAlign:'center' }}><SignalBadge signal={r.signal} /></div>

              <div style={{ textAlign:'right' }}>
                <button onClick={() => handleManualSwitch(r.sym)}
                  style={{ ...css.btn, padding:'5px 12px', fontSize:11,
                    background: isActive ? T.accentDim : T.surface3,
                    color: isActive ? T.accent : T.muted,
                    border: `1px solid ${isActive ? T.accent+'44' : T.border}` }}>
                  {isActive ? '✓ Active' : '→ Switch'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Split bars for all markets */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
        {MARKETS.map(sym => {
          const s = stats[sym];
          const digits = scores[sym]?.digits || [];
          const evenCount = digits.filter(d=>d%2===0).length;
          const evenPct = digits.length > 0 ? Math.round(evenCount/digits.length*100) : 50;
          const overCount = digits.filter(d=>d>4).length;
          const overPct = digits.length > 0 ? Math.round(overCount/digits.length*100) : 50;
          const isActive = sym === activeMarket;
          return (
            <div key={sym} onClick={() => handleManualSwitch(sym)}
              style={{ ...css.card, cursor:'pointer', border:`1px solid ${isActive ? T.accent+'66' : T.border}`,
                background: isActive ? T.surface3 : T.surface2, transition:'all 0.2s' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <span style={{ fontSize:15, fontWeight:800, color:isActive?T.accent:T.text, fontFamily:"'Syne',sans-serif" }}>{MSHORT[sym]}</span>
                {s && <span style={{ fontSize:18, fontWeight:800, color:s.score>70?T.green:s.score>45?T.yellow:T.red, fontFamily:"'JetBrains Mono',monospace" }}>{s.score}</span>}
              </div>

              {partition === 'evenodd' ? (
                <>
                  <div style={{ height:5, borderRadius:3, background:T.dim, overflow:'hidden', marginBottom:4 }}>
                    <div style={{ height:'100%', width:`${evenPct}%`, background:T.accent, transition:'width 0.5s' }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10 }}>
                    <span style={{ color:T.accent }}>E {evenPct}%</span>
                    <span style={{ color:T.purple }}>O {100-evenPct}%</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ height:5, borderRadius:3, background:T.dim, overflow:'hidden', marginBottom:4 }}>
                    <div style={{ height:'100%', width:`${overPct}%`, background:T.green, transition:'width 0.5s' }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10 }}>
                    <span style={{ color:T.green }}>OV {overPct}%</span>
                    <span style={{ color:T.yellow }}>UN {100-overPct}%</span>
                  </div>
                </>
              )}

              {s && (
                <div style={{ marginTop:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <SignalBadge signal={s.signal} />
                  <span style={{ fontSize:10, color:T.muted }}>streak: {s.streak}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
