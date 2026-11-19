const WORDS = window.WORDS || [];
const PROGRESS_KEY = "vocab1528-progress-v1";
const SETTINGS_KEY = "vocab1528-settings-v1";
const ACTIVITY_KEY = "vocab1528-activity-v1";
const STARS_KEY = "vocab1528-stars-v1";
const LAST_ACCENT_KEY = "vocab1528-last-accent-v2";
const TEST_KEY = "vocab1528-testprep-v1"; // independent from 3-hit progress
const DAY = 86400000;
const IS_STANDALONE = !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
document.documentElement.classList.toggle("pwa-standalone", IS_STANDALONE);
const MAX_WORD_ID = WORDS.length ? Math.max(...WORDS.map(w => Number(w.id) || 0)) : 1528;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ACCENTS = [
  ["#4f46e5","79,70,229"],["#7c3aed","124,58,237"],["#c026d3","192,38,211"],
  ["#db2777","219,39,119"],["#e11d48","225,29,72"],["#ea580c","234,88,12"],
  ["#ca8a04","202,138,4"],["#16a34a","22,163,74"],["#059669","5,150,105"],
  ["#0891b2","8,145,178"],["#0284c7","2,132,199"],["#2563eb","37,99,235"]
];

let progress = loadJSON(PROGRESS_KEY, {});
let activity = loadJSON(ACTIVITY_KEY, {});
let stars = loadJSON(STARS_KEY, {});
let settings = Object.assign({
  theme:"system", rangeStart:1, rangeEnd:MAX_WORD_ID,
  targetDate:"", dailyQuota:100, plans:{}, mode:"mixed"
}, loadJSON(SETTINGS_KEY, {}));
if(!["en-ja","ja-en","mixed"].includes(settings.mode)) settings.mode="mixed";
settings.rangeStart = clamp(parseInt(settings.rangeStart)||1, 1, MAX_WORD_ID);
settings.rangeEnd = clamp(parseInt(settings.rangeEnd)||MAX_WORD_ID, 1, MAX_WORD_ID);
if(settings.rangeStart > settings.rangeEnd) [settings.rangeStart, settings.rangeEnd] = [settings.rangeEnd, settings.rangeStart];
settings.dailyQuota = clamp(parseInt(settings.dailyQuota)||100, 1, 5000);
if(!settings.plans || typeof settings.plans !== "object") settings.plans = {};

let testStore = loadJSON(TEST_KEY, {});
if(!testStore || typeof testStore !== "object" || Array.isArray(testStore)) testStore = {};
if(!testStore.config || typeof testStore.config !== "object") testStore.config = {};
testStore.config = Object.assign({start:settings.rangeStart,end:settings.rangeEnd,mode:"mixed"},testStore.config);
if(!Array.isArray(testStore.history)) testStore.history = [];
if(!testStore.active || typeof testStore.active !== "object") testStore.active = null;
let testCurrentUnit = null;
let testCurrentDirection = "en-ja";
let testAnswered = false;
let unitById = new Map();


let ALL_UNITS = [];
let activeUnits = [];
let currentUnit = null;
let currentDirection = "en-ja";
let missionAnswered = false;
let recentUnits = [];
let recentWords = [];
let recentDirections = [];
let retryQueue = [];
let questionNo = 0;
let combo = 0;
let quotaExtended = false;

function loadJSON(k,fallback){ try{return JSON.parse(localStorage.getItem(k)) ?? fallback}catch{return fallback} }
function persist(){
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  localStorage.setItem(STARS_KEY, JSON.stringify(stars));
}
function clamp(n,a,b){ return Math.min(b,Math.max(a,n)); }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function sample(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function toast(msg){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),1600); }

function syncVisualViewport(){
  if(IS_STANDALONE){
    const h=window.innerHeight || document.documentElement.clientHeight;
    document.documentElement.style.setProperty("--app-vh",`${Math.round(h)}px`);
    document.documentElement.style.setProperty("--app-vtop","0px");
    return;
  }
  const vv=window.visualViewport;
  const h=vv?vv.height:window.innerHeight;
  const top=vv?vv.offsetTop:0;
  document.documentElement.style.setProperty("--app-vh",`${Math.round(h)}px`);
  document.documentElement.style.setProperty("--app-vtop",`${Math.max(0,Math.round(top))}px`);
}
function scheduleViewportSync(){
  syncVisualViewport();
  requestAnimationFrame(syncVisualViewport);
  setTimeout(syncVisualViewport,120);
  setTimeout(syncVisualViewport,420);
}
function isLight(hex){
  const n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  return (r*299+g*587+b*114)/1000>170;
}
function setRandomAccent(force=false){
  const prev=localStorage.getItem(LAST_ACCENT_KEY);
  let pool=ACCENTS.filter(a=>force || a[0]!==prev);
  if(!pool.length) pool=ACCENTS;
  const [hex,rgb]=sample(pool);
  document.documentElement.style.setProperty("--accent",hex);
  document.documentElement.style.setProperty("--accent-rgb",rgb);
  document.documentElement.style.setProperty("--accentText",isLight(hex)?"#111827":"#ffffff");
  localStorage.setItem(LAST_ACCENT_KEY,hex);
}
function speak(text){
  if(!("speechSynthesis" in window)) return toast("このブラウザでは読み上げを利用できません");
  speechSynthesis.cancel();
  const clean=String(text).replace(/[～〜]/g," ").trim();
  const u=new SpeechSynthesisUtterance(clean); u.lang="en-US"; u.rate=.87; speechSynthesis.speak(u);
}

function splitMeanings(raw){
  const text=String(raw||"");
  const result=[]; let buf="", stack=[];
  const openers={"(":")","（":"）","[":"]","［":"］","{":"}","｛":"｝"};
  for(const ch of text){
    if(openers[ch]){ stack.push(openers[ch]); buf+=ch; continue; }
    if(stack.length && ch===stack[stack.length-1]){ stack.pop(); buf+=ch; continue; }
    if((ch==="，" || ch===",") && stack.length===0){
      const s=buf.trim(); if(s) result.push(s); buf=""; continue;
    }
    buf+=ch;
  }
  const tail=buf.trim(); if(tail) result.push(tail);
  return result.length ? result : [text.trim()];
}
function buildUnits(){
  ALL_UNITS=[];
  for(const w of WORDS){
    const senses=splitMeanings(w.meaning);
    senses.forEach((meaning,index)=>ALL_UNITS.push({ id:`${w.id}:${index+1}`, w, meaning, index, count:senses.length }));
  }
  unitById = new Map(ALL_UNITS.map(u=>[u.id,u]));
  refreshActiveUnits();
}
function refreshActiveUnits(){ activeUnits=ALL_UNITS.filter(u=>u.w.id>=settings.rangeStart && u.w.id<=settings.rangeEnd); }
function unitState(id){
  if(!progress[id]) progress[id]={hits:0,correct:0,wrong:0,seen:0};
  const s=progress[id]; s.hits=clamp(Number(s.hits)||0,0,3); return s;
}
function getHits(u){ return unitState(u.id).hits; }
function isClear(u){ return getHits(u)>=3; }
function unitWrong(u){ return unitState(u.id).wrong||0; }
function normalizedWord(s){ return String(s).toLowerCase().trim(); }

