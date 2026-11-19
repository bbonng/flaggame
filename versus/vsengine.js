/* =========================================================
   FLAG GAME 대전 모드 — 엔진 다시 돌리기 (일반 스크립트)
   - index.html의 엔진(simulate, throwTo, playOutcome, decodePlay …)을 고치지 않고 그대로 부른다.
   - 대전 수비 기기의 리플레이와, 기기 간 결정론 비교 시험(?test)이 같은 함수를 쓴다.
   - index.html 페이지에 이 파일만 넣어도 돌아가게 Firebase와 무관하게 만든다(회귀 확인용).
   ========================================================= */
(function(){
  const VS_LV = 1; // 주전 고정

  /* 엔진 상수 중 기기마다 달라질 수 있는 값을 주전 값으로 강제 (설정 창·localStorage 영향 제거) */
  function lockR(){ const L=LEVELS[VS_LV]; R.lag=L.lag; R.ballReact=L.ballReact; R.rushArrive=L.rush; }

  /* 그 순간 공이 QB 손에 있어야 던질 수 있다 (2D 필드는 막지만 3D 리시버 버튼은 안 막아서,
     런 플레이에서 핸드오프 뒤 누르면 index.html의 throwTo가 멈춘다 → 대전에서는 여기서 거른다) */
  function canThrow(t){ if(!S.sim) return false; const f=frameAt(Math.max(0.2,Math.round(t*10)/10)); return f.holder==='QB'; }

  /* 한 다운을 입력만으로 다시 계산한다.
     down = { code: encodePlay() 문자열, goal: 골까지 야드, actual: 실제 수비 키, thr: {rid,t} | null }
     돌려줌: { o: playOutcome(), strict: 정밀 비교용 문자열 }
     호출 뒤 S.sim / S.pass 가 그 장면으로 남아 있어 바로 재생할 수 있다. */
  function runDown(down){
    const keep = window.gamePlayDone; window.gamePlayDone = function(){}; // throwTo 안의 색 처리 등이 경기 진행을 건드리지 않게
    try{
      lockR();
      applyGoal(down.goal);
      decodePlay(down.code);           // 화면도 그 작전으로 바뀜
      S.defKey = down.actual;
      setPhase('live');
      S.pass=null; S.t=0; simulate();
      if(down.thr && canThrow(down.thr.t)){ S.t = down.thr.t; throwTo(down.thr.rid); stopPlay(); }
      const o = playOutcome();
      return { o, strict: strictOf() };
    } finally { window.gamePlayDone = keep; }
  }

  /* 장면 전체를 숫자 그대로 이어 붙인 문자열 (마지막 자리까지 같은지 보기 위함) */
  function strictOf(){ const sm=S.sim, last=sm.frames[sm.frames.length-1], P=sm.pass;
    const pos = Object.keys(last.off).sort().map(id=>id+last.off[id].join(',')).join(';') + '|' + last.def.map(p=>p.join(',')).join(';') + '|' + last.rush.map(p=>p.join(',')).join(';');
    return [sm.frames.length, sm.tackleT, sm.sackT, sm.tdT, sm.gain, P?[P.tc,P.catchD,P.caught,P.who].join(','):'-', pos].join('#'); }

  /* 결과 비교용: 두 기기가 같은 결과인지 (야드는 0.1 단위) */
  function sameOutcome(a,b){ if(!a||!b) return false; const g=v=>v==null?'':(+v).toFixed(1);
    return a.k===b.k && g(a.gain)===g(b.gain) && (a.who||'')===(b.who||''); }

  /* ---------- 결정론 시험 케이스: 시드로 만든 작전 100개 ---------- */
  const SEED = 20261119;
  function genCase(i){
    const r=rng(hashN(SEED,i)), pick=a=>a[Math.floor(r()*a.length)], r1=v=>Math.round(v*1000)/1000;
    const off=pick(Object.keys(OFF_SETS)), mode=r()<0.3?'run':'pass', p={}, paths={}, roles={};
    const routeKeys=Object.keys(ROUTES);
    for(const [id,[x,y]] of Object.entries(OFF_SETS[off].p)){
      const nx = clamp(x+(r()-0.5)*3, FIELD.xMin+1, FIELD.xMax-1);
      const ny = id==='QB' ? clamp(y+(r()-0.5)*2, -9, -4) : clamp(y-r()*1.2, -3, 0);
      p[id]=[r1(nx), r1(ny), id==='QB'||r()<0.08 ? null : pick(routeKeys)];   // 반올림은 encode/decode가 한다
    }
    if(mode==='run'){
      const runner=pick(['C','W1','W2','W3']), qb=p.QB;
      paths[runner]=[[r1(qb[0]+0.6),r1(qb[1]+0.5)],[r1((r()-0.5)*16),r1(3+r()*3)],[r1((r()-0.5)*20),r1(12+r()*10)]]; roles[runner]='real';
      if(r()<0.5){ const fk=pick(['C','W1','W2','W3'].filter(x=>x!==runner)); paths[fk]=[[r1(qb[0]-0.6),r1(qb[1]+0.4)],[r1((r()-0.5)*20),r1(6+r()*8)]]; roles[fk]='fake'; }
      if(r()<0.3) paths.QB=[[r1(qb[0]+(r()-0.5)*6),r1(qb[1]+1)]];
    }
    const code=JSON.stringify({v:PLAY_VER,mode,off,def:'2-2',p,paths,roles});
    const goal=pick([25,25,21.5,17,12,9.5,6,3,5,12]);
    const actual=pick(Object.keys(DEFS0));
    const thr = r()<0.75 ? {rid:pick(ELIG), t:Math.round((0.4+r()*2.8)*10)/10} : null;
    return {code, goal, actual, thr};
  }

  function fnv(str){ let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193); } return ('0000000'+(h>>>0).toString(16)).slice(-8); }

  function runCases(n){ n=n||100; const outs=[], stricts=[], cnt={td:0,gain:0,inc:0,sack:0};
    for(let i=0;i<n;i++){ const c=genCase(i), r=runDown(c); const o=r.o;
      cnt[o.k]=(cnt[o.k]||0)+1;
      outs.push(`${i}:${o.k}:${o.gain==null?'':(+o.gain).toFixed(1)}:${o.who||''}`); stricts.push(r.strict); }
    return { n, outcome:fnv(outs.join('\n')), strict:fnv(stricts.join('\n')), cnt, outs, stricts }; }

  window.VSE = { lockR, canThrow, runDown, sameOutcome, genCase, runCases, fnv, VS_LV };
})();
