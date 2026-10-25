/* Выбор допов — статическая демонстрация. Никакого сервера и настоящей авторизации. */
(() => {
  'use strict';
  if (!window.DOP_DATA) { document.body.textContent = 'Не найден файл data.js'; return; }
  const BASE = JSON.parse(JSON.stringify(window.DOP_DATA));
  const DATA = JSON.parse(JSON.stringify(BASE));
  const KEY = 'vybor_dopov_demo_v4';
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || JSON.parse(localStorage.getItem('vybor_dopov_demo_v3')) || JSON.parse(localStorage.getItem('vybor_dopov_demo_v2')) || {}; }
    catch { return {}; }
  })();
  const dayShort = ['','ПН','ВТ','СР','ЧТ','ПТ'];
  const $ = id => document.getElementById(id);
  const h = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const uniq = list => [...new Set(list)];
  const allBranches = DATA.branches;
  const grades = [1,2,3,4];
  const groupById = {};
  const studentById = {};
  // Одна и та же тема может предлагаться в нескольких параллелях и филиалах.
  // Группы — самостоятельные сущности внутри пары branchId + grade.
  function groupsFor(branchId, grade){return DATA.groups.filter(g=>g.branchId===branchId && g.grade===Number(grade));}
  function groupsForStudent(sid=state.studentId){const s=studentById[sid];return groupsFor(s.branchId,s.grade);}
  function subjectsForStudent(sid=state.studentId){return uniq(groupsForStudent(sid).filter(g=>g.type!=='olympiad').map(g=>g.subject)).sort((a,b)=>a.localeCompare(b,'ru'));}
  const scheduleMask = sessions => sessions.reduce((acc,s)=>acc|(1 << ((s.day-1)*2+(s.slot-1))),0);
  const sessionText = ses => `${dayShort[ses.day]}, доп №${ses.slot}`;
  const prettySessions = sessions => sessions.map(sessionText).join('; ');
  const state = {
    records:saved.records || {},
    addedStudents:saved.addedStudents || [],
    groupOverrides:saved.groupOverrides || {},
    offerOverrides:saved.offerOverrides || {},
    studentId:DATA.students.find(s=>DATA.olympiadOffers[s.id])?.id || DATA.students[0].id,
    mode:'student',search:'',wishes:[],suggestion:null,report:'subjects',
    adminBranchId:DATA.branches[0].id,adminGrade:2,adminTab:'overview',offerSelected:new Set()
  };
  // Локальные данные V3 хранили время олимпиады прямо у ученика.
  // При переходе на V4 связываем предложение с настоящей группой в каталоге.
  function migrateLegacyOffers(){
    for(const [sid,value] of Object.entries(state.offerOverrides)){
      if(!Array.isArray(value) || !value.length)continue;
      const stu=[...BASE.students,...state.addedStudents].find(s=>s.id===sid);
      if(!stu)continue;
      const norm=JSON.stringify([...value].sort((a,b)=>a.day-b.day||a.slot-b.slot));
      let group=[...BASE.groups,...Object.values(state.groupOverrides)].find(g=>g && g.type==='olympiad' && g.branchId===stu.branchId && g.grade===stu.grade && JSON.stringify(g.sessions)===norm);
      if(!group){
        const id='olymp-migrated-'+sid;
        group={id,subject:'Олимпиада',group:'Из V3',type:'olympiad',branchId:stu.branchId,grade:stu.grade,sessions:value};
        state.groupOverrides[id]=group;
      }
      state.offerOverrides[sid]=group.id;
    }
  }
  migrateLegacyOffers();
  function syncData(){
    DATA.students = [...BASE.students,...state.addedStudents];
    DATA.groups = [...BASE.groups,...Object.entries(state.groupOverrides).filter(([id])=>!BASE.groups.some(g=>g.id===id)).map(([,g])=>g)]
      .map(g=>Object.prototype.hasOwnProperty.call(state.groupOverrides,g.id)?state.groupOverrides[g.id]:g).filter(Boolean);
    DATA.olympiadOffers={...BASE.olympiadOffers,...state.offerOverrides};
    for(const id of Object.keys(studentById))delete studentById[id];
    for(const id of Object.keys(groupById))delete groupById[id];
    for(const s of DATA.students) studentById[s.id]=s;
    for(const g of DATA.groups) groupById[g.id]=g;
  }
  syncData();
  function persist(){
    try { localStorage.setItem(KEY,JSON.stringify({records:state.records,addedStudents:state.addedStudents,groupOverrides:state.groupOverrides,offerOverrides:state.offerOverrides})); }
    catch {notify('Не удалось сохранить в браузере. Проверьте режим приватности.',true);}
  }
  function record(sid=state.studentId){ if(!state.records[sid])state.records[sid]={chosen:[],olympiad:false,confirmed:false};return state.records[sid]; }
  function student(){return studentById[state.studentId];}
  function isLocked(){return !!record().confirmed;}
  function chosenGroups(rec=record(), sid=state.studentId){
    // Даже если локальные данные повреждены, группа чужой школы/параллели не попадает в расписание.
    const stu=studentById[sid];
    return rec.chosen.map(id=>groupById[id]).filter(g=>g && g.branchId===stu.branchId && g.grade===stu.grade);
  }
  function offer(sid=state.studentId){const id=DATA.olympiadOffers[sid];const g=groupById[id];return g && g.type==='olympiad' && allowedFor(g,sid)?g:null;}
  function olympEnabled(rec=record(),sid=state.studentId){return Boolean(rec.olympiad && offer(sid));}
  function allowedFor(g,sid=state.studentId){
    const s=studentById[sid];
    return Boolean(s && g && g.branchId===s.branchId && g.grade===s.grade);
  }
  function maskTaken(rec=record(),excludingGroupId=null,sid=state.studentId){
    let result=0;
    for(const g of chosenGroups(rec,sid)) if(g.id!==excludingGroupId) result|=scheduleMask(g.sessions);
    if(olympEnabled(rec,sid))result|=scheduleMask(offer(sid).sessions);
    return result;
  }
  function conflict(g,rec=record(),excludingId=null,sid=state.studentId){
    const candidates=[];
    const mask=scheduleMask(g.sessions);
    for(const another of chosenGroups(rec,sid))if(another.id!==excludingId && another.id!==g.id && (mask & scheduleMask(another.sessions)))candidates.push(another.subject);
    if(olympEnabled(rec,sid) && (mask & scheduleMask(offer(sid).sessions)))candidates.push('Олимпиада');
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
    if(mode==='admin'){renderAdmin();setAdminTab(state.adminTab);}else renderStudent();
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
    $('olympiadBox').innerHTML=`<div class="olympiad-offer"><div><h3>${h(o.subject)} · группа ${h(o.group)}</h3><p>${rec.olympiad?'Выбрано — время учитывается в расписании':'Принимать предложение необязательно'}</p><div class="slot-chips">${o.sessions.map(s=>`<span class="slot-pill">${h(sessionText(s))}</span>`).join('')}</div></div><label class="toggle" title="Принять или отклонить предложение"><input id="olympiadToggle" type="checkbox" ${rec.olympiad?'checked':''} ${rec.confirmed?'disabled':''} aria-label="Выбрать олимпиаду"><span></span></label></div>`;
    $('olympiadToggle').addEventListener('change',evt=>{
      if(isLocked()){evt.target.checked=rec.olympiad;return;}
      if(evt.target.checked){
        const conflicts=chosenGroups().filter(g=>scheduleMask(g.sessions)&scheduleMask(o.sessions));
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
    const allowed=groupsForStudent().filter(g=>g.type!=='olympiad');
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
    if(g.type==='olympiad'){notify('Олимпиаду можно принять только по предложению методолога.',true);return;}
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
    const items=[...gs.map(g=>`<div class="chosen-item"><div><span class="name">${h(g.subject)}</span><span class="detail">Группа ${h(g.group)}</span></div><button class="remove-button" data-remove="${h(g.id)}" title="Убрать занятие" aria-label="Убрать ${h(g.subject)}" ${rec.confirmed?'disabled':''}>×</button></div>`),...(olym?[`<div class="chosen-item"><div><span class="name">${h(offer().subject)}</span><span class="detail">Олимпиада · группа ${h(offer().group)} · предложение принято</span></div><span style="color:#bd8a21;font-size:18px">★</span></div>`]:[])];
    $('chosenList').innerHTML=items.length?items.join(''):'<div class="empty-chosen">Здесь появятся выбранные занятия</div>';
    const cells={};
    for(const g of gs)for(const ses of g.sessions)cells[ses.day+'-'+ses.slot]={text:g.subject,kind:'taken'};
    if(olym)for(const ses of offer().sessions)cells[ses.day+'-'+ses.slot]={text:offer().subject,kind:'olymp'};
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
        for(const g of groupsForStudent().filter(g=>g.type!=='olympiad' && g.subject===subject)){
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
    renderAdminStudents();
    renderAdminOlympiads();
    renderSubjectSuggestions();
  }
  function renderSummary(confirmed){
    const tab=state.report;
    document.querySelectorAll('.report-tab').forEach(b=>b.classList.toggle('active',b.dataset.report===tab));
    const inScope=reportStudents();
    const available=groupsFor(state.adminBranchId,state.adminGrade);
    let head=[],rows=[];
    if(tab==='subjects'){
      head=['Направление','Выборов'];
      const counts=new Map(uniq(available.map(g=>g.subject)).map(sub=>[sub,0]));
      for(const stu of confirmed){const rec=record(stu.id);for(const group of chosenGroups(rec,stu.id))counts.set(group.subject,(counts.get(group.subject)||0)+1);if(olympEnabled(rec,stu.id)){const sub=offer(stu.id).subject;counts.set(sub,(counts.get(sub)||0)+1);}}
      rows=[...counts].sort((a,b)=>b[1]-a[1]).map(([name,count])=>[name,String(count)]);
    }else if(tab==='groups'){
      head=['Направление','Группа','Выборов'];
      rows=available.map(g=>[g.subject,'№ '+g.group,String(confirmed.reduce((n,stu)=>n+(g.type==='olympiad'?(olympEnabled(record(stu.id),stu.id)&&offer(stu.id).id===g.id?1:0):(record(stu.id).chosen.includes(g.id)?1:0)),0))]).sort((a,b)=>Number(b[2])-Number(a[2]));
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
    $('adminGroupsBody').innerHTML=available.sort((a,b)=>a.subject.localeCompare(b.subject,'ru')) .map(g=>{
      const count=g.type==='olympiad'?olympiadOffersForGroup(g.id):studentSelectionsForGroup(g.id);
      return `<tr><td>${h(g.subject)}</td><td>${g.type==='olympiad'?'★ Олимпиада':'Обычный'}</td><td>${h(g.group)}</td><td>${h(prettySessions(g.sessions))}</td><td>${count}</td><td><div class="table-actions"><button type="button" class="btn outline mini" data-edit-group="${h(g.id)}" ${count?'disabled title="Есть записи или предложения учеников"':''}>Изменить</button><button type="button" class="btn ghost mini" data-delete-group="${h(g.id)}" ${count?'disabled title="Есть записи или предложения учеников"':''}>Удалить</button></div></td></tr>`;
    }).join('')||'<tr><td colspan="6" class="empty-row">Для этой параллели группы не заведены</td></tr>';
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
  /* Панель методолога: все изменения — локальные и ограничены демонстрационным филиалом. */
  function setAdminTab(tab){
    state.adminTab=tab;
    document.querySelectorAll('[data-admin-tab]').forEach(b=>{
      const active=b.dataset.adminTab===tab;
      b.classList.toggle('active',active);
      b.setAttribute('aria-current',active?'page':'false');
    });
    document.querySelectorAll('[data-admin-panel]').forEach(p=>p.hidden=p.dataset.adminPanel!==tab);
  }
  function scopedStudent(s){return s.branchId===state.adminBranchId && s.grade===state.adminGrade;}
  function scopedGroup(g){return g.branchId===state.adminBranchId && g.grade===state.adminGrade;}
  function newId(prefix){
    let id;
    do{id=prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);}while(studentById[id]||groupById[id]);
    return id;
  }
  function studentSelectionsForGroup(groupId){
    return DATA.students.reduce((n,s)=>n+(state.records[s.id]?.chosen?.includes(groupId)?1:0),0);
  }
  function olympiadOffersForGroup(groupId){return DATA.students.reduce((n,s)=>n+(DATA.olympiadOffers[s.id]===groupId?1:0),0);}
  function initSlotPicker(id){
    const el=$(id);
    el.innerHTML=DATA.days.map((day,i)=>`<fieldset class="day-choices"><legend>${h(day)}</legend>${DATA.slots.map(sl=>`<label class="slot-option"><input type="checkbox" value="${i+1}:${sl.id}"><span>${h(sl.name)}<small>${h(sl.from)}–${h(sl.to)}</small></span></label>`).join('')}</fieldset>`).join('');
  }
  function getSlotSelection(id){
    return [...$(id).querySelectorAll('input[type=checkbox]:checked')].map(i=>{
      const [day,slot]=i.value.split(':').map(Number);return {day,slot};
    }).sort((a,b)=>a.day-b.day||a.slot-b.slot);
  }
  function setSlotSelection(id,sessions){
    const vals=new Set((sessions||[]).map(s=>`${s.day}:${s.slot}`));
    $(id).querySelectorAll('input[type=checkbox]').forEach(i=>i.checked=vals.has(i.value));
  }
  function fieldError(id,message){$(id).textContent=message;$(id).hidden=!message;}
  function resetGroupEditor(){
    $('groupForm').reset();$('editingGroupId').value='';
    $('groupFormTitle').textContent='Создать доп и расписание группы';
    $('saveGroup').textContent='+ Создать доп и группу';
    $('cancelEditGroup').hidden=true;
    fieldError('groupFormError','');
  }
  function renderSubjectSuggestions(){
    const names=uniq([...DATA.subjects,...DATA.groups.map(g=>g.subject)]).sort((a,b)=>a.localeCompare(b,'ru'));
    $('subjectSuggestions').innerHTML=names.map(x=>`<option value="${h(x)}"></option>`).join('');
  }
  function saveGroupForm(evt){
    evt.preventDefault();fieldError('groupFormError','');
    let subject=$('groupSubject').value.trim().replace(/\s+/g,' ');
    const group= $('groupNumber').value.trim().replace(/\s+/g,' ');
    const type=$('groupType').value;
    const sessions=getSlotSelection('groupSlotPicker');
    const existingId=$('editingGroupId').value;
    const existing=existingId?groupById[existingId]:null;
    if(subject.length<2||!group){fieldError('groupFormError','Укажите название допа (от 2 символов) и группу.');return;}
    const canonical=uniq([...DATA.subjects,...DATA.groups.map(g=>g.subject)]).find(x=>x.toLocaleLowerCase('ru')===subject.toLocaleLowerCase('ru'));
    if(canonical)subject=canonical;
    if(!sessions.length){fieldError('groupFormError','Выберите хотя бы один слот расписания.');return;}
    if(existingId&&(!existing||!scopedGroup(existing))){fieldError('groupFormError','Эта группа недоступна в данном филиале и параллели.');return;}
    if(existing&&(studentSelectionsForGroup(existing.id)>0 || olympiadOffersForGroup(existing.id)>0)){fieldError('groupFormError','Группа уже выбрана учеником. Сначала измените его выбор, затем расписание.');return;}
    if(groupsFor(state.adminBranchId,state.adminGrade).some(g=>g.id!==existingId && (g.type||'regular')===type && g.subject.toLocaleLowerCase('ru')===subject.toLocaleLowerCase('ru') && String(g.group).toLocaleLowerCase('ru')===group.toLocaleLowerCase('ru'))){
      fieldError('groupFormError','Группа с таким номером уже есть у этого направления в данной параллели.');return;
    }
    const id=existingId||newId('group');
    state.groupOverrides[id]={id,subject,group,type,sessions,branchId:state.adminBranchId,grade:state.adminGrade};
    syncData();persist();resetGroupEditor();renderAdmin();renderStudent();
    notify(type==='olympiad'?'Олимпиада создана. Теперь предложите её ученикам во вкладке «Олимпиады».':(existingId?'Расписание группы обновлено':'Новое направление/группа создано и доступно ученикам'),false,true);
  }
  function editGroup(id){
    const g=groupById[id];if(!g||!scopedGroup(g))return;
    if(studentSelectionsForGroup(id)||olympiadOffersForGroup(id))return notify('Нельзя редактировать группу, уже связанную с учениками или предложениями.',true);
    setAdminTab('groups');
    $('editingGroupId').value=g.id;$('groupType').value=g.type||'regular';$('groupSubject').value=g.subject;$('groupNumber').value=g.group;
    setSlotSelection('groupSlotPicker',g.sessions);
    $('groupFormTitle').textContent='Изменить группу и расписание';
    $('saveGroup').textContent='Сохранить изменения';$('cancelEditGroup').hidden=false;
    fieldError('groupFormError','');$('groupForm').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function deleteGroup(id){
    const g=groupById[id];if(!g||!scopedGroup(g))return;
    if(studentSelectionsForGroup(id)||olympiadOffersForGroup(id))return notify('Нельзя удалить группу, для которой есть записи или предложения.',true);
    if(!window.confirm(`Удалить группу «${g.subject} · ${g.group}»?`))return;
    state.groupOverrides[id]=null;
    syncData();persist();if($('editingGroupId').value===id)resetGroupEditor();
    renderAdmin();renderStudent();notify('Группа удалена из этого филиала и параллели',false,true);
  }
  function renderAdminStudents(){
    const users=reportStudents().sort((a,b)=>a.className.localeCompare(b.className,'ru')||a.name.localeCompare(b.name,'ru'));
    $('studentsScopeLabel').textContent=`${users.length} учеников · ${state.adminGrade}-я параллель`;
    $('manageStudentsBody').innerHTML=users.map(s=>{
      const rec=state.records[s.id],text=rec?.confirmed?'Подтверждён':(rec?.chosen?.length||rec?.olympiad)?'В процессе':'Не выбрано';
      const custom=state.addedStudents.some(x=>x.id===s.id);
      return `<tr><td>${h(s.name)}</td><td>${h(s.className)}</td><td>${h(text)}</td><td><div class="table-actions"><button type="button" class="btn outline mini" data-open-student="${h(s.id)}">Открыть</button>${custom?`<button type="button" class="btn ghost mini" data-delete-student="${h(s.id)}">Удалить</button>`:''}</div></td></tr>`;
    }).join('')||'<tr><td class="empty-row" colspan="4">В параллели пока нет учеников</td></tr>';
  }
  function addStudent(evt){
    evt.preventDefault();
    const name=$('newStudentName').value.trim().replace(/\s+/g,' ');
    if(name.length<2){notify('Укажите имя ученика.',true);return;}
    const letter=$('newStudentClass').value;
    const branch=allBranches.find(b=>b.id===state.adminBranchId);
    const s={id:newId('student'),name,branch:branch.name,branchId:branch.id,grade:state.adminGrade,className:`${state.adminGrade} "${letter}"`};
    state.addedStudents.push(s);syncData();persist();$('studentForm').reset();renderAdmin();renderStudent();
    notify(`Ученик «${name}» добавлен в ${branch.name}`,false,true);
  }
  function openStudent(id){
    const s=studentById[id];if(!s||!scopedStudent(s))return;
    state.studentId=id;state.wishes=[];state.suggestion=null;state.search='';$('searchInput').value='';
    setMode('student');notify('Открыт кабинет выбранного ученика');
  }
  function deleteStudent(id){
    const s=studentById[id];if(!s||!scopedStudent(s)||!state.addedStudents.some(x=>x.id===id))return;
    if(!window.confirm(`Удалить тестового ученика «${s.name}» и его выбор?`))return;
    state.addedStudents=state.addedStudents.filter(x=>x.id!==id);
    delete state.records[id];delete state.offerOverrides[id];
    syncData();persist();if(state.studentId===id)state.studentId=DATA.students[0].id;
    renderAdmin();renderStudent();notify('Тестовый ученик удалён',false,true);
  }
  function renderOlympiadGroupOptions(){
    const select=$('olympiadGroup'),previous=select.value;
    const groups=groupsFor(state.adminBranchId,state.adminGrade).filter(g=>g.type==='olympiad');
    select.innerHTML=groups.map(g=>`<option value="${h(g.id)}">${h(g.subject)} · группа ${h(g.group)} · ${h(prettySessions(g.sessions))}</option>`).join('') || '<option value="">Сначала создайте олимпиаду</option>';
    if(groups.some(g=>g.id===previous))select.value=previous;
    select.disabled=groups.length===0;
    $('noOlympiadGroups').hidden=groups.length>0;
    $('assignOlympiadButton').disabled=groups.length===0;
  }
  function renderAdminOlympiads(){
    renderOlympiadGroupOptions();
    const users=reportStudents().sort((a,b)=>a.className.localeCompare(b.className,'ru')||a.name.localeCompare(b.name,'ru'));
    const q=$('olympiadStudentSearch').value.trim().toLocaleLowerCase('ru');
    $('olympiadStudentsCount').textContent=`${users.length} учеников · отмечено ${state.offerSelected.size}`;
    const found=users.filter(s=>(s.name+' '+s.className).toLocaleLowerCase('ru').includes(q));
    $('olympiadStudentPicker').innerHTML=found.map(s=>`<label class="student-check"><input type="checkbox" value="${h(s.id)}" ${state.offerSelected.has(s.id)?'checked':''}><span><strong>${h(s.name)}</strong><small>${h(s.className)}${offer(s.id)?' · уже предложено':''}</small></span></label>`).join('')||'<div class="microcopy">Учеников не найдено</div>';
    const assigned=users.filter(s=>offer(s.id));
    $('olympiadAssignmentsBody').innerHTML=assigned.map(s=>{
      const o=offer(s.id),rec=state.records[s.id],status=rec?.olympiad?(rec.confirmed?'Принято и подтверждено':'Принято, не подтверждено'):(rec?.confirmed?'Не выбрано':'Предложено');
      const locked=!!(rec?.olympiad||rec?.confirmed);
      return `<tr><td>${h(s.name)}</td><td>${h(s.className)}</td><td>${h(o.subject)} · ${h(o.group)}</td><td>${h(prettySessions(o.sessions))}</td><td><span class="${rec?.olympiad?'status-accepted':'status-pending'}">${status}</span></td><td><div class="table-actions"><button type="button" class="btn outline mini" data-edit-offer="${h(s.id)}" ${locked?'disabled title="Выбор ученика заблокирован"':''}>Изменить</button><button type="button" class="btn ghost mini" data-revoke-offer="${h(s.id)}" ${locked?'disabled title="Выбор ученика заблокирован"':''}>Отозвать</button></div></td></tr>`;
    }).join('')||'<tr><td class="empty-row" colspan="6">В этой параллели ещё нет предложений олимпиады</td></tr>';
  }
  function resetOlympiadEditor(){
    $('olympiadForm').reset();state.offerSelected.clear();
    $('olympiadStudentSearch').value='';fieldError('olympiadFormError','');
    renderAdminOlympiads();
  }
  function assignOlympiad(evt){
    evt.preventDefault();fieldError('olympiadFormError','');
    const group=groupById[$('olympiadGroup').value];
    const ids=[...state.offerSelected];
    if(!group||group.type!=='olympiad'||!scopedGroup(group)){fieldError('olympiadFormError','Сначала создайте группу олимпиады в разделе «Допы и расписание».');return;}
    if(!ids.length){fieldError('olympiadFormError','Выберите хотя бы одного ученика.');return;}
    let updated=0,skipped=[];
    for(const id of ids){
      const s=studentById[id];if(!s||!scopedStudent(s))continue;
      const rec=state.records[id];
      if(rec?.olympiad){skipped.push(s.name+' (уже принята)');continue;}
      if(rec?.confirmed){skipped.push(s.name+' (выбор подтверждён)');continue;}
      // Предлагаем созданную группу. Согласие и разрешение пересечений — за учеником.
      state.offerOverrides[id]=group.id;updated++;
    }
    syncData();persist();resetOlympiadEditor();renderAdmin();renderStudent();
    if(updated)notify(`Предложений группы «${group.subject}» назначено: ${updated}`,false,true);
    if(skipped.length)notify(`Не изменены: ${skipped.slice(0,3).join(', ')}${skipped.length>3?' и ещё '+(skipped.length-3):''}`,true);
  }
  function editOffer(id){
    const s=studentById[id],rec=state.records[id],o=offer(id);if(!s||!scopedStudent(s)||!o)return;
    if(rec?.olympiad||rec?.confirmed)return notify('Сначала необходимо открыть и изменить подтверждённый выбор.',true);
    $('olympiadGroup').value=o.id;
    state.offerSelected=new Set([id]);
    $('olympiadStudentSearch').value=s.name;renderAdminOlympiads();
    $('olympiadForm').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function revokeOffer(id){
    const s=studentById[id],rec=state.records[id];if(!s||!scopedStudent(s)||!offer(id))return;
    if(rec?.olympiad||rec?.confirmed)return notify('Нельзя отозвать олимпиаду после принятия или подтверждения выбора.',true);
    if(!window.confirm(`Отозвать предложение олимпиады у «${s.name}»?`))return;
    state.offerOverrides[id]=null;syncData();persist();renderAdmin();renderStudent();
    notify('Предложение отозвано',false,true);
  }
  function setupAdminForms(){
    initSlotPicker('groupSlotPicker');
    $('studentForm').addEventListener('submit',addStudent);
    $('groupForm').addEventListener('submit',saveGroupForm);
    $('cancelEditGroup').addEventListener('click',resetGroupEditor);
    $('olympiadForm').addEventListener('submit',assignOlympiad);
    $('clearOlympiadForm').addEventListener('click',resetOlympiadEditor);
    $('olympiadStudentSearch').addEventListener('input',renderAdminOlympiads);
    $('olympiadStudentPicker').addEventListener('change',e=>{
      const checkbox=e.target.closest('input[type=checkbox]');if(!checkbox)return;
      if(checkbox.checked)state.offerSelected.add(checkbox.value);else state.offerSelected.delete(checkbox.value);
      $('olympiadStudentsCount').textContent=`${reportStudents().length} учеников · отмечено ${state.offerSelected.size}`;
    });
    $('selectAllOlympiad').addEventListener('change',e=>{
      $('olympiadStudentPicker').querySelectorAll('input[type=checkbox]').forEach(i=>{
        i.checked=e.target.checked;
        if(e.target.checked)state.offerSelected.add(i.value);else state.offerSelected.delete(i.value);
      });
      renderAdminOlympiads();
    });
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>setAdminTab(b.dataset.adminTab)));
    $('adminGroupsBody').addEventListener('click',e=>{
      const edit=e.target.closest('[data-edit-group]'),del=e.target.closest('[data-delete-group]');
      if(edit)editGroup(edit.dataset.editGroup);if(del)deleteGroup(del.dataset.deleteGroup);
    });
    $('manageStudentsBody').addEventListener('click',e=>{
      const open=e.target.closest('[data-open-student]'),del=e.target.closest('[data-delete-student]');
      if(open)openStudent(open.dataset.openStudent);if(del)deleteStudent(del.dataset.deleteStudent);
    });
    $('olympiadAssignmentsBody').addEventListener('click',e=>{
      const edit=e.target.closest('[data-edit-offer]'),revoke=e.target.closest('[data-revoke-offer]');
      if(edit)editOffer(edit.dataset.editOffer);if(revoke)revokeOffer(revoke.dataset.revokeOffer);
    });
    $('exportData').addEventListener('click',()=>{
      const content={version:4,exportedAt:new Date().toISOString(),...{
        addedStudents:state.addedStudents,groupOverrides:state.groupOverrides,offerOverrides:state.offerOverrides,records:state.records
      }};
      const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='vybor-dopov-demo-backup.json';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify('Тестовые данные выгружены в JSON',false,true);
    });
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
    $('adminBranch').addEventListener('change',e=>{state.adminBranchId=e.target.value;$('reportClass').value='all';resetGroupEditor();resetOlympiadEditor();renderAdmin();});
    $('adminGrade').addEventListener('change',e=>{state.adminGrade=Number(e.target.value);$('reportClass').value='all';resetGroupEditor();resetOlympiadEditor();renderAdmin();});
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
    setupAdminForms();
    $('resetDemo').addEventListener('click',()=>{
      if(!window.confirm('Сбросить добавленных учеников, группы, предложения олимпиады и все выборы в этом браузере?'))return;
      state.records={};state.addedStudents=[];state.groupOverrides={};state.offerOverrides={};state.wishes=[];state.suggestion=null;
      syncData();persist();resetGroupEditor();resetOlympiadEditor();state.studentId=DATA.students[0].id;
      renderStudent();renderAdmin();notify('Тестовые данные восстановлены',false,true);
    });
    renderStudent();
  }
  setup();
})();
