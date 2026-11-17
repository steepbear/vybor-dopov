import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const state={client:null,branch:null,docs:[],members:[],students:[],logins:new Map(),selected:null,busy:false};
function year(){return Number($('v9Year').value);}
function grade(){return Number($('v9Grade').value);}
function tell(message,error=false){const n=$('v9Message');n.textContent=message;n.className='live-message '+(error?'error':'ok');n.hidden=false;}
function statusLabel(s){return {draft:'Формируется',active:'Активен',finished:'Завершён'}[s]||s;}
async function read(table,fields){
 const all=[];for(let n=0;n<50000;n+=700){
  const {data,error}=await state.client.from(table).select(fields).range(n,n+699);
  if(error)throw error;
  all.push(...(data||[]));if(!data||data.length<700)break;
 }
 return all;
}
async function task(action,{silent=false}={}){
 if(state.busy)return;
 state.busy=true;
 document.querySelectorAll('#v9Workspace button').forEach(b=>b.disabled=true);
 try{await action();await load();if(!silent)tell('Изменения сохранены.');return true;}
 catch(e){try{await load();}catch{}tell(e.message||String(e),true);return false;}
 finally{state.busy=false;document.querySelectorAll('#v9Workspace button').forEach(b=>b.disabled=false);render();}
}
function filteredDocs(){return state.docs.filter(d=>d.year_start===year()&&d.grade===grade()).sort((a,b)=>a.class_letter.localeCompare(b.class_letter,'ru'));}
function currentDocument(){return state.docs.find(d=>d.id===state.selected)||null;}
function render(){
 const docs=filteredDocs(),selected=currentDocument();
 renderBulk();
 $('v9Docs').innerHTML=docs.length?docs.map(d=>'<button type="button" class="v9-doc'+(d.id===state.selected?' current':'')+'" data-doc="'+esc(d.id)+'">'+
 '<span class="v9-doc-name">'+d.grade+esc(d.class_letter)+'</span><span>'+statusLabel(d.status)+'</span></button>').join(''):'<p class="microcopy">Для этой параллели документов пока нет.</p>';
 $('v9DetailBody').hidden=!selected;
 $('v9DetailTitle').textContent=selected?'Класс '+selected.grade+selected.class_letter:'Состав класса';
 $('v9DetailSubtitle').textContent=selected?selected.year_start+'/'+(selected.year_start+1)+' · '+state.branch.name:'Выберите документ слева.';
 $('v9Status').hidden=!selected;
 if(!selected)return;
 $('v9Status').textContent=statusLabel(selected.status);
 $('v9Status').dataset.status=selected.status;
 $('v9Activate').hidden=selected.status!=='draft';
 $('v9Finish').hidden=selected.status!=='active';
 $('v9Enroll').hidden=selected.status==='finished';
 const here=state.members.filter(x=>x.document_id===selected.id);
 const occupied=new Set(state.members.filter(x=>x.year_start===selected.year_start).map(x=>x.student_id));
 const candidates=state.students.filter(s=>!occupied.has(s.id));
 $('v9Student').innerHTML=candidates.length?'<option value="">Выберите ученика</option>'+candidates.map(s=>{
   const l=state.logins.get(s.id);
   return '<option value="'+esc(s.id)+'">'+esc(l||'Ученик '+s.id.slice(0,8))+' · '+esc(s.id.slice(0,8))+'…</option>';
 }).join(''):'<option value="">Нет незачисленных учеников</option>';
 $('v9Enroll').querySelector('button').disabled=!candidates.length||state.busy;
 $('v9MemberCount').textContent='Зачислено учеников: '+here.length;
 $('v9Members').innerHTML=here.length?here.map(m=>{
  const label=state.logins.get(m.student_id)||'Ученик '+m.student_id.slice(0,8);
  const remove=selected.status==='finished'?'':'<button class="btn outline mini" type="button" data-remove="'+esc(m.student_id)+'">Убрать</button>';
  return '<tr><td>'+esc(label)+'</td><td><code>'+esc(m.student_id)+'</code></td><td>'+remove+'</td></tr>';
 }).join(''):'<tr><td colspan="3" class="microcopy">В документе пока нет учеников</td></tr>';
}
async function load(){
 const b=state.branch.id;
 const [docs,members,students,accounts]=await Promise.all([
  read('v9_class_documents','id,branch_id,year_start,grade,class_letter,status'),
  read('v9_class_enrollments','document_id,student_id,branch_id,year_start'),
  read('students','id,branch_id'),
  read('student_accounts','student_id,login')]);
 state.docs=docs.filter(x=>x.branch_id===b);
 state.members=members.filter(x=>x.branch_id===b);
 state.students=students.filter(x=>x.branch_id===b);
 state.logins=new Map(accounts.map(a=>[a.student_id,a.login]));
 if(state.selected&&!state.docs.some(d=>d.id===state.selected))state.selected=null;
 render();
}
function createYears(){const now=new Date(),start=now.getFullYear()-(now.getMonth()<8?1:0);$('v9Year').innerHTML=Array.from({length:8},(_,i)=>start-2+i).map(y=>'<option value="'+y+'">'+y+'/'+(y+1)+'</option>').join('');$('v9Year').value=String(start);}
async function start(){
 createYears();
 try{
  state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data:user,error:e}=await state.client.auth.getUser();if(e||!user?.user)throw Error('Сначала войдите под методологом.');
  const {data:p,error:pe}=await state.client.from('profiles').select('role,branch_id,is_active').eq('user_id',user.user.id).single();
  if(pe||!p||p.role!=='methodologist'||!p.is_active)throw Error('Раздел доступен только активному методологу.');
  const {data:branch,error:be}=await state.client.from('branches').select('id,name').eq('id',p.branch_id).single();
  if(be||!branch)throw Error('Не удалось определить филиал.');
  state.branch=branch;
  $('v9User').textContent='Методолог · '+branch.name;
  $('v9Branch').textContent=branch.name;
  $('v9Workspace').hidden=false;await load();
 }catch(e){$('v9NoAccess').hidden=false;$('v9NoAccessText').textContent=e.message||String(e);$('v9User').textContent='Требуется вход';}
}
$('v9Create').addEventListener('submit',event=>{
 event.preventDefault();
 const letter=$('v9Letter').value.trim().toLocaleUpperCase('ru');
 if(!/^[А-ЯЁ]{1,3}$/u.test(letter)){tell('Введите букву класса (А, Б, В и т. д.).',true);return;}
 task(async()=>{
  const {data,error}=await state.client.from('v9_class_documents').insert({branch_id:state.branch.id,year_start:year(),grade:grade(),class_letter:letter,status:'draft'}).select('id').single();
  if(error)throw error;state.selected=data.id;$('v9Letter').value='';
 });
});
$('v9Docs').addEventListener('click',event=>{const button=event.target.closest('[data-doc]');if(!button)return;state.selected=button.dataset.doc;render();});
$('v9Enroll').addEventListener('submit',event=>{
 event.preventDefault();const doc=currentDocument(),sid=$('v9Student').value;
 if(!doc||!UUID.test(sid))return;
 task(async()=>{const {error}=await state.client.from('v9_class_enrollments').insert({document_id:doc.id,student_id:sid,branch_id:doc.branch_id,year_start:doc.year_start});if(error)throw error;});
});
$('v9Members').addEventListener('click',event=>{
 const button=event.target.closest('[data-remove]'),doc=currentDocument();
 if(!button||!doc)return;
 if(!confirm('Убрать ученика из этого документа класса? Учётная запись ученика сохранится.'))return;
 task(async()=>{const {error}=await state.client.from('v9_class_enrollments').delete().eq('document_id',doc.id).eq('student_id',button.dataset.remove);if(error)throw error;});
});
$('v9Activate').addEventListener('click',()=>{
 const doc=currentDocument();if(!doc)return;
 if(!confirm('Активировать документ класса '+doc.grade+doc.class_letter+'?'))return;
 task(async()=>{const {error}=await state.client.from('v9_class_documents').update({status:'active'}).eq('id',doc.id);if(error)throw error;});
});
$('v9Finish').addEventListener('click',()=>{
 const doc=currentDocument();if(!doc)return;
 if(!confirm('Завершить документ класса '+doc.grade+doc.class_letter+'? После этого нельзя изменять его состав.'))return;
 task(async()=>{const {error}=await state.client.from('v9_class_documents').update({status:'finished'}).eq('id',doc.id);if(error)throw error;});
});
$('v9Year').addEventListener('change',()=>{state.selected=null;render();});
$('v9Grade').addEventListener('change',()=>{state.selected=null;render();});
$('v9Refresh').addEventListener('click',()=>task(async()=>{}, {silent:true}));

