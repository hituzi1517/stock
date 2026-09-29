const WORDS = window.WORDS || [];
const PROGRESS_KEY = "vocab1528-progress-v1";
const SETTINGS_KEY = "vocab1528-settings-v1";
const ACTIVITY_KEY = "vocab1528-activity-v1";
const STARS_KEY = "vocab1528-stars-v1";
const LAST_ACCENT_KEY = "vocab1528-last-accent-v1";
const DAY = 86400000;
const MAX_WORD_ID = WORDS.length ? Math.max(...WORDS.map(w => Number(w.id) || 0)) : 1528;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ACCENTS = [
  {accent:"#7c3aed", text:"#ffffff"}, {accent:"#2563eb", text:"#ffffff"},
  {accent:"#0891b2", text:"#ffffff"}, {accent:"#059669", text:"#ffffff"},
  {accent:"#65a30d", text:"#ffffff"}, {accent:"#ca8a04", text:"#ffffff"},
  {accent:"#ea580c", text:"#ffffff"}, {accent:"#e11d48", text:"#ffffff"},
  {accent:"#db2777", text:"#ffffff"}, {accent:"#9333ea", text:"#ffffff"},
  {accent:"#0f766e", text:"#ffffff"}, {accent:"#4f46e5", text:"#ffffff"}
];

let progress = loadJSON(PROGRESS_KEY, {});
let activity = loadJSON(ACTIVITY_KEY, {});
let stars = loadJSON(STARS_KEY, {});
let settings = Object.assign({
  theme:"system", rangeStart:1, rangeEnd:MAX_WORD_ID,
  targetDate:"", dailyQuota:100, plans:{}
}, loadJSON(SETTINGS_KEY, {}));
settings.rangeStart = clamp(parseInt(settings.rangeStart)||1, 1, MAX_WORD_ID);
settings.rangeEnd = clamp(parseInt(settings.rangeEnd)||MAX_WORD_ID, 1, MAX_WORD_ID);
if(settings.rangeStart > settings.rangeEnd) [settings.rangeStart, settings.rangeEnd] = [settings.rangeEnd, settings.rangeStart];
settings.dailyQuota = clamp(parseInt(settings.dailyQuota)||100, 1, 5000);
if(!settings.plans || typeof settings.plans !== "object") settings.plans = {};

let ALL_UNITS = [];
let activeUnits = [];
let currentUnit = null;
let missionAnswered = false;
let recentUnits = [];
let recentWords = [];
let retryQueue = [];
let questionNo = 0;
let combo = 0;
let quotaExtended = false;
let activeAccentIndex = -1;

function loadJSON(k,fallback){ try{return JSON.parse(localStorage.getItem(k)) ?? fallback}catch{return fallback} }
function persist(){
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  localStorage.setItem(STARS_KEY, JSON.stringify(stars));
}
function clamp(n,a,b){ return Math.min(b,Math.max(a,n)); }
function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function toast(msg){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),1800); }
function cryptoIndex(max){
  if(window.crypto?.getRandomValues){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%max; }
  return Math.floor(Math.random()*max);
}
function rerollAccent(showToast=false){
  const last=Number(localStorage.getItem(LAST_ACCENT_KEY));
  let idx=cryptoIndex(ACCENTS.length);
  if(ACCENTS.length>1 && idx===last) idx=(idx+1+cryptoIndex(ACCENTS.length-1))%ACCENTS.length;
  activeAccentIndex=idx; localStorage.setItem(LAST_ACCENT_KEY,String(idx));
  const p=ACCENTS[idx];
  document.documentElement.style.setProperty("--accent",p.accent);
  document.documentElement.style.setProperty("--accentText",p.text);
  $("#themeMeta")?.setAttribute("content",p.accent);
  if(showToast) toast("差し色を変えました");
}
function speak(text){
  if(!("speechSynthesis" in window)) return toast("このブラウザでは読み上げを利用できません");
  const clean=String(text).replace(/[（(][^）)]*[）)]/g,"").trim();
  speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(clean); u.lang="en-US"; u.rate=.88; speechSynthesis.speak(u);
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
    senses.forEach((meaning,index)=>ALL_UNITS.push({
      id:`${w.id}:${index+1}`, w, meaning, index, count:senses.length
    }));
  }
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
function unitCorrect(u){ return unitState(u.id).correct||0; }
function normalizedWord(s){ return String(s).toLowerCase().trim(); }

