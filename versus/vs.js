/* =========================================================
   FLAG GAME 대전 모드 (M1: 방 번호로 1:1)
   - index.html을 복제한 versus.html 위에서 돈다. 엔진(판정·수비 움직임·simulate·R)은 건드리지 않는다.
   - 화면을 보내지 않고 입력만 주고받는다: 수비 {actual, shown} / 공격 {play, throw, result}
   - 수비 기기는 같은 입력으로 장면을 다시 계산해 본다 (versus/vsengine.js 의 runDown)
   - 데이터 구조·규칙: docs/대전모드_설계서.md 6절, firebase/database.rules.json
   ========================================================= */
import { FIREBASE_CONFIG, SDK } from './fbconfig.js';

const L = LEVELS[VSE.VS_LV];
const VS_VER = `p${PLAY_VER}-vs1`;           // 엔진 작전 형식 + 대전 모드 버전. 다르면 같은 방에 못 들어감
const CFG = { offSec:40, defSec:15, cardSec:30 };
const DEF_KEYS = Object.keys(DEFS0);
const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

const VS = {
  code:null, uid:null, room:null, st:null, tOff:0, key:'',
  setupK:-1, driveReset:0, snapK:-1, liveK:-1, resK:-1, revealK:-1, localRes:null, want3d:false,
  def:null, cardK:-1, cardAt:0, hTried:{}, fixDef:null, finalShown:false, mismatch:0, waitShown:-1
};
window.VS = VS; // 디버그용
let fb = null;   // {db, ref, get, set, update, onValue, serverTimestamp, onDisconnect}

/* ---------- 화면 붙이기 ---------- */
function inject(){
  document.body.insertAdjacentHTML('beforeend', `
<div id="vsLobby" class="gOver" role="dialog" aria-modal="true" aria-labelledby="vsLobbyT"><div class="gCard">
  <div class="gKick">FLAG GAME · 1:1 대전</div>
  <h2 class="gTitle" id="vsLobbyT">FLAG<b>VS</b></h2>
  <p class="gLead">한 사람은 <b>공격</b>, 한 사람은 <b>수비</b>. 드라이브가 끝나면 바뀌어요.<br>점수가 높은 쪽이 이겨요.</p>
  <ul class="gRules">
    <li>각자 <b>공격 드라이브 1번</b> · 골까지 25야드, 4번 안에 터치다운</li>
    <li>수비는 대형을 고르고, 드라이브마다 한 번 <b>위장</b>할 수 있어요</li>
    <li>작전 시간: 공격 ${CFG.offSec}초 · 수비 ${CFG.defSec}초</li>
  </ul>
  <div id="vsJoin">
    <div class="gField"><label for="vsCodeIn">방 번호 <small>상대가 만든 방 번호 4자리</small></label><input id="vsCodeIn" type="tel" inputmode="numeric" maxlength="4" autocomplete="off"></div>
    <div class="vsRow"><button class="btn primary" id="vsBtnJoin">들어가기</button></div>
    <div class="vsOr">또는</div>
    <div class="vsRow"><button class="btn" id="vsBtnNew">새 방 만들기</button></div>
  </div>
  <div id="vsWaitBox" hidden>
    <div class="gKick" style="text-align:center">방 번호</div>
    <div class="vsCode" id="vsCodeBig"></div>
    <div class="vsWait"><i></i>상대가 이 번호로 들어오기를 기다리는 중</div>
    <div class="vsRow"><button class="btn" id="vsBtnLeave">나가기</button></div>
  </div>
  <div class="vsMsg" id="vsMsg"></div>
  <a class="vsLink" href="index.html">혼자 하기로 →</a> &nbsp;·&nbsp; <a class="vsLink" href="versus.html?test">기기 비교 시험</a>
</div></div>

<div id="vsEnd" class="gOver" role="dialog" aria-modal="true" aria-labelledby="vsEndT"><div class="gCard">
  <div class="gKick" id="vsEndKick"></div>
  <h2 class="vsResult" id="vsEndT"></h2>
  <div class="vsScoreLine" id="vsEndScore"></div>
  <div class="gDrives" id="vsEndDrives"></div>
  <div class="vsRow" style="margin-top:16px"><button class="btn" id="vsBtnSeeLast">마지막 장면 보기</button><button class="btn primary" id="vsBtnAgain">새 대전</button></div>
</div></div>

<div id="vsTest" class="gOver" role="dialog" aria-modal="true" aria-labelledby="vsTestT"><div class="gCard">
  <div class="gKick">FLAG GAME 대전 · 기기 비교 시험</div>
  <h2 class="gTitle" id="vsTestT" style="font-size:40px">같은 계산?</h2>
  <p class="gLead">미리 정해 둔 작전 <b>100개</b>를 이 기기에서 계산해요.<br>웨일북과 아이폰에서 아래 <b>결과 코드</b>가 같으면 두 기기의 판정이 같은 거예요.</p>
  <button class="btn primary gGo" id="vsBtnTest">시험 시작</button>
  <div class="vsDigest" id="vsDigest" hidden>
    <span>결과 코드</span><b id="vsDgOut"></b>
    <span>정밀 코드</span><b id="vsDgStrict" style="font-size:20px"></b>
    <span>결과 종류</span><span id="vsDgCnt"></span>
    <span>걸린 시간</span><span id="vsDgTime"></span>
  </div>
  <div class="vsRow" id="vsTestActs" hidden><button class="btn" id="vsBtnTestCopy">결과 복사</button><a class="btn" href="versus.html" style="text-align:center">대전으로</a></div>
  <pre id="vsTestLog" hidden></pre>
  <p class="vsLink" id="vsTestUA"></p>
</div></div>`);

  $('side').insertAdjacentHTML('afterbegin', `
<section class="box" id="vsStatBox"><div id="vsStat"></div></section>
<section class="box" id="vsDefBox">
  <h2>우리 수비 고르기 <span class="r" id="vsDefClock"></span></h2>
  <div class="vsSit" id="vsDefSit"></div>
  <div class="vsLbl">실제 수비</div>
  <div class="vsForms" id="vsActual"></div>
  <label class="vsDisg"><input type="checkbox" id="vsDisgOn"> 위장하기 <span id="vsDisgLeft"></span></label>
  <div id="vsShownWrap" hidden><div class="vsLbl">스냅 전에 상대에게 보여 줄 대형</div><div class="vsForms shown" id="vsShown"></div></div>
  <button class="btn primary" id="vsDefGo">이 수비로 확정</button>
  <div class="vsNote" id="vsDefMsg"></div>
</section>`);

  // 상황판: 레벨 칸 → 작전 시계, 점수 칸 → 나 : 상대
  sbLv.parentElement.classList.add('vsClock'); sbLv.parentElement.querySelector('small').textContent='남은 시간'; sbLv.textContent='–';
  sbScore.parentElement.classList.add('vsScore'); sbScore.parentElement.querySelector('small').textContent='나 : 상대';
  sbDrive.parentElement.querySelector('small').textContent='드라이브';
}

