import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days={1:'Понедельник',2:'Вторник',3:'Среда',4:'Четверг',5:'Пятница'};
const statusNames={draft:'Формируется',active:'Активен',finished:'Завершён'};
const state={client:null,branch:null,docs:[],electives:[],groups:[],sessions:[],slots:[],busy:false,editing:null};

function year(){return Number($('v9Year').value);}
function documentForYear(){return state.docs.find(x=>x.year_start===year())||null;}
function sessionsFor(groupId){return state.sessions.filter(s=>s.group_id===groupId).sort((a,b)=>a.weekday-b.weekday||a.slot_id-b.slot_id);}
function nameOfElective(id){return state.electives.find(x=>x.id===id)?.name||'Неизвестный доп';}
function moscowDate(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}
function isLocked(doc){return !doc||doc.status==='finished'||moscowDate()>doc.selection_deadline;}
function defaultDeadline(y){const standard=`${y}-08-31`;if(standard>=moscowDate())return standard;const test=`${y}-12-31`;return test>=moscowDate()?test:`${y+1}-08-31`;}
function inform(message,error=false){const node=$('v9Message');node.textContent=message;node.className='live-message '+(error?'error':'ok');node.hidden=false;}
function readableError(e){return e?.message||String(e);}

async function read(table,columns='*'){
  const all=[];
  for(let offset=0;offset<30000;offset+=700){
    const {data,error}=await state.client.from(table).select(columns).range(offset,offset+699);
    if(error)throw error;
    all.push(...(data||[]));if(!data||data.length<700)break;
  }
  return all;
}
async function load(){
  const [electives,docs,groups,sessions,slots]=await Promise.all([
    read('v9_electives','id,branch_id,name,created_at'),
    read('v9_schedule_documents','id,branch_id,year_start,selection_deadline,status'),
    read('v9_schedule_groups','id,document_id,branch_id,elective_id,group_name,kind,grade_targets'),
    read('v9_schedule_sessions','group_id,weekday,slot_id,time_from,time_to'),
    read('time_slots','id,time_from,time_to')
  ]);
  const branch=state.branch.id;
  state.electives=electives.filter(x=>x.branch_id===branch).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  state.docs=docs.filter(x=>x.branch_id===branch);
  state.groups=groups.filter(x=>x.branch_id===branch);
  state.sessions=sessions;
  state.slots=slots.sort((a,b)=>a.id-b.id);
  render();
}
async function perform(action,success){
  if(state.busy)return false;
  state.busy=true;
  document.querySelectorAll('#v9Workspace button').forEach(b=>b.disabled=true);
  try{
    await action();await load();
    if(success)inform(success);
    return true;
  }catch(e){inform(readableError(e),true);try{await load();}catch{}return false;}
  finally{
    state.busy=false;
    // Снимаем временную блокировку после любой операции (успех или ошибка).
    // Затем render() снова отключит только действительно недоступные действия.
    document.querySelectorAll('#v9Workspace button').forEach(b=>b.disabled=false);
    render();
  }
}