function localDateKey(d=new Date()){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
function dateFromKey(k){ const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function shiftDateKey(k,n){ const d=dateFromKey(k); d.setDate(d.getDate()+n); return localDateKey(d); }
function activityEntry(k=localDateKey()){
  if(!activity[k]) activity[k]={answered:0,correct:0,wrong:0,unitHits:{}};
  const a=activity[k]; if(!a.unitHits||typeof a.unitHits!=="object")a.unitHits={}; return a;
}
function streakCount(){
  const today=localDateKey();
  let cursor=(activity[today]?.answered||0)>0?today:shiftDateKey(today,-1), n=0;
  while((activity[cursor]?.answered||0)>0){ n++; cursor=shiftDateKey(cursor,-1); }
  return n;
}
function activeUnitIdSet(){ return new Set(activeUnits.map(u=>u.id)); }
function todayStats(){
  const a=activityEntry(), ids=activeUnitIdSet();
  let hits=0; for(const [id,n] of Object.entries(a.unitHits||{})) if(ids.has(id)) hits+=Number(n)||0;
  return {hits,answered:a.answered||0,correct:a.correct||0,wrong:a.wrong||0};
}
function missionData(units=activeUnits){
  let hits=0,cleared=0; const dist=[0,0,0,0];
  for(const u of units){ const h=getHits(u); hits+=h; dist[h]++; if(h>=3)cleared++; }
  const total=units.length*3, remaining=Math.max(0,total-hits), pct=total?Math.round(hits/total*100):0;
  return {hits,cleared,total,remaining,pct,dist,units:units.length};
}
function rangeWordCount(){ return Math.max(0,settings.rangeEnd-settings.rangeStart+1); }
function rangeKey(start=settings.rangeStart,end=settings.rangeEnd){ return `${start}-${end}`; }
function savePlanForCurrentRange(){ settings.plans[rangeKey()]={targetDate:settings.targetDate||"",dailyQuota:clamp(parseInt(settings.dailyQuota)||100,1,5000)}; }
function loadPlanForRange(){
  const p=settings.plans[rangeKey()];
  settings.targetDate=p?.targetDate||"";
  settings.dailyQuota=clamp(parseInt(p?.dailyQuota)||100,1,5000);
}
function planningData(){
  const m=missionData(); let days=null,needed=null;
  if(settings.targetDate){
    const target=dateFromKey(settings.targetDate),today=dateFromKey(localDateKey());
    const diff=Math.floor((target-today)/DAY); days=diff>=0?diff+1:0; needed=days>0?Math.ceil(m.remaining/days):null;
  }
  return {...m,days,needed};
}
function buildRangePreset(){
  const s=$("#rangePreset");
  let html=`<option value="custom">自由指定</option><option value="1-${MAX_WORD_ID}">全範囲 1–${MAX_WORD_ID}</option>`;
  for(let start=1;start<=MAX_WORD_ID;start+=100){ const end=Math.min(start+99,MAX_WORD_ID); html+=`<option value="${start}-${end}">${start}–${end}</option>`; }
  s.innerHTML=html; syncPreset();
}
function syncPreset(){ const val=rangeKey(), ok=[...$("#rangePreset").options].some(o=>o.value===val); $("#rangePreset").value=ok?val:"custom"; }
function modeText(mode=settings.mode){ return mode==="en-ja"?"英 → 日":mode==="ja-en"?"日 → 英":"ごちゃまぜ"; }
function refreshModeUI(){
  $$("#modeSegment button").forEach(b=>b.classList.toggle("active",b.dataset.mode===settings.mode));
  $("#modeHint").textContent=modeText();
}
function setMode(mode){ if(!["en-ja","ja-en","mixed"].includes(mode))return; settings.mode=mode; persist(); refreshModeUI(); refreshHome(); }

function refreshHome(){
  refreshActiveUnits();
  const m=missionData(), plan=planningData(), t=todayStats(), quota=settings.dailyQuota;
  $("#overallPct").textContent=m.pct; $("#earnedHits").textContent=m.hits.toLocaleString(); $("#totalHits").textContent=m.total.toLocaleString();
  $("#remainingHits").textContent=m.remaining.toLocaleString(); $("#clearedUnits").textContent=m.cleared.toLocaleString(); $("#rangeUnits").textContent=m.units.toLocaleString(); $("#streakCount").textContent=streakCount();
  $("#ringPct").textContent=m.pct+"%"; $("#progressRing").style.setProperty("--p",(m.pct*3.6)+"deg");
  $("#heroRange").textContent=`${settings.rangeStart}–${settings.rangeEnd}`;
  $("#rangeStart").value=settings.rangeStart; $("#rangeEnd").value=settings.rangeEnd; syncPreset();
  $("#rangeWordCount").textContent=rangeWordCount().toLocaleString(); $("#rangeMeaningCount").textContent=m.units.toLocaleString(); $("#rangeTotalHits").textContent=m.total.toLocaleString();
  $("#targetDate").value=settings.targetDate||""; $("#dailyQuota").value=quota;
  $("#daysLeft").textContent=plan.days==null?"—":plan.days; $("#planRemaining").textContent=m.remaining.toLocaleString(); $("#neededPerDay").textContent=plan.needed==null?"—":plan.needed.toLocaleString();
  $("#todayHits").textContent=t.hits.toLocaleString(); $("#todayQuotaText").textContent=quota.toLocaleString(); $("#dailyGoalBar").style.width=Math.min(100,t.hits/quota*100)+"%";
  refreshModeUI();
  const pace=$("#paceStatus"), hint=$("#planHint");
  if(m.remaining===0){ pace.textContent="範囲クリア"; pace.className="status-pill good"; hint.textContent=`${settings.rangeStart}–${settings.rangeEnd} の全${m.units.toLocaleString()}意味を3回ずつ正解しました。`; }
  else if(!settings.targetDate){ pace.textContent="目標日未設定"; pace.className="status-pill"; hint.textContent=`この範囲は全${m.units.toLocaleString()}意味、${m.total.toLocaleString()}正解でクリアです。`; }
  else if(plan.days===0){ pace.textContent="目標日経過"; pace.className="status-pill bad"; hint.textContent="この範囲の新しい目標日を設定してください。"; }
  else if(quota>=plan.needed){ pace.textContent="ペースOK"; pace.className="status-pill good"; hint.textContent=`必要ペースは1日 ${plan.needed.toLocaleString()} 正解。現在は「${modeText()}」です。`; }
  else { pace.textContent=`+${(plan.needed-quota).toLocaleString()}/日`; pace.className="status-pill warn"; hint.textContent=`目標日に間に合わせるには、1日あと ${(plan.needed-quota).toLocaleString()} 正解増やす必要があります。`; }
  $("#startMissionBtn").textContent = m.remaining===0 ? "この範囲はクリア済み" : (t.hits>=quota ? `今日達成済み · ${modeText()}で続ける` : `${modeText()}で今日のノルマを始める`);
  $("#startMissionBtn").disabled = m.remaining===0;
}
function savePlan(){
  settings.targetDate=$("#targetDate").value||""; settings.dailyQuota=clamp(parseInt($("#dailyQuota").value)||100,1,5000); $("#dailyQuota").value=settings.dailyQuota;
  savePlanForCurrentRange(); persist(); refreshHome();
}
function changeRange(start,end){
  savePlanForCurrentRange();
  let a=clamp(parseInt(start)||1,1,MAX_WORD_ID), b=clamp(parseInt(end)||MAX_WORD_ID,1,MAX_WORD_ID);
  if(a>b)[a,b]=[b,a];
  settings.rangeStart=a; settings.rangeEnd=b; loadPlanForRange(); refreshActiveUnits(); persist(); refreshHome();
}
function autoQuota(){
  settings.targetDate=$("#targetDate").value||settings.targetDate||"";
  const p=planningData();
  if(p.needed==null){ toast(settings.targetDate?"目標日が過ぎています":"先に目標日を設定してください"); return; }
  settings.dailyQuota=clamp(Math.max(1,p.needed),1,5000); savePlanForCurrentRange(); persist(); refreshHome(); toast(`1日 ${settings.dailyQuota.toLocaleString()} 正解に設定しました`);
}
function go(view){
  $$(".view").forEach(v=>v.classList.remove("active")); const el=$(`#${view}View`); if(el)el.classList.add("active");
  document.body.classList.toggle("quiz-open",view==="mission"||view==="testQuiz"); if(view==="mission"||view==="testQuiz")scheduleViewportSync();
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===(view==="testQuiz"?"test":view)));
  if(view!=="mission"&&view!=="testQuiz") window.scrollTo({top:0,behavior:"instant"});
  if(view==="home")refreshHome(); if(view==="test")refreshTestView(); if(view==="search")renderSearch(); if(view==="stats")renderStats();
}