/* ---------- 엔진 쪽 고리 (함수를 바꿔 끼울 뿐, 엔진 코드는 그대로) ---------- */
function hookEngine(){
  G.lv = VSE.VS_LV;
  gStart.classList.remove('show'); gEnd.classList.remove('show');
  S.guide='space'; document.querySelectorAll('.guideSel button').forEach(b=>b.classList.toggle('on',b.dataset.g==='space'));

  window.renderSB = renderSB;
  window.renderSit = renderSit;
  window.endGame = ()=>{};
  window.submitScore = ()=>{};
  // 조 보관함 작전을 불러와도 지금 보이는 수비는 그대로
  const dec0 = window.decodePlay; window.decodePlay = function(code){ const r=dec0(code); if(VS.fixDef) S.defKey=VS.fixDef; return r; };
  // 플레이가 끝나면: 공격 기기만 결과를 올린다
  window.gamePlayDone = function(){
    if(G.phase!=='live') return; setPhase('done');
    hint.textContent='아래 시간 막대로 되감아 보거나, 3D로 다시 볼 수 있어요';
    const st=VS.st; if(!st || st.phase!=='live' || roleOf(st.sit)!=='off' || VS.resK===st.k) return;
    VS.resK=st.k;
    const o=JSON.parse(JSON.stringify(playOutcome())), res={o, at:fb.serverTimestamp()};
    if(S.pass) res.thr={rid:S.pass.rid, t:S.pass.t};
    VS.localRes={k:st.k, o};
    fb.set(fb.ref(fb.db,`rooms/${VS.code}/downs/${st.k}/res`), res).catch(e=>{ VS.resK=-1; toast('결과를 보내지 못했어요: '+e.message); });
  };
  // 핸드오프 뒤 3D 리시버 버튼을 누르면 엔진이 멈추는 경우를 막음 (2D 필드와 같은 조건)
  const thr0 = window.throwTo; window.throwTo = function(rid){ if(G.phase==='live' && !S.pass && !VSE.canThrow(S.t)){ hint.textContent='공을 든 선수가 끝까지 달려요'; return; } return thr0(rid); };
  btnSnap.onclick = ()=>vsSnap(false);
  btn3d.onclick = async ()=>{
    if(G.phase==='done'){ open3d(); return; }
    const st=VS.st; if(!st || st.phase!=='off' || roleOf(st.sit)!=='off' || G.phase!=='call') return;
    btn3d.disabled=true; btn3d.textContent='3D 준비 중…';
    try{ await loadThree(); await loadAssets(); }catch(e){ btn3d.disabled=false; btn3d.textContent='3D로 플레이'; toast('3D 부품을 받지 못했어요. 2D로 플레이해 주세요'); return; }
    VS.want3d=true; vsSnap(false);
  };
  btnMenu.textContent='나가기';
  btnMenu.onclick = ()=>{ if(VS.code && !confirm('대전에서 나갈까요? 이 기기는 방에서 빠져요')) return; leave(); };
}

/* ---------- Firebase ---------- */
function withTimeout(p,ms,msg){ let t; return Promise.race([p,new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error(msg)),ms); })]).finally(()=>clearTimeout(t)); }
async function fbInit(){
  const [A,U,D] = await withTimeout(Promise.all([import(SDK('app')),import(SDK('auth')),import(SDK('database'))]),15000,'Firebase 부품을 받지 못했어요');
  const app=A.initializeApp(FIREBASE_CONFIG), auth=U.getAuth(app);
  await withTimeout(auth.authStateReady(),10000,'로그인 상태를 확인하지 못했어요');
  const user = auth.currentUser || (await withTimeout(U.signInAnonymously(auth),15000,'로그인 서버가 대답하지 않아요')).user;
  const db=D.getDatabase(app);
  fb={ db, ref:D.ref, get:D.get, set:D.set, update:D.update, onValue:D.onValue, serverTimestamp:D.serverTimestamp, onDisconnect:D.onDisconnect };
  VS.uid=user.uid;
  D.onValue(D.ref(db,'.info/serverTimeOffset'), s=>{ VS.tOff=+s.val()||0; });
  D.onValue(D.ref(db,'.info/connected'), s=>{ if(s.val()===true && VS.code) markOnline(); });
}
const now = ()=>Date.now()+VS.tOff;
const roomRef = p => fb.ref(fb.db, `rooms/${VS.code}${p?'/'+p:''}`);

