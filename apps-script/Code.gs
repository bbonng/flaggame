/**
 * FLAG GAME 기록 저장소 (Google Apps Script)
 *   - 학생 게임(index.html)  : 경기를 끝내면 점수를 보냄
 *   - 교실 TV(board.html)    : 실시간 순위표 (교사 열쇠 필요)
 *   수업용 작전 저장소(공간작전판·계획서)와는 따로 쓰는 시트입니다.
 *
 * 쓰는 법
 *  1. 구글 시트를 새로 만들고 [확장 프로그램 > Apps Script]에 이 코드를 통째로 붙여 넣고 저장
 *  2. 시트로 돌아와 새로고침 → 위 메뉴 [FLAG GAME > 처음 설정] 실행 (권한 허용) → 교사 열쇠가 나옴
 *  3. Apps Script 화면에서 [배포 > 새 배포 > 유형: 웹 앱]
 *       - 다음 사용자로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자
 *     → 나온 웹 앱 주소(…/exec)를 게임·순위표 파일에 넣으면 끝
 *
 *  코드를 고친 뒤에는 [배포 > 배포 관리 > 연필(수정) > 버전: 새 버전 > 배포]로 올려야
 *  주소가 바뀌지 않습니다. ([새 배포]를 누르면 주소가 바뀝니다)
 *
 * 시트
 *  - 게임기록 : 시간 | 문제 | 반 | 번호 | 이름 | 난이도 | 점수 | 랭킹 점수 | 터치다운 | 숨김 | 저장 번호
 *               → 경기를 끝까지 하면 한 줄씩 쌓입니다. 순위표는 한 사람(반·번호·이름)의 최고 랭킹 점수만 셉니다.
 *               '숨김'을 TRUE로 바꾸면 그 줄은 순위표에서 빠집니다.
 *  - 설정     : 교사열쇠 | 기록마감
 *               기록마감 예: 8,9 → 8반·9반 기록 안 받음 / all → 전체 마감 / 비우면 마감 없음
 */

const SHEET_SCORES = '게임기록', SHEET_CONF = '설정';
const SCORE_HEAD = ['시간', '문제', '반', '번호', '이름', '난이도', '점수', '랭킹 점수', '터치다운', '숨김', '저장 번호'];
const LV_MULT = [1, 1.5, 2, 3]; // 난이도별 랭킹 배율 (루키·주전·프로·올스타)
const MAX_SCORE = 45;           // 드라이브 5번 × (터치다운 6 + 첫 공격 보너스 1 + 추가 2점)
const MAX_FAIL = 5;             // 교사 열쇠를 이만큼 틀리면
const LOCK_SEC = 300;           // 이 시간(초) 동안 잠김

/* ---------------- 시트 메뉴 ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('FLAG GAME')
    .addItem('처음 설정', 'setup')
    .addItem('교사 열쇠 보기', 'showKey')
    .addToUi();
}

function setup() {
  setup_();
  SpreadsheetApp.getUi().alert('준비됐어요.\n\n교사 열쇠: ' + getConf_('교사열쇠') + '\n\n다음은 [배포 > 새 배포 > 웹 앱]이에요.');
}

function setup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_SCORES, SCORE_HEAD);
  ensureSheet_(ss, SHEET_CONF, ['항목', '값']);
  if (!getConf_('교사열쇠')) setConf_('교사열쇠', randKey_());
  if (getConf_('기록마감') === null) setConf_('기록마감', '');
}

function showKey() { SpreadsheetApp.getUi().alert('교사 열쇠: ' + getConf_('교사열쇠') + '\n\n교실 TV 순위표(board.html)에서 한 번만 넣으면 됩니다.'); }

/* ---------------- 웹 앱 ---------------- */
function doGet() { return json_({ ok: true, msg: 'FLAG GAME 기록 저장소가 켜져 있어요' }); }

function doPost(e) {
  let q;
  try { q = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, err: 'bad', msg: '요청을 읽지 못했어요' }); }
  try {
    switch (q.action) {
      case 'ping': return json_({ ok: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONF), msg: '연결됐어요', now: new Date().toISOString() });
      case 'score_submit': return json_(scoreSubmit_(q));
      case 'score_board': return json_(scoreBoard_(q));
      default: return json_({ ok: false, err: 'action', msg: '알 수 없는 요청이에요' });
    }
  } catch (err) {
    return json_({ ok: false, err: 'server', msg: '저장소에서 문제가 생겼어요: ' + err });
  }
}