function normalizeMeaning(s){
  return String(s).toLowerCase().replace(/[（(][^）)]*[）)]/g,"").replace(/[〈〉［］\[\]～〜・，、。,.\/＝=\s]/g,"");
}
function meaningTokens(s){
  const cleaned=String(s).replace(/[（(][^）)]*[）)]/g," ").replace(/[〈〉［］\[\]～〜・，、。,.\/＝=]/g," ");
  return [...new Set(cleaned.match(/[一-龯ぁ-んァ-ヶー]{2,}|[a-zA-Z]{3,}/g)||[])];
}
function meaningsOverlap(a,b){
  const na=normalizeMeaning(a),nb=normalizeMeaning(b); if(!na||!nb)return false; if(na===nb)return true;
  if(Math.min(na.length,nb.length)>=4&&(na.includes(nb)||nb.includes(na)))return true;
  const A=meaningTokens(a),B=meaningTokens(b); if(!A.length||!B.length)return false;
  let shared=0; for(const x of A) if(B.includes(x))shared++;
  return shared/Math.min(A.length,B.length)>=0.55;
}
function distractorsFor(unit,direction,primaryPool=activeUnits,secondaryPool=ALL_UNITS){
  const targetWord=normalizedWord(unit.w.word),picked=[],usedWords=new Set(),usedMeanings=[];
  function addFrom(pool){
    for(const c of shuffle(pool)){
      if(c.id===unit.id || c.w.id===unit.w.id || normalizedWord(c.w.word)===targetWord || meaningsOverlap(c.meaning,unit.meaning))continue;
      if(picked.some(x=>x.id===c.id) || usedWords.has(normalizedWord(c.w.word)))continue;
      if(usedMeanings.some(x=>meaningsOverlap(x,c.meaning)))continue;
      picked.push(c);usedWords.add(normalizedWord(c.w.word));usedMeanings.push(c.meaning);
      if(picked.length===3)break;
    }
  }
  addFrom(primaryPool);
  if(picked.length<3)addFrom(secondaryPool);
  return picked;
}