/* ---------- 로비 ---------- */
function lobbyMsg(t,bad){ vsMsg.textContent=t||''; vsMsg.className='vsMsg'+(bad?' bad':''); }
function showLobby(waitCode){
  vsLobby.classList.add('show'); vsJoin.hidden=!!waitCode; vsWaitBox.hidden=!waitCode;
  if(waitCode) vsCodeBig.textContent=waitCode;
}
async function createRoom(){
  lobbyMsg('방을 만드는 중…');
  for(let i=0;i<15;i++){
    const c=String(1000+Math.floor(Math.random()*9000));
    try{
      const s=(await fb.get(fb.ref(fb.db,`rooms/${c}/seats`))).val(); if(s) continue;
      await fb.update(fb.ref(fb.db,`rooms/${c}`), { meta:{v:VS_VER, createdAt:fb.serverTimestamp(), first:Math.random()<0.5?0:1, cfg:CFG}, 'seats/0':VS.uid, [`players/${VS.uid}`]:'0' });
      lobbyMsg(''); return enterRoom(c);
    }catch(e){ console.warn('[VS] 방 만들기 재시도', e.message); }
  }
  lobbyMsg('방을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요', true);
}
async function joinRoom(c){
  if(!/^\d{4}$/.test(c)){ lobbyMsg('방 번호 4자리를 적어 주세요', true); return; }
  lobbyMsg('들어가는 중…');
  try{
    const [s,m]=await Promise.all([fb.get(fb.ref(fb.db,`rooms/${c}/seats`)), fb.get(fb.ref(fb.db,`rooms/${c}/meta`))]);
    const seats=s.val(), meta=m.val();
    if(!seats||!meta){ store.del('vs.room'); lobbyMsg('그런 방이 없어요. 번호를 확인해 주세요', true); return; }
    if(meta.v!==VS_VER){ lobbyMsg('두 기기의 프로그램 버전이 달라요. 둘 다 새로고침 해 주세요', true); return; }
    if(Object.values(seats).includes(VS.uid)){ lobbyMsg(''); return enterRoom(c); }
    if(seats[1]){ store.del('vs.room'); lobbyMsg('이미 두 명이 들어간 방이에요', true); return; }
    await fb.update(fb.ref(fb.db,`rooms/${c}`), { 'seats/1':VS.uid, [`players/${VS.uid}`]:'1' });
    lobbyMsg(''); enterRoom(c);
  }catch(e){ lobbyMsg('들어가지 못했어요: '+e.message, true); }
}
let unRoom=null;
function enterRoom(c){
  VS.code=c; store.set('vs.room',c); markOnline();
  if(unRoom) unRoom();
  unRoom = fb.onValue(roomRef(), s=>{ VS.room=s.val(); onRoom(); }, e=>{ lobbyMsg('방을 읽지 못했어요: '+e.message, true); });
}
function markOnline(){ const r=roomRef(`online/${VS.uid}`); fb.set(r,true).then(()=>fb.onDisconnect(r).remove()).catch(()=>{}); }
function leave(){ store.del('vs.room'); if(VS.code){ fb.set(roomRef(`online/${VS.uid}`),null).catch(()=>{}); } setTimeout(()=>location.replace('versus.html'),150); }

/* ---------- 방 데이터 → 경기 상태 (두 기기가 같은 데이터로 같은 상태를 계산) ---------- */
function compute(rm){
  const seats=rm.seats||{}, uids=[seats[0],seats[1]];
  const st={uids, scores:{}, drives:[], over:false};
  if(!uids[0]||!uids[1]||!rm.meta){ st.phase='lobby'; return st; }
  uids.forEach(u=>st.scores[u]=0);
  const D=rm.downs||{};
  let drive=1, off=rm.meta.first, down=1, goalNow=START_G, conv=null, disg=0, lastAct=null, over=false;
  const newDrive=()=>({off:uids[off], plays:0, res:'', downs:0, pts:0, conv:''});
  let cur=newDrive(); st.drives.push(cur);
  const sitNow=()=>({drive, off:uids[off], def:uids[1-off], down, conv, goal:conv?CONV_G[conv]:goalNow, disg, lastAct});
  const endDrive=()=>{ drive++; off=1-off; down=1; goalNow=START_G; conv=null; disg=0; lastAct=null;
    if(drive>2) over=true; else { cur=newDrive(); st.drives.push(cur); } };
  let k=0, needConv=false;
  for(;;){
    const d=D[k], sit=sitNow(); if(!d||!d.res) break;
    const o=d.res.o, td=o.k==='td' || (o.k==='gain' && o.gain>=sit.goal-1e-6);
    if(d.shown!==d.actual) disg++; lastAct=d.actual; cur.plays++;
    st.last={k, d, sit, td, o};
    if(sit.conv){ if(td){ st.scores[sit.off]+=sit.conv; cur.pts+=sit.conv; } cur.conv=td?`+${sit.conv}`:'✕'; endDrive(); }
    else if(td){ const pts=6+(down===1?1:0); st.scores[sit.off]+=pts; cur.pts+=pts; cur.res='TD'; cur.downs=down;
      if(!d.conv){ needConv=true; break; } conv=+d.conv; }
    else { const gain=o.k==='inc'?0:o.gain; goalNow=clamp(+(goalNow-gain).toFixed(1),0.5,30);
      if(down>=4){ cur.res='실패'; endDrive(); } else down++; }
    k++; if(over) break;
  }
  st.k=k; st.over=over; st.sit=over?null:sitNow(); st.needConv=needConv;
  if(needConv){ st.phase='result'; st.rk=st.last.k; }
  else if(over){ st.phase='final'; st.rk=st.last.k; }
  else { const d=D[k]; st.d=d||null;
    if(!d||!d.h){ st.phase = k===0 ? 'start' : 'result'; st.rk=k-1; }
    else st.phase = !d.shown ? 'def' : !d.play ? 'off' : !d.actual ? 'reveal' : !d.res ? 'live' : 'result'; }
  return st;
}
const roleOf = sit => !sit ? null : sit.off===VS.uid ? 'off' : sit.def===VS.uid ? 'def' : null;
const oppOf = st => st.uids.find(u=>u!==VS.uid);

