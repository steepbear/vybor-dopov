/* Выбор допов — статическая демонстрация. Никакого сервера и настоящей авторизации. */
(() => {
  'use strict';
  const DATA = window.DOP_DATA;
  if (!DATA) { document.body.textContent = 'Не найден файл data.js'; return; }
  const KEY = 'vybor_dopov_demo_v2';
  const dayShort = ['','ПН','ВТ','СР','ЧТ','ПТ'];
  const $ = id => document.getElementById(id);
  const h = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const uniq = list => [...new Set(list)];
  const allBranches = DATA.branches;
  const grades = [1,2,3,4];
  const allClasses = uniq(DATA.students.map(s => s.className)).sort((a,b)=>a.localeCompare(b,'ru'));
  const groupById = Object.fromEntries(DATA.groups.map(g=>[g.id,g]));
  const studentById = Object.fromEntries(DATA.students.map(s=>[s.id,s]));
  // Одна и та же тема может предлагаться в нескольких параллелях и филиалах.
  // Группы — самостоятельные сущности внутри пары branchId + grade.
  function groupsFor(branchId, grade){return DATA.groups.filter(g=>g.branchId===branchId && g.grade===Number(grade));}
  function groupsForStudent(sid=state.studentId){const s=studentById[sid];return groupsFor(s.branchId,s.grade);}
  function subjectsForStudent(sid=state.studentId){return uniq(groupsForStudent(sid).map(g=>g.subject)).sort((a,b)=>a.localeCompare(b,'ru'));}
  const scheduleMask = sessions => sessions.reduce((acc,s)=>acc|(1 << ((s.day-1)*2+(s.slot-1))),0);
  const sessionText = ses => `${dayShort[ses.day]}, доп №${ses.slot}`;
  const prettySessions = sessions => sessions.map(sessionText).join('; ');
  const saved = (()=> { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const state = {records:saved.records || {},restrictions:saved.restrictions || {},studentId:DATA.students.find(s=>DATA.olympiadOffers[s.id])?.id || DATA.students[0].id,
    mode:'student',search:'',wishes:[],suggestion:null,report:'subjects',adminBranchId:DATA.branches[0].id,adminGrade:2};
  function persist(){ try{localStorage.setItem(KEY,JSON.stringify({records:state.records,restrictions:state.restrictions}));}catch{notify('Не удалось сохранить в браузере. Проверьте режим приватности.',true);} }
  function record(sid=state.studentId){ if(!state.records[sid])state.records[sid]={chosen:[],olympiad:false,confirmed:false};return state.records[sid]; }
  function student(){return studentById[state.studentId];}
  function isLocked(){return !!record().confirmed;}
  function chosenGroups(rec=record(), sid=state.studentId){
    // Даже если локальные данные повреждены, группа чужой школы/параллели не попадает в расписание.
    const stu=studentById[sid];
    return rec.chosen.map(id=>groupById[id]).filter(g=>g && g.branchId===stu.branchId && g.grade===stu.grade);
  }
  function offer(sid=state.studentId){return DATA.olympiadOffers[sid] || null;}
  function olympEnabled(rec=record(),sid=state.studentId){return Boolean(rec.olympiad && offer(sid));}
  function allowedFor(g,sid=state.studentId){
    const s=studentById[sid];
    return Boolean(s && g && g.branchId===s.branchId && g.grade===s.grade);
  }
  function maskTaken(rec=record(),excludingGroupId=null,sid=state.studentId){
    let result=0;
    for(const g of chosenGroups(rec,sid)) if(g.id!==excludingGroupId) result|=scheduleMask(g.sessions);
    if(olympEnabled(rec,sid))result|=scheduleMask(offer(sid));
    return result;
  }
  function conflict(g,rec=record(),excludingId=null,sid=state.studentId){
    const candidates=[];
    const mask=scheduleMask(g.sessions);
    for(const another of chosenGroups(rec,sid))if(another.id!==excludingId && another.id!==g.id && (mask & scheduleMask(another.sessions)))candidates.push(another.subject);
    if(olympEnabled(rec,sid) && (mask & scheduleMask(offer(sid))))candidates.push('Олимпиада');
    return uniq(candidates);
  }
  function updateState(){persist();state.suggestion=null;renderStudent();if(state.mode==='admin')renderAdmin();}
  let toastTimeout;
  function notify(message,warning=false,success=false){
    const t=$('toast');t.textContent=message;t.hidden=false;t.className='toast'+(warning?' warning':success?' success':'');
    clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>t.hidden=true,4300);
  }
  function setMode(mode){
    state.mode=mode;
    $('studentView').hidden=mode!=='student';$('adminView').hidden=mode!=='admin';
    $('tabStudent').classList.toggle('active',mode==='student');$('tabAdmin').classList.toggle('active',mode==='admin');
    $('tabStudent').setAttribute('aria-selected',String(mode==='student'));
    $('tabAdmin').setAttribute('aria-selected',String(mode==='admin'));
    if(mode==='admin')renderAdmin();else renderStudent();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function renderStudent(){
    const s=student(),rec=record();
    $('studentBranch').value=s.branchId;
    $('studentGrade').value=String(s.grade);
    fillStudents(s.branchId,s.grade);
    $('studentSelect').value=s.id;
    $('studentMeta').innerHTML=`<span class="student-chip">${h(s.className)}</span><span class="student-chip">${h(s.branch)}</span>`;
    $('studentStatus').className='status-label'+(rec.confirmed?' confirmed':'');
    $('studentStatus').textContent=rec.confirmed?'✓ Выбор подтверждён':'Выбор не подтверждён';
    renderOlympiad();renderCourses();renderChosen();renderWishes();
  }
  function renderOlympiad(){
    const rec=record(),o=offer();
    if(!o){$('olympiadBox').innerHTML='<div class="offer-empty">Этому ученику олимпиада не предложена. Выбирать её нельзя.</div>';return;}
    $('olympiadBox').innerHTML=`<div class="olympiad-offer"><div><h3>${rec.olympiad?'Олимпиада выбрана':'Есть предложение участвовать'}</h3><p>${rec.olympiad?'Её время учитывается в расписании':'Можешь принять предложение или оставить его без выбора'}</p><div class="slot-chips">${o.map(s=>`<span class="slot-pill">${h(sessionText(s))}</span>`).join('')}</div></div><label class="toggle" title="Включить или исключить олимпиаду"><input id="olympiadToggle" type="checkbox" ${rec.olympiad?'checked':''} ${rec.confirmed?'disabled':''} aria-label="Выбрать олимпиаду"><span></span></label></div>`;
    $('olympiadToggle').addEventListener('change',evt=>{
      if(isLocked()){evt.target.checked=rec.olympiad;return;}
      if(evt.target.checked){
        const conflicts=chosenGroups().filter(g=>scheduleMask(g.sessions)&scheduleMask(o));
        if(conflicts.length){evt.target.checked=false;notify('Олимпиада пересекается с: '+conflicts.map(g=>g.subject).join(', ')+'. Сначала убери конфликтующие группы.',true);return;}
      }
      rec.olympiad=evt.target.checked;updateState();
    });
  }
  function groupStatus(g){
    const rec=record();const current=chosenGroups().find(x=>x.subject===g.subject);
    const selected=current?.id===g.id;
    const clashes=conflict(g,rec,current?.id);
    const excluded=!allowedFor(g);
    return {selected,current,clashes,excluded,disabled:rec.confirmed || excluded || clashes.length>0};
  }
  function renderCourses(){
    const needle=state.search.trim().toLocaleLowerCase('ru');
    const allowed=groupsForStudent();
    const grouped=Object.fromEntries(subjectsForStudent().map(s=>[s,allowed.filter(g=>g.subject===s)]));
    const subjects=Object.keys(grouped).filter(s=>s.toLocaleLowerCase('ru').includes(needle));
    $('resultCount').textContent=`${subjects.length} из ${Object.keys(grouped).length} направлений`;
    $('catalogEmpty').hidden=subjects.length>0;
    $('courseList').innerHTML=subjects.map(subject=>{
      const groups=grouped[subject],numChosen=chosenGroups().some(g=>g.subject===subject);
      return `<div class="course-card"><div class="course-head"><h3>${h(subject)}</h3>${numChosen?'<span class="status-label confirmed">✓ Выбрано</span>':`<span class="result-count">${groups.length} ${groups.length===1?'группа':'группы'}</span>`}</div><div class="group-list">${groups.map(g=>{
        const st=groupStatus(g);
        const reason=st.excluded?'Группа другого филиала или параллели':st.clashes.length?'Пересечение: '+st.clashes.join(', '):'';
        const cls=st.selected?' selected':st.disabled?' disabled':'';
        const action=st.selected?'Убрать':st.current?'Сменить': 'Выбрать';
        const btnClass=st.selected?'btn ghost mini':st.disabled?'btn ghost mini':'btn outline mini';
        const isDisabled=(st.disabled && !st.selected);
        return `<div class="group-row${cls}"><div class="group-info"><span class="group-title">Группа ${h(g.group)}</span><div class="slot-chips">${g.sessions.map(s=>`<span class="slot-pill">${h(sessionText(s))}</span>`).join('')}</div>${reason?`<p class="group-reason">${h(reason)}</p>`:''}</div><button type="button" data-group="${h(g.id)}" class="${btnClass}" ${isDisabled||record().confirmed?'disabled':''}>${st.selected?'✓ '+action:action}</button></div>`;
      }).join('')}</div></div>`;
    }).join('');
  }
  function selectGroup(groupId){
    if(isLocked()){notify('Выбор подтверждён. Для исправления обратитесь к методологу.',true);return;}
    const g=groupById[groupId];if(!g)return;
    const rec=record();
    if(rec.chosen.includes(g.id)){rec.chosen=rec.chosen.filter(id=>id!==g.id);updateState();return;}
    if(!allowedFor(g)){notify('Эта группа не относится к твоему филиалу и параллели.',true);return;}
    const old=chosenGroups().find(x=>x.subject===g.subject);
    const clashes=conflict(g,rec,old?.id);
    if(clashes.length){notify('Группа пересекается с: '+clashes.join(', '),true);return;}
    if(old)rec.chosen=rec.chosen.filter(id=>id!==old.id);
    rec.chosen.push(g.id);
    updateState();notify(old?'Группа заменена':'Занятие добавлено',false,true);
  }
  function renderChosen(){
    const rec=record(),gs=chosenGroups(),olym=olympEnabled(rec);
    const selections=gs.length+(olym?1:0);
    $('selectedCount').textContent=String(selections);
    const items=[...gs.map(g=>`<div class="chosen-item"><div><span class="name">${h(g.subject)}</span><span class="detail">Группа ${h(g.group)}</span></div><button class="remove-button" data-remove="${h(g.id)}" title="Убрать занятие" aria-label="Убрать ${h(g.subject)}" ${rec.confirmed?'disabled':''}>×</button></div>`),...(olym?[`<div class="chosen-item"><div><span class="name">Олимпиада</span><span class="detail">Предложение принято</span></div><span style="color:#bd8a21;font-size:18px">★</span></div>`]:[])];
    $('chosenList').innerHTML=items.length?items.join(''):'<div class="empty-chosen">Здесь появятся выбранные занятия</div>';
    const cells={};
    for(const g of gs)for(const ses of g.sessions)cells[ses.day+'-'+ses.slot]={text:g.subject,kind:'taken'};
    if(olym)for(const ses of offer())cells[ses.day+'-'+ses.slot]={text:'Олимпиада',kind:'olymp'};
    $('scheduleBody').innerHTML=DATA.slots.map(sl=>`<tr><td><strong>${h(sl.from)}</strong><div>${h(sl.to)}</div></td>${[1,2,3,4,5].map(day=>{const c=cells[day+'-'+sl.id];return c?`<td class="${c.kind}" title="${h(c.text)}">${h(c.text)}</td>`:'<td>—</td>';}).join('')}</tr>`).join('');
    $('confirmSelection').disabled=rec.confirmed || selections===0;
    $('confirmSelection').textContent=rec.confirmed?'✓ Расписание подтверждено':'Подтвердить выбор';
    $('confirmationHint').textContent=rec.confirmed?'Для изменений методолог должен открыть выбор повторно.':selections===0?'Добавь хотя бы одно занятие или олимпиаду.':'После подтверждения изменить расписание сможет только методолог.';
  }
  function renderWishes(){
    const available=subjectsForStudent().filter(x=>!state.wishes.includes(x));
    $('wishSubject').innerHTML=available.map(s=>`<option value="${h(s)}">${h(s)}</option>`).join('') || '<option value="">Все направления добавлены</option>';
    $('addWish').disabled=!available.length||isLocked();
    $('runHelper').disabled=!state.wishes.length||isLocked();
    $('wishList').innerHTML=state.wishes.map((s,i)=>`<div class="wish-row"><span class="wish-no">${i+1}</span><span class="wish-row-name">${h(s)}</span><button class="icon-btn" data-wish="up" data-index="${i}" ${i===0||isLocked()?'disabled':''} title="Повысить приоритет">↑</button><button class="icon-btn" data-wish="down" data-index="${i}" ${i===state.wishes.length-1||isLocked()?'disabled':''} title="Понизить приоритет">↓</button><button class="icon-btn" data-wish="remove" data-index="${i}" ${isLocked()?'disabled':''} title="Убрать из пожеланий">×</button></div>`).join('') || '<p class="microcopy">Список желаний пока пуст.</p>';
    if(!state.suggestion)$('helperResult').innerHTML='';
  }
  function runHelper(){
    const rec=record(); if(rec.confirmed)return;
    const baseMask=maskTaken(rec),fixedSubjects=new Set(chosenGroups(rec).map(g=>g.subject));
    const subjects=state.wishes.filter(s=>!fixedSubjects.has(s));
    // Динамическое программирование: 10 слотов = 1024 варианта занятости.
    // Сначала максимум направлений, затем сумма очков приоритетов.
    let states=new Map([[baseMask,{count:0,score:0,selected:[] }]]);
    subjects.forEach((subject,rank)=>{
      const next=new Map(states);
      const weight=subjects.length-rank;
      for(const [mask,s] of states){
        for(const g of groupsForStudent().filter(g=>g.subject===subject)){
          const bits=scheduleMask(g.sessions);
          if(!allowedFor(g)||(mask&bits))continue;
          const nextMask=mask|bits;
          const cand={count:s.count+1,score:s.score+weight,selected:[...s.selected,g.id]};
          const current=next.get(nextMask);
          if(!current || cand.count>current.count ||(cand.count===current.count && cand.score>current.score))next.set(nextMask,cand);
        }
      }
      states=next;
    });
    let best={count:0,score:0,selected:[]};
    for(const opt of states.values())if(opt.count>best.count ||(opt.count===best.count&&opt.score>best.score))best=opt;
    const notFound=subjects.filter(subject=>!best.selected.some(id=>groupById[id].subject===subject));
    state.suggestion=best.selected;
    $('helperResult').innerHTML=`<div class="helper-result"><h3>Найдено ${best.selected.length} дополнительных направлений</h3><p>Плюс уже выбранные: ${chosenGroups().length}${olympEnabled(rec)?' и олимпиада':''}. Приоритеты используются для выбора среди вариантов с одинаковым числом занятий.</p>${best.selected.map(id=>{const g=groupById[id];return `<div>✓ ${h(g.subject)} · группа ${h(g.group)} <span style="color:#7990b0">(${h(prettySessions(g.sessions))})</span></div>`;}).join('')}${notFound.length?`<p style="margin-top:9px">Не поместились: ${h(notFound.join(', '))}</p>`:''}<button type="button" class="btn primary" id="applySuggestion" ${best.selected.length?'':'disabled'}>Добавить предложенные группы</button></div>`;
    $('applySuggestion').addEventListener('click',()=>{
      for(const id of state.suggestion||[])if(allowedFor(groupById[id])&&!rec.chosen.includes(id))rec.chosen.push(id);
      updateState();notify('Совместимые группы добавлены',false,true);
    });
  }
  function reportStudents(){return DATA.students.filter(s=>s.branchId===state.adminBranchId && s.grade===state.adminGrade);}
  function renderAdmin(){
    const inScope=reportStudents();
    const confirmed=inScope.filter(s=>state.records[s.id]?.confirmed);
    const unconfirmed=inScope.filter(s=>!state.records[s.id]?.confirmed);
    let choices=0;
    for(const stu of confirmed){const rec=record(stu.id);choices+=chosenGroups(rec,stu.id).length+(olympEnabled(rec,stu.id)?1:0);}
    $('metrics').innerHTML=[['Учеников в параллели',inScope.length],['Подтвердили выбор',confirmed.length],['Не подтвердили',unconfirmed.length],['Выбранных направлений',choices]].map(([name,count])=>`<div class="metric"><strong>${count}</strong><span>${name}</span></div>`).join('');
    const cls=$('reportClass').value||'all';
    const classes=uniq(inScope.map(s=>s.className)).sort((a,b)=>a.localeCompare(b,'ru'));
    $('reportClass').innerHTML='<option value="all">Все классы</option>'+classes.map(x=>`<option value="${h(x)}">${h(x)}</option>`).join('');
    $('reportClass').value=classes.includes(cls)?cls:'all';
    const filtered=unconfirmed.filter(stu=>$('reportClass').value==='all'||$('reportClass').value===stu.className);
    $('reportScope').textContent=DATA.branches.find(b=>b.id===state.adminBranchId).name+' · '+state.adminGrade+' параллель';
    $('unconfirmedCount').textContent=`${filtered.length} учеников`;
    $('unconfirmedBody').innerHTML=filtered.map(stu=>`<tr><td>${h(stu.name)}</td><td>${h(stu.className)}</td><td>${h(stu.branch)}</td><td><span class="status-pending">Не подтверждено</span></td></tr>`).join('')||'<tr><td class="empty-row" colspan="4">Все ученики в этой выборке подтвердили расписание</td></tr>';
    $('confirmedBody').innerHTML=confirmed.map(stu=>{
      const rec=record(stu.id);return `<tr><td>${h(stu.name)}</td><td>${h(stu.className)}</td><td>${chosenGroups(rec,stu.id).length+(olympEnabled(rec,stu.id)?1:0)}</td><td><button class="btn outline mini" data-unlock="${h(stu.id)}">Открыть для изменения</button></td></tr>`;
    }).join('')||'<tr><td class="empty-row" colspan="4">Подтверждённых выборов пока нет</td></tr>';
    renderSummary(confirmed);
    renderAdminGroups();
  }
  function renderSummary(confirmed){
    const tab=state.report;
    document.querySelectorAll('.report-tab').forEach(b=>b.classList.toggle('active',b.dataset.report===tab));
    const inScope=reportStudents();
    const available=groupsFor(state.adminBranchId,state.adminGrade);
    let head=[],rows=[];
    if(tab==='subjects'){
      head=['Направление','Выборов'];
      const counts=new Map(uniq(available.map(g=>g.subject)).map(sub=>[sub,0]));counts.set('Олимпиада',0);
      for(const stu of confirmed){const rec=record(stu.id);for(const group of chosenGroups(rec,stu.id))counts.set(group.subject,(counts.get(group.subject)||0)+1);if(olympEnabled(rec,stu.id))counts.set('Олимпиада',counts.get('Олимпиада')+1);}
      rows=[...counts].sort((a,b)=>b[1]-a[1]).map(([name,count])=>[name,String(count)]);
    }else if(tab==='groups'){
      head=['Направление','Группа','Выборов'];
      rows=available.map(g=>[g.subject,'№ '+g.group,String(confirmed.reduce((n,stu)=>n+(record(stu.id).chosen.includes(g.id)?1:0),0))]).sort((a,b)=>Number(b[2])-Number(a[2]));
    }else{
      head=['Класс','Подтвердили','Всего учеников','Выбрано направлений'];
      const classes=uniq(inScope.map(stu=>stu.className)).sort((a,b)=>a.localeCompare(b,'ru'));
      rows=classes.map(className=>{
        const users=confirmed.filter(stu=>stu.className===className);
        let total=0;for(const stu of users){const rec=record(stu.id);total+=chosenGroups(rec,stu.id).length+(olympEnabled(rec,stu.id)?1:0);}
        return [className,String(users.length),String(inScope.filter(stu=>stu.className===className).length),String(total)];
      });
    }
    $('summaryHead').innerHTML='<tr>'+head.map(x=>`<th>${h(x)}</th>`).join('')+'</tr>';
    $('summaryBody').innerHTML=rows.map(row=>'<tr>'+row.map(x=>`<td>${h(x)}</td>`).join('')+'</tr>').join('')||'<tr><td colspan="4" class="empty-row">Записей пока нет</td></tr>';
  }
  function renderAdminGroups(){
    const available=groupsFor(state.adminBranchId,state.adminGrade);
    $('adminGroupsBody').innerHTML=available.map(g=>`<tr><td>${h(g.subject)}</td><td>№ ${h(g.group)}</td><td>${h(prettySessions(g.sessions))}</td></tr>`).join('')||'<tr><td colspan="3" class="empty-row">Для этой параллели группы не заведены</td></tr>';
  }
  function fillStudents(branchId,grade){
    const available=DATA.students.filter(s=>s.branchId===branchId&&s.grade===Number(grade));
    $('studentSelect').innerHTML=available.map(s=>`<option value="${h(s.id)}">${h(s.name)} · ${h(s.className)}</option>`).join('');
    return available;
  }
  function changeStudentContext(){
    const matches=fillStudents($('studentBranch').value,Number($('studentGrade').value));
    if(!matches.length){notify('В этой параллели нет тестовых учеников.',true);return;}
    state.studentId=matches[0].id;state.wishes=[];state.suggestion=null;state.search='';$('searchInput').value='';renderStudent();
  }
  function setup(){
    $('studentBranch').innerHTML=allBranches.map(b=>`<option value="${h(b.id)}">${h(b.name)}</option>`).join('');
    $('studentGrade').innerHTML=grades.map(g=>`<option value="${g}">${g}-я параллель</option>`).join('');
    $('studentBranch').addEventListener('change',changeStudentContext);
    $('studentGrade').addEventListener('change',changeStudentContext);
    fillStudents(student().branchId,student().grade);
    $('adminBranch').innerHTML=allBranches.map(b=>`<option value="${h(b.id)}">${h(b.name)}</option>`).join('');
    $('adminGrade').innerHTML=grades.map(g=>`<option value="${g}">${g}-я параллель</option>`).join('');
    $('adminBranch').value=state.adminBranchId;
    $('adminGrade').value=String(state.adminGrade);
    $('adminBranch').addEventListener('change',e=>{state.adminBranchId=e.target.value;$('reportClass').value='all';renderAdmin();});
    $('adminGrade').addEventListener('change',e=>{state.adminGrade=Number(e.target.value);$('reportClass').value='all';renderAdmin();});
    $('studentSelect').addEventListener('change',e=>{state.studentId=e.target.value;state.wishes=[];state.suggestion=null;renderStudent();});
    $('tabStudent').addEventListener('click',()=>setMode('student'));
    $('tabAdmin').addEventListener('click',()=>setMode('admin'));
    $('brandLink').addEventListener('click',e=>{e.preventDefault();setMode('student');});
    $('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderCourses();});
    $('courseList').addEventListener('click',e=>{const btn=e.target.closest('[data-group]');if(btn)selectGroup(btn.dataset.group);});
    $('chosenList').addEventListener('click',e=>{const btn=e.target.closest('[data-remove]');if(btn)selectGroup(btn.dataset.remove);});
    $('confirmSelection').addEventListener('click',()=>{
      const rec=record();if(rec.confirmed)return;
      if(!rec.chosen.length&&!olympEnabled(rec)){notify('Сначала выбери хотя бы одно занятие.',true);return;}
      if(!window.confirm('Подтвердить выбор? После подтверждения изменения будут доступны только через панель методолога.'))return;
      rec.confirmed=true;rec.confirmedAt=new Date().toISOString();updateState();notify('Расписание подтверждено',false,true);
    });
    $('addWish').addEventListener('click',()=>{const name=$('wishSubject').value;if(name&&!state.wishes.includes(name)){state.wishes.push(name);state.suggestion=null;renderWishes();}});
    $('clearWishes').addEventListener('click',()=>{state.wishes=[];state.suggestion=null;renderWishes();});
    $('runHelper').addEventListener('click',runHelper);
    $('wishList').addEventListener('click',e=>{
      const btn=e.target.closest('[data-wish]');if(!btn||isLocked())return;
      const i=Number(btn.dataset.index),act=btn.dataset.wish;
      if(act==='remove')state.wishes.splice(i,1);
      if(act==='up'&&i>0)[state.wishes[i],state.wishes[i-1]]=[state.wishes[i-1],state.wishes[i]];
      if(act==='down'&&i<state.wishes.length-1)[state.wishes[i],state.wishes[i+1]]=[state.wishes[i+1],state.wishes[i]];
      state.suggestion=null;renderWishes();
    });
    $('reportClass').addEventListener('change',renderAdmin);
    document.querySelectorAll('.report-tab').forEach(btn=>btn.addEventListener('click',()=>{state.report=btn.dataset.report;renderAdmin();}));
    $('confirmedBody').addEventListener('click',e=>{
      const btn=e.target.closest('[data-unlock]');if(!btn)return;
      const sid=btn.dataset.unlock,rec=record(sid);
      if(!window.confirm(`Открыть выбор ученика «${studentById[sid].name}» для изменения? Подтверждение будет снято.`))return;
      rec.confirmed=false;rec.confirmedAt=null;state.studentId=sid;state.wishes=[];state.suggestion=null;persist();setMode('student');notify('Выбор открыт для исправления',false,true);
    });
    $('resetDemo').addEventListener('click',()=>{
      if(!window.confirm('Удалить все локальные подтверждения и выборы? Это затронет только текущий браузер.'))return;
      state.records={};state.restrictions={};state.wishes=[];state.suggestion=null;persist();renderAdmin();notify('Тестовые данные сброшены',false,true);
    });
    renderStudent();
  }
  setup();
})();