function localDateKey(d=new Date()){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
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
function savePlanForCurrentRange(){
  settings.plans[rangeKey()]={targetDate:settings.targetDate||"",dailyQuota:clamp(parseInt(settings.dailyQuota)||100,1,5000)};
}
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
function syncPreset(){
  const val=rangeKey(); const opt=[...$("#rangePreset").options].some(o=>o.value===val); $("#rangePreset").value=opt?val:"custom";
}
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
  const pace=$("#paceStatus"), hint=$("#planHint");
  if(m.remaining===0){ pace.textContent="範囲クリア"; pace.className="status-pill good"; hint.textContent=`${settings.rangeStart}–${settings.rangeEnd} の全${m.units.toLocaleString()}意味を3回ずつ正解しました。`; }
  else if(!settings.targetDate){ pace.textContent="目標日未設定"; pace.className="status-pill"; hint.textContent=`この範囲は全${m.units.toLocaleString()}意味。あと ${m.remaining.toLocaleString()} 正解でクリアです。`; }
  else if(plan.days===0){ pace.textContent="目標日経過"; pace.className="status-pill bad"; hint.textContent="この範囲の新しい目標日を設定してください。"; }
  else if(quota>=plan.needed){ pace.textContent="ペースOK"; pace.className="status-pill good"; hint.textContent=`必要ペースは1日 ${plan.needed.toLocaleString()} 正解です。現在のノルマなら目標日に間に合います。`; }
  else { pace.textContent=`+${(plan.needed-quota).toLocaleString()}/日`; pace.className="status-pill warn"; hint.textContent=`目標日に間に合わせるには、1日あと ${(plan.needed-quota).toLocaleString()} 正解増やす必要があります。`; }
  $("#startMissionBtn").textContent = m.remaining===0 ? "この範囲はクリア済み" : (t.hits>=quota ? "今日のノルマ達成済み · 続ける" : "今日のノルマを始める");
  $("#startMissionBtn").disabled = m.remaining===0;
}
function savePlan(){
  settings.targetDate=$("#targetDate").value||""; settings.dailyQuota=clamp(parseInt($("#dailyQuota").value)||100,1,5000); $("#dailyQuota").value=settings.dailyQuota;
  savePlanForCurrentRange(); persist(); refreshHome();
}
function changeRange(start,end){
  savePlanForCurrentRange();
  let a=clamp(parseInt(start)||1,1,MAX_WORD_ID), b=clamp(parseInt(end)||MAX_WORD_ID,1,MAX_WORD_ID);
  if(a>b)[a,b]=[b,a]; settings.rangeStart=a; settings.rangeEnd=b; loadPlanForRange(); refreshActiveUnits(); persist(); refreshHome();
}
function autoQuota(){
  settings.targetDate=$("#targetDate").value||settings.targetDate||""; const p=planningData();
  if(p.needed==null){ toast(settings.targetDate?"目標日が過ぎています":"先に目標日を設定してください"); return; }
  settings.dailyQuota=clamp(Math.max(1,p.needed),1,5000); savePlanForCurrentRange(); persist(); refreshHome(); toast(`1日 ${settings.dailyQuota.toLocaleString()} 正解に設定しました`);
}