/* ---------- 상태가 바뀔 때 ---------- */
function onRoom(){
  const rm=VS.room;
  if(!rm || !rm.seats){ store.del('vs.room'); VS.code=null; showLobby(null); lobbyMsg('방이 사라졌어요', true); return; }
  if(rm.meta && rm.meta.v!==VS_VER){ showLobby(null); lobbyMsg('두 기기의 프로그램 버전이 달라요. 둘 다 새로고침 해 주세요', true); return; }
  const st=compute(rm); VS.st=st;
  if(st.phase==='lobby'){ showLobby(VS.code); return; }
  vsLobby.classList.remove('show');
  maybeStartNext(st);
  const key = st.phase + ':' + (st.phase==='result'||st.phase==='final' ? st.rk : st.k) + (st.needConv?'c':'');
  const entering = key!==VS.key; VS.key=key;
  render(st, entering);
}

/* 다음 다운 시작 (방에 h를 한 번만 쓴다: 규칙이 두 번째 쓰기를 막음) */
function maybeStartNext(st){
  let k=null;
  if(st.phase==='start') k=0;
  else if(st.phase==='result' && !st.needConv){ const r=(VS.room.downs[st.rk]||{}).ready||{}; if(st.uids.every(u=>r[u])) k=st.k; }
  if(k==null || VS.hTried[k]) return; VS.hTried[k]=true;
  fb.set(roomRef(`downs/${k}/h`), {startAt:fb.serverTimestamp(), off:st.sit.off, def:st.sit.def}).catch(()=>{});
}

function setBodyRole(role, phase){
  document.body.classList.toggle('vs-def', role==='def'); document.body.classList.toggle('vs-off', role==='off');
  for(const c of [...document.body.classList]) if(c.startsWith('vs-phase-')) document.body.classList.remove(c);
  document.body.classList.add('vs-phase-'+phase);
}

function render(st, entering){ render0(st, entering); tick(); }
function render0(st, entering){
  const ph=st.phase, sit = (ph==='result'||ph==='final') ? st.last.sit : st.sit, role=roleOf(sit);
  setBodyRole(role, ph);
  renderStat(st, role); renderSB();
  if(ph==='start') return;
  if(ph==='def'||ph==='off'||ph==='reveal'||ph==='live'){
    if(VS.setupK!==st.k) setupDown(st, role);
    VS.fixDef = role==='off' && (ph==='def'||ph==='off') ? (st.d.shown || (st.sit.lastAct||'2-2')) : null;
    if(role==='off' && ph==='off' && G.phase==='call' && S.defKey!==st.d.shown){ S.defKey=st.d.shown; renderChips(); draw(); }
    if(role==='def') renderDef(st);
    if(role==='off') renderSit();
    if(ph==='reveal' && role==='def') doReveal(st);
    if(ph==='reveal' && role==='off' && VS.snapK!==st.k && entering){ applyGoal(st.d.play.goal); decodePlay(st.d.play.code); setPhase('wait'); hint.textContent='수비가 공개되는 중…'; }
    if(ph==='live' && role==='off') startLive(st);
    if(ph==='live' && role==='def' && entering){ hint.textContent='상대가 플레이하는 중… 끝나면 같은 장면을 다시 보여 줘요'; }
    if(ph==='off' && role==='off' && qs.has('debug')) secCheck(st);
    if(ph==='off' && role==='off' && entering && VS.snapK!==st.k){ hint.textContent='수비가 정해졌어요! 작전을 짜고 스냅'; if(st.d.shown) toast(`상대 수비: ${DEFS[st.d.shown].n}`); }
    updateNoteam(st, role);
    return;
  }
  // result / final
  updateNoteam(st, role);
  const myReady = !!(((VS.room.downs[st.rk]||{}).ready||{})[VS.uid]);
  if(ph==='final' && myReady){ showFinal(st); return; }
  if(myReady){ if(VS.waitShown!==st.rk) showWaiting(st, role); }
  else if(entering || VS.cardK!==st.rk) showResult(st, role);
}

function updateNoteam(st, role){
  const can = role==='off' && (st.phase==='def'||st.phase==='off') && G.phase==='call';
  document.body.classList.toggle('vs-noteam', !can);
}

