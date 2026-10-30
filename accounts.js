import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const configKey='vybor_dopov_supabase_v6';
let client,role,branchId,known=[],localPairs=[],credentials=null;
function toast(message,error=false){const e=$('feedback');e.hidden=false;e.textContent=message;e.className='live-message '+(error?'error':'ok');e.scrollIntoView({block:'nearest',behavior:'smooth'});}
async function api(action,params={}){
 const {data,error}=await client.functions.invoke('school-accounts',{body:{action,...params}});
 if(error){let text=error.message;try{const j=await error.context.json();text=j.error||text;}catch{}throw new Error(text);}
 if(data?.error)throw new Error(data.error);return data;
}
async function act(callback){try{await callback();}catch(e){toast(e.message||String(e),true);}}
const translit={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
function latin(v){return [...v.toLowerCase()].map(c=>translit[c]??(/[a-z0-9]/.test(c)?c:'')).join('');}
function makeBase(raw){const x=raw.trim().split(/\s+/).filter(Boolean);if(x.length<2)return '';
 const last=latin(x[0]), first=latin(x[1]);return (last[0]?.toUpperCase()||'')+last.slice(1)+(first[0]?.toUpperCase()||'');}
function showCreds(title,login,password,desc){credentials={login,password};$('credentialTitle').textContent=title;$('resultLogin').textContent=login||'—';$('resultPassword').textContent=password;
 $('credentialDescription').textContent=desc||'Пароль отображается только один раз. Сохраните или распечатайте его сейчас.';$('credentialDialog').showModal();}
function hideCreds(){ $('credentialDialog').close();credentials=null;$('resultPassword').textContent='';}
function renderAdmin(data){known=data.branches;
 $('staffBranch').innerHTML=known.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
 const b=new Map(known.map(x=>[x.id,x.name]));
 $('staffRows').innerHTML=data.methodologists.length?data.methodologists.map(u=>`<tr><td>${esc(u.email)}</td><td>${esc(b.get(u.branch_id)||'—')}</td><td>${u.is_active?'Активен':'Заблокирован'}</td><td><div class="account-actions"><button class="btn outline mini" data-reset="methodologist" data-id="${esc(u.user_id)}" data-email="${esc(u.email)}">Сбросить пароль</button><button class="btn ghost mini" data-toggle="methodologist" data-id="${esc(u.user_id)}" data-enabled="${!u.is_active}">${u.is_active?'Заблокировать':'Разблокировать'}</button></div></td></tr>`).join(''):'<tr><td colspan="4">Методологов пока нет</td></tr>';
}
function renderStudents(data){$('studentRows').innerHTML=data.students.length?data.students.map(s=>`<tr><td><strong>${esc(s.login||'Без учётной записи (V6)')}</strong></td><td>${s.grade}</td><td>${esc(s.class_letter)}</td><td>${!s.has_account?'Нет входа':s.is_active?'Активен':'Заблокирован'}</td><td>${s.confirmed?'Подтверждено':'Не подтверждено'}</td><td>${s.has_account?`<div class="account-actions"><button class="btn outline mini" data-reset="student" data-id="${esc(s.id)}" data-email="${esc(s.login||'')}" >Новый пароль</button><button class="btn ghost mini" data-toggle="student" data-id="${esc(s.id)}" data-enabled="${!s.is_active}">${s.is_active?'Блокировать':'Разблокировать'}</button></div>`:`<button class="btn outline mini" data-provision="${esc(s.id)}">Выдать доступ</button>`}</td></tr>`).join(''):'<tr><td colspan="6">Учеников пока нет</td></tr>';
}
async function refresh(){const data=await api('list');if(role==='system_admin')renderAdmin(data);else renderStudents(data);}
async function start(){const old=localStorage.getItem(configKey);if(!old)throw new Error('Сначала настройте подключение на главной странице.');
 const {url,key}=JSON.parse(old);client=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}});
 const auth=await client.auth.getUser();if(!auth.data?.user)throw new Error('Сначала войдите на главной странице.');
 const p=await client.from('profiles').select('role,branch_id,is_active').eq('user_id',auth.data.user.id).single();if(p.error)throw p.error;if(p.data.is_active===false)throw new Error('Учётная запись заблокирована.');
 role=p.data.role;branchId=p.data.branch_id;if(!['system_admin','methodologist'].includes(role))throw new Error('Для этой роли нет панели управления доступом.');
 $('activeIdentity').textContent=role==='system_admin'?'Администратор системы':'Методолог';
 $('adminArea').hidden=role!=='system_admin';$('methodArea').hidden=role!=='methodologist';
 if(role==='methodologist'){const b=await client.from('branches').select('name').eq('id',branchId).single();$('myBranch').textContent=b.data?.name||'Мой филиал';}
 await refresh();}
