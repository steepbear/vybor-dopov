// V9: admission registry (.vdop V2). FIO is processed ONLY in this browser.
// HTTP requests contain UUIDs/year; never surname, name or classroom.
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
import {readStudentsXlsx} from './xlsx-import.js';
import {downloadCreatedStudentsXlsx} from './xlsx-export.js';

const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>String(x??'').normalize('NFC').trim().replace(/\s+/g,' ');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME=/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z'’\- ]{0,59}$/u;
const HEADER_V2='VDOP/2\n',HEADER_V1='VDOP/1\n',LIMIT=500,MAX_SIZE=2*1024*1024;
const state={client:null,branchId:'',branchName:'',branchCode:null,doc:null,
 rows:[],dirty:false,busy:false,issued:new Map(),exported:true};
function feedback(msg,bad=false){
 const n=$('registryNotice');n.textContent=msg;n.className='live-message '+(bad?'error':'ok');n.hidden=false;
}
function year(){return Number($('registryYear').value);}
function createDoc(y=year(),registryId=crypto.randomUUID()){
 return {format:'VDOP',version:2,kind:'school_admissions',registry_id:registryId,
  branch_id:state.branchId,branch_name:state.branchName,admission_year:y,students:[]};
}
function student(id=crypto.randomUUID(),data={}){
 return {id,surname:norm(data.surname),name:norm(data.name),
  login:norm(data.login),namesake_verified:data.namesake_verified===true};
}
function hasUnsavedCredentials(){return !state.exported&&[...state.issued.values()].some(x=>x.password);}
function confirmDiscard(){
 if(hasUnsavedCredentials()&&!confirm('Пароли новых учеников ещё не выгружены в Excel. Продолжить и потерять их?'))return false;
 return !state.doc||!state.dirty||confirm('Есть несохранённые изменения. Заменить текущий реестр?');
}
function validation(){
 const issues=new Map(),counts=new Map(),seen=new Set();
 state.rows.forEach(r=>{
  const key=norm(r.surname).toLocaleLowerCase('ru')+'|'+norm(r.name).toLocaleLowerCase('ru');
  if(r.surname&&r.name)counts.set(key,(counts.get(key)||0)+1);
 });
 state.rows.forEach((r,i)=>{
  const problems=[];
  if(!UUID.test(r.id)||seen.has(r.id.toLowerCase()))problems.push('Повтор или ошибка GUID');
  seen.add(String(r.id).toLowerCase());
  if(!NAME.test(r.surname)||!NAME.test(r.name))problems.push('Проверьте фамилию и имя');
  const key=norm(r.surname).toLocaleLowerCase('ru')+'|'+norm(r.name).toLocaleLowerCase('ru');
  if((counts.get(key)||0)>1&&!r.namesake_verified)problems.push('Совпадение ФИО: подтвердите тёзку');
  if(r.login&&r.login.length>80)problems.push('Слишком длинный логин');
  if(problems.length)issues.set(i,problems.join('; '));
 });
 return {issues,counts};
}
function render(){
 $('registryEditor').hidden=!state.doc;
 $('registryNew').textContent=state.doc?'Закрыть реестр':'Новый пустой реестр';
 if(!state.doc)return;
 $('registryYear').value=String(state.doc.admission_year);
 $('registryYear').disabled=true;
 const {issues,counts}=validation();
 $('registrySummary').textContent=state.rows.length+' учеников · замечаний: '+issues.size+
  (state.dirty?' · не сохранено':' · сохранено');
 $('registryDirty').hidden=!state.dirty;
 $('registrySave').disabled=state.busy||!state.rows.length||issues.size>0;
 $('registryAdd').disabled=state.busy||state.rows.length>=LIMIT;
 $('registryAdmit').disabled=state.busy||state.dirty||!state.rows.length||issues.size>0;
 $('registryAdmit').textContent=state.busy?'Регистрация…':'Зарегистрировать учеников в системе';
 $('registryExport').disabled=state.busy||![...state.issued.values()].some(x=>x.password);
 $('registryBody').innerHTML=state.rows.map((s,i)=>{
  const problem=issues.get(i),key=norm(s.surname).toLocaleLowerCase('ru')+'|'+norm(s.name).toLocaleLowerCase('ru');
  const duplicate=(counts.get(key)||0)>1;
  const outcome=state.issued.get(s.id);
  const label=outcome?.status==='created'?'Создан':outcome?.status==='exists'?'Уже зарегистрирован':
    outcome?.status==='error'?'Ошибка: '+outcome.message:outcome?.status==='uncertain'?'Неизвестно: повторите запрос':
    s.login?'Логин в файле':'Не зарегистрирован';
  return '<tr data-row="'+i+'" class="'+(problem?'registry-problem':'')+'">'+
   '<td>'+(i+1)+'</td>'+
   '<td><input aria-label="Фамилия" maxlength="60" data-field="surname" value="'+esc(s.surname)+'" '+(state.busy?'disabled':'')+'></td>'+
   '<td><input aria-label="Имя" maxlength="60" data-field="name" value="'+esc(s.name)+'" '+(state.busy?'disabled':'')+'></td>'+
   '<td><code title="'+esc(s.id)+'">'+esc(s.id.slice(0,8))+'…</code></td>'+
   '<td><small>'+esc(s.login||'После регистрации')+'</small></td>'+
   '<td>'+ (duplicate?'<label class="registry-namesake"><input data-field="namesake_verified" type="checkbox" '+(s.namesake_verified?'checked ':'')+(state.busy?'disabled':'')+'>Это разные дети</label>':'—')+'</td>'+
   '<td class="'+(problem?'registry-error':'registry-valid')+'">'+esc(problem||label)+'</td>'+
   '<td><button type="button" class="btn ghost mini" data-delete="'+i+'" aria-label="Удалить ученика" '+(state.busy?'disabled':'')+'>×</button></td></tr>';
 }).join('');
 $('registryPasswordNotice').hidden=!hasUnsavedCredentials();
}
function installDoc(doc,rows,dirty){
 state.doc=doc;state.rows=rows;state.dirty=dirty;state.issued=new Map();state.exported=true;
 render();
}
function newRegistry(){
 if(state.busy||!confirmDiscard())return;
 if(state.doc){
  state.doc=null;state.rows=[];state.dirty=false;
  state.issued.clear();state.exported=true;
  $('registryYear').disabled=false;render();
  feedback('Реестр закрыт. Выберите год и создайте новый или откройте .vdop.');
  return;
 }
 installDoc(createDoc(),[],true);feedback('Создан реестр зачисления без классов. Добавьте учеников.');
}
async function importExcel(e){
 const file=e.target.files?.[0];e.target.value='';
 if(!file||state.busy)return;
 try{
  const sheet=await readStudentsXlsx(file);
  const head=sheet.find(r=>r.cells.some(norm));if(!head)throw Error('Excel пуст.');
  const labels=head.cells.map(x=>norm(x).toLocaleLowerCase('ru').replace(/\s/g,''));
  const s=labels.indexOf('фамилия'),n=labels.indexOf('имя');
  if(s<0||n<0)throw Error('Нужны столбцы «Фамилия» и «Имя». Класс не нужен.');
  const lines=sheet.filter(r=>r.number>head.number&&r.cells.some(norm));
  if(!lines.length||lines.length>LIMIT)throw Error('Допустимо от 1 до '+LIMIT+' учеников.');
  const doc=createDoc(),rows=lines.map(r=>student(crypto.randomUUID(),{
   surname:r.cells[s],name:r.cells[n]
  }));
  installDoc(doc,rows,true);
  const bad=validation().issues.size;
  feedback('Excel прочитан: '+rows.length+' учеников. Класс не требуется и не сохраняется. '+
   (bad?'Исправьте замечания: '+bad+'.':'Сохраните новый .vdop.'),Boolean(bad));
 }catch(err){feedback('Ошибка Excel: '+(err?.message||String(err)),true);}
}
function parseVdop(text){
 const old=text.startsWith(HEADER_V1),header=old?HEADER_V1:HEADER_V2;
 if(!text.startsWith(header))throw Error('Неизвестный формат .vdop.');
 const data=JSON.parse(text.slice(header.length));
 if(!data||typeof data!=='object'||Array.isArray(data)||data.format!=='VDOP'||
    data.kind!==(old?'student_registry':'school_admissions')||data.version!==(old?1:2))
   throw Error('Неверная версия или структура реестра.');
 if(!UUID.test(data.registry_id)||!UUID.test(data.branch_id)||data.branch_id!==state.branchId)
   throw Error('Некорректный GUID реестра или реестр другого филиала.');
 const y=old?data.year_start:data.admission_year;
 if(!Number.isInteger(y)||y<2025||y>2100)throw Error('Некорректный год зачисления.');
 if(!Array.isArray(data.students)||data.students.length>LIMIT)throw Error('Некорректный список учеников.');
 const ids=new Set(),rows=data.students.map((r,i)=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||!UUID.test(r.id))throw Error('Неверный GUID строки '+(i+1));
  const id=r.id.toLowerCase();if(ids.has(id))throw Error('Повтор GUID в файле.');
  ids.add(id);
  if(['surname','name','login'].some(k=>r[k]!==undefined&&typeof r[k]!=='string'))
    throw Error('Ошибка строки '+(i+1));
  return student(id,r);
 });
 return {doc:createDoc(y,data.registry_id),rows,old};
}
async function openVdop(e){
 const file=e.target.files?.[0];e.target.value='';
 if(!file||state.busy||!confirmDiscard())return;
 try{
  if(!/\.vdop$/i.test(file.name)||file.size>MAX_SIZE)throw Error('Выберите .vdop не больше 2 МБ.');
  const parsed=parseVdop(await file.text());
  installDoc(parsed.doc,parsed.rows,parsed.old);
  const bad=validation().issues.size;
  feedback((parsed.old?'Файл V1 преобразован в реестр зачисления V2; сведения о классах исключены. Сохраните новую копию.':
   'Открыт реестр зачисления.')+' Учеников: '+parsed.rows.length+', замечаний: '+bad+'.',Boolean(bad));
 }catch(err){feedback('Ошибка открытия: '+(err?.message||String(err)),true);}
}
function addStudent(){
 if(!state.doc||state.busy||state.rows.length>=LIMIT)return;
 state.rows.push(student());state.dirty=true;render();
 $('registryBody').querySelector('tr:last-child [data-field="surname"]')?.focus();
}
function changeRow(e){
 const tr=e.target.closest('tr[data-row]'),field=e.target.dataset.field;
 if(!tr||!['surname','name','namesake_verified'].includes(field)||state.busy)return;
 const row=state.rows[Number(tr.dataset.row)];if(!row)return;
 row[field]=field==='namesake_verified'?e.target.checked:norm(e.target.value);
 state.dirty=true;render();
}
function deleteRow(e){
 const b=e.target.closest('[data-delete]');if(!b||state.busy)return;
 const i=Number(b.dataset.delete),r=state.rows[i];if(!r)return;
 if(!confirm('Удалить строку из локального .vdop? Учётная запись в Supabase не удаляется.'))return;
 state.rows.splice(i,1);state.issued.delete(r.id);state.dirty=true;render();
}
function download(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),6000);
}
function saveVdop(){
 if(!state.doc||state.busy)return;
 const bad=validation().issues.size;
 if(bad||!state.rows.length){feedback('Исправьте замечания и добавьте учеников.',true);return;}
 const data={...state.doc,students:state.rows.map(r=>({...r}))};
 const text=HEADER_V2+JSON.stringify(data,null,2),slug=norm(state.branchName)
   .replace(/[^А-ЯЁа-яёA-Za-z0-9_-]+/gu,'_').slice(0,30);
 download(new Blob([text],{type:'application/octet-stream'}),
   slug+'_'+state.doc.admission_year+'_зачисление.vdop');
 state.dirty=false;render();
 feedback('Скачан .vdop с '+state.rows.length+' учениками. Сохраните файл в защищённом месте.');
}
async function admit(){
 if(state.busy||!state.doc||state.dirty||validation().issues.size)return;
 if(!confirm('Зарегистрировать учеников из этого .vdop? GUID останутся постоянными, класс не назначается. Новые пароли будут показаны один раз.'))return;
 state.busy=true;render();let processed=0,errors=0,created=0,already=0;
 try{
  const pending=state.rows.filter(r=>!['created','exists'].includes(state.issued.get(r.id)?.status));
  for(let i=0;i<pending.length;i+=5){
   const batch=pending.slice(i,i+5);
   // Never send FIO or local-only flags in this request.
   let answer;
   try{
    const {data,error}=await state.client.functions.invoke('school-accounts',{
      body:{action:'v9_admit_students',admission_year:state.doc.admission_year,
       rows:batch.map(r=>({id:r.id}))}
    });
    if(error||data?.error)throw Error(error?.message||data.error);
    answer=data;
   }catch(err){
    batch.forEach(r=>state.issued.set(r.id,{status:'uncertain',message:String(err?.message||err)}));
    feedback('Ответ сервера не получен. Повторная попытка безопасна благодаря проверке GUID.',true);
    errors+=batch.length;break;
   }
   const mapped=new Map((answer?.rows||[]).map(r=>[String(r.id).toLowerCase(),r]));
   for(const r of batch){
    const result=mapped.get(r.id.toLowerCase())||{status:'error',message:'Нет ответа для GUID'};
    if(result.status==='created'||result.status==='exists'){
     r.login=result.login;state.dirty=true;
     if(result.status==='created'){created++;state.exported=false;}
     else already++;
    }else errors++;
    state.issued.set(r.id,result);processed++;
   }
   render();
   feedback('Регистрация: обработано '+processed+' из '+pending.length+'. Новых: '+created+'. Ошибок: '+errors+'.',Boolean(errors));
  }
  feedback('Завершено. Создано: '+created+', ранее существовали: '+already+', ошибки: '+errors+
    '. Сохраните обновлённый .vdop'+(created?' и выгрузите Excel с паролями.':'.'),Boolean(errors));
 }finally{state.busy=false;render();}
}
function exportPasswords(){
 const issued=state.rows.flatMap(r=>{
  const result=state.issued.get(r.id);
  return result?.status==='created'&&result.password?[{
   className:'Не распределён',surname:r.surname,name:r.name,login:result.login,password:result.password
  }]:[];
 });
 if(!issued.length){feedback('Новых паролей для выгрузки нет.',true);return;}
 try{
  const count=downloadCreatedStudentsXlsx(issued,'Зачисление_'+state.doc.admission_year+'_логины_пароли.xlsx');
  state.exported=true;render();
  feedback('Скачан Excel с '+count+' логинами и паролями. ФИО в нём сформированы локально.');
 }catch(err){feedback('Ошибка формирования Excel: '+String(err?.message||err),true);}
}
function initYears(){
 const today=new Date().getFullYear();
 $('registryYear').innerHTML=Array.from({length:11},(_,i)=>today-2+i)
  .map(y=>'<option value="'+y+'">'+y+'</option>').join('');
 $('registryYear').value=String(today);
}
async function start(){
 initYears();
 try{
  state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const {data:auth,error:authError}=await state.client.auth.getUser();
  if(authError||!auth?.user)throw Error('Войдите в кабинет методолога.');
  const {data:p,error:pe}=await state.client.from('profiles')
   .select('role,branch_id,is_active').eq('user_id',auth.user.id).single();
  if(pe||p?.role!=='methodologist'||!p.is_active||!p.branch_id)
   throw Error('Доступ только для активного методолога.');
  const {data:b,error:be}=await state.client.from('branches')
   .select('id,name,v9_code').eq('id',p.branch_id).single();
  if(be||!b||!b.v9_code)throw Error('Не удалось получить код филиала.');
  state.branchId=b.id;state.branchName=b.name;state.branchCode=b.v9_code;
  $('branchTitle').textContent='Методолог · '+b.name;
  $('registryBranchName').textContent=b.name+' · Ф'+b.v9_code;
  $('registryWorkspace').hidden=false;
 }catch(err){
  $('registryNoAccess').hidden=false;
  $('registryAccessMessage').textContent=String(err?.message||err);
  $('branchTitle').textContent='Требуется вход';
 }
}
$('registryNew').addEventListener('click',newRegistry);
$('registryExcelAction').addEventListener('click',()=>{
 if(state.busy)return;
 if(state.doc&&hasUnsavedCredentials()&&!confirm('Пароли новых учеников ещё не выгружены в Excel. Продолжить и потерять их?'))return;
 if(state.doc&&!confirm('Текущие данные будут заменены данными из файла. Продолжить?'))return;
 $('registryExcel').click();
});
$('registryExcel').addEventListener('change',importExcel);
$('registryOpen').addEventListener('change',openVdop);
$('registryAdd').addEventListener('click',addStudent);
$('registryBody').addEventListener('change',changeRow);
$('registryBody').addEventListener('click',deleteRow);
$('registrySave').addEventListener('click',saveVdop);
$('registryAdmit').addEventListener('click',admit);
$('registryExport').addEventListener('click',exportPasswords);
window.addEventListener('beforeunload',e=>{
 if(state.doc&&(state.dirty||hasUnsavedCredentials())){e.preventDefault();e.returnValue='';}
});
start();