/* 새 다운 준비 (다운마다 한 번) */
function setupDown(st, role){
  VS.setupK=st.k; VS.def=null; VS.cardK=-1;
  hideBanner(); vsEnd.classList.remove('show'); if(V3.open) close3d();
  const s=st.sit;
  applyGoal(s.goal); clearSim();
  if(s.down===1 && !s.conv && VS.driveReset!==s.drive){ VS.driveReset=s.drive; role==='off' ? defaultPlay(true) : defaultPlay(false); }
  if(role==='off'){
    S.defKey = st.d.shown || s.lastAct || '2-2'; setPhase('call'); renderChips(); renderGrid(); renderRun();
    hint.textContent = st.d.shown ? '작전을 짜고 스냅! 플레이 중에 리시버를 눌러 던져요' : '수비가 고르는 중… 그동안 작전을 짜 두세요';
  } else {
    setPhase('def'); VS.def={k:st.k, actual:s.lastAct||'2-2', disgOn:false, shown:null, done:false, sent:null};
    S.defKey=VS.def.actual;
    hint.textContent='상대 작전은 스냅 뒤에 공개돼요. 필드의 공격은 '+(s.lastAct?'바로 전 플레이 모습':'기본 대형')+'이에요';
  }
  draw();
}
function defaultPlay(withRoutes){
  if(S.mode!=='pass'){ const b=modeSel.querySelector('button[data-m="pass"]'); if(b) b.click(); }
  loadOffSet('spread');
  if(withRoutes){ Object.assign(S.off.W1,{route:'go'}); Object.assign(S.off.W2,{route:'slant'}); Object.assign(S.off.W3,{route:'out'}); Object.assign(S.off.C,{route:'hitch'}); }
  renderChips(); renderGrid(); renderRun();
}

/* ---------- 공격 ---------- */
function usesRoute(){ return S.mode==='pass' ? ELIG.some(id=>S.off[id].route) : ELIG.some(id=>S.off[id].route||(S.paths[id]&&S.paths[id].length)||S.roles[id]); }
async function vsSnap(auto){
  const st=VS.st; if(!st || st.phase!=='off' || roleOf(st.sit)!=='off' || G.phase!=='call' || VS.snapK===st.k) return;
  if(!usesRoute()){ if(auto) defaultPlay(true); else { toast('리시버에게 라우트를 하나 이상 주세요'); btn3d.disabled=false; btn3d.textContent='3D로 플레이'; VS.want3d=false; return; } }
  VSE.lockR(); S.rate=L.rate;
  const code=encodePlay(); decodePlay(code);          // 두 기기가 똑같이 0.1야드로 반올림된 작전을 쓰게
  const k=st.k; VS.snapK=k; setPhase('wait'); btn3d.disabled=true;
  hint.textContent = auto ? '시간이 다 되어 지금 작전으로 스냅! 수비가 공개되는 중…' : '스냅! 수비가 공개되는 중…';
  try{ await fb.set(roomRef(`downs/${k}/play`), {code, goal:st.sit.goal, at:fb.serverTimestamp()}); }
  catch(e){ VS.snapK=-1; setPhase('call'); toast('스냅을 보내지 못했어요: '+e.message); }
}
function startLive(st){
  if(VS.liveK===st.k) return; VS.liveK=st.k;
  const d=st.d;
  if(VS.snapK!==st.k){ applyGoal(d.play.goal); decodePlay(d.play.code); }   // 새로고침 뒤 이어 하기
  VSE.lockR(); S.rate=L.rate; VS.fixDef=null; S.defKey=d.actual; renderChips();
  setPhase('live'); renderSit();
  simulate(); computeWindows(); S.t=0; S.pass=null; resOut.textContent=''; winLine.innerHTML=''; result.style.display='none'; btn3d.disabled=true;
  hint.textContent = S.mode==='pass' ? '리시버를 눌러 던지세요! 러셔가 오고 있어요' : '공을 든 선수를 지켜보세요. QB가 들고 있으면 리시버를 눌러 던질 수 있어요';
  if(d.shown!==d.actual) toast(`위장! 스냅하자 ${DEFS[d.actual].n}(으)로 바뀌었어요`,3200);
  play();
  if(VS.want3d){ VS.want3d=false; open3d(); }
}