function renderElectives(){
  $('v9ElectivesCount').textContent=state.electives.length+' допов';
  $('v9Electives').innerHTML=state.electives.length?state.electives.map(e=>
    `<div class="v9-elective-row"><strong>${esc(e.name)}</strong><button type="button" class="btn outline mini" data-rename-elective="${esc(e.id)}">Переименовать</button></div>`
  ).join(''):'<div class="v9-empty">В филиале пока нет допов. Создайте первый.</div>';
}
function renderDocument(){
  const doc=documentForYear();
  $('v9DocStatus').textContent=doc?statusNames[doc.status]:'Не создан';
  $('v9DocStatus').dataset.status=doc?.status||'';
  $('v9DocSubtitle').textContent=`${year()}/${year()+1} · ${state.branch.name}`;
  $('v9Deadline').value=doc?.selection_deadline||defaultDeadline(year());
  const locked=isLocked(doc);
  $('v9Deadline').disabled=doc?.status==='finished'||Boolean(doc&&locked);
  $('v9SaveDocument').hidden=Boolean(doc&&locked);
  $('v9SaveDocument').textContent=doc?'Сохранить срок':'Создать документ';
  $('v9DocumentActions').hidden=!doc;
  $('v9Activate').hidden=!doc||doc.status!=='draft';
  $('v9Finish').hidden=!doc||doc.status!=='active';
  const groups=doc?state.groups.filter(x=>x.document_id===doc.id):[];
  $('v9DocSummary').innerHTML=doc?
    `<span>Групп: ${groups.length}</span><span>Допов в расписании: ${new Set(groups.map(x=>x.elective_id)).size}</span>`:'';
}
function renderPicker(){
  $('v9SessionPicker').innerHTML=[1,2,3,4,5].map(day=>
    `<fieldset class="v9-day"><legend>${days[day]}</legend>${state.slots.map(slot=>
      `<label class="v9-slot-choice"><input type="checkbox" name="v9Session" value="${day}:${slot.id}"><span>Доп №${slot.id}<small>${esc(slot.time_from.slice(0,5))}–${esc(slot.time_to.slice(0,5))}</small></span></label>`
    ).join('')}</fieldset>`).join('');
}
function renderGroups(){
  const doc=documentForYear();
  $('v9NoDocument').hidden=Boolean(doc);
  $('v9GroupsWorkspace').hidden=!doc;
  if(!doc)return;
  const groups=state.groups.filter(x=>x.document_id===doc.id)
    .sort((a,b)=>nameOfElective(a.elective_id).localeCompare(nameOfElective(b.elective_id),'ru')||a.group_name.localeCompare(b.group_name,'ru'));
  $('v9GroupsCount').textContent=groups.length+' групп';
  const locked=isLocked(doc);
  const current=state.editing&&groups.find(g=>g.id===state.editing);
  $('v9GroupFormTitle').textContent=current?'Редактирование группы':'Новая группа';
  $('v9GroupCancel').hidden=!current;
  $('v9GroupNotice').textContent=locked?'Изменение состава и времени расписания закрыто. Названия допов и групп можно изменить.':'';
  $('v9GroupForm').hidden=locked;
  const previous=$('v9GroupElective').value;
  $('v9GroupElective').innerHTML='<option value="">Выберите доп</option>'+state.electives.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  if(state.electives.some(e=>e.id===previous))$('v9GroupElective').value=previous;
  $('v9SaveGroup').disabled=!state.electives.length||locked||state.busy;
  $('v9Groups').innerHTML=groups.length?groups.map(g=>{
    const gradeText=g.grade_targets?.length?`Параллели: ${g.grade_targets.slice().sort().join(', ')}`:'Все параллели 1–4';
    const kind=g.kind==='olympiad'?'★ Олимпиада':'Обычный доп';
    const slots=sessionsFor(g.id).map(s=>`<span>${esc(days[s.weekday])} · ${esc(s.time_from.slice(0,5))}–${esc(s.time_to.slice(0,5))}</span>`).join('');
    const actions=locked?
      `<button class="btn outline mini" data-rename-group="${esc(g.id)}">Название</button>`:
      `<button class="btn outline mini" data-edit-group="${esc(g.id)}">Изменить</button><button class="btn outline mini" data-delete-group="${esc(g.id)}">Удалить</button>`;
    return `<div class="v9-group-row"><div class="v9-group-row-info"><strong>${esc(nameOfElective(g.elective_id))} · ${esc(g.group_name)}</strong><div class="v9-group-meta">${kind} · ${gradeText}</div><div class="v9-group-slots">${slots}</div></div><div class="v9-group-actions">${actions}</div></div>`;
  }).join(''):'<div class="v9-empty">В этом году ещё нет групп. Добавьте первую группу в форме выше.</div>';
}
function render(){if(!state.branch)return;renderElectives();renderDocument();renderGroups();}
function resetGroupForm(){
  state.editing=null;
  $('v9GroupForm').reset();
  $('v9GroupElective').value='';
  render();
}
function editGroup(groupId){
  const g=state.groups.find(x=>x.id===groupId),doc=documentForYear();if(!g||isLocked(doc))return;
  state.editing=g.id;
  $('v9GroupElective').value=g.elective_id;
  $('v9GroupName').value=g.group_name;
  $('v9GroupKind').value=g.kind;
  document.querySelectorAll('[name="v9Grade"]').forEach(n=>n.checked=(g.grade_targets||[]).includes(Number(n.value)));
  const chosen=new Set(sessionsFor(g.id).map(s=>`${s.weekday}:${s.slot_id}`));
  document.querySelectorAll('[name="v9Session"]').forEach(n=>n.checked=chosen.has(n.value));
  renderGroups();
  $('v9GroupForm').scrollIntoView({behavior:'smooth',block:'center'});
}
function createYears(){
  const now=new Date(),start=now.getFullYear()-(now.getMonth()<8?1:0);
  $('v9Year').innerHTML=Array.from({length:9},(_,i)=>start-2+i).map(y=>`<option value="${y}">${y}/${y+1}</option>`).join('');
  $('v9Year').value=String(start);
}
async function start(){
  createYears();
  try{
    state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    const {data:who,error:whoError}=await state.client.auth.getUser();
    if(whoError||!who?.user)throw Error('Сначала войдите под методологом.');
    const {data:p,error:pError}=await state.client.from('profiles').select('role,branch_id,is_active').eq('user_id',who.user.id).single();
    if(pError||!p||p.role!=='methodologist'||!p.is_active)throw Error('Раздел доступен только активному методологу.');
    const {data:b,error:bError}=await state.client.from('branches').select('id,name').eq('id',p.branch_id).single();
    if(bError||!b)throw Error('Не удалось определить филиал.');
    state.branch=b;$('v9Branch').textContent=b.name;$('v9User').textContent='Методолог · '+b.name;
    $('v9Workspace').hidden=false;
    await load();renderPicker();
  }catch(e){$('v9NoAccess').hidden=false;$('v9NoAccessText').textContent=readableError(e);$('v9User').textContent='Требуется вход';}
}

