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
 try{await action();await load();if(!silent)tell('Изменения сохранены.');}
 catch(e){tell(e.message||String(e),true);}
 finally{state.busy=false;document.querySelectorAll('#v9Workspace button').forEach(b=>b.disabled=false);render();}
}
function filteredDocs(){return state.docs.filter(d=>d.year_start===year()&&d.grade===grade()).sort((a,b)=>a.class_letter.localeCompare(b.class_letter,'ru'));}
function currentDocument(){return state.docs.find(d=>d.id===state.selected)||null;}
function render(){
 const docs=filteredDocs(),selected=currentDocument();
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
start();