/* ---------- 수비 ---------- */
const disgLeft = st => Math.max(0, 1 - st.sit.disg);
function renderDef(st){
  const s=st.sit, D=VS.def, picking = st.phase==='def' && D && !D.done;
  if(D && D.k===st.k && !picking && !D.sent) loadMyPick(st);
  vsDefSit.innerHTML = s.conv
    ? `상대의 <b>추가 ${s.conv}점</b> 도전 · 골까지 <b>${fmtY(s.goal)}야드</b>`
    : `상대 <b>${s.down}번째 공격</b> · 골까지 <b>${fmtY(s.goal)}야드</b> · 상대 점수 <b>${st.scores[s.off]}</b>점`;
  const cur = D ? D.actual : null, sh = D ? D.shown : null;
  vsActual.innerHTML = DEF_KEYS.map(k=>`<button data-k="${k}" class="${k===cur?'on':''}" ${picking?'':'disabled'}><b>${esc(DEFS[k].n)}</b><small>${esc(DEFS[k].note)}</small></button>`).join('');
  vsActual.querySelectorAll('button').forEach(b=>b.onclick=()=>{ D.actual=b.dataset.k; if(D.shown===D.actual) D.shown=null; S.defKey=D.actual; clearSim(); draw(); renderDef(VS.st); });
  const left=disgLeft(st);
  vsDisgOn.checked = !!(D && D.disgOn); vsDisgOn.disabled = !picking || left<=0;
  vsDisgLeft.textContent = left>0 ? `이번 드라이브 ${left}번 남음` : '이번 드라이브에 이미 썼어요';
  vsDisgOn.onchange=()=>{ D.disgOn=vsDisgOn.checked; if(D.disgOn && !D.shown) D.shown=DEF_KEYS.find(k=>k!==D.actual && k!=='blitz'); renderDef(VS.st); };
  vsShownWrap.hidden = !(D && D.disgOn);
  vsShown.innerHTML = DEF_KEYS.map(k=>`<button data-k="${k}" class="${k===sh?'on':''}" ${picking&&k!==cur?'':'disabled'}><b>${esc(DEFS[k].n)}</b><small>${esc(DEFS[k].note)}</small></button>`).join('');
  vsShown.querySelectorAll('button').forEach(b=>b.onclick=()=>{ D.shown=b.dataset.k; renderDef(VS.st); });
  vsDefGo.disabled = !picking; vsDefGo.textContent = picking ? '이 수비로 확정' : '확정했어요';
  const sent = D && D.sent;
  const what = sent ? `실제 <b>${esc(DEFS[sent.actual].n)}</b>` + (sent.shown!==sent.actual ? ` · 보여 준 대형 <b>${esc(DEFS[sent.shown].n)}</b> (위장)` : '') : '';
  vsDefMsg.innerHTML = picking ? '대형을 누르면 필드에 우리 존이 보여요. 빈 곳이 어디인지 보세요'
    : st.phase==='def' ? '보내는 중…'
    : st.phase==='off' ? `${what} · 상대가 작전을 짜는 중…`
    : st.phase==='reveal' ? `${what} · 상대가 스냅했어요!`
    : st.phase==='live' ? `${what} · 상대가 플레이하는 중…` : what;
}
async function loadMyPick(st){ const D=VS.def; if(D.loading) return; D.loading=true;
  try{ const p=(await fb.get(fb.ref(fb.db,`picks/${VS.code}/${st.k}/${VS.uid}`))).val(); if(p){ D.sent=p; D.actual=p.actual; D.shown=p.shown; D.done=true; S.defKey=p.actual; draw(); renderDef(VS.st); } }
  catch(e){} }
async function confirmDef(auto){
  const st=VS.st, D=VS.def; if(!st||st.phase!=='def'||!D||D.done) return;
  if(auto){ D.actual=st.sit.lastAct||'2-2'; D.disgOn=false; }
  const actual=D.actual, shown = D.disgOn && D.shown && D.shown!==actual && disgLeft(st)>0 ? D.shown : actual;
  D.done=true; renderDef(st);
  try{
    await fb.update(fb.ref(fb.db), { [`picks/${VS.code}/${st.k}/${VS.uid}`]:{actual,shown}, [`rooms/${VS.code}/downs/${st.k}/shown`]:shown });
    D.sent={actual,shown}; if(auto) toast(`시간이 다 되어 ${DEFS[actual].n}(으)로 정했어요`);
    renderDef(VS.st);
  }catch(e){ D.done=false; renderDef(VS.st); toast('수비를 보내지 못했어요: '+e.message); }
}
async function doReveal(st){
  if(VS.revealK===st.k) return; VS.revealK=st.k;
  try{
    const p=(await fb.get(fb.ref(fb.db,`picks/${VS.code}/${st.k}/${VS.uid}`))).val();
    const actual = p && p.actual && p.shown===st.d.shown ? p.actual : st.d.shown;
    await fb.set(roomRef(`downs/${st.k}/actual`), actual);
  }catch(e){ VS.revealK=-1; console.warn('[VS] 공개 실패', e.message); }
}

/* 보안 확인 (?debug): 공격 기기가 스냅 전에 수비의 실제 선택을 읽으려 하면 막혀야 한다 */
async function secCheck(st){
  if(VS.secK===st.k) return; VS.secK=st.k;
  try{ const v=(await fb.get(fb.ref(fb.db,`picks/${VS.code}/${st.k}/${st.sit.def}`))).val();
    VS.sec = v ? 'bad' : 'empty'; console.error('[VS] 보안 확인', v); }
  catch(e){ VS.sec='ok'; VS.secN=(VS.secN||0)+1; console.log('[VS] 보안 확인 통과', e.message); }
  renderStat(VS.st, roleOf(VS.st.sit));
}

