// V9, этап 1: локальный редактор школьного реестра .vdop.
// ФИО не отправляются в Supabase: запросы только для определения филиала и роли методолога.
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
import {readStudentsXlsx} from './xlsx-import.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MAX_STUDENTS=500;
const MAX_VDOP_SIZE=2*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME=/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z'’\- ]{0,59}$/u;
const LETTER=/^[А-ЯЁA-Z]{1,3}$/u;
const FILE_HEADER='VDOP/1\n';
const state={branchId:'',branchName:'',doc:null,rows:[],dirty:false};
const norm=x=>String(x??'').normalize('NFC').trim().replace(/\s+/g,' ');
function feedback(text,error=false){
 const node=$('registryNotice');node.textContent=text;node.className='live-message '+(error?'error':'ok');node.hidden=false;
}
function requireDiscard(){
 if(!state.doc||!state.dirty)return true;
 return window.confirm('Есть несохранённые изменения. Заменить текущий реестр?');
}
function yearStart(){
 return Number($('registryYear').value);
}
function createDoc(){
 return {format:'VDOP',version:1,kind:'student_registry',registry_id:crypto.randomUUID(),
  branch_id:state.branchId,branch_name:state.branchName,year_start:yearStart(),
  grade:Number($('registryGrade').value),students:[]};
}
function student(id=crypto.randomUUID(),data={}){
 return {id,surname:norm(data.surname),name:norm(data.name),
  class_letter:norm(data.class_letter).toUpperCase(),login:norm(data.login)};
}
function selectedYearGrade(){
 $('registryYear').value=String(state.doc.year_start);
 $('registryGrade').value=String(state.doc.grade);
 $('registryYear').disabled=Boolean(state.doc);
 $('registryGrade').disabled=Boolean(state.doc);
}
function validateRows(){
 const seenNames=new Set(),seenIds=new Set();
 const problems=new Map();
 for(let i=0;i<state.rows.length;i++){
  const r=state.rows[i];
  const issues=[];
  if(!UUID.test(r.id)||seenIds.has(r.id.toLowerCase()))issues.push('Повтор GUID');
  seenIds.add(String(r.id).toLowerCase());
  if(!LETTER.test(r.class_letter))issues.push('Буква класса');
  if(!NAME.test(r.surname)||!NAME.test(r.name))issues.push('Фамилия или имя');
  const key=r.class_letter+'|'+norm(r.surname).toLocaleLowerCase('ru')+'|'+norm(r.name).toLocaleLowerCase('ru');
  if(seenNames.has(key))issues.push('Дубль ФИО в классе');
  seenNames.add(key);
  if(r.login && r.login.length>80)issues.push('Слишком длинный логин');
  if(issues.length)problems.set(i,issues.join(', '));
 }
 return problems;
}
function render(){
 const editor=$('registryEditor');editor.hidden=!state.doc;
 $('registryNew').textContent=state.doc?'Закрыть реестр / выбрать другой год':'Новый пустой реестр';
 if(!state.doc)return;
 selectedYearGrade();
 const problems=validateRows();
 $('registryDirty').hidden=!state.dirty;
 $('registrySummary').textContent=state.rows.length+' учеников · '+problems.size+' строк с замечаниями'+(state.dirty?' · не сохранено':' · сохранено');
 $('registrySave').disabled=Boolean(problems.size)||!state.rows.length;
 $('registryAdd').disabled=state.rows.length>=MAX_STUDENTS;
 $('registryBody').innerHTML=state.rows.map((s,i)=>{
  const problem=problems.get(i),cls=state.doc.grade+(s.class_letter||'?');
  return '<tr data-row="'+i+'" class="'+(problem?'registry-problem':'')+'">'+
   '<td>'+(i+1)+'</td>'+
   '<td><span class="registry-grade">'+state.doc.grade+'</span><input aria-label="Буква класса" maxlength="3" class="registry-letter" data-field="class_letter" value="'+esc(s.class_letter)+'"></td>'+
   '<td><input aria-label="Фамилия" maxlength="60" data-field="surname" value="'+esc(s.surname)+'"></td>'+
   '<td><input aria-label="Имя" maxlength="60" data-field="name" value="'+esc(s.name)+'"></td>'+
   '<td><code title="'+esc(s.id)+'">'+esc(s.id.slice(0,8))+'…</code></td>'+
   '<td><small>'+esc(s.login||'После создания аккаунта')+'</small></td>'+
   '<td class="'+(problem?'registry-error':'registry-valid')+'">'+esc(problem||'✓ Готов')+'</td>'+
   '<td><button type="button" class="btn ghost mini" data-delete="'+i+'" aria-label="Удалить ученика">×</button></td></tr>';
 }).join('');
}
function installDoc(doc,rows,dirty){
 state.doc=doc;state.rows=rows;state.dirty=dirty;
 render();
}
function newRegistry(){
 if(!requireDiscard())return;
 if(state.doc){
  state.doc=null;state.rows=[];state.dirty=false;
  $('registryYear').disabled=false;
  $('registryGrade').disabled=false;
  render();
  feedback('Реестр закрыт. Выберите учебный год и параллель, затем создайте новый реестр или откройте файл.');
  return;
 }
 installDoc(createDoc(),[],true);
 feedback('Создан новый реестр. Добавьте учеников или загрузите список Excel.');
}
function parseClass(value){
 const found=/^([1-4])\s*[-«"\s]*\s*([А-ЯЁA-Z]{1,3})\s*[»"]?$/iu.exec(norm(value));
 return found?{grade:Number(found[1]),letter:found[2].toUpperCase()}:null;
}
async function importExcel(event){
 const file=event.target.files?.[0];event.target.value='';
 if(!file||!requireDiscard())return;
 try{
  if(!/\.xlsx$/i.test(file.name))throw Error('Нужен файл Excel с расширением .xlsx.');
  const sheet=await readStudentsXlsx(file);
  const head=sheet.find(r=>r.cells.some(norm));
  if(!head)throw Error('Excel пуст.');
  const labels=head.cells.map(s=>norm(s).toLocaleLowerCase('ru').replace(/\s/g,''));
  const indices={c:labels.indexOf('класс'),s:labels.indexOf('фамилия'),n:labels.indexOf('имя')};
  if(Object.values(indices).some(x=>x<0))throw Error('Нужны колонки: Класс, Фамилия, Имя.');
  const list=sheet.filter(r=>r.number>head.number&&r.cells.some(norm));
  if(!list.length||list.length>MAX_STUDENTS)throw Error('Допустимо от 1 до '+MAX_STUDENTS+' учеников.');
  const doc=createDoc();
  const rows=[];
  for(const row of list){
   const cls=parseClass(row.cells[indices.c]);
   if(!cls)throw Error('Строка '+row.number+': некорректный класс.');
   if(cls.grade!==doc.grade)throw Error('Строка '+row.number+': файл содержит '+cls.grade+'-ю параллель, а выбрана '+doc.grade+'-я.');
   rows.push(student(crypto.randomUUID(),{surname:row.cells[indices.s],name:row.cells[indices.n],class_letter:cls.letter}));
  }
  installDoc(doc,rows,true);
  const errors=validateRows().size;
  feedback(errors?'Импортировано '+rows.length+' строк. Исправьте '+errors+' замечаний до сохранения.':'Импортировано '+rows.length+' учеников. Сохраните реестр .vdop.',Boolean(errors));
 }catch(e){feedback('Ошибка Excel: '+(e?.message||String(e)),true);}
}
function validateDoc(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.format!=='VDOP'||data.version!==1||data.kind!=='student_registry')
  throw Error('Неизвестный формат реестра или версия .vdop.');
 if(!UUID.test(data.registry_id)||!UUID.test(data.branch_id))throw Error('В реестре повреждены идентификаторы.');
 if(data.branch_id!==state.branchId)throw Error('Реестр принадлежит другому филиалу. Загрузка запрещена.');
 if(!Number.isInteger(data.year_start)||data.year_start<2025||data.year_start>2100)throw Error('Некорректный учебный год.');
 if(!Number.isInteger(data.grade)||data.grade<1||data.grade>4)throw Error('Некорректная параллель.');
 if(!Array.isArray(data.students)||data.students.length>MAX_STUDENTS)throw Error('Слишком много учеников.');
 const ids=new Set();
 const rows=data.students.map((item,i)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Некорректная запись ученика №'+(i+1));
  if(!UUID.test(item.id))throw Error('Некорректный GUID в строке '+(i+1));
  if(ids.has(item.id.toLowerCase()))throw Error('Повтор GUID в реестре.');
  ids.add(item.id.toLowerCase());
  for(const prop of ['surname','name','class_letter','login']){
   if(item[prop]!==undefined&&typeof item[prop]!=='string')throw Error('Повреждено поле '+prop+' в строке '+(i+1));
  }
  return student(item.id,item);
 });
 return {doc:{...createDoc(),registry_id:data.registry_id,year_start:data.year_start,grade:data.grade},rows};
}
async function openVdop(event){
 const file=event.target.files?.[0];event.target.value='';
 if(!file||!requireDiscard())return;
 try{
  if(!/\.vdop$/i.test(file.name)||file.size>MAX_VDOP_SIZE)throw Error('Нужен файл .vdop размером до 2 МБ.');
  const content=await file.text();
  if(!content.startsWith(FILE_HEADER))throw Error('Это не реестр Выбора допов V9.');
  const data=JSON.parse(content.slice(FILE_HEADER.length));
  const checked=validateDoc(data);
  installDoc(checked.doc,checked.rows,false);
  const n=validateRows().size;
  feedback('Открыт реестр: '+checked.rows.length+' учеников'+(n?', замечаний: '+n:'')+'.',Boolean(n));
 }catch(e){feedback('Ошибка открытия .vdop: '+(e?.message||String(e)),true);}
}
function addStudent(){
 if(!state.doc||state.rows.length>=MAX_STUDENTS)return;
 const letter=state.rows.at(-1)?.class_letter||'А';
 state.rows.push(student(crypto.randomUUID(),{class_letter:letter}));
 state.dirty=true;render();
 const fields=$('registryBody').querySelector('tr:last-child [data-field="surname"]');fields?.focus();
}
function updateRow(event){
 const field=event.target?.dataset?.field;
 const tr=event.target.closest('tr[data-row]');
 if(!field||!tr)return;
 const index=Number(tr.dataset.row);
 if(!Number.isInteger(index)||!state.rows[index])return;
 if(!['surname','name','class_letter'].includes(field))return;
 state.rows[index][field]=field==='class_letter'?norm(event.target.value).toUpperCase():norm(event.target.value);
 state.dirty=true;render();
}
function deleteRow(event){
 const button=event.target.closest('[data-delete]');if(!button)return;
 const index=Number(button.dataset.delete);
 if(!state.rows[index])return;
 if(!window.confirm('Удалить строку из локального реестра? GUID будет потерян. Записи в Supabase не меняются.'))return;
 state.rows.splice(index,1);state.dirty=true;render();
}
function saveVdop(){
 if(!state.doc)return;
 const problems=validateRows();
 if(problems.size){feedback('Исправьте ошибки в '+problems.size+' строках.',true);return;}
 if(!state.rows.length){feedback('Добавьте хотя бы одного ученика.',true);return;}
 const payload={...state.doc,students:state.rows.map(r=>({...r}))};
 const bytes=FILE_HEADER+JSON.stringify(payload,null,2);
 const blob=new Blob([bytes],{type:'application/octet-stream'});
 const href=URL.createObjectURL(blob);
 const safeName=norm(state.branchName).replace(/[^А-ЯЁа-яёA-Za-z0-9_-]+/gu,'_').slice(0,30);
 const a=document.createElement('a');
 a.href=href;a.download=safeName+'_'+state.doc.year_start+'_'+state.doc.grade+'_параллель.vdop';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),6000);
 state.dirty=false;render();feedback('Реестр сохранён: '+state.rows.length+' учеников. Храните файл в защищённом месте.');
}
function setYears(){
 const year=new Date().getFullYear();const starts=Array.from({length:11},(_,i)=>year-2+i);
 $('registryYear').innerHTML=starts.map(x=>'<option value="'+x+'">'+x+'/'+(x+1)+'</option>').join('');
 const current=new Date(),preferred=current.getFullYear()+(current.getMonth()>=8?0:-1);
 $('registryYear').value=String(preferred);
}
async function start(){
 setYears();
 try{
  const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const current=await client.auth.getUser();
  if(current.error||!current.data?.user)throw Error('Войдите в кабинет методолога на главной странице.');
  const {data:profile,error:profileError}=await client.from('profiles').select('role,branch_id,is_active')
   .eq('user_id',current.data.user.id).single();
  if(profileError||profile?.role!=='methodologist'||profile.is_active!==true||!profile.branch_id)
   throw Error('Редактор доступен только активному методологу своего филиала.');
  const {data:branch,error:branchError}=await client.from('branches').select('id,name').eq('id',profile.branch_id).single();
  if(branchError||!branch)throw Error('Не удалось определить филиал методолога.');
  state.branchId=branch.id;state.branchName=branch.name;
  $('branchTitle').textContent='Методолог · '+branch.name;
  $('registryBranchName').textContent=branch.name;
  $('registryWorkspace').hidden=false;
 }catch(error){
  $('registryNoAccess').hidden=false;$('registryAccessMessage').textContent=error?.message||String(error);
  $('branchTitle').textContent='Требуется вход';
 }
}
$('registryNew').addEventListener('click',newRegistry);
$('registryExcel').addEventListener('change',importExcel);
$('registryOpen').addEventListener('change',openVdop);
$('registryAdd').addEventListener('click',addStudent);
$('registrySave').addEventListener('click',saveVdop);
$('registryBody').addEventListener('change',updateRow);
$('registryBody').addEventListener('click',deleteRow);
window.addEventListener('beforeunload',event=>{if(state.doc&&state.dirty){event.preventDefault();event.returnValue='';}});
start();