$('v9ElectiveForm').addEventListener('submit',event=>{
  event.preventDefault();const name=$('v9ElectiveName').value.trim();
  if(name.length<2){inform('Введите название допа.',true);return;}
  perform(async()=>{
    const {error}=await state.client.from('v9_electives').insert({branch_id:state.branch.id,name});
    if(error)throw error;$('v9ElectiveName').value='';
  },'Доп добавлен в справочник филиала.');
});
$('v9Electives').addEventListener('click',event=>{
  const btn=event.target.closest('[data-rename-elective]');if(!btn)return;
  const elective=state.electives.find(e=>e.id===btn.dataset.renameElective);if(!elective)return;
  const name=prompt('Новое название допа:',elective.name)?.trim();if(!name||name===elective.name)return;
  perform(async()=>{const {error}=await state.client.from('v9_electives').update({name}).eq('id',elective.id);if(error)throw error;},'Название допа изменено.');
});
$('v9DocumentForm').addEventListener('submit',event=>{
  event.preventDefault();const deadline=$('v9Deadline').value,doc=documentForYear();
  if(!deadline)return;
  perform(async()=>{
    const query=doc?state.client.from('v9_schedule_documents').update({selection_deadline:deadline}).eq('id',doc.id):
      state.client.from('v9_schedule_documents').insert({branch_id:state.branch.id,year_start:year(),selection_deadline:deadline,status:'draft'});
    const {error}=await query;if(error)throw error;
  },doc?'Срок выбора обновлён.':'Документ расписания создан.');
});
$('v9Activate').addEventListener('click',()=>{
  const doc=documentForYear();if(!doc||!confirm('Активировать расписание '+year()+'/'+(year()+1)+'?'))return;
  perform(async()=>{const {error}=await state.client.from('v9_schedule_documents').update({status:'active'}).eq('id',doc.id);if(error)throw error;},'Расписание активировано.');
});
$('v9Finish').addEventListener('click',()=>{
  const doc=documentForYear();if(!doc||!confirm('Завершить расписание? После этого состав групп и занятия нельзя будет изменить.'))return;
  perform(async()=>{const {error}=await state.client.from('v9_schedule_documents').update({status:'finished'}).eq('id',doc.id);if(error)throw error;},'Документ расписания завершён.');
});
$('v9GroupForm').addEventListener('submit',event=>{
  event.preventDefault();const doc=documentForYear();if(!doc||isLocked(doc))return;
  const p_elective_id=$('v9GroupElective').value,p_name=$('v9GroupName').value.trim(),p_kind=$('v9GroupKind').value;
  const p_grade_targets=[...document.querySelectorAll('[name="v9Grade"]:checked')].map(n=>Number(n.value));
  const p_slots=[...document.querySelectorAll('[name="v9Session"]:checked')].map(n=>{
    const [weekday,slot_id]=n.value.split(':').map(Number);return {weekday,slot_id};
  });
  if(!p_elective_id||!p_name||!p_slots.length){inform('Укажите доп, название и хотя бы одно занятие.',true);return;}
  const editing=state.editing;
  perform(async()=>{
    const {error}=await state.client.rpc('v9_save_schedule_group',{
      p_document_id:doc.id,p_elective_id,p_name,p_kind,p_grade_targets,p_slots,p_group_id:editing||null
    });
    if(error)throw error;state.editing=null;$('v9GroupForm').reset();
  },editing?'Группа и её расписание обновлены.':'Группа добавлена в документ.');
});
$('v9Groups').addEventListener('click',event=>{
  const btn=event.target.closest('[data-edit-group],[data-delete-group],[data-rename-group]');if(!btn)return;
  if(btn.dataset.editGroup){editGroup(btn.dataset.editGroup);return;}
  const id=btn.dataset.deleteGroup||btn.dataset.renameGroup,g=state.groups.find(x=>x.id===id);if(!g)return;
  if(btn.dataset.renameGroup){
    const name=prompt('Название группы:',g.group_name)?.trim();if(!name||name===g.group_name)return;
    perform(async()=>{const {error}=await state.client.from('v9_schedule_groups').update({group_name:name}).eq('id',id);if(error)throw error;},'Группа переименована.');
    return;
  }
  if(!confirm('Удалить группу '+g.group_name+' и её занятия из расписания?'))return;
  perform(async()=>{
    const {error}=await state.client.rpc('v9_delete_schedule_group',{p_group_id:id});
    if(error)throw error;if(state.editing===id)state.editing=null;
  },'Группа удалена из документа.');
});
$('v9GroupCancel').addEventListener('click',resetGroupForm);
$('v9Year').addEventListener('change',()=>{state.editing=null;$('v9GroupForm').reset();render();});
$('v9Refresh').addEventListener('click',()=>perform(async()=>{},null));

start();