/* ---------- 결과 카드 ---------- */
function outcomeText(o, sit, td){
  if(sit.conv) return td ? `추가 ${sit.conv}점 성공!` : '추가 득점 실패';
  if(td) return 'TOUCHDOWN!';
  const gain=o.k==='inc'?0:o.gain;
  return o.k==='sack' ? `색! ${Math.round(gain)}야드` : o.k==='inc' ? (o.why==='쳐냄'?'쳐냄 · 패스 실패':o.why==='못 던짐'?'못 던졌어요':'패스 실패') : `${gain>=0?'+':''}${Math.round(gain)}야드`;
}
function showResult(st, role){
  const {k, d, sit, td, o}=st.last, again=VS.cardK===k; VS.cardK=k; VS.cardAt=Date.now(); VS.waitShown=-1;
  let mismatch='';
  if(!again && (role==='def' || !VS.localRes || VS.localRes.k!==k)){
    if(V3.open) close3d(); // 수비 기기(또는 새로고침한 공격 기기): 같은 입력으로 다시 계산
    const r=VSE.runDown({code:d.play.code, goal:d.play.goal, actual:d.actual, thr:d.res.thr||null});
    setPhase('done');
    if(!VSE.sameOutcome(r.o,o)){ VS.mismatch++; console.warn('[VS] 결과 불일치 — 공격 쪽 값을 씀', {mine:r.o, theirs:o}); mismatch = ` · ⚠ 이 기기 계산(${r.o.k} ${r.o.gain})과 달라 공격 쪽 결과를 썼어요`; }
    if(role==='def'){ S.t=0; play(); }
  }
  if(!again) hint.textContent = role==='def' ? '상대가 한 플레이를 똑같이 다시 보여 주는 중 · 우리 수비가 어디를 비웠는지 보세요' : '아래 시간 막대로 되감아 보거나, 3D로 다시 볼 수 있어요';
  const disg=d.shown!==d.actual, thr=d.res.thr;
  const rt = S.pass && S.pass.rt ? ` · ${S.pass.rt}` : '';
  const lines=[
    `수비 ${DEFS[d.actual].n}` + (disg ? ` (위장! 스냅 전엔 ${DEFS[d.shown].n})` : ''),
    thr ? `${labelOf(thr.rid)}에게 ${(+thr.t).toFixed(1)}초에 던짐${rt}` : o.how==='런' ? `${o.who} 런` : '던지지 않음',
  ];
  const big=outcomeText(o,sit,td);
  const good = o.k==='td'||td||(o.k==='gain'&&o.gain>=4), bad = o.k!=='gain'&&!td || (o.k==='gain'&&o.gain<=0);
  const tone = role==='off' ? (td?'td':good?'good':bad?'bad':'') : (td?'bad':bad?'good':good?'bad':'');
  const acts=[['다시 보기', replay, false, true], ['3D', ()=>open3d(), false, true]];
  if(st.needConv && role==='off') acts.push(['1점 · 5야드',()=>ready(1)], ['2점 · 12야드',()=>ready(2),true]);
  else if(!(st.needConv && role==='def')) acts.push([st.over?'최종 결과 ▶':'다음 ▶', ()=>ready(), true]);
  const sub = lines.join(' · ') + (st.needConv ? (role==='off'?' — 추가 득점을 고르세요':' — 상대가 추가 득점을 고르는 중') : '') + mismatch;
  banner(big, sub, acts, tone);
  renderSB();
}
function showWaiting(st, role){ VS.waitShown=st.rk;
  banner(gbBig.textContent, '상대가 다음으로 넘어가기를 기다리는 중…', [['다시 보기', replay, false, true], ['3D', ()=>open3d(), false, true]], gBanner.className.replace(/gBanner|show/g,'').trim()); }
function replay(){ if(!S.sim) return; if(V3.open){ S.t=0; play(); return; } stopPlay(); S.t=0; play(); }
function ready(conv){
  const st=VS.st; if(!st || (st.phase!=='result'&&st.phase!=='final')) return;
  const rk=st.rk, upd={[`downs/${rk}/ready/${VS.uid}`]:true};
  if(conv && st.needConv && roleOf(st.last.sit)==='off') upd[`downs/${rk}/conv`]=conv;
  fb.update(roomRef(), upd).catch(e=>toast('보내지 못했어요: '+e.message));
}
function showFinal(st){
  if(VS.finalShown) return; VS.finalShown=true; hideBanner();
  const me=VS.uid, op=oppOf(st), a=st.scores[me], b=st.scores[op], r=a>b?'win':a<b?'lose':'draw';
  vsEndKick.textContent=`대전 결과 · 방 ${VS.code}`;
  vsEndT.className='vsResult '+r; vsEndT.textContent = r==='win'?'승리!':r==='lose'?'패배':'무승부';
  vsEndScore.innerHTML = `나 ${a}<span>:</span>${b} 상대`;
  vsEndDrives.innerHTML = st.drives.map((x,i)=>`<div class="d ${x.res==='TD'?'td':'no'}"><b>${x.off===me?'내 공격':'상대 공격'}</b><span>${x.res==='TD'?`${x.downs}번째 공격에 터치다운`+(x.conv?` · 추가점 ${x.conv}`:''):'4번 안에 실패'}</span><span class="p">${x.pts}점</span></div>`).join('');
  vsEnd.classList.add('show');
}

/* ---------- 상단·상태 ---------- */
function renderStat(st, role){
  const op=oppOf(st), on=!!((VS.room.online||{})[op]);
  vsStat.innerHTML = `${role?`<span class="role ${role}">${role==='off'?'내가 공격':'내가 수비'}</span>`:''}<span class="room">방 ${esc(VS.code)}</span>`
    + `<span class="opp ${on?'':'off'}">${on?'상대 연결됨':'상대 연결 끊김'}</span>`
    + (qs.has('debug') ? `<span class="sec ${VS.sec||''}">${ VS.sec==='ok' ? `✓ 보안 확인 ${VS.secN}번 통과 (스냅 전 수비 선택을 못 읽음)` : VS.sec==='bad' ? '✗ 보안 문제: 스냅 전에 수비 선택이 읽혔어요!' : VS.sec==='empty' ? '? 보안 확인: 수비 선택이 비어 있음' : '보안 확인: 내가 공격할 때 확인해요' }</span>` : '');
}
function renderSB(){
  const st=VS.st; if(!st || st.phase==='lobby') return;
  const sit = (st.phase==='result'||st.phase==='final'||!st.sit) ? st.last.sit : st.sit, me=VS.uid, op=oppOf(st);
  sbDrive.textContent = `${Math.min(sit.drive,2)}/2`;
  sbDown.textContent = sit.conv ? `+${sit.conv}` : `${sit.down}`;
  sbPips.innerHTML = sit.conv ? '' : [1,2,3,4].map(i=>`<i class="${i===sit.down?'on':i<sit.down?'used':''}"></i>`).join('');
  sbTogo.textContent = fmtY(sit.goal); sbScore.textContent = `${st.scores[me]} : ${st.scores[op]}`;
}
function renderSit(){
  const st=VS.st; if(!st || !st.d) return;
  const d=st.d, shown=d.shown, revealed=d.actual && G.phase!=='call' && G.phase!=='wait';
  if(!shown){ sitDef.textContent='고르는 중…'; defNote.textContent='상대가 수비를 고르고 있어요'; }
  else { const k=revealed?d.actual:shown; sitDef.innerHTML = esc(DEFS[k].n) + (revealed && d.shown!==d.actual ? '<small>위장이었어요!</small>' : ''); defNote.textContent=DEFS[k].note; }
  sitCoach.textContent='';
}