/* ---------------- 기록 ---------------- */
function scoreSubmit_(q) {
  const quiz = +q.q, c = +q.c, n = +q.n, lv = +q.lv, score = +q.score, td = +q.td, name = safe_(q.name, 10);
  if (!(quiz >= 1 && quiz <= 999999 && quiz === Math.floor(quiz))) return { ok: false, err: 'q', msg: '문제 번호가 이상해요' };
  if (!(c >= 1 && c <= 30 && n >= 1 && n <= 60) || !name) return { ok: false, err: 'who', msg: '반·번호·이름을 확인해 주세요' };
  if (!(lv >= 1 && lv <= LV_MULT.length)) return { ok: false, err: 'lv', msg: '난이도가 이상해요' };
  if (!(score >= 0 && score <= MAX_SCORE && score === Math.floor(score)) || !(td >= 0 && td <= 5)) return { ok: false, err: 'score', msg: '점수가 이상해요' };
  if (isClosed_(c)) return { ok: false, err: 'closed', msg: c + '반은 지금 기록을 받지 않아요' };
  const rank = Math.round(score * LV_MULT[lv - 1]), id = String(q.id || '').slice(0, 40);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_SCORES, SCORE_HEAD);
    if (!(id && seenId_(sh, 11, id))) sh.appendRow([new Date(), quiz, c, n, name, lv, score, rank, td, false, id]); // 응답이 끊겨 다시 보낸 경우 한 번만
  } finally { lock.releaseLock(); }
  const board = boardOf_(quiz), me = c + '-' + n + '-' + name;
  const place = board.findIndex(r => r.c + '-' + r.n + '-' + r.name === me) + 1;
  return { ok: true, rank: rank, place: place, players: board.length };
}

function scoreBoard_(q) {
  const k = keyCheck_(q.key); if (!k.ok) return k;
  const quiz = +q.q; if (!(quiz >= 1)) return { ok: false, err: 'q', msg: '문제 번호를 넣어 주세요' };
  const board = boardOf_(quiz);
  return { ok: true, q: quiz, rows: board.slice(0, 300), players: board.length, now: new Date().toISOString() };
}

/* 한 사람(반·번호·이름)의 최고 기록만: 랭킹 점수 → 점수 → 먼저 낸 사람 순 */
function boardOf_(quiz) {
  const best = {};
  scores_().forEach(r => { if (r.q !== quiz || r.hidden) return; const key = r.c + '-' + r.n + '-' + r.name; const b = best[key];
    if (!b || r.rank > b.rank || (r.rank === b.rank && r.score > b.score)) best[key] = Object.assign({}, r, { tries: (b ? b.tries : 0) + 1 }); else b.tries++; });
  return Object.keys(best).map(k => best[k]).sort((a, b) => b.rank - a.rank || b.score - a.score || (a.time < b.time ? -1 : 1));
}

function scores_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCORES); if (!sh) return [];
  const v = sh.getDataRange().getValues(); const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; const quiz = +r[1], c = +r[2], n = +r[3]; if (!(quiz > 0 && c > 0 && n > 0)) continue;
    out.push({ time: iso_(r[0]), q: quiz, c: c, n: n, name: String(r[4]), lv: +r[5], score: +r[6], rank: +r[7], td: +r[8], hidden: isTrue_(r[9]) });
  }
  return out;
}

function keyCheck_(key) {
  const cache = CacheService.getScriptCache(), n = +(cache.get('fail_teacher') || 0);
  if (n >= MAX_FAIL) return { ok: false, err: 'locked', msg: '교사 열쇠를 여러 번 틀려서 5분 동안 잠겼어요' };
  if (!key || String(key).trim() !== String(getConf_('교사열쇠')).trim()) { cache.put('fail_teacher', String(n + 1), LOCK_SEC); return { ok: false, err: 'key', msg: '교사 열쇠가 맞지 않아요' }; }
  cache.remove('fail_teacher'); return { ok: true };
}

function isClosed_(c) {
  const v = String(getConf_('기록마감') || '').trim().toLowerCase(); if (!v) return false;
  if (v === 'all' || v === '전체') return true;
  return v.split(/[,\s]+/).map(Number).indexOf(+c) >= 0;
}

/* ---------------- 도우미 ---------------- */
function seenId_(sh, col, id) {
  const last = sh.getLastRow(), from = Math.max(2, last - 300); if (last < 2) return false;
  const ids = sh.getRange(from, col, last - from + 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return true;
  return false;
}
function ensureSheet_(ss, name, head) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); }
  return sh;
}
function getConf_(k) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONF); if (!sh) return null;
  const v = sh.getDataRange().getValues(); for (let i = 1; i < v.length; i++) if (String(v[i][0]) === k) return String(v[i][1]);
  return null;
}
function setConf_(k, val) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONF); const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]) === k) { sh.getRange(i + 1, 2).setValue(val); return; }
  sh.appendRow([k, val]);
}
function iso_(d) { return d instanceof Date ? d.toISOString() : String(d); }
function isTrue_(x) { return x === true || String(x).toUpperCase() === 'TRUE'; }
function randKey_() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function safe_(s, n) { s = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n); return /^[=+\-@]/.test(s) ? "'" + s : s; } // 시트 수식으로 바뀌지 않게
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