function weightedRandom(pool){
  let total=0; const weighted=pool.map(u=>{ const h=getHits(u),w=1+Math.min(4,unitWrong(u)*.55)+h*.18; total+=w; return [u,total]; });
  const r=Math.random()*total; return weighted.find(([,cum])=>r<cum)?.[0]||pool[0];
}
function queueRetry(unit){ if(!retryQueue.some(x=>x.id===unit.id))retryQueue.push({id:unit.id,due:questionNo+4+Math.floor(Math.random()*3)}); }
function chooseNextUnit(){
  retryQueue=retryQueue.filter(x=>{ const u=activeUnits.find(v=>v.id===x.id); return u&&!isClear(u); });
  const due=retryQueue.filter(x=>x.due<=questionNo);
  if(due.length){ const item=due[0]; retryQueue=retryQueue.filter(x=>x!==item); return activeUnits.find(u=>u.id===item.id); }
  let pool=activeUnits.filter(u=>!isClear(u)&&!recentUnits.includes(u.id)&&!recentWords.includes(normalizedWord(u.w.word)));
  if(pool.length<8)pool=activeUnits.filter(u=>!isClear(u)&&!recentUnits.includes(u.id));
  if(!pool.length)pool=activeUnits.filter(u=>!isClear(u));
  return pool.length?weightedRandom(pool):null;
}
function chooseDirection(){
  if(settings.mode!=="mixed")return settings.mode;
  if(recentDirections.length>=2 && recentDirections.slice(-2).every(x=>x===recentDirections.at(-1)))return recentDirections.at(-1)==="en-ja"?"ja-en":"en-ja";
  if(recentDirections.length && Math.random()<.42)return recentDirections.at(-1)==="en-ja"?"ja-en":"en-ja";
  return Math.random()<.5?"en-ja":"ja-en";
}
function startMission(forceContinue=false){
  refreshActiveUnits(); const m=missionData(); if(!m.remaining){toast("この範囲はクリア済みです");return;}
  quotaExtended=forceContinue || todayStats().hits>=settings.dailyQuota;
  currentUnit=null; missionAnswered=false; combo=0; retryQueue=[]; recentUnits=[]; recentWords=[]; recentDirections=[]; questionNo=0;
  go("mission"); nextMission();
}
function nextMission(){
  const t=todayStats(); if(!quotaExtended && t.hits>=settings.dailyQuota){showComplete();return;}
  currentUnit=chooseNextUnit(); missionAnswered=false; if(!currentUnit){showComplete(true);return;}
  currentDirection=chooseDirection(); recentDirections.push(currentDirection); if(recentDirections.length>5)recentDirections.shift();
  questionNo++; recentUnits.push(currentUnit.id); if(recentUnits.length>10)recentUnits.shift();
  recentWords.push(normalizedWord(currentUnit.w.word)); if(recentWords.length>5)recentWords.shift();
  renderMission();
}
function renderMission(){
  const u=currentUnit,m=missionData(),t=todayStats(),quota=settings.dailyQuota,h=getHits(u);
  $("#missionTodayHits").textContent=t.hits.toLocaleString(); $("#missionQuota").textContent=quota.toLocaleString(); $("#missionBar").style.width=Math.min(100,t.hits/quota*100)+"%";
  $("#missionRemaining").textContent=m.remaining.toLocaleString(); $("#missionRange").textContent=`${settings.rangeStart}–${settings.rangeEnd}`;
  $("#missionWordNo").textContent=`No. ${u.w.id}`; $("#senseHit").textContent=`${h} / 3`; $("#directionBadge").textContent=currentDirection==="en-ja"?"英 → 日":"日 → 英";
  $("#missionStarBtn").textContent=stars[u.w.id]?"★":"☆";
  $("#senseLabel").textContent=u.count>1?`意味 ${u.index+1}/${u.count}`:"単一意味";
  const prompt=$("#missionPrompt"), speakBtn=$("#missionSpeakBtn");
  if(currentDirection==="en-ja"){
    prompt.textContent=u.w.word; prompt.classList.remove("jp"); speakBtn.classList.remove("hidden");
  }else{
    prompt.textContent=u.meaning; prompt.classList.add("jp"); speakBtn.classList.add("hidden");
  }
  const f=$("#missionFeedback"); f.className="feedback-strip neutral"; f.textContent="1つ選んでください";
  const next=$("#nextMissionBtn"); next.disabled=true; next.textContent="選択してください";
  $("#missionChoices").innerHTML="";
  const choices=shuffle([u,...distractorsFor(u,currentDirection)]);
  choices.forEach(c=>$("#missionChoices").appendChild(makeChoice(c,u)));
  updateLiveStats();
}
function makeChoice(c,target){
  const b=document.createElement("button"); b.className="choice-card"; b.dataset.unit=c.id;
  const main=document.createElement("div"); main.className="choice-main";
  const reveal=document.createElement("div"); reveal.className="choice-reveal";
  if(currentDirection==="en-ja"){
    main.textContent=c.meaning;
    reveal.innerHTML=`<b>${escapeHTML(c.w.word)}</b>${c.count>1?` <span>· 意味${c.index+1}/${c.count}</span>`:""}`;
  }else{
    main.textContent=c.w.word; main.classList.add("en","has-audio");
    const audio=document.createElement("span"); audio.className="choice-audio"; audio.textContent="🔊"; audio.setAttribute("role","button"); audio.setAttribute("aria-label",`${c.w.word}を読み上げ`);
    audio.onclick=e=>{e.stopPropagation();speak(c.w.word);};
    b.appendChild(audio);
    reveal.textContent=c.meaning;
  }
  b.appendChild(main); b.appendChild(reveal);
  b.onclick=()=>answerMission(b,c.id===target.id);
  return b;
}
function recordMission(correct){
  const u=currentUnit,s=unitState(u.id),a=activityEntry(); s.seen=(s.seen||0)+1; a.answered=(a.answered||0)+1; let gained=0;
  if(correct){
    s.correct=(s.correct||0)+1; a.correct=(a.correct||0)+1;
    if(s.hits<3){s.hits++;a.unitHits[u.id]=(a.unitHits[u.id]||0)+1;gained=1;}
  }else{
    s.wrong=(s.wrong||0)+1; a.wrong=(a.wrong||0)+1; queueRetry(u);
  }
  persist(); return gained;
}
function answerMission(btn,correct){
  if(missionAnswered)return; missionAnswered=true; const u=currentUnit;
  [...$("#missionChoices").children].forEach(b=>{
    b.disabled=true; b.classList.add("answered");
    if(b.dataset.unit===u.id)b.classList.add("correct");
    else if(b===btn&&!correct)b.classList.add("wrong");
    else b.classList.add("dim");
  });
  const gained=recordMission(correct),h=getHits(u); combo=correct?combo+1:0; $("#senseHit").textContent=`${h} / 3`;
  const f=$("#missionFeedback");
  if(correct){f.className="feedback-strip good";f.textContent=h>=3?"✓ 正解 · この意味をクリア！":`✓ 正解 · ${h}/3`;}
  else{f.className="feedback-strip bad";f.textContent="✕ 不正解 · 正解は緑色。4〜6問後に再出題";}
  const next=$("#nextMissionBtn"); next.disabled=false; next.textContent="次の問題";
  updateMissionHeader(); updateLiveStats();
  const t=todayStats(); if(gained&&t.hits>0&&t.hits%25===0)toast(`この範囲で今日 ${t.hits.toLocaleString()} 正解！`);
}
function updateMissionHeader(){
  const t=todayStats(),m=missionData(),quota=settings.dailyQuota;
  $("#missionTodayHits").textContent=t.hits.toLocaleString(); $("#missionQuota").textContent=quota.toLocaleString(); $("#missionBar").style.width=Math.min(100,t.hits/quota*100)+"%"; $("#missionRemaining").textContent=m.remaining.toLocaleString();
}
function updateLiveStats(){ const t=todayStats(); $("#todayAccuracy").textContent=t.answered?Math.round(t.correct/t.answered*100)+"%":"—"; }
function showComplete(all=false){
  const m=missionData(),t=todayStats(); $("#completeTodayHits").textContent=t.hits.toLocaleString(); $("#completeRemaining").textContent=m.remaining.toLocaleString(); $("#completeUnits").textContent=m.cleared.toLocaleString(); $("#completeRange").textContent=`${settings.rangeStart}–${settings.rangeEnd}`;
  $("#continueMissionBtn").classList.toggle("hidden",all||m.remaining===0); go("complete");
}
function toggleStar(id){ stars[id]=!stars[id]; persist(); return stars[id]; }