$('studentFio').addEventListener('input',()=>{const base=makeBase($('studentFio').value);$('loginBase').value=base;$('loginExample').textContent=base?base+'-001':'—';});
$('loginBase').addEventListener('input',()=>{$('loginExample').textContent=$('loginBase').value.trim()+'-001';});
$('branchForm').addEventListener('submit',e=>{e.preventDefault();act(async()=>{await api('create_branch',{name:$('branchName').value.trim()});$('branchName').value='';await refresh();toast('Филиал создан.');});});
$('methodologistForm').addEventListener('submit',e=>{e.preventDefault();act(async()=>{const data=await api('create_methodologist',{email:$('staffEmail').value.trim(),branch_id:$('staffBranch').value});$('staffEmail').value='';await refresh();showCreds('Новый методолог',data.email,data.password);});});
$('studentAccountForm').addEventListener('submit',e=>{e.preventDefault();act(async()=>{
 const original=$('studentFio').value.trim();const base=$('loginBase').value.trim();
 const result=await api('create_student',{base,grade:Number($('studentGrade').value),class_letter:$('studentClass').value});
 localPairs.push({fio:original,login:result.login});$('exportMapping').disabled=false;$('localCount').textContent=`Новых записей в текущей сессии: ${localPairs.length}`;
 $('studentFio').value='';$('loginBase').value='';$('loginExample').textContent='—';await refresh();showCreds('Учётная запись ученика',result.login,result.password);
});});
document.addEventListener('click',e=>{const reset=e.target.closest('[data-reset]'),toggle=e.target.closest('[data-toggle]');
 const provision=e.target.closest('[data-provision]');
 if(provision)act(async()=>{
   const fio=prompt('Укажи ФИО для локального формирования логина (не отправляется в Supabase):');if(!fio)return;
   const base=makeBase(fio);if(!base)throw new Error('Укажи фамилию и имя.');
   const result=await api('assign_existing_student',{student_id:provision.dataset.provision,base});
   localPairs.push({fio,login:result.login});$('exportMapping').disabled=false;$('localCount').textContent=`Новых записей в текущей сессии: ${localPairs.length}`;
   await refresh();showCreds('Учётная запись ученика',result.login,result.password);
 });
 if(reset)act(async()=>{if(!confirm(`Сбросить пароль для ${reset.dataset.email||'этой записи'}? Старый пароль перестанет действовать.`))return;
 const data=await api('reset_password',{type:reset.dataset.reset,id:reset.dataset.id});showCreds('Пароль обновлён',reset.dataset.email||'Ученик',data.password);});
 if(toggle)act(async()=>{const active=toggle.dataset.enabled==='true';if(!confirm(`${active?'Разблокировать':'Заблокировать'} учётную запись?`))return;
 await api('set_active',{type:toggle.dataset.toggle,id:toggle.dataset.id,enabled:active});await refresh();toast(active?'Доступ включён.':'Доступ заблокирован.');});
});
$('updateList').addEventListener('click',()=>act(refresh));
$('exit').addEventListener('click',()=>act(async()=>{if(client)await client.auth.signOut();window.location.href='index.html';}));
$('copyCredentials').addEventListener('click',async()=>{if(!credentials)return;try{await navigator.clipboard.writeText(`Логин: ${credentials.login}\nПароль: ${credentials.password}`);toast('Учётные данные скопированы.');}catch{toast('Не удалось скопировать автоматически.',true);}});
$('closeCredentials').addEventListener('click',hideCreds);
$('printCredentials').addEventListener('click',()=>window.print());
$('exportMapping').addEventListener('click',()=>{if(!localPairs.length)return;const csv='\ufeffФИО;Логин\r\n'+localPairs.map(x=>[x.fio,x.login].map(v=>'"'+v.replaceAll('"','""')+'"').join(';')).join('\r\n');
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='sootvetstvie-uchenikov-local.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
start().catch(e=>{$('needLogin').hidden=false;$('adminArea').hidden=true;$('methodArea').hidden=true;$('activeIdentity').textContent='Требуется вход';toast(e.message||String(e),true);});
