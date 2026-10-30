import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days = ['','ПН','ВТ','СР','ЧТ','ПТ'];
const configKey = 'vybor_dopov_supabase_v6'; // сохраняем подключение V6
const state = {
  client:null,user:null,profile:null,branch:null,myStudent:null,grade:2,
  students:[],studentAccounts:[],subjects:[],groups:[],sessions:[],slots:[],offers:[],choices:[],
  panel:'overview',report:'subjects',search:'',offerSearch:'',busy:false,accountInfo:new Map()
};
let noticeTimer;
function notice(message,error=false){
  const n=$('message');n.hidden=false;n.className='live-message '+(error?'error':'ok');n.textContent=message;
  clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>n.hidden=true,8500);
}
function friendly(error){
  const msg=error?.message || String(error);
  if(/permission denied|row-level security|violates row-level/i.test(msg))return 'Доступ запрещён настройками базы. '+msg;
  if(/duplicate key|unique constraint/i.test(msg))return 'Такая запись уже существует. '+msg;
  return msg;
}
async function operation(fn,button){
  if(state.busy)return;
  state.busy=true;if(button)button.disabled=true;
  try{await fn();await reload();notice('Сохранено в Supabase.');}
  catch(err){notice(friendly(err),true);}
  finally{state.busy=false;if(button)button.disabled=false;}
}
function createConfigClient(url,key){
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))throw new Error('Некорректный Project URL Supabase.');
  if(!key.startsWith('sb_publishable_'))throw new Error('Введи только Publishable key (sb_publishable_...).');
  return createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
}
async function restore(){
  const old=localStorage.getItem(configKey);if(!old)return;
  try{
    const {url,key}=JSON.parse(old);
    $('projectUrl').value=url; $('publishableKey').value=key;
    state.client=createConfigClient(url,key);
    const {data,error}=await state.client.auth.getUser();
    if(error || !data?.user)return;
    state.user=data.user;
    await openWorkspace();
  }catch(err){notice('Автоматический вход недоступен: '+friendly(err),true);}
}
async function login(event){
  event.preventDefault();
  const btn=$('loginButton');btn.disabled=true;
  try{
    const url=$('projectUrl').value.trim().replace(/\/+$/,''),key=$('publishableKey').value.trim();
    state.client=createConfigClient(url,key);
    let data,error;
    if($('loginMode').value==='student'){
      const response=await state.client.functions.invoke('school-accounts', {body:{action:'login_student',login:$('username').value.trim(),password:$('password').value}});
      if(response.error){let msg=response.error.message;try{msg=(await response.error.context.json()).error||msg;}catch{}throw new Error(msg);}
      if(response.data?.error)throw new Error(response.data.error);
      const session=await state.client.auth.setSession({access_token:response.data.access_token,refresh_token:response.data.refresh_token});
      data=session.data;error=session.error;
    } else {
      const response=await state.client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
      data=response.data;error=response.error;
    }
    $('password').value='';if(error)throw error;
    localStorage.setItem(configKey,JSON.stringify({url,key}));
    state.user=data.user;
    await openWorkspace();notice('Вход выполнен.');
  }catch(err){notice('Не удалось войти: '+friendly(err),true);}
  finally{btn.disabled=false;}
}
async function read(table,columns='*'){
  // Данные фильтруются RLS на сервере. Клиент дополнительно фильтрует область.
  const all=[];
  for(let start=0;start<14000;start+=700){
    const {data,error}=await state.client.from(table).select(columns).range(start,start+699);
    if(error)throw new Error(`${table}: ${error.message}`);
    all.push(...(data||[]));if(!data || data.length<700)break;
  }
  return all;
}
async function openWorkspace(){
  const {data:userData,error:authError}=await state.client.auth.getUser();
  if(authError || !userData?.user)throw new Error('Нет действующей сессии. Войди заново.');
  state.user=userData.user;
  const {data:profile,error:pError}=await state.client.from('profiles').select('role,branch_id,is_active').eq('user_id',state.user.id).single();
  if(pError)throw new Error('Нет привязанного профиля. '+pError.message);
  if(profile.is_active===false)throw new Error('Учётная запись заблокирована.');
  if(profile.role==='system_admin'){localStorage.setItem(configKey,JSON.stringify({url:$('projectUrl').value.trim(),key:$('publishableKey').value.trim()}));window.location.href='accounts.html';return;}
  if(!['methodologist','student'].includes(profile.role))throw new Error('Для этой роли кабинет ещё не создан.');
  state.profile=profile;
  const {data:branch,error:bError}=await state.client.from('branches').select('id,name').eq('id',profile.branch_id).single();
  if(bError)throw bError;
  state.branch=branch;
  $('loginView').hidden=true;$('topUser').hidden=false;
  $('identity').textContent=`${profile.role==='methodologist'?'Методолог':'Ученик'} · ${branch.name}`;
  $('adminView').hidden=profile.role!=='methodologist';
  $('studentView').hidden=profile.role!=='student';
  if(profile.role==='methodologist')$('branchCaption').textContent=branch.name;
  await reload();
}
async function logout(){
  if(state.client)await state.client.auth.signOut();
  state.user=null;state.profile=null;state.branch=null;state.myStudent=null;
  $('topUser').hidden=true;$('studentView').hidden=true;$('adminView').hidden=true;$('loginView').hidden=false;
  $('password').value='';notice('Вы вышли из системы.');
}
async function reload(){
  if(!state.client || !state.profile)return;
  if(state.profile.role==='methodologist'){
    try{const a=await accountsApi('list');state.accountInfo=new Map((a.students||[]).map(x=>[x.id,x]));}
    catch(e){state.accountInfo=new Map();notice('Не удалось получить статусы учётных записей: '+friendly(e),true);}
  }
  const [students,studentAccounts,subjects,groups,sessions,slots,offers,choices]=await Promise.all([
    read('students','id,branch_id,grade,class_letter,full_name,user_id,confirmed_at'),
    read('student_accounts','student_id,login'),
    read('subjects','id,name'),
    read('study_groups','id,branch_id,grade,subject_id,group_name,kind'),
    read('group_sessions','group_id,weekday,slot_id'),
    read('time_slots','id,time_from,time_to'),
    read('olympiad_offers','student_id,group_id,branch_id,grade,status'),
    read('regular_selections','student_id,group_id,branch_id,grade')
  ]);
  // Не полагаемся на фильтр клиента для безопасности: серверные RLS применяются к каждому запросу.
  Object.assign(state,{
    students:students.sort((a,b)=>a.grade-b.grade||a.full_name.localeCompare(b.full_name,'ru')),studentAccounts,
    subjects:subjects.sort((a,b)=>a.name.localeCompare(b.name,'ru')),
    groups,sessions,slots:slots.sort((a,b)=>a.id-b.id),offers,choices
  });
  if(state.profile.role==='student'){
    state.myStudent=state.students.find(s=>s.user_id===state.user.id);
    if(!state.myStudent){$('studentMeta').textContent='Учётная запись ещё не привязана к ученику';$('studentStatus').textContent='Нет карточки ученика';$('courseList').replaceChildren();$('olympiadBox').replaceChildren();return;}
    renderStudent();
  } else renderAdmin();
}
function studentLabel(id){return state.studentAccounts.find(a=>a.student_id===id)?.login || state.students.find(s=>s.id===id)?.full_name || 'Ученик';}
function subject(id){return state.subjects.find(x=>x.id===id)?.name || 'Неизвестное направление';}
function group(id){return state.groups.find(x=>x.id===id);}
function activeStudents(){return state.students.filter(s=>s.grade===state.grade && s.branch_id===state.branch.id);}
function activeGroups(){return state.groups.filter(g=>g.grade===state.grade && g.branch_id===state.branch.id);}
function groupSlots(groupId){return state.sessions.filter(s=>s.group_id===groupId);}
function groupName(g){return `${subject(g.subject_id)} · ${g.group_name}`;}
function slotLabel(s){const t=state.slots.find(t=>t.id===s.slot_id);return `${days[s.weekday]} ${t? t.time_from.slice(0,5)+'–'+t.time_to.slice(0,5):'доп №'+s.slot_id}`;}
function groupSchedule(g){return groupSlots(g.id).sort((a,b)=>a.weekday-b.weekday||a.slot_id-b.slot_id).map(slotLabel).join(' · ');}
function sessionsClash(first,second){
  const firstSet=new Set(groupSlots(first).map(s=>`${s.weekday}:${s.slot_id}`));
  return groupSlots(second).some(s=>firstSet.has(`${s.weekday}:${s.slot_id}`));
}
function selectedRegular(id){return state.choices.filter(x=>x.student_id===id).map(x=>group(x.group_id)).filter(Boolean);}
function selectedOlympiads(id){return state.offers.filter(x=>x.student_id===id&&x.status==='accepted').map(x=>group(x.group_id)).filter(Boolean);}
function busyGroups(id){return [...selectedRegular(id),...selectedOlympiads(id)];}
function conflicting(id,candidate,excludeId){
  return busyGroups(id).filter(g=>g.id!==candidate.id && g.id!==excludeId && sessionsClash(candidate.id,g.id));
}
const empty = (text='Пока записей нет')=>`<tr><td colspan="8" class="muted-empty">${esc(text)}</td></tr>`;
function renderStudent(){
  const st=state.myStudent; if(!st)return;
  const locked=Boolean(st.confirmed_at);
  $('studentMeta').innerHTML=`<span class="student-chip">${esc(studentLabel(st.id))}</span><span class="student-chip">${st.grade} «${esc(st.class_letter)}»</span><span class="student-chip">${esc(state.branch.name)}</span>`;
  $('studentStatus').className='status-label'+(locked?' confirmed':'');
  $('studentStatus').textContent=locked?'✓ Выбор подтверждён':'Выбор не подтверждён';
  const selected=selectedRegular(st.id),accepted=selectedOlympiads(st.id),list=[...selected,...accepted];
  $('selectedCount').textContent=String(list.length);
  $('chosenList').innerHTML=list.length?list.map(g=>`<div class="chosen-item"><div><span class="name">${esc(subject(g.subject_id))}</span><span class="detail">${g.kind==='olympiad'?'Олимпиада · ':''}${esc(g.group_name)}</span></div>${g.kind==='regular'?`<button type="button" data-remove="${esc(g.id)}" class="remove-button" title="Убрать" ${locked?'disabled':''}>×</button>`:'<span>★</span>'}</div>`).join(''):'<div class="empty-chosen">Выбранные занятия появятся здесь</div>';
  const cells=new Map();for(const g of list)for(const ses of groupSlots(g.id))cells.set(`${ses.weekday}:${ses.slot_id}`,{title:subject(g.subject_id),kind:g.kind});
  $('scheduleBody').innerHTML=state.slots.map(sl=>`<tr><td><strong>${esc(sl.time_from.slice(0,5))}</strong><div>${esc(sl.time_to.slice(0,5))}</div></td>${[1,2,3,4,5].map(day=>{let c=cells.get(`${day}:${sl.id}`);return c?`<td class="${c.kind==='olympiad'?'olymp':'taken'}">${esc(c.title)}</td>`:'<td>—</td>'}).join('')}</tr>`).join('');
  $('confirmSelection').disabled=locked||!list.length;
  $('confirmSelection').textContent=locked?'✓ Расписание подтверждено':'Подтвердить выбор';
  const myOffers=state.offers.filter(x=>x.student_id===st.id);
  $('olympiadBox').innerHTML=myOffers.length?`<div class="olympiad-list">${myOffers.map(o=>{
    const g=group(o.group_id);if(!g)return '';
    const clash= o.status==='accepted'?[]:conflicting(st.id,g);
    return `<div class="olympiad-offer"><div><h3>${esc(subject(g.subject_id))} · ${esc(g.group_name)}</h3><p>${o.status==='accepted'?'✓ Принята':o.status==='declined'?'Отклонена': 'Предложена'}${clash.length?' · пересечение: '+esc(clash.map(x=>subject(x.subject_id)).join(', ')):''}</p><div class="slot-chips">${groupSlots(g.id).map(s=>`<span class="slot-pill">${esc(slotLabel(s))}</span>`).join('')}</div><div class="mini-actions"><button class="btn ${o.status==='accepted'?'ghost':'outline'} mini" data-offer-action="accepted" data-offer-group="${esc(g.id)}" ${locked||clash.length?'disabled':''}>Принять</button><button class="btn ghost mini" data-offer-action="declined" data-offer-group="${esc(g.id)}" ${locked?'disabled':''}>Отклонить</button></div></div></div>`;
  }).join('')}</div>`:'<div class="offer-empty">Методолог пока не предложил олимпиады.</div>';
  const available=state.groups.filter(g=>g.branch_id===st.branch_id&&g.grade===st.grade&&g.kind==='regular');
  const subjects=[...new Set(available.map(g=>g.subject_id))].filter(id=>subject(id).toLocaleLowerCase('ru').includes(state.search.toLocaleLowerCase('ru')));
  $('resultCount').textContent=`${subjects.length} направлений`;
  $('courseList').innerHTML=subjects.map(id=>{
    const gs=available.filter(g=>g.subject_id===id),old=selected.find(g=>g.subject_id===id);
    return `<div class="course-card"><div class="course-head"><h3>${esc(subject(id))}</h3><span class="result-count">${gs.length} гр.</span></div><div class="group-list">${gs.map(g=>{
      const chosen=old?.id===g.id;
      const conflicts=chosen?[]:conflicting(st.id,g,old?.id);
      const reason=conflicts.length?'Пересечение: '+conflicts.map(x=>subject(x.subject_id)).join(', '):'';
      const disabled=locked||conflicts.length>0;
      return `<div class="group-row ${chosen?'selected':disabled?'disabled':''}"><div class="group-info"><span class="group-title">${esc(g.group_name)}</span><div class="slot-chips">${groupSlots(g.id).map(s=>`<span class="slot-pill">${esc(slotLabel(s))}</span>`).join('')}</div>${reason?`<p class="group-reason">${esc(reason)}</p>`:''}</div><button class="btn ${chosen?'ghost':'outline'} mini" data-select-group="${esc(g.id)}" ${disabled?'disabled':''}>${chosen?'✓ Убрать':old?'Сменить':'Выбрать'}</button></div>`;
    }).join('')}</div></div>`;
  }).join('')||'<div class="offer-empty">Для вашей параллели ещё не созданы занятия.</div>';
}
async function selectGroup(groupId){
  const st=state.myStudent, g=group(groupId);if(!g||!st||st.confirmed_at)return;
  const old=selectedRegular(st.id).find(x=>x.subject_id===g.subject_id);
  await operation(async()=>{
    let response;
    if(old?.id===groupId)response=await state.client.from('regular_selections').delete().eq('student_id',st.id).eq('group_id',groupId);
    else if(old)response=await state.client.rpc('replace_regular_selection',{p_previous_group_id:old.id,p_new_group_id:groupId});
    else response=await state.client.from('regular_selections').insert({student_id:st.id,group_id:groupId,branch_id:st.branch_id,grade:st.grade});
    if(response.error)throw response.error;
  });
}
async function changeOffer(groupId,status){
  const st=state.myStudent;if(!st||st.confirmed_at)return;
  await operation(async()=>{
    const {error}=await state.client.from('olympiad_offers').update({status}).eq('student_id',st.id).eq('group_id',groupId);
    if(error)throw error;
  });
}
function renderSlotPicker(){
  $('sessionPicker').innerHTML=[1,2,3,4,5].map(d=>`<fieldset class="day-choices"><legend>${days[d]}</legend>${state.slots.map(s=>`<label class="slot-option"><input type="checkbox" name="session" value="${d}:${s.id}"><span>Доп №${s.id}<small>${esc(s.time_from.slice(0,5))}–${esc(s.time_to.slice(0,5))}</small></span></label>`).join('')}</fieldset>`).join('');
}
async function accountsApi(action,params={}){
  const {data,error}=await state.client.functions.invoke('school-accounts',{body:{action,...params}});
  if(error){let detail=error.message;try{detail=(await error.context.json()).error||detail;}catch{}throw new Error(detail);}
  if(data?.error)throw new Error(data.error);return data;
}
function showNewStudentPassword(login,password){
  const dialog=$('studentPasswordDialog');
  $('newStudentLogin').textContent=login;
  $('newStudentPassword').textContent=password;
  dialog.showModal();
}
async function studentAccountAction(type,id){
  const info=state.accountInfo.get(id);if(!info?.has_account){notice('Сначала выдайте ученику учётную запись.',true);return;}
  const login=info.login||studentLabel(id);
  if(type==='reset'){
    if(!confirm(`Создать новый пароль для ${login}? Старый пароль перестанет действовать.`))return;
    await operation(async()=>{const data=await accountsApi('reset_password',{type:'student',id});showNewStudentPassword(login,data.password);});
  }else{
    const enabled=info.is_active===false;
    if(!confirm(`${enabled?'Разблокировать':'Заблокировать'} ${login}?`))return;
    await operation(async()=>{await accountsApi('set_active',{type:'student',id,enabled});});
  }
}
function renderAdmin(){
  $('adminGrade').value=String(state.grade);
  document.querySelectorAll('[data-panel-view]').forEach(node=>node.hidden=node.dataset.panelView!==state.panel);
  document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===state.panel));
  const students=activeStudents(),groups=activeGroups();
  $('metrics').innerHTML=[['Учеников',students.length],['Групп',groups.length],['Олимпиад',groups.filter(g=>g.kind==='olympiad').length],['Подтверждений',students.filter(s=>s.confirmed_at).length]].map(([label,count])=>`<div class="metric"><strong>${count}</strong><span>${label}</span></div>`).join('');
  $('unconfirmedBody').innerHTML=students.filter(s=>!s.confirmed_at).map(s=>`<tr><td>${esc(studentLabel(s.id))}</td><td>${s.grade} «${esc(s.class_letter)}»</td><td>Не подтверждено</td></tr>`).join('')||empty('Все ученики этой параллели подтвердили выбор или учеников ещё нет');
  $('studentBody').innerHTML=students.map(s=>{
    const info=state.accountInfo.get(s.id),hasAccount=info?.has_account===true,active=info?.is_active!==false;
    const status=!s.user_id?'Не привязана':!info?'Не определён':!hasAccount?'Нет доступа':active?'Активен':'Заблокирован';
    const controls=hasAccount?`<div class="account-actions"><button type="button" class="btn outline mini" data-student-reset="${esc(s.id)}">Сменить пароль</button><button type="button" class="btn outline mini" data-student-toggle="${esc(s.id)}">${active?'Блокировать':'Разблокировать'}</button></div>`:`<a class="btn outline mini" href="accounts.html">Выдать доступ</a>`;
    return `<tr><td>${esc(studentLabel(s.id))}<div class="small-status">ID: ${esc(s.id.slice(0,8))}… <button class="copy-inline" type="button" data-copy-id="${esc(s.id)}">Копировать ID</button></div></td><td>${s.grade} «${esc(s.class_letter)}»</td><td>${esc(status)}</td><td>${s.confirmed_at?'✓ Подтверждено':'Нет подтверждения'}</td><td>${controls}${s.confirmed_at?`<button class="btn outline mini" data-unlock="${esc(s.id)}">Открыть выбор</button>`:''}</td></tr>`;
  }).join('')||empty('Добавьте первого ученика');
  $('groupSubject').innerHTML=state.subjects.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('groupsBody').innerHTML=groups.map(g=>{
    const count=g.kind==='regular'?state.choices.filter(x=>x.group_id===g.id).length:state.offers.filter(x=>x.group_id===g.id).length;
    return `<tr><td>${esc(subject(g.subject_id))}</td><td>${g.kind==='olympiad'?'★ Олимпиада':'Доп'}</td><td>${esc(g.group_name)}</td><td>${esc(groupSchedule(g))}</td><td>${count}</td></tr>`;
  }).join('')||empty('Для параллели ещё не создано групп');
  const olym=groups.filter(g=>g.kind==='olympiad');
  const before=$('offerGroup').value;
  $('offerGroup').innerHTML=olym.length?olym.map(g=>`<option value="${esc(g.id)}">${esc(groupName(g))}</option>`).join(''):'<option value="">Сначала создайте олимпиаду</option>';
  if(olym.some(g=>g.id===before))$('offerGroup').value=before;
  renderOfferStudents();
  $('offersBody').innerHTML=state.offers.filter(o=>o.grade===state.grade&&o.branch_id===state.branch.id).map(o=>{
    const s=state.students.find(s=>s.id===o.student_id),g=group(o.group_id);
    return `<tr><td>${esc(s?.full_name||'—')}</td><td>${esc(g?subject(g.subject_id):'—')}</td><td>${esc(g?.group_name||'—')}</td><td>${o.status==='accepted'?'✓ Принята':o.status==='declined'?'Отклонена':'Предложена'}</td></tr>`;
  }).join('')||empty('Предложений пока нет');
  renderSummary();
  renderSlotPicker();
}
function renderOfferStudents(){
  const g=group($('offerGroup').value);
  const eligible=activeStudents().filter(s=>!s.confirmed_at && studentLabel(s.id).toLocaleLowerCase('ru').includes(state.offerSearch.toLocaleLowerCase('ru')));
  $('offerStudents').innerHTML=g?eligible.map(s=>{
    const exists=state.offers.some(o=>o.student_id===s.id&&o.group_id===g.id);
    return `<label class="student-check"><input type="checkbox" value="${esc(s.id)}" ${exists?'disabled':''}><span><strong>${esc(studentLabel(s.id))}</strong><small>${s.grade} «${esc(s.class_letter)}» ${exists?'· Уже предложена':''}</small></span></label>`;
  }).join('')||'<p class="muted-empty">Подходящих учеников нет.</p>':'<p class="muted-empty">Создайте группу олимпиады.</p>';
}
function renderSummary(){
  const confirmed=activeStudents().filter(s=>s.confirmed_at);
  const result=new Map();
  for(const s of confirmed)for(const g of busyGroups(s.id)){
    const key=state.report==='subjects'?subject(g.subject_id):state.report==='groups'?groupName(g):`${s.grade} «${s.class_letter}»`;
    result.set(key,(result.get(key)||0)+1);
  }
  $('summaryHead').innerHTML=`<tr><th>${state.report==='subjects'?'Направление':state.report==='groups'?'Группа':'Класс'}</th><th>Подтверждённых записей</th></tr>`;
  $('summaryBody').innerHTML=[...result].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ru')).map(([key,n])=>`<tr><td>${esc(key)}</td><td>${n}</td></tr>`).join('')||empty('Пока нет подтверждённых выборов');
}
async function saveSubject(event){event.preventDefault();await operation(async()=>{
  const name=$('subjectName').value.trim();if(name.length<2)throw new Error('Название слишком короткое.');
  const {error}=await state.client.from('subjects').insert({name});
  if(error)throw error;$('subjectName').value='';
},event.submitter);}
async function saveGroup(event){event.preventDefault();await operation(async()=>{
  const entries=[...document.querySelectorAll('#sessionPicker input:checked')].map(n=>{let [weekday,slot_id]=n.value.split(':').map(Number);return {weekday,slot_id};});
  if(!entries.length)throw new Error('Отметьте хотя бы один слот расписания.');
  const subjectId=$('groupSubject').value;if(!subjectId)throw new Error('Сначала создайте направление.');
  const {error}=await state.client.rpc('create_group_with_sessions',{
    p_subject_id:subjectId,p_branch_id:state.branch.id,p_grade:state.grade,
    p_group_name:$('groupName').value.trim(),p_kind:$('groupType').value,p_sessions:entries
  });if(error)throw error;$('groupName').value='';
},event.submitter);}
async function saveOffers(event){event.preventDefault();await operation(async()=>{
  const g=group($('offerGroup').value);if(!g||g.kind!=='olympiad')throw new Error('Выберите олимпиаду.');
  const ids=[...document.querySelectorAll('#offerStudents input:checked')].map(n=>n.value);
  if(!ids.length)throw new Error('Выберите хотя бы одного ученика.');
  const {error}=await state.client.from('olympiad_offers').insert(ids.map(student_id=>({student_id,group_id:g.id,branch_id:state.branch.id,grade:g.grade})));
  if(error)throw error;
},event.submitter);}
async function unlock(id){
  if(!window.confirm('Разблокировать подтверждённое расписание ученика? Он снова сможет изменить выбор.'))return;
  await operation(async()=>{const {error}=await state.client.from('students').update({confirmed_at:null}).eq('id',id);if(error)throw error;});
}
async function confirmChoice(){
  if(!window.confirm('Подтвердить расписание? После этого изменить его сможет только методолог.'))return;
  await operation(async()=>{const {error}=await state.client.rpc('confirm_student_choice');if(error)throw error;},$('confirmSelection'));
}
$('loginForm').addEventListener('submit',login);
$('loginMode').addEventListener('change',e=>{const isStudent=e.target.value==='student';$('emailField').hidden=isStudent;$('usernameField').hidden=!isStudent;$('email').required=!isStudent;$('username').required=isStudent;});
$('logout').addEventListener('click',logout);
$('refresh').addEventListener('click',()=>operation(async()=>{},$('refresh')));
$('adminGrade').addEventListener('change',event=>{state.grade=Number(event.target.value);renderAdmin();});
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{state.panel=button.dataset.panel;renderAdmin();}));
document.querySelectorAll('[data-report]').forEach(button=>button.addEventListener('click',()=>{state.report=button.dataset.report;document.querySelectorAll('[data-report]').forEach(b=>b.classList.toggle('active',b===button));renderSummary();}));
// Создание ученика V7 доступно только в accounts.html через Edge Function. ФИО не отправляются в students.
$('subjectForm').addEventListener('submit',saveSubject);
$('groupForm').addEventListener('submit',saveGroup);
$('offerForm').addEventListener('submit',saveOffers);
$('offerGroup').addEventListener('change',renderOfferStudents);
$('offerSearch').addEventListener('input',e=>{state.offerSearch=e.target.value;renderOfferStudents();});
$('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderStudent();});
$('confirmSelection').addEventListener('click',confirmChoice);
$('courseList').addEventListener('click',e=>{let btn=e.target.closest('[data-select-group]');if(btn && !btn.disabled)selectGroup(btn.dataset.selectGroup);});
$('chosenList').addEventListener('click',e=>{let btn=e.target.closest('[data-remove]');if(btn&&!btn.disabled)selectGroup(btn.dataset.remove);});
$('olympiadBox').addEventListener('click',e=>{let btn=e.target.closest('[data-offer-action]');if(btn&&!btn.disabled)changeOffer(btn.dataset.offerGroup,btn.dataset.offerAction);});
$('studentBody').addEventListener('click',e=>{
  const reset=e.target.closest('[data-student-reset]'),toggle=e.target.closest('[data-student-toggle]');
  if(reset){studentAccountAction('reset',reset.dataset.studentReset);return;}
  if(toggle){studentAccountAction('toggle',toggle.dataset.studentToggle);return;}
  const btn=e.target.closest('[data-unlock]');if(btn)unlock(btn.dataset.unlock);
  const cp=e.target.closest('[data-copy-id]');if(cp)navigator.clipboard.writeText(cp.dataset.copyId).then(()=>notice('ID ученика скопирован.')).catch(()=>notice('Не удалось скопировать ID.',true));
});
restore();

$('closeStudentPassword').addEventListener('click',()=>{$('newStudentPassword').textContent='';$('studentPasswordDialog').close();});
$('copyStudentPassword').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`Логин: ${$('newStudentLogin').textContent}\nПароль: ${$('newStudentPassword').textContent}`);notice('Учётные данные скопированы.');}catch{notice('Не удалось скопировать пароль.',true);}});