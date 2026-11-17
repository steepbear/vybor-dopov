// Выбор допов V7. Код выполняется ТОЛЬКО в Supabase Edge Functions.
// JWT проверяется вручную на каждом защищённом запросе (verify_jwt=false).
// Для demo: ученические логины читаемые, пароли короткие. НЕ production-hardening.
// @ts-ignore: Supabase/Deno resolves npm imports during Edge deployment
import { createClient } from 'npm:@supabase/supabase-js@2';
declare const Deno: any;

const url = Deno.env.get('SUPABASE_URL')!;
function keyFromEnv(jsonName: string, legacyName: string): string {
  const raw = Deno.env.get(jsonName);
  if (raw) { const value = JSON.parse(raw).default; if (value) return value; }
  const fallback = Deno.env.get(legacyName);
  if (!fallback) throw new Error(`Missing ${jsonName}`);
  return fallback;
}
const secret = keyFromEnv('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const publishable = keyFromEnv('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const admin = createClient(url, secret, {auth:{persistSession:false,autoRefreshToken:false}});
// Новый клиент для КАЖДОЙ попытки входа; авторизационные сессии не разделяются между запросами.
const allowedOrigins = (Deno.env.get('V7_ALLOWED_ORIGINS') || 'https://steepbear.github.io')
 .split(',').map(x=>x.trim()).filter(Boolean);
const words = ['lipa','more','kivi','ruka','zima','leto','ryba','puma','tigr','mama','papa','most','list','luna','rosa','volk','sova','klen','gora','voda','mylo','nebo','kota','utka','nora','vaza','pero','lama','sneg','keks','slon','maki','yula','pion','lisa','bor','pole','kust','domik','shar','vishnya','zebra','grusha','reka','melo','bobr','kolos','sahar','buket','dacha','kasha','dino','feya','veter','siniy','mango','plod','pchel','bereg','yabl','vagon','tort','kapla','ruchey'];
function number(max: number) { const x=new Uint32Array(1);crypto.getRandomValues(x);return x[0]%max; }
function passwordStudent(){const short=words.filter(w=>w.length>=4&&w.length<=6);return short[number(short.length)]+String(number(10000)).padStart(4,'0');}
function passwordStaff(){const abc='abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';return Array.from({length:16},()=>abc[number(abc.length)]).join('');}
function reply(origin:string|null,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});}
function invalid(text:string):never{throw new RequestError(text,400);}
class RequestError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
function check(result:any,text='Ошибка базы'):any{
 if(result.error)throw new Error(text+': '+result.error.message);return result.data;
}
async function roleFor(req:Request) {
 const bearer=req.headers.get('Authorization')||'';
 if(!bearer.startsWith('Bearer '))throw new RequestError('Требуется вход',401);
 const {data,error}=await admin.auth.getUser(bearer.slice(7));
 if(error||!data.user)throw new RequestError('Сессия недействительна',401);
 const p=check(await admin.from('profiles').select('role,branch_id,is_active').eq('user_id',data.user.id).maybeSingle());
 if(!p || !p.is_active)throw new RequestError('Учётная запись заблокирована или не назначена',403);
 return {id:data.user.id,role:p.role,branchId:p.branch_id};
}
async function accountForStudent(studentId:string,branchId:string){
 const st=check(await admin.from('students').select('id,user_id,branch_id,grade,class_letter').eq('id',studentId).maybeSingle());
 if(!st || st.branch_id!==branchId || !st.user_id)throw new RequestError('Ученик не найден в вашем филиале',404);
 return st;
}
async function digest(x:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)))].map(a=>a.toString(16).padStart(2,'0')).join('');}
async function throttle(key:string,max:number){
 const hash=await digest(key);const allowed=check(await admin.rpc('v7_consume_login_attempt',{p_hash:hash,p_max:max}));
 if(!allowed)throw new RequestError('Слишком много попыток. Повторите вход позже.',429);
}
async function studentLogin(req:Request,body:any){
 const login=String(body.login||'').trim();const pwd=String(body.password||'');
 if(login.length>80||pwd.length>100)throw new RequestError('Неверный логин или пароль',401);
 const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,80);
 await throttle('ip:'+ip,40);
 await throttle('login:'+login.toLowerCase(),8);
 if((!/^[A-Za-z][A-Za-z0-9]{1,31}-[0-9]{3}$/.test(login) && !/^20[2-9][0-9]_Ф[1-9][0-9]*_Ученик_[0-9]{4,6}$/.test(login)) || !pwd)throw new RequestError('Неверный логин или пароль',401);
 const lookup=admin.from('student_accounts').select('user_id');
 const a=check(await (/^20[2-9][0-9]_Ф/.test(login)?lookup.eq('login',login):lookup.ilike('login',login)).maybeSingle());
 if(!a)throw new RequestError('Неверный логин или пароль',401);
 const p=check(await admin.from('profiles').select('role,is_active').eq('user_id',a.user_id).maybeSingle());
 if(!p||p.role!=='student'||!p.is_active)throw new RequestError('Вход запрещён',403);
 const u=check(await admin.auth.admin.getUserById(a.user_id));
 if(!u.user?.email)throw new RequestError('Учётная запись неактивна',403);
 const loginClient=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
 const signed=await loginClient.auth.signInWithPassword({email:u.user.email,password:pwd});
 if(signed.error||!signed.data.session)throw new RequestError('Неверный логин или пароль',401);
 const session=signed.data.session;
 return {access_token:session.access_token,refresh_token:session.refresh_token};
}
async function list(actor:any){
 if(actor.role==='system_admin'){
   const branches=check(await admin.from('branches').select('id,name').order('name'));
   const profiles=check(await admin.from('profiles').select('user_id,branch_id,is_active').eq('role','methodologist'));
   const methodologists=await Promise.all(profiles.map(async p=>{
     const u=await admin.auth.admin.getUserById(p.user_id);
     return {user_id:p.user_id,branch_id:p.branch_id,is_active:p.is_active,email:u.data.user?.email||'(нет email)'};
   }));
   return {role:actor.role,branches,methodologists};
 }
 if(actor.role!=='methodologist')throw new RequestError('Доступ закрыт',403);
 const sts=check(await admin.from('students').select('id,user_id,grade,class_letter,confirmed_at,created_at')
    .eq('branch_id',actor.branchId).order('grade').order('class_letter'));
 const ids=sts.map(s=>s.id);
 const mapped=ids.length?check(await admin.from('student_accounts').select('student_id,login').in('student_id',ids)):[];
 const m=new Map(mapped.map((x:any)=>[x.student_id,x.login]));
 const users=sts.filter(s=>s.user_id).map(s=>s.user_id);
 const profs=users.length?check(await admin.from('profiles').select('user_id,is_active').in('user_id',users)):[];
 const active=new Map(profs.map((x:any)=>[x.user_id,x.is_active]));
 return {role:actor.role,students:sts.map(s=>({id:s.id,grade:s.grade,class_letter:s.class_letter,
   login:m.get(s.id)||null,has_account:!!s.user_id,is_active:s.user_id?active.get(s.user_id)!==false:false,
   confirmed:!!s.confirmed_at}))};
}
async function createBranch(actor:any,body:any){
 if(actor.role!=='system_admin')throw new RequestError('Недостаточно прав',403);
 const name=String(body.name||'').trim();if(name.length<2||name.length>100)invalid('Название школы: от 2 до 100 символов');
 return check(await admin.from('branches').insert({name}).select('id,name').single());
}
async function createMethodologist(actor:any,body:any){
 if(actor.role!=='system_admin')throw new RequestError('Недостаточно прав',403);
 const email=String(body.email||'').trim().toLowerCase();const branchId=String(body.branch_id||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)invalid('Введите email методолога');
 const branch=check(await admin.from('branches').select('id').eq('id',branchId).maybeSingle());
 if(!branch)invalid('Филиал не найден');
 const pwd=passwordStaff();const created=await admin.auth.admin.createUser({email,password:pwd,email_confirm:true});
 if(created.error||!created.data.user)throw new RequestError('Не удалось создать пользователя: '+created.error?.message,400);
 const id=created.data.user.id;
 try{check(await admin.from('profiles').insert({user_id:id,role:'methodologist',branch_id:branchId}));}
 catch(e){await admin.auth.admin.deleteUser(id);throw e;}
 return {email,password:pwd,user_id:id};
}
async function createStudent(actor:any,body:any){
 if(actor.role!=='methodologist')throw new RequestError('Недостаточно прав',403);
 const base=String(body.base||'').trim();let grade=Number(body.grade);let letter=String(body.class_letter||'').trim().toUpperCase();
 const previousId=body.student_id?String(body.student_id):null;let previousName='';
 if(previousId){
   const prior=check(await admin.from('students').select('id,branch_id,grade,class_letter,full_name,user_id').eq('id',previousId).maybeSingle());
   if(!prior || prior.branch_id!==actor.branchId || prior.user_id)invalid('Нельзя выдать учётную запись этому ученику');
   grade=prior.grade;letter=prior.class_letter;previousName=prior.full_name;
 }
 if(!/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(base))invalid('Некорректная основа логина');
 if(!Number.isInteger(grade)||grade<1||grade>4)invalid('Параллель должна быть 1–4');
 if(!/^[А-ЯЁA-Z]{1,3}$/u.test(letter))invalid('Некорректная буква класса');
 const all=check(await admin.from('student_accounts').select('login').ilike('login',base+'-%').limit(1000));
 const taken=new Set(all.map((a:any)=>a.login.toLowerCase()));let login='';
 for(let i=1;i<=999;i++){const candidate=base+'-'+String(i).padStart(3,'0');if(!taken.has(candidate.toLowerCase())){login=candidate;break;}}
 if(!login)invalid('Закончились номера для этого логина');
 const pwd=passwordStudent();
 const technicalEmail=crypto.randomUUID().replaceAll('-','')+'@students.invalid';
 const created=await admin.auth.admin.createUser({email:technicalEmail,password:pwd,email_confirm:true});
 if(created.error||!created.data.user)throw new RequestError('Не удалось создать аккаунт ученика: '+created.error?.message,400);
 const uid=created.data.user.id;let studentId='';
 try{
   const st=check(previousId
      ? await admin.from('students').update({full_name:login,user_id:uid}).eq('id',previousId).select('id').single()
      : await admin.from('students').insert({branch_id:actor.branchId,grade,class_letter:letter,full_name:login,user_id:uid}).select('id').single());
   studentId=st.id;
   check(await admin.from('profiles').insert({user_id:uid,role:'student',branch_id:actor.branchId}));
   check(await admin.from('student_accounts').insert({student_id:st.id,user_id:uid,login}));
 }catch(e){
   if(studentId){if(previousId)await admin.from('students').update({full_name:previousName,user_id:null}).eq('id',studentId);else await admin.from('students').delete().eq('id',studentId);}
   await admin.auth.admin.deleteUser(uid);throw e;
 }
 return {login,password:pwd,student_id:studentId};
}
// Пакетная выдача аккаунтов. Имя и фамилия в Edge Function не передаются:
// только основа логина, класс и параллель. Фактические пароли возвращаются однократно.
async function bulkCreateStudents(actor:any, body:any) {
  if(actor.role!=='methodologist'||!actor.branchId)throw new RequestError('Недостаточно прав',403);
  const grade=Number(body.grade);
  if(!Number.isInteger(grade)||grade<1||grade>4)invalid('Параллель должна быть 1–4');
  const rows=body.rows;
  if(!Array.isArray(rows)||rows.length<1||rows.length>5)invalid('Допускается пакет из 1–5 учеников');
  await throttle('bulk_methodologist:'+actor.id,30);
  const processed=new Set<string>();
  const results=[];
  for(const item of rows){
    const line=Number(item?.line);
    const base=String(item?.base||'').trim();
    const letter=String(item?.class_letter||'').trim().toUpperCase();
    try{
      if(!Number.isInteger(line)||line<1||line>2000)invalid('Некорректный номер строки Excel');
      if(!/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(base))invalid('Некорректная основа логина');
      if(!/^[А-ЯЁA-Z]{1,3}$/u.test(letter))invalid('Некорректный класс');
      const key=grade+':'+letter+':'+base.toLowerCase();
      if(processed.has(key)){
        results.push({line,status:'exists',message:'В этом пакете уже есть такой логин и класс'});
        continue;
      }
      processed.add(key);
      const accounts=check(await admin.from('student_accounts')
        .select('student_id,login').ilike('login',base+'-%').limit(1000));
      if(accounts.length){
        const ids=accounts.map((a:any)=>a.student_id);
        const existing=check(await admin.from('students').select('id')
          .in('id',ids).eq('branch_id',actor.branchId)
          .eq('grade',grade).eq('class_letter',letter).limit(1));
        if(existing.length){
          results.push({line,status:'exists',login:accounts.find((a:any)=>a.student_id===existing[0].id)?.login||'',
            message:'Учётная запись с такой основой логина в этом классе уже есть'});
          continue;
        }
      }
      const created=await createStudent(actor,{base,grade,class_letter:letter});
      results.push({line,status:'created',login:created.login,password:created.password});
    }catch(e){
      const message=e instanceof RequestError?e.message:
        (e instanceof Error && /duplicate|unique/i.test(e.message)?'Возможно, учётная запись уже создана':
          'Не удалось создать учётную запись. Проверьте Edge Function Logs.');
      results.push({line,status:'error',message});
    }
  }
  return {rows:results};
}