function go(view){
  $$(".view").forEach(v=>v.classList.remove("active")); const el=$(`#${view}View`); if(el)el.classList.add("active");
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  window.scrollTo({top:0,behavior:"instant"});
  if(view==="home")refreshHome(); if(view==="search")renderSearch(); if(view==="stats")renderStats();
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
  return shared/Math.min(A.length,B.length)>=0.6;
}
function distractorsFor(unit){
  const sameWord=u=>normalizedWord(u.w.word)===normalizedWord(unit.w.word);
  const selectFrom=source=>{
    const candidates=shuffle(source.filter(u=>!sameWord(u) && u.id!==unit.id && !meaningsOverlap(u.meaning,unit.meaning)));
    const picked=[];
    for(const c of candidates){ if(picked.some(x=>meaningsOverlap(x.meaning,c.meaning)))continue; picked.push(c); if(picked.length===3)break; }
    return picked;
  };
  let picked=selectFrom(activeUnits);
  if(picked.length<3){
    const used=new Set(picked.map(x=>x.id));
    for(const c of selectFrom(ALL_UNITS)){
      if(!used.has(c.id)){ picked.push(c); used.add(c.id); if(picked.length===3)break; }
    }
  }
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
function startMission(forceContinue=false){
  refreshActiveUnits(); const m=missionData(); if(!m.remaining){toast("この範囲はクリア済みです");return;}
  quotaExtended=forceContinue || todayStats().hits>=settings.dailyQuota;
  currentUnit=null; missionAnswered=false; combo=0; retryQueue=[]; recentUnits=[]; recentWords=[]; questionNo=0; go("mission"); nextMission();
}
function nextMission(){
  const t=todayStats(); if(!quotaExtended && t.hits>=settings.dailyQuota){ showComplete(); return; }
  currentUnit=chooseNextUnit(); missionAnswered=false; if(!currentUnit){ showComplete(true); return; }
  questionNo++; recentUnits.push(currentUnit.id); if(recentUnits.length>10)recentUnits.shift(); recentWords.push(normalizedWord(currentUnit.w.word)); if(recentWords.length>5)recentWords.shift(); renderMission();
}
function renderMission(){
  const u=currentUnit,m=missionData(),t=todayStats(),quota=settings.dailyQuota,h=getHits(u);
  $("#missionTodayHits").textContent=t.hits.toLocaleString(); $("#missionQuota").textContent=quota.toLocaleString(); $("#missionBar").style.width=Math.min(100,t.hits/quota*100)+"%";
  $("#missionRemaining").textContent=m.remaining.toLocaleString(); $("#missionRange").textContent=`${settings.rangeStart}–${settings.rangeEnd}`; $("#missionWordNo").textContent=`No. ${u.w.id}`; $("#senseHit").textContent=`${h} / 3`;
  $("#missionPrompt").textContent=u.w.word; $("#missionStarBtn").textContent=stars[u.w.id]?"★":"☆";
  const label=$("#senseLabel");
  if(u.count>1){ label.classList.remove("hidden"); label.textContent=`意味 ${u.index+1} / ${u.count}`; } else label.classList.add("hidden");
  $("#missionFeedback").className="feedback hidden"; $("#nextMissionBtn").classList.add("hidden"); $("#missionChoices").innerHTML="";
  const choices=shuffle([u,...distractorsFor(u)]);
  choices.forEach(c=>{ const b=document.createElement("button"); b.className="choice"; b.textContent=c.meaning; b.dataset.unit=c.id; b.onclick=()=>answerMission(b,c.id===u.id); $("#missionChoices").appendChild(b); });
  updateLiveStats();
}
function recordMission(correct){
  const u=currentUnit,s=unitState(u.id),a=activityEntry(); s.seen=(s.seen||0)+1; a.answered=(a.answered||0)+1; let gained=0;
  if(correct){
    s.correct=(s.correct||0)+1; a.correct=(a.correct||0)+1;
    if(s.hits<3){ s.hits++; a.unitHits[u.id]=(a.unitHits[u.id]||0)+1; gained=1; }
  }else{ s.wrong=(s.wrong||0)+1; a.wrong=(a.wrong||0)+1; queueRetry(u); }
  persist(); return gained;
}
function answerMission(btn,correct){
  if(missionAnswered)return; missionAnswered=true; const u=currentUnit;
  [...$("#missionChoices").children].forEach(b=>{ b.disabled=true; if(b.dataset.unit===u.id)b.classList.add("correct"); }); if(!correct)btn.classList.add("wrong");
  const gained=recordMission(correct),h=getHits(u); combo=correct?combo+1:0; $("#senseHit").textContent=`${h} / 3`;
  const f=$("#missionFeedback"); f.className="feedback "+(correct?"good-f":"bad-f");
  if(correct){ f.innerHTML=`✓ 正解 <b>${h} / 3</b>${h>=3?" · この意味をクリア！":""}<div class="feedback-note">${escapeHTML(u.w.word)}：${escapeHTML(u.meaning)}</div>`; }
  else{ f.innerHTML=`✕ 正解は <b>${escapeHTML(u.meaning)}</b><div class="feedback-note">4〜6問ほど後にもう一度出ます。正解回数は減りません。</div>`; }
  $("#nextMissionBtn").classList.remove("hidden"); updateMissionHeader(); updateLiveStats();
  const t=todayStats(); if(gained&&t.hits>0&&t.hits%25===0)toast(`この範囲で今日 ${t.hits.toLocaleString()} 正解！`);
}
function updateMissionHeader(){
  const t=todayStats(),m=missionData(),quota=settings.dailyQuota; $("#missionTodayHits").textContent=t.hits.toLocaleString(); $("#missionQuota").textContent=quota.toLocaleString(); $("#missionBar").style.width=Math.min(100,t.hits/quota*100)+"%"; $("#missionRemaining").textContent=m.remaining.toLocaleString();
}
function updateLiveStats(){ const t=todayStats(); $("#comboCount").textContent=combo; $("#todayAnswered").textContent=t.answered.toLocaleString(); $("#todayAccuracy").textContent=t.answered?Math.round(t.correct/t.answered*100)+"%":"—"; }
function showComplete(all=false){
  const m=missionData(),t=todayStats(); $("#completeTodayHits").textContent=t.hits.toLocaleString(); $("#completeRemaining").textContent=m.remaining.toLocaleString(); $("#completeUnits").textContent=m.cleared.toLocaleString(); $("#completeRange").textContent=`${settings.rangeStart}–${settings.rangeEnd}`; $("#continueMissionBtn").classList.toggle("hidden",all||m.remaining===0); go("complete");
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
  $$('[data-star]').forEach(b=>b.onclick=()=>{ const on=toggleStar(Number(b.dataset.star)); b.textContent=on?"★":"☆"; });
}
function renderWeekStrip(){
  const today=localDateKey(),labels=["日","月","火","水","木","金","土"],ids=activeUnitIdSet(),cells=[];
  for(let i=6;i>=0;i--){
    const key=shiftDateKey(today,-i),d=dateFromKey(key),a=activity[key]||{}, count=0; for(const [id,n] of Object.entries(a.unitHits||{}))if(ids.has(id))count+=Number(n)||0;
    cells.push(`<div class="week-day ${count?"active":""}"><span>${labels[d.getDay()]}</span><b>${d.getDate()}</b><small>${count||"—"}</small></div>`);
  }
  $("#weekStrip").innerHTML=cells.join("");
}
function renderStats(){
  refreshActiveUnits(); const m=missionData(), allStates=Object.values(progress), correct=allStates.reduce((a,s)=>a+(s.correct||0),0),wrong=allStates.reduce((a,s)=>a+(s.wrong||0),0),t=todayStats();
  $("#statsRangeTitle").textContent=`範囲 ${settings.rangeStart}–${settings.rangeEnd}`; $("#statsHits").textContent=m.hits.toLocaleString(); $("#statsClearedUnits").textContent=m.cleared.toLocaleString(); $("#statsRemaining").textContent=m.remaining.toLocaleString();
  $("#statsStreak").textContent=streakCount(); $("#statsToday").textContent=t.hits.toLocaleString(); $("#statsAccuracy").textContent=(correct+wrong)?Math.round(correct/(correct+wrong)*100)+"%":"—";
  $("#hitDistribution").innerHTML=m.dist.map((n,i)=>`<div><span>${i}/3</span><div class="mini-bar"><i style="width:${m.units?Math.round(n/m.units*100):0}%"></i></div><b>${n.toLocaleString()}</b></div>`).join("");
  renderWeekStrip();
  const hard=activeUnits.filter(u=>unitWrong(u)>0&&!isClear(u)).sort((a,b)=>unitWrong(b)-unitWrong(a)||getHits(a)-getHits(b)).slice(0,12);
  $("#hardList").innerHTML=hard.length?hard.map(u=>`<div class="hard-item"><div><b>${escapeHTML(u.w.word)}${u.count>1?` · 意味${u.index+1}`:""}</b><span>${escapeHTML(u.meaning)}</span></div><em>誤答 ${unitWrong(u)} · ${getHits(u)}/3</em></div>`).join(""):`<p class="tiny">この範囲にはまだ誤答記録がありません。</p>`;
  const chunks=[];
  for(let start=1;start<=MAX_WORD_ID;start+=100){
    const end=Math.min(start+99,MAX_WORD_ID), units=ALL_UNITS.filter(u=>u.w.id>=start&&u.w.id<=end),cleared=units.filter(isClear).length,p=units.length?Math.round(cleared/units.length*100):0;
    chunks.push(`<div class="chunk"><span>${start}–${end}</span><div class="mini-bar"><i style="width:${p}%"></i></div><b>${p}%</b></div>`);
  }
  $("#chunkStats").innerHTML=chunks.join("");
}

function exportProgress(){
  savePlanForCurrentRange(); persist();
  const payload={version:1,book:"vocab1528",exportedAt:new Date().toISOString(),progress,settings,activity,stars};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url; a.download=`vocab1528-progress-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importProgress(file){
  try{
    const j=JSON.parse(await file.text()); if(!j||j.book!=="vocab1528"||typeof j.progress!=="object")throw new Error();
    progress=j.progress; activity=(j.activity&&typeof j.activity==="object")?j.activity:{}; stars=(j.stars&&typeof j.stars==="object")?j.stars:{}; settings=Object.assign(settings,j.settings||{});
    settings.rangeStart=clamp(parseInt(settings.rangeStart)||1,1,MAX_WORD_ID); settings.rangeEnd=clamp(parseInt(settings.rangeEnd)||MAX_WORD_ID,1,MAX_WORD_ID); if(settings.rangeStart>settings.rangeEnd)[settings.rangeStart,settings.rangeEnd]=[settings.rangeEnd,settings.rangeStart];
    settings.dailyQuota=clamp(parseInt(settings.dailyQuota)||100,1,5000); if(!settings.plans||typeof settings.plans!=="object")settings.plans={};
    refreshActiveUnits(); persist(); refreshHome(); toast("進捗を読み込みました");
  }catch{toast("この単語帳の進捗データではありません")}
}
function resetProgress(){
  if(confirm("この単語帳のすべての学習記録をリセットしますか？")){ progress={}; activity={}; stars={}; localStorage.removeItem(PROGRESS_KEY); localStorage.removeItem(ACTIVITY_KEY); localStorage.removeItem(STARS_KEY); persist(); refreshHome(); toast("リセットしました"); }
}
function applyTheme(){ const dark=settings.theme==="dark"||(settings.theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme=dark?"dark":"light"; }
function cycleTheme(){ settings.theme=settings.theme==="system"?"light":settings.theme==="light"?"dark":"system"; persist(); applyTheme(); toast(`表示: ${settings.theme==="system"?"端末設定":settings.theme==="light"?"ライト":"ダーク"}`); }

buildUnits();
// 全データのユニット状態は必要になった時だけ作る。初回は設定だけ保存。
buildRangePreset(); rerollAccent(false); applyTheme(); refreshHome(); persist();

$("#rangeStart").onchange=()=>changeRange($("#rangeStart").value,$("#rangeEnd").value);
$("#rangeEnd").onchange=()=>changeRange($("#rangeStart").value,$("#rangeEnd").value);
$("#rangePreset").onchange=e=>{ if(e.target.value==="custom")return; const [a,b]=e.target.value.split("-").map(Number); changeRange(a,b); };
$("#targetDate").onchange=savePlan; $("#dailyQuota").onchange=savePlan; $("#autoQuotaBtn").onclick=autoQuota;
$("#startMissionBtn").onclick=()=>startMission(false); $("#missionSpeakBtn").onclick=()=>speak(currentUnit?.w.word||"");
$("#missionStarBtn").onclick=()=>{ if(currentUnit)$("#missionStarBtn").textContent=toggleStar(currentUnit.w.id)?"★":"☆"; };
$("#nextMissionBtn").onclick=nextMission; $("#continueMissionBtn").onclick=()=>startMission(true);
$("#searchInput").oninput=renderSearch; $("#exportBtn").onclick=exportProgress; $("#importInput").onchange=e=>{if(e.target.files[0])importProgress(e.target.files[0]);}; $("#resetBtn").onclick=resetProgress;
$("#themeBtn").onclick=cycleTheme; $("#rerollAccentBtn").onclick=()=>rerollAccent(true);
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go)); $$(".bottom-nav button").forEach(b=>b.onclick=()=>go(b.dataset.view));
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