/* 시계 (0.25초마다) */
function tick(){
  const st=VS.st; if(!st || st.phase==='lobby') return;
  const ph=st.phase, sit=(ph==='result'||ph==='final')?st.last.sit:st.sit, role=roleOf(sit), t=now();
  let left=null;
  if((ph==='def'||ph==='off') && st.d && st.d.h && typeof st.d.h.startAt==='number'){
    const dl = st.d.h.startAt + (role==='def' ? CFG.defSec : CFG.offSec)*1000;
    if(role==='def' && ph==='def') left=(dl-t)/1000;
    if(role==='off') left=(dl-t)/1000;
    if(role==='def' && ph==='def' && left<=0) confirmDef(true);
    if(role==='off' && ph==='off' && left<=0 && G.phase==='call') vsSnap(true);
  }
  if(ph==='result'||ph==='final'){
    const myReady=!!(((VS.room.downs[st.rk]||{}).ready||{})[VS.uid]);
    if(!myReady && VS.cardK===st.rk && !(st.needConv && role==='def')){ left=CFG.cardSec-(Date.now()-VS.cardAt)/1000; if(left<=0) ready(st.needConv&&role==='off'?1:undefined); }
  }
  const c=sbLv.parentElement;
  if(left==null){ sbLv.textContent='–'; c.classList.remove('low'); }
  else { const s=Math.max(0,Math.ceil(left)); sbLv.textContent=s+'초'; c.classList.toggle('low', s<=5); }
  if(role==='def') vsDefClock.textContent = ph==='def' && left!=null ? `${Math.max(0,Math.ceil(left))}초` : '';
  btnSnap.disabled = !(ph==='off' && role==='off' && G.phase==='call');
  if(role==='off' && ph==='def' && G.phase==='call') btnSnap.textContent='수비가 고르는 중…'; else btnSnap.textContent='스냅!';
}

/* ---------- 기기 비교 시험 (?test) ---------- */
function runTest(){
  vsTest.classList.add('show'); vsTestUA.textContent=navigator.userAgent;
  vsBtnTest.onclick=()=>{ vsBtnTest.disabled=true; vsBtnTest.textContent='계산 중…';
    setTimeout(()=>{ const t0=performance.now(); const r=VSE.runCases(100); const ms=performance.now()-t0;
      vsDgOut.textContent=r.outcome.toUpperCase(); vsDgStrict.textContent=r.strict.toUpperCase();
      vsDgCnt.textContent=`터치다운 ${r.cnt.td||0} · 전진 ${r.cnt.gain||0} · 패스 실패 ${r.cnt.inc||0} · 색 ${r.cnt.sack||0}`;
      vsDgTime.textContent=`${(ms/1000).toFixed(1)}초`;
      vsDigest.hidden=false; vsTestActs.hidden=false; vsTestLog.hidden=false; vsTestLog.textContent=r.outs.join('\n');
      vsBtnTest.disabled=false; vsBtnTest.textContent='다시 시험';
      vsBtnTestCopy.onclick=async()=>{ const txt=`FLAG GAME 기기 비교\n결과 코드 ${r.outcome}\n정밀 코드 ${r.strict}\n${vsDgCnt.textContent}\n${navigator.userAgent}`;
        try{ await navigator.clipboard.writeText(txt); toast('복사했어요'); }catch(e){ prompt('아래 내용을 복사하세요',txt); } };
    },50); };
}

/* ---------- 시작 ---------- */
async function boot(){
  inject(); hookEngine();
  if(qs.has('test')){ runTest(); return; }
  showLobby(null); lobbyMsg('연결하는 중…');
  vsJoin.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{ await fbInit(); }
  catch(e){
    console.error(e);
    vsJoin.hidden=true;
    vsMsg.className='vsMsg bad';
    vsMsg.innerHTML=`대전을 쓸 수 없어요 (${esc(e.message)}).<br><a href="index.html" class="btn primary" style="display:block;text-align:center;margin-top:10px">혼자 하기로 이동</a>`;
    return;
  }
  lobbyMsg(''); vsJoin.querySelectorAll('button').forEach(b=>b.disabled=false);
  vsCodeIn.oninput=()=>{ vsCodeIn.value=vsCodeIn.value.replace(/\D/g,'').slice(0,4); };
  vsCodeIn.onkeydown=e=>{ if(e.key==='Enter') joinRoom(vsCodeIn.value); };
  vsBtnJoin.onclick=()=>joinRoom(vsCodeIn.value);
  vsBtnNew.onclick=()=>createRoom();
  vsBtnLeave.onclick=()=>leave();
  vsBtnAgain.onclick=()=>leave();
  vsBtnSeeLast.onclick=()=>{ vsEnd.classList.remove('show'); VS.finalShown=true; replay(); };
  vsDefGo.onclick=()=>confirmDef(false);
  setInterval(tick,250);
  const saved=store.get('vs.room'); if(saved) joinRoom(saved);
}
boot();