// V9: register a child without class/grade, using the UUID already assigned locally.
// Neither this action nor its response contains surname, name, or class.
const UUID_V9=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function admitOneV9(actor:any, studentId:string, year:number, branchCode:number){
  const existing=check(await admin.from('students')
    .select('id,branch_id,user_id,full_name').eq('id',studentId).maybeSingle());
  if(existing && existing.branch_id!==actor.branchId)
    throw new RequestError('GUID ученика уже принадлежит другому филиалу',409);
  if(existing?.user_id){
    const account=check(await admin.from('student_accounts')
      .select('login').eq('student_id',studentId).maybeSingle());
    if(account) return {status:'exists',id:studentId,login:account.login};
    throw new RequestError('У ученика есть Auth, но не найдена учётная запись',409);
  }

  const prefix=year+'_Ф'+branchCode+'_Ученик_';
  const accounts=check(await admin.from('student_accounts').select('login')
    .like('login',prefix+'%').limit(10000));
  const used=new Set(accounts.map((a:any)=>a.login).filter((x:string)=>x.startsWith(prefix)));
  let login='';
  for(let n=1;n<=999999;n++){
    const candidate=prefix+String(n).padStart(4,'0');
    if(!used.has(candidate)){login=candidate;break;}
  }
  if(!login)throw new RequestError('Закончились номера логинов для этого года и филиала',409);

  const password=passwordStudent();
  const technicalEmail=crypto.randomUUID().replaceAll('-','')+'@students.invalid';
  const created=await admin.auth.admin.createUser({email:technicalEmail,password,email_confirm:true});
  if(created.error||!created.data.user)
    throw new Error('Не удалось создать пользователя Auth: '+(created.error?.message||''));
  const userId=created.data.user.id;
  let studentChanged=false,studentNew=false;
  try{
    if(existing){
      const updated=check(await admin.from('students')
        .update({full_name:login,user_id:userId})
        .eq('id',studentId).is('user_id',null).select('id').maybeSingle());
      if(!updated)throw new RequestError('Ученик был зарегистрирован параллельным запросом',409);
      studentChanged=true;
    }else{
      check(await admin.from('students').insert({
        id:studentId,branch_id:actor.branchId,grade:null,class_letter:null,
        full_name:login,user_id:userId
      }));
      studentChanged=true;studentNew=true;
    }
    check(await admin.from('profiles').insert({
      user_id:userId,role:'student',branch_id:actor.branchId
    }));
    check(await admin.from('student_accounts').insert({
      student_id:studentId,user_id:userId,login
    }));
  }catch(e){
    if(studentChanged){
      if(studentNew)await admin.from('students').delete().eq('id',studentId);
      else await admin.from('students').update({full_name:existing.full_name,user_id:null})
        .eq('id',studentId).eq('user_id',userId);
    }
    await admin.auth.admin.deleteUser(userId);
    throw e;
  }
  return {status:'created',id:studentId,login,password};
}
async function admitStudentsV9(actor:any,body:any){
  if(actor.role!=='methodologist'||!actor.branchId)
    throw new RequestError('Недостаточно прав',403);
  const year=Number(body.admission_year),rows=body.rows;
  if(!Number.isInteger(year)||year<2025||year>2100)invalid('Некорректный год зачисления');
  if(!Array.isArray(rows)||rows.length<1||rows.length>5)
    invalid('Допускается партия из 1–5 учеников');
  const branch=check(await admin.from('branches').select('v9_code')
    .eq('id',actor.branchId).single());
  if(!Number.isInteger(branch.v9_code)||branch.v9_code<1)
    throw new RequestError('Не назначен код филиала',409);
  await throttle('v9_admit:'+actor.id,300);
  const results=[],seen=new Set<string>();
  for(const item of rows){
    const id=String(item?.id||'').toLowerCase();
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).some(k=>k!=='id')||!UUID_V9.test(id)){
      results.push({id,status:'error',message:'Разрешён только корректный GUID ученика'});
      continue;
    }
    if(seen.has(id)){results.push({id,status:'error',message:'Повтор GUID в партии'});continue;}
    seen.add(id);
    try{results.push(await admitOneV9(actor,id,year,branch.v9_code));}
    catch(e){
      const message=e instanceof RequestError?e.message:
        (e instanceof Error&&/duplicate|unique/i.test(e.message)
          ? 'Одновременная регистрация: повторите запрос для этого GUID'
          : 'Ошибка создания учётной записи. Проверьте Edge Function Logs.');
      results.push({id,status:'error',message});
    }
  }
  return {rows:results};
}