function renderSearch(){
  const q=$("#searchInput").value.trim().toLowerCase();
  const list=(q?WORDS.filter(w=>w.word.toLowerCase().includes(q)||w.meaning.toLowerCase().includes(q)):WORDS.slice(0,80)).slice(0,180);
  $("#searchResults").innerHTML=list.map(w=>{
    const units=ALL_UNITS.filter(u=>u.w.id===w.id), inRange=w.id>=settings.rangeStart&&w.id<=settings.rangeEnd;
    const rows=units.map(u=>`<div class="sense-row"><span>${u.count>1?`${u.index+1}/${u.count}`:""}</span><em>${escapeHTML(u.meaning)}</em><b>${getHits(u)}/3</b></div>`).join("");
    return `<div class="word-item ${inRange?"in-range":""}"><div><div class="meta">No. ${w.id} · ${units.length}意味 ${inRange?"· 学習範囲内":""}</div><h4>${escapeHTML(w.word)}</h4>${rows}</div><button class="mini-star" data-star="${w.id}">${stars[w.id]?"★":"☆"}</button></div>`;
  }).join("");
  $$('[data-star]').forEach(b=>b.onclick=()=>{const on=toggleStar(Number(b.dataset.star));b.textContent=on?"★":"☆";});
}
function renderWeekStrip(){
  const today=localDateKey(),labels=["日","月","火","水","木","金","土"],ids=activeUnitIdSet(),cells=[];
  for(let i=6;i>=0;i--){
    const key=shiftDateKey(today,-i),d=dateFromKey(key),a=activity[key]||{},count=0;
    for(const [id,n] of Object.entries(a.unitHits||{}))if(ids.has(id))count+=Number(n)||0;
    cells.push(`<div class="week-day ${count?"active":""}"><span>${labels[d.getDay()]}</span><b>${d.getDate()}</b><small>${count||"—"}</small></div>`);
  }
  $("#weekStrip").innerHTML=cells.join("");
}
function renderStats(){
  refreshActiveUnits(); const m=missionData(),allStates=Object.values(progress),correct=allStates.reduce((a,s)=>a+(s.correct||0),0),wrong=allStates.reduce((a,s)=>a+(s.wrong||0),0),t=todayStats();
  $("#statsRangeTitle").textContent=`範囲 ${settings.rangeStart}–${settings.rangeEnd}`; $("#statsHits").textContent=m.hits.toLocaleString(); $("#statsClearedUnits").textContent=m.cleared.toLocaleString(); $("#statsRemaining").textContent=m.remaining.toLocaleString();
  $("#statsStreak").textContent=streakCount(); $("#statsToday").textContent=t.hits.toLocaleString(); $("#statsAccuracy").textContent=(correct+wrong)?Math.round(correct/(correct+wrong)*100)+"%":"—";
  $("#hitDistribution").innerHTML=m.dist.map((n,i)=>`<div><span>${i}/3</span><div class="mini-bar"><i style="width:${m.units?Math.round(n/m.units*100):0}%"></i></div><b>${n.toLocaleString()}</b></div>`).join("");
  renderWeekStrip();
  const hard=activeUnits.filter(u=>unitWrong(u)>0&&!isClear(u)).sort((a,b)=>unitWrong(b)-unitWrong(a)||getHits(a)-getHits(b)).slice(0,12);
  $("#hardList").innerHTML=hard.length?hard.map(u=>`<div class="hard-item"><div><b>${escapeHTML(u.w.word)}${u.count>1?` · 意味${u.index+1}`:""}</b><span>${escapeHTML(u.meaning)}</span></div><em>誤答 ${unitWrong(u)} · ${getHits(u)}/3</em></div>`).join(""):`<p class="tiny">この範囲にはまだ誤答記録がありません。</p>`;
  const chunks=[];
  for(let start=1;start<=MAX_WORD_ID;start+=100){
    const end=Math.min(start+99,MAX_WORD_ID),units=ALL_UNITS.filter(u=>u.w.id>=start&&u.w.id<=end),cleared=units.filter(isClear).length,p=units.length?Math.round(cleared/units.length*100):0;
    chunks.push(`<div class="chunk"><span>${start}–${end}</span><div class="mini-bar"><i style="width:${p}%"></i></div><b>${p}%</b></div>`);
  }
  $("#chunkStats").innerHTML=chunks.join("");
}
function exportProgress(){
  savePlanForCurrentRange(); persist();
  const payload={version:3,book:"vocab1528",exportedAt:new Date().toISOString(),progress,settings,activity,stars,testStore};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`vocab1528-plus-progress-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importProgress(file){
  try{
    const j=JSON.parse(await file.text()); if(!j||j.book!=="vocab1528"||typeof j.progress!=="object")throw new Error();
    progress=j.progress; activity=(j.activity&&typeof j.activity==="object")?j.activity:{}; stars=(j.stars&&typeof j.stars==="object")?j.stars:{}; settings=Object.assign(settings,j.settings||{});
    settings.rangeStart=clamp(parseInt(settings.rangeStart)||1,1,MAX_WORD_ID);settings.rangeEnd=clamp(parseInt(settings.rangeEnd)||MAX_WORD_ID,1,MAX_WORD_ID);if(settings.rangeStart>settings.rangeEnd)[settings.rangeStart,settings.rangeEnd]=[settings.rangeEnd,settings.rangeStart];
    settings.dailyQuota=clamp(parseInt(settings.dailyQuota)||100,1,5000);if(!settings.plans||typeof settings.plans!=="object")settings.plans={};if(!["en-ja","ja-en","mixed"].includes(settings.mode))settings.mode="mixed";
    if(j.testStore && typeof j.testStore==="object" && !Array.isArray(j.testStore)){
      testStore=j.testStore;
      if(!testStore.config||typeof testStore.config!=="object")testStore.config={start:1,end:MAX_WORD_ID,mode:"mixed"};
      if(!Array.isArray(testStore.history))testStore.history=[];
      if(!testStore.active||typeof testStore.active!=="object")testStore.active=null;
      persistTest();
    }
    refreshActiveUnits();persist();refreshHome();toast("進捗を読み込みました");
  }catch{toast("この単語帳の進捗データではありません")}
}
function resetProgress(){
  if(confirm("通常学習の3回正解記録・学習履歴をリセットしますか？（テスト前の記録は残ります）")){
    progress={};activity={};stars={};localStorage.removeItem(PROGRESS_KEY);localStorage.removeItem(ACTIVITY_KEY);localStorage.removeItem(STARS_KEY);persist();refreshHome();toast("リセットしました");
  }
}

// --------------------- Test preparation v6: exactly once per No. per round ---------------------
// Each round has an immutable shuffled order of distinct word IDs.  A word is
// answered at most once in that round, irrespective of right/wrong.  Misses are
// recorded for the *next* round, never returned to the current round's queue.
// A fresh sense is drawn on every new appearance, favoring sense #1 (70%).
const TEST_ENGINE_VERSION = 6;
function persistTest(){
  try{localStorage.setItem(TEST_KEY,JSON.stringify(testStore));}
  catch(e){toast("保存容量が不足しています。バックアップをご利用ください");}
}
function testConfigSafe(){
  const c=testStore.config;
  c.start=clamp(Number.parseInt(c.start)||1,1,MAX_WORD_ID);
  c.end=clamp(Number.parseInt(c.end)||MAX_WORD_ID,1,MAX_WORD_ID);
  if(c.start>c.end)[c.start,c.end]=[c.end,c.start];
  if(!["en-ja","ja-en","mixed"].includes(c.mode))c.mode="mixed";
  return c;
}
function testRangeUnits(c=testConfigSafe()){
  return ALL_UNITS.filter(u=>u.w.id>=c.start&&u.w.id<=c.end);
}
function testWordUnits(wordId){return ALL_UNITS.filter(u=>u.w.id===wordId);}
function uniqueValidWordIds(xs){
  return [...new Set((Array.isArray(xs)?xs:[]).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=MAX_WORD_ID))];
}
// Older versions did not record a complete, non-repeating order. Preserve the
// current v5 pending items and already counted answers; for v3/v4 preserve
// already-cleared words and start a fresh round of the remaining ones.
function ensureTestSession(s){
  if(!s)return s;
  if(s.selectionType==="once-per-round-v6")return s;
  const previous=s.selectionType;
  if(previous==="rounds-per-word"){
    const ids=uniqueValidWordIds(s.wordIds);
    const cleared=new Set(uniqueValidWordIds(s.clearedWordIds));
    const pending=[];
    if(s.currentWordId!=null && !s.currentAnswered)pending.push(Number(s.currentWordId));
    pending.push(...(Array.isArray(s.roundQueue)?s.roundQueue:[]).map(Number));
    const order=[...new Set(pending)].filter(id=>ids.includes(id)&&!cleared.has(id));
    s.wordIds=ids;
    s.clearedWordIds=ids.filter(id=>cleared.has(id));
    s.roundOrder=order;
    s.roundIndex=0;
    s.roundDone=Math.max(0,Number(s.roundDone)||0);
    s.roundSize=s.roundDone+order.length;
    s.roundMissed=uniqueValidWordIds(s.roundMissed).filter(id=>ids.includes(id));
    s.roundAnsweredIds=[...s.roundMissed];
    s.roundHistory=Array.isArray(s.roundHistory)?s.roundHistory:[];
    s.roundNumber=Math.max(1,Number(s.roundNumber)||1);
    s.migratedFromOlderTest=true;
  }else{
    const originalIds=(Array.isArray(s.unitIds)?s.unitIds:[]).map(x=>Number.parseInt(String(x).split(":")[0],10));
    const ids=uniqueValidWordIds(originalIds);
    const cleared=new Set((Array.isArray(s.clearedIds)?s.clearedIds:[]).map(x=>Number.parseInt(String(x).split(":")[0],10)));
    const pending=ids.filter(id=>!cleared.has(id));
    s.wordIds=ids;
    s.clearedWordIds=ids.filter(id=>cleared.has(id));
    s.roundNumber=1;
    s.roundOrder=shuffle(pending);
    s.roundIndex=0;
    s.roundDone=0;
    s.roundSize=pending.length;
    s.roundMissed=[];
    s.roundAnsweredIds=[];
    s.roundHistory=[];
    s.migratedFromOlderTest=true;
  }
  s.answers=Number(s.answers)||0;
  s.correct=Number(s.correct)||0;
  s.wrong=Number(s.wrong)||0;
  if(!s.mistakes||typeof s.mistakes!=="object")s.mistakes={};
  if(!Array.isArray(s.recentDirections))s.recentDirections=[];
  s.currentWordId=null;s.currentUnitId=null;s.currentDirection=null;s.currentAnswered=false;
  s.selectionType="once-per-round-v6";
  s.testEngineVersion=TEST_ENGINE_VERSION;
  persistTest();
  return s;
}
function testSummary(session){
  const total=(session.wordIds||session.unitIds||[]).length;
  const cleared=(session.clearedWordIds||session.clearedIds||[]).length;
  return {id:session.id,createdAt:session.createdAt,finishedAt:session.finishedAt||null,abandonedAt:session.abandonedAt||null,
    selectionType:session.selectionType||"legacy-meaning-sample",start:session.start,end:session.end,mode:session.mode,total,cleared,
    migratedFromOlderTest:!!session.migratedFromOlderTest,
    roundNumber:session.roundNumber||null,roundSize:session.roundSize||null,roundDone:session.roundDone||0,
    roundHistory:Array.isArray(session.roundHistory)?session.roundHistory:[],
    correct:session.correct||0,wrong:session.wrong||0,
    accuracy:(session.answers?Math.round((session.correct||0)/session.answers*100):null)};
}
function testPresetBuild(){
  let html=`<option value="custom">自由指定</option><option value="1-${MAX_WORD_ID}">全範囲 1–${MAX_WORD_ID}</option>`;
  for(let i=1;i<=MAX_WORD_ID;i+=100)html+=`<option value="${i}-${Math.min(MAX_WORD_ID,i+99)}">${i}–${Math.min(MAX_WORD_ID,i+99)}</option>`;
  $("#testRangePreset").innerHTML=html;
}
function testPreview(){
  const a=clamp(Number.parseInt($("#testRangeStart").value)||1,1,MAX_WORD_ID),
        b=clamp(Number.parseInt($("#testRangeEnd").value)||MAX_WORD_ID,1,MAX_WORD_ID);
  const start=Math.min(a,b),end=Math.max(a,b);
  const total=WORDS.filter(w=>w.id>=start&&w.id<=end).length;
  $("#testAvailableLabel").textContent=`No. ${start}–${end} · 1周目は重複なしで ${total.toLocaleString()}問（不正解は次の周へ）`;
  const key=`${start}-${end}`;
  $("#testRangePreset").value=[...$("#testRangePreset").options].some(x=>x.value===key)?key:"custom";
}
function chooseTestSense(units){
  if(!units.length)return null;
  if(units.length===1||Math.random()<.70)return units[0];
  return units[1+Math.floor(Math.random()*(units.length-1))];
}
function refreshTestView(){
  const c=testConfigSafe(),s=ensureTestSession(testStore.active);
  $("#testRangeStart").value=c.start;$("#testRangeEnd").value=c.end;
  $$("#testModeSegment button").forEach(b=>b.classList.toggle("active",b.dataset.testMode===c.mode));
  testPreview();
  const panel=$("#testCurrentPanel");panel.classList.toggle("hidden",!s);
  if(s){
    const sum=testSummary(s),pct=sum.total?Math.round(sum.cleared/sum.total*100):0;
    $("#testCurrentTitle").textContent=sum.finishedAt?"テスト完了！":"進行中のテスト";
    $("#testStateTag").textContent=sum.finishedAt?"全問クリア":"途中から再開OK";
    $("#testStateTag").className=`status-pill ${sum.finishedAt?"good":""}`;
    $("#testCurrentInfo").textContent=`No. ${sum.start}–${sum.end} · ${modeText(sum.mode)} · ${sum.total}問 · ${new Date(sum.createdAt).toLocaleDateString("ja-JP")}`;
    $("#testCurrentPct").textContent=`${pct}%`;$("#testCurrentBar").style.width=`${pct}%`;
    $("#testCleared").textContent=sum.cleared;$("#testLeft").textContent=sum.total-sum.cleared;$("#testWrong").textContent=sum.wrong;
    const roundMsg=sum.finishedAt?`${sum.roundNumber||1}周で全問クリア`:`第${sum.roundNumber||1}周 · ${sum.roundDone||0}/${sum.roundSize||0}問 回答済み`;
    $("#testCurrentAccuracy").textContent=`${roundMsg} · 累計回答 ${sum.correct+sum.wrong}回 · 正答率 ${sum.accuracy==null?"—":sum.accuracy+"%"}`;
    $("#testRoundHistory").textContent=(sum.roundHistory||[]).length?
      `周回の記録：${sum.roundHistory.map(x=>`${x.number}周目 ${x.total}問 → 不正解${x.missed}問`).join(" ／ ")}`:
      "1周目は指定範囲の全単語を重複なしで1回ずつ出題します。";
    const warning=$("#testLegacyNotice");warning.classList.toggle("hidden",!sum.migratedFromOlderTest);
    $("#resumeTestBtn").classList.toggle("hidden",!!sum.finishedAt);
    $("#resumeTestBtn").textContent=`第${sum.roundNumber||1}周の続きから再開する`;
  }
  const all=[];if(s)all.push(testSummary(s));all.push(...testStore.history);
  $("#testHistory").innerHTML=all.length?all.slice(0,12).map((t,i)=>{
    const pct=t.total?Math.round(t.cleared/t.total*100):0;
    const status=t.finishedAt?"完了":t.abandonedAt?"途中で終了":"進行中";
    const rounds=t.roundNumber?` · ${t.roundNumber}周目`:"";
    return `<div class="test-history-item"><div class="test-history-top"><b>${i===0&&s?"現在のテスト":escapeHTML(new Date(t.createdAt).toLocaleDateString("ja-JP"))} · ${escapeHTML(status)}</b><span>${t.cleared}/${t.total}問 · ${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="test-history-info">No. ${t.start}–${t.end} · ${modeText(t.mode)}${rounds} · 正答 ${t.correct} / 誤答 ${t.wrong}</div></div>`;
  }).join(""):`<p class="tiny">まだテスト記録がありません。番号の範囲を指定して始めましょう。</p>`;
}
function saveTestConfigFromUI(){
  const c=testStore.config;
  c.start=clamp(Number.parseInt($("#testRangeStart").value)||1,1,MAX_WORD_ID);
  c.end=clamp(Number.parseInt($("#testRangeEnd").value)||MAX_WORD_ID,1,MAX_WORD_ID);
  if(c.start>c.end)[c.start,c.end]=[c.end,c.start];
  testPreview();persistTest();return c;
}
function createTest(){
  const c=saveTestConfigFromUI();
  const ids=WORDS.filter(w=>w.id>=c.start&&w.id<=c.end).map(w=>w.id);
  if(!ids.length){toast("この範囲に問題がありません");return;}
  if(testStore.active && !testStore.active.finishedAt && !confirm("進行中のテストを終了して、新しいテストを作成しますか？\nこれまでの結果は履歴に残ります。"))return;
  if(testStore.active){
    ensureTestSession(testStore.active);
    if(!testStore.active.finishedAt)testStore.active.abandonedAt=new Date().toISOString();
    testStore.history.unshift(testSummary(testStore.active));
    testStore.history=testStore.history.slice(0,30);
  }
  testStore.active={
    id:`${Date.now()}-${Math.floor(Math.random()*1e6)}`,
    start:c.start,end:c.end,mode:c.mode,selectionType:"once-per-round-v6",testEngineVersion:TEST_ENGINE_VERSION,
    createdAt:new Date().toISOString(),finishedAt:null,
    wordIds:ids,clearedWordIds:[],answers:0,correct:0,wrong:0,mistakes:{},
    roundNumber:1,roundSize:ids.length,roundDone:0,
    roundOrder:shuffle(ids),roundIndex:0,roundMissed:[],roundAnsweredIds:[],roundHistory:[],
    currentWordId:null,currentUnitId:null,currentDirection:null,currentAnswered:false,
    recentDirections:[],migratedFromOlderTest:false
  };
  persistTest();openTestQuiz();
}
function openTestQuiz(){
  const s=ensureTestSession(testStore.active);
  if(!s){toast("先にテストを作成してください");return;}
  if(s.finishedAt){go("test");return;}
  go("testQuiz");
  // On reload, keep an unanswered question; a previously answered question
  // advances without a second count (answers must never be double-counted).
  if(s.currentWordId!=null&&!s.currentAnswered&&unitById.has(s.currentUnitId)){
    testCurrentUnit=unitById.get(s.currentUnitId);
    testCurrentDirection=s.currentDirection||"en-ja";testAnswered=false;
    renderTestQuestion();return;
  }
  nextTestQuestion();
}
function nextTestDirection(s){
  if(s.mode!=="mixed")return s.mode;
  const a=s.recentDirections||[];
  if(a.length>=2&&a.at(-1)===a.at(-2))return a.at(-1)==="en-ja"?"ja-en":"en-ja";
  if(a.length&&Math.random()<.45)return a.at(-1)==="en-ja"?"ja-en":"en-ja";
  return Math.random()<.5?"en-ja":"ja-en";
}
function beginNextTestRound(s){
  if(s.roundDone < s.roundSize)return true;
  // The just-completed round is archived BEFORE clearing its mistake list.
  const missed=[...new Set(s.roundMissed)];
  s.roundHistory.push({number:s.roundNumber,total:s.roundSize,correct:s.roundSize-missed.length,
    missed:missed.length,wrongIds:[...missed]});
  if(s.roundHistory.length>30)s.roundHistory=s.roundHistory.slice(-30);
  if(missed.length===0){persistTest();return false;}
  s.roundNumber++;
  s.roundOrder=shuffle(missed);
  s.roundIndex=0;
  s.roundSize=missed.length;
  s.roundDone=0;
  s.roundMissed=[];
  s.roundAnsweredIds=[];
  persistTest();return true;
}
function nextTestQuestion(){
  const s=ensureTestSession(testStore.active);
  if(!s||s.finishedAt){go("test");return;}
  // Do not let a user skip an unanswered No. (including a double tap).
  if(s.currentWordId!=null&&!s.currentAnswered){
    if(unitById.has(s.currentUnitId)){
      testCurrentUnit=unitById.get(s.currentUnitId);
      testCurrentDirection=s.currentDirection||"en-ja";testAnswered=false;
      renderTestQuestion();return;
    }
  }
  s.currentWordId=null;s.currentUnitId=null;s.currentDirection=null;s.currentAnswered=false;
  if(!beginNextTestRound(s)){finishTest();return;}
  // roundOrder was fixed when the round began, never recomputed by correctness.
  // A fresh No. always comes from the next unused position in this order.
  const wordId=s.roundOrder[s.roundIndex];
  if(!Number.isInteger(wordId)){
    toast("テストの出題順を確認できません。進捗を保存して一覧へ戻ります");
    persistTest();go("test");return;
  }
  if(s.roundAnsweredIds.includes(wordId)){
    toast("重複出題を検知したため、この問題をスキップします");
    s.roundIndex++;persistTest();nextTestQuestion();return;
  }
  const u=chooseTestSense(testWordUnits(wordId));
  if(!u){toast("単語データが見つかりません");go("test");return;}
  s.roundIndex++;
  testCurrentUnit=u;testAnswered=false;
  testCurrentDirection=nextTestDirection(s);
  (s.recentDirections||=[]).push(testCurrentDirection);
  if(s.recentDirections.length>5)s.recentDirections.shift();
  s.currentWordId=wordId;s.currentUnitId=u.id;s.currentDirection=testCurrentDirection;
  persistTest();renderTestQuestion();
}
function renderTestHeader(){
  const s=testStore.active,cleared=s.clearedWordIds.length,total=s.wordIds.length;
  // Top meter is THIS ROUND'S answered count, not lifetime clear count.
  // Wrong answers also fill this meter and never return in the same round.
  $("#testTopRoundLabel").textContent=`${s.roundNumber}周目`;
  $("#testQuizCleared").textContent=s.roundDone;$("#testQuizTotal").textContent=s.roundSize;
  $("#testQuizBar").style.width=`${s.roundSize?s.roundDone/s.roundSize*100:0}%`;
  $("#testQuizRoundInfo").textContent=`${s.roundNumber}周目 ${s.roundDone}/${s.roundSize}`;
  $("#testQuizRemaining").textContent=total-cleared;
  $("#testQuizAccuracy").textContent=s.answers?Math.round(s.correct/s.answers*100)+"%":"—";
}
function renderTestQuestion(){
  const u=testCurrentUnit,s=testStore.active;
  $("#testQuizWordNo").textContent=`No. ${u.w.id}`;
  $("#testQuizSenseLabel").textContent=u.count>1?`意味 ${u.index+1}/${u.count}`:"単一意味";
  $("#testQuizHit").textContent="0 / 1";
  $("#testDirectionBadge").textContent=testCurrentDirection==="en-ja"?"英 → 日":"日 → 英";
  const prompt=$("#testQuizPrompt"),speak=$("#testQuizSpeakBtn"),icon=$("#testSpeakIcon");
  if(testCurrentDirection==="en-ja"){
    prompt.textContent=u.w.word;prompt.classList.remove("jp");speak.classList.remove("hidden");icon.classList.remove("hidden");
  }else{
    prompt.textContent=u.meaning;prompt.classList.add("jp");speak.classList.add("hidden");icon.classList.add("hidden");
  }
  $("#testQuizFeedback").className="feedback-strip neutral";
  $("#testQuizFeedback").textContent="1つ選んでください";
  $("#nextTestBtn").disabled=true;$("#nextTestBtn").textContent="選択してください";
  const range=testRangeUnits({start:s.start,end:s.end});
  const choices=shuffle([u,...distractorsFor(u,testCurrentDirection,range,ALL_UNITS)]);
  $("#testQuizChoices").replaceChildren();
  choices.forEach(c=>$("#testQuizChoices").appendChild(makeTestChoice(c,u)));
  renderTestHeader();
}
function makeTestChoice(c,target){
  const b=document.createElement("button");b.className="choice-card";b.dataset.unit=c.id;
  const main=document.createElement("div");main.className="choice-main";
  const reveal=document.createElement("div");reveal.className="choice-reveal";
  if(testCurrentDirection==="en-ja"){
    main.textContent=c.meaning;
    reveal.innerHTML=`<b>${escapeHTML(c.w.word)}</b>${c.count>1?` <span>· 意味${c.index+1}/${c.count}</span>`:""}`;
  }else{
    main.textContent=c.w.word;main.classList.add("en","has-audio");
    const audio=document.createElement("span");audio.className="choice-audio";audio.textContent="🔊";audio.setAttribute("role","button");audio.setAttribute("aria-label",`${c.w.word}を読み上げ`);
    audio.onclick=e=>{e.stopPropagation();speak(c.w.word);};
    b.appendChild(audio);reveal.textContent=c.meaning;
  }
  b.append(main,reveal);b.onclick=()=>answerTestChoice(b,c.id===target.id);return b;
}
function answerTestChoice(chosen,correct){
  if(testAnswered||!testCurrentUnit)return;
  const s=testStore.active,u=testCurrentUnit;
  if(!s||s.currentAnswered)return;
  if(s.roundAnsweredIds.includes(u.w.id))return;
  testAnswered=true;s.currentAnswered=true;
  // One answer, one No., one slot in this round: WRONG also advances the count.
  s.roundAnsweredIds.push(u.w.id);
  s.answers++;s.roundDone++;
  if(correct){
    s.correct++;
    if(!s.clearedWordIds.includes(u.w.id))s.clearedWordIds.push(u.w.id);
  }else{
    s.wrong++;s.mistakes[u.w.id]=(s.mistakes[u.w.id]||0)+1;
    if(!s.roundMissed.includes(u.w.id))s.roundMissed.push(u.w.id);
  }
  persistTest();
  [...$("#testQuizChoices").children].forEach(b=>{
    b.disabled=true;b.classList.add("answered");
    if(b.dataset.unit===u.id)b.classList.add("correct");
    else if(b===chosen&&!correct)b.classList.add("wrong");
    else b.classList.add("dim");
  });
  const fb=$("#testQuizFeedback");fb.className=`feedback-strip ${correct?"good":"bad"}`;
  fb.textContent=correct?"✓ 正解！ この単語はテスト完了まで出題しません":"✕ 不正解 · 今の周では出ず、次の周で再挑戦します";
  $("#testQuizHit").textContent=correct?"1 / 1 ✓":"0 / 1";
  $("#nextTestBtn").disabled=false;
  const lastInRound=s.roundDone===s.roundSize;
  $("#nextTestBtn").textContent=lastInRound?(s.roundMissed.length?`${s.roundNumber}周目終了 → ${s.roundNumber+1}周目へ`:`${s.roundNumber}周目終了 → 結果を見る`):"次の問題";
  renderTestHeader();
}
function finishTest(){
  const s=ensureTestSession(testStore.active);
  if(s&&!s.finishedAt){s.finishedAt=new Date().toISOString();persistTest();}
  testCurrentUnit=null;go("test");toast("全問クリア！ テストお疲れさまでした");
}
function resetTestOnly(){
  if(confirm("テスト前モードの途中経過・過去のテスト履歴をすべて削除しますか？\n通常学習の3回正解記録は消えません。")){
    testStore.active=null;testStore.history=[];testCurrentUnit=null;persistTest();refreshTestView();toast("テスト前の記録のみ削除しました");
  }
}

function applyTheme(){
  const dark=settings.theme==="dark"||(settings.theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme=dark?"dark":"light";
  const meta=$("#themeColorMeta");if(meta)meta.setAttribute("content",dark?"#080d16":"#f4f5f7");
}
function cycleTheme(){ settings.theme=settings.theme==="system"?"light":settings.theme==="light"?"dark":"system";persist();applyTheme();toast(`表示: ${settings.theme==="system"?"端末設定":settings.theme==="light"?"ライト":"ダーク"}`); }

buildUnits();
buildRangePreset();
testPresetBuild();
testConfigSafe();
setRandomAccent(false);
applyTheme();
refreshHome();
persist();

$("#testRangeStart").onchange=()=>{saveTestConfigFromUI();};
$("#testRangeEnd").onchange=()=>{saveTestConfigFromUI();};
$("#testRangePreset").onchange=e=>{
  if(e.target.value==="custom")return;
  const [a,b]=e.target.value.split("-").map(Number);
  $("#testRangeStart").value=a;$("#testRangeEnd").value=b;saveTestConfigFromUI();refreshTestView();
};
$$("#testModeSegment button").forEach(b=>b.onclick=()=>{
  testStore.config.mode=b.dataset.testMode;persistTest();refreshTestView();
});
$("#createTestBtn").onclick=createTest;
$("#resumeTestBtn").onclick=openTestQuiz;
$("#nextTestBtn").onclick=()=>{if(!$("#nextTestBtn").disabled)nextTestQuestion();};
$("#testQuizSpeakBtn").onclick=()=>speak(testCurrentUnit?.w.word||"");
$("#testSpeakIcon").onclick=()=>speak(testCurrentUnit?.w.word||"");
$("#resetTestBtn").onclick=resetTestOnly;

$("#rangeStart").onchange=()=>changeRange($("#rangeStart").value,$("#rangeEnd").value);
$("#rangeEnd").onchange=()=>changeRange($("#rangeStart").value,$("#rangeEnd").value);
$("#rangePreset").onchange=e=>{if(e.target.value==="custom")return;const[a,b]=e.target.value.split("-").map(Number);changeRange(a,b);};
$("#targetDate").onchange=savePlan;$("#dailyQuota").onchange=savePlan;$("#autoQuotaBtn").onclick=autoQuota;
$("#startMissionBtn").onclick=()=>startMission(false);$("#missionSpeakBtn").onclick=()=>speak(currentUnit?.w.word||"");
$("#missionStarBtn").onclick=()=>{if(currentUnit)$("#missionStarBtn").textContent=toggleStar(currentUnit.w.id)?"★":"☆";};
$("#nextMissionBtn").onclick=()=>{if(!$("#nextMissionBtn").disabled)nextMission();};
$("#continueMissionBtn").onclick=()=>startMission(true);
$("#searchInput").oninput=renderSearch;$("#exportBtn").onclick=exportProgress;$("#importInput").onchange=e=>{if(e.target.files[0])importProgress(e.target.files[0]);};$("#resetBtn").onclick=resetProgress;
$("#themeBtn").onclick=cycleTheme;$("#accentBtn").onclick=()=>{setRandomAccent(true);toast("差し色を変えました");};
$$("#modeSegment button").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$$(".bottom-nav button").forEach(b=>b.onclick=()=>go(b.dataset.view));

scheduleViewportSync();
window.addEventListener("resize",scheduleViewportSync,{passive:true});
window.addEventListener("orientationchange",scheduleViewportSync,{passive:true});
window.addEventListener("pageshow",scheduleViewportSync,{passive:true});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleViewportSync();});
if(window.visualViewport&&!IS_STANDALONE){
  window.visualViewport.addEventListener("resize",scheduleViewportSync,{passive:true});
  window.visualViewport.addEventListener("scroll",scheduleViewportSync,{passive:true});
}
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js?v=6-once-per-round").catch(()=>{}));