/* Bulk classroom allocation. Names are read from local .vdop only.
   The database receives exclusively UUID and the selected document id. */
const bulk={rows:[],targets:new Map(),marked:new Set(),search:''};
const bulkNorm=x=>String(x??'').normalize('NFC').trim().replace(/\s+/g,' ');
function bulkCurrentRows(){
 const value=bulk.search.toLocaleLowerCase('ru');
 return bulk.rows.filter(r=>!value||[r.surname,r.name,r.login,r.id]
  .some(x=>String(x).toLocaleLowerCase('ru').includes(value)));
}
function bulkOccupation(){
 return new Map(state.members.filter(e=>e.year_start===year()).map(e=>[e.student_id,e.document_id]));
}
function bulkOptions(selected,docs){
 return '<option value="">Не распределён</option>'+docs.map(d=>
  '<option value="'+esc(d.id)+'" '+(selected===d.id?'selected':'')+'>'+d.grade+
   esc(d.class_letter)+' · '+statusLabel(d.status)+'</option>').join('');
}
function renderBulk(){
 const section=$('v9BulkBody');if(!section)return;
 const docs=filteredDocs().filter(d=>d.status!=='finished');
 const occupied=bulkOccupation(),known=new Set(state.students.map(s=>s.id));
 const available=docs.some(d=>d.status!=='finished');
 $('v9BulkFileName').textContent=bulk.rows.length?'Загружено '+bulk.rows.length+' учеников':'Файл .vdop не выбран';
 $('v9BulkControls').hidden=!bulk.rows.length;
 const previousDest=$('v9BulkDest').value;
 $('v9BulkDest').innerHTML='<option value="">Класс для отмеченных</option>'+docs.map(d=>
  '<option value="'+esc(d.id)+'">'+d.grade+esc(d.class_letter)+'</option>').join('');
 if(docs.some(d=>d.id===previousDest))$('v9BulkDest').value=previousDest;
 const visible=bulkCurrentRows();
 let ready=0,missing=0,other=0,same=0;
 for(const r of bulk.rows){
  const current=occupied.get(r.id),target=bulk.targets.get(r.id)||'';
  if(!known.has(r.id))missing++;
  else if(current&&target===current)same++;
  else if(current)other++;
  else if(target&&docs.some(d=>d.id===target))ready++;
 }
 const rows=visible.map(r=>{
  const current=occupied.get(r.id),target=bulk.targets.get(r.id)||'';
  const canAssign=known.has(r.id)&&!current;
  const classDoc=current&&state.docs.find(d=>d.id===current);
  const label=!known.has(r.id)?'Сначала зарегистрируйте ученика':
    current?'Уже в '+(classDoc?classDoc.grade+classDoc.class_letter:'другом классе'):'Не распределён';
  const changed=bulk.marked.has(r.id);
  return '<tr><td><input aria-label="Выбрать строку" type="checkbox" data-bulk-check="'+esc(r.id)+'" '+(changed?'checked ':'')+(!canAssign?'disabled':'')+'></td>'+
   '<td>'+esc(r.surname)+' '+esc(r.name)+'</td>'+
   '<td><code>'+esc(r.id.slice(0,8))+'…</code></td>'+
   '<td>'+esc(label)+'</td>'+
   '<td><select data-bulk-target="'+esc(r.id)+'" '+(!canAssign?'disabled':'')+'>'+
    bulkOptions(target,docs)+'</select></td></tr>';
 }).join('');
 section.innerHTML=visible.length?rows:'<tr><td colspan="5">Нет подходящих строк</td></tr>';
 $('v9BulkSummary').textContent='К записи: '+ready+' · уже распределены: '+(other+same)+
  ' · не зарегистрированы: '+missing+' · всего в файле: '+bulk.rows.length;
 $('v9BulkSubmit').disabled=!ready||!available||state.busy;
 $('v9BulkSubmit').textContent=state.busy?'Зачисление…':'Зачислить выбранных ('+ready+')';
 $('v9BulkApply').disabled=!bulk.marked.size||!docs.length||state.busy;
}
async function readBulkFile(e){
 const file=e.target.files?.[0];e.target.value='';if(!file||state.busy)return;
 try{
  if(!/\.vdop$/i.test(file.name)||file.size>2*1024*1024)throw Error('Нужен .vdop V2 до 2 МБ.');
  const contents=await file.text();
  if(!contents.startsWith('VDOP/2\n'))throw Error('Откройте старый .vdop в редакторе и сохраните формат V2.');
  const data=JSON.parse(contents.slice('VDOP/2\n'.length));
  if(data.format!=='VDOP'||data.version!==2||data.kind!=='school_admissions'||
    data.branch_id!==state.branch.id)throw Error('Файл другого филиала или неверный формат.');
  if(!Array.isArray(data.students)||data.students.length>500)
    throw Error('Некорректное количество учеников в реестре.');
  const ids=new Set();
  const rows=data.students.map((r,i)=>{
   if(!r||typeof r!=='object'||!UUID.test(r.id))throw Error('Ошибка GUID строки '+(i+1));
   const id=r.id.toLowerCase();if(ids.has(id))throw Error('Повтор GUID в .vdop.');
   ids.add(id);
   if(typeof r.surname!=='string'||typeof r.name!=='string')
    throw Error('Некорректные имена строки '+(i+1));
   return {id,surname:bulkNorm(r.surname),name:bulkNorm(r.name),login:bulkNorm(r.login)};
  });
  bulk.rows=rows;bulk.targets.clear();bulk.marked.clear();
  $('v9BulkSearch').value='';bulk.search='';
  renderBulk();tell('Прочитан локальный .vdop. Распределите учеников по классам — ФИО не покидают браузер.');
 }catch(err){tell('Не удалось открыть .vdop: '+(err?.message||String(err)),true);}
}
async function commitBulk(){
 if(state.busy)return;
 const docs=new Map(filteredDocs().filter(d=>d.status!=='finished').map(d=>[d.id,d]));
 const occupied=bulkOccupation(),known=new Set(state.students.map(s=>s.id));
 const commands=bulk.rows.filter(r=>bulk.targets.has(r.id)&&docs.has(bulk.targets.get(r.id))&&
   !occupied.has(r.id)&&known.has(r.id)).map(r=>({
    document_id:bulk.targets.get(r.id),student_id:r.id,
    branch_id:state.branch.id,year_start:year()
   }));
 if(!commands.length){tell('Нет новых зачислений. Проверьте распределение.',true);return;}
 if(!confirm('Зачислить '+commands.length+' учеников в документы классов '+year()+'/'+(year()+1)+
  '? ФИО на сервер не передаются.'))return;
 const ok=await task(async()=>{
  for(let i=0;i<commands.length;i+=80){
   const {error}=await state.client.from('v9_class_enrollments')
    .insert(commands.slice(i,i+80));
   if(error)throw error;
  }
  bulk.targets.clear();bulk.marked.clear();
 },{silent:true});
 if(ok)tell('Зачислено '+commands.length+' учеников. Проверьте составы документов.');
}
$('v9BulkFile').addEventListener('change',readBulkFile);
$('v9BulkSearch').addEventListener('input',e=>{bulk.search=e.target.value;renderBulk();});
$('v9BulkBody').addEventListener('change',e=>{
 const id=e.target.dataset.bulkCheck||e.target.dataset.bulkTarget;
 if(!id)return;
 if(e.target.dataset.bulkCheck){if(e.target.checked)bulk.marked.add(id);else bulk.marked.delete(id);}
 else{if(e.target.value)bulk.targets.set(id,e.target.value);else bulk.targets.delete(id);}
 renderBulk();
});
$('v9BulkAll').addEventListener('click',()=>{
 const eligible=new Set(state.students.map(x=>x.id)),occupied=bulkOccupation();
 for(const r of bulkCurrentRows())if(eligible.has(r.id)&&!occupied.has(r.id))bulk.marked.add(r.id);
 renderBulk();
});
$('v9BulkClear').addEventListener('click',()=>{bulk.marked.clear();renderBulk();});
$('v9BulkApply').addEventListener('click',()=>{
 const id=$('v9BulkDest').value;
 if(!id||!filteredDocs().some(d=>d.id===id&&d.status!=='finished')){
  tell('Выберите доступный класс назначения.',true);return;
 }
 const occupied=bulkOccupation(),registered=new Set(state.students.map(x=>x.id));
 for(const sid of bulk.marked)if(!occupied.has(sid)&&registered.has(sid))bulk.targets.set(sid,id);
 bulk.marked.clear();renderBulk();
 tell('Класс назначен отмеченным строкам. Нажмите «Зачислить выбранных», чтобы записать в БД.');
});
$('v9BulkSubmit').addEventListener('click',commitBulk);

start();