async function resetAccount(actor:any,body:any){
 const type=String(body.type||'');const id=String(body.id||'');let userId='';
 if(type==='student'&&actor.role==='methodologist')userId=(await accountForStudent(id,actor.branchId)).user_id;
 else if(type==='methodologist'&&actor.role==='system_admin'){
  const p=check(await admin.from('profiles').select('user_id').eq('user_id',id).eq('role','methodologist').maybeSingle());if(!p)invalid('Методолог не найден');userId=p.user_id;
 }else throw new RequestError('Недостаточно прав',403);
 const pwd=type==='student'?passwordStudent():passwordStaff();
 const {error}=await admin.auth.admin.updateUserById(userId,{password:pwd});
 if(error)throw new Error(error.message);
 return {password:pwd};
}
async function toggleAccount(actor:any,body:any){
 const type=String(body.type||'');const id=String(body.id||'');const enabled=body.enabled;
 if(typeof enabled!=='boolean')invalid('Неверный статус');let uid='';
 if(type==='student'&&actor.role==='methodologist')uid=(await accountForStudent(id,actor.branchId)).user_id;
 else if(type==='methodologist'&&actor.role==='system_admin'){
   const p=check(await admin.from('profiles').select('user_id').eq('user_id',id).eq('role','methodologist').maybeSingle());if(!p)invalid('Методолог не найден');uid=p.user_id;
 }else throw new RequestError('Недостаточно прав',403);
 check(await admin.from('profiles').update({is_active:enabled}).eq('user_id',uid));
 const {error}=await admin.auth.admin.updateUserById(uid,{ban_duration:enabled?'none':'876000h'});
 if(error)throw new Error('Статус сохранён, но Auth-бан не обновлён: '+error.message);
 return {enabled};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('Origin');
 if(origin && !allowedOrigins.includes(origin))return reply(null,{error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||allowedOrigins[0], 'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Max-Age':'600'}});
 if(req.method!=='POST')return reply(origin,{error:'Method not allowed'},405);
 try{
   const body=await req.json();const action=String(body.action||'');
   if(action==='login_student')return reply(origin,await studentLogin(req,body));
   const actor=await roleFor(req);
   let result;
   switch(action){
     case 'list':result=await list(actor);break;
     case 'create_branch':result=await createBranch(actor,body);break;
     case 'create_methodologist':result=await createMethodologist(actor,body);break;
     case 'create_student':
     case 'assign_existing_student':result=await createStudent(actor,body);break;
     case 'bulk_create_students':result=await bulkCreateStudents(actor,body);break;
     case 'v9_admit_students':result=await admitStudentsV9(actor,body);break;
     case 'reset_password':result=await resetAccount(actor,body);break;
     case 'set_active':result=await toggleAccount(actor,body);break;
     default:throw new RequestError('Неизвестная операция',400);
   }
   return reply(origin,result);
 }catch(e){
   if(e instanceof RequestError)return reply(origin,{error:e.message},e.status);
   console.error('school-accounts error:',e);
   return reply(origin,{error:'Ошибка сервера. Проверьте Edge Function Logs.'},500);
 }
});
