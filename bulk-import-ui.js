import {readStudentsXlsx} from './xlsx-import.js';

// Browser-only names; only transliterated identifiers and class reach the server.
export function installBulkImport({state,notice,friendly,accountsApi,reload}){
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={А:'A',Б:'B',В:'V',Г:'G',Д:'D',Е:'E',Ё:'E',Ж:'Zh',З:'Z',И:'I',Й:'I',К:'K',Л:'L',М:'M',Н:'N',О:'O',П:'P',Р:'R',С:'S',Т:'T',У:'U',Ф:'F',Х:'Kh',Ц:'Ts',Ч:'Ch',Ш:'Sh',Щ:'Shch',Ъ:'',Ы:'Y',Ь:'',Э:'E',Ю:'Yu',Я:'Ya'};
 let rows=[],working=false;
 const norm=x=>String(x??'').normalize('NFC').trim().replace(/\s+/g,' ');
 function trans(x){const raw=[...x].map(c=>{const v=names[c.toUpperCase()];return v===undefined?c:v;}).join('').replace(/[^A-Za-z0-9]/g,'');return raw.charAt(0).toUpperCase()+raw.slice(1).toLowerCase();}
 function classInfo(raw){const m=/^([1-4])\s*[-«"\s]*\s*([А-ЯЁA-Z]{1,3})\s*[»"]?$/iu.exec(norm(raw));return m?{grade:+m[1],letter:m[2].toUpperCase()}:null;}
 function status(r){return ({created:'✓ Создан',exists:'Пропущен: уже существует',pending:'Ожидает',processing:'Создаётся…',uncertain:'Ответ не получен: проверьте список учеников'})[r.status]||r.message||'Ошибка';}
 function render(){
  const caption=$('importGradeCaption');if(!caption)return;
  caption.textContent=state.grade;
  $('importBranchName').textContent=state.branch?.name||'—';
  $('importStudentsTableWrap').hidden=!rows.length;
  $('importStudentsBody').innerHTML=rows.map(r=>'<tr><td>'+r.line+'</td><td>'+esc(r.grade?r.grade+r.letter:r.rawClass)+'</td><td>'+esc(r.surname)+'</td><td>'+esc(r.name)+'</td><td><code>'+esc(r.login||'—')+'</code></td><td><code>'+esc(r.password||'—')+'</code></td><td>'+esc(status(r))+'</td></tr>').join('');
  const count=k=>rows.filter(r=>r.status===k).length;
  $('importStudentsSummary').textContent=rows.length?'Всего: '+rows.length+' · Создано: '+count('created')+' · Уже есть: '+count('exists')+' · Ошибки: '+(count('invalid')+count('error')+count('uncertain'))+' · Ожидают: '+count('pending'):'Выберите XLSX-файл для предварительной проверки.';
  $('importStudentsStart').disabled=working||!count('pending')||!!count('invalid');
  $('importStudentsStart').textContent=working?'Создание учётных записей…':count('created')?'Продолжить загрузку':'Создать учётные записи';
  $('importStudentsExport').hidden=!rows.some(r=>r.password);
  $('importStudentsFile').disabled=working;
  $('adminGrade').disabled=working;
 }
 async function readFile(){
  if(working)return;
  const file=$('importStudentsFile').files?.[0];if(!file)return;
  if(rows.some(r=>r.password)&&!confirm('Показанные пароли будут очищены. Вы сохранили результаты?')){$('importStudentsFile').value='';return;}
  rows=[];render();
  try{
   const data=await readStudentsXlsx(file);
   const first=data.find(r=>r.cells.some(norm));if(!first)throw Error('Пустой Excel.');
   const h=first.cells.map(x=>norm(x).toLowerCase().replace(/\s/g,''));
   const pos={c:h.indexOf('класс'),s:h.indexOf('фамилия'),n:h.indexOf('имя')};
   if(Object.values(pos).some(i=>i<0))throw Error('Нужны столбцы: Класс, Фамилия, Имя.');
   const source=data.filter(r=>r.number>first.number&&r.cells.some(norm));
   if(!source.length||source.length>500)throw Error('Файл должен содержать от 1 до 500 учеников.');
   const seen=new Set();
   rows=source.map(r=>{
    const rawClass=norm(r.cells[pos.c]),surname=norm(r.cells[pos.s]),name=norm(r.cells[pos.n]),cls=classInfo(rawClass);
    const x={line:r.number,rawClass,surname,name,grade:cls?.grade||null,letter:cls?.letter||'',base:'',status:'pending',login:'',password:'',message:''};
    if(!cls){x.status='invalid';x.message='Неверно указан класс';}
    else if(cls.grade!==state.grade){x.status='invalid';x.message='Неверная параллель: '+cls.grade;}
    else if(!/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z'’\- ]{0,59}$/u.test(surname)||!/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z'’\- ]{0,59}$/u.test(name)){x.status='invalid';x.message='Проверьте ФИО';}
    x.base=trans(surname).slice(0,29)+trans(name).charAt(0);
    if(!/^[A-Za-z][A-Za-z0-9]{1,31}$/.test(x.base)){x.status='invalid';x.message='Неверная основа логина';}
    const key=x.letter+'|'+surname.toLocaleLowerCase('ru')+'|'+name.toLocaleLowerCase('ru');
    if(seen.has(key)){x.status='invalid';x.message='Повтор ученика в файле';}seen.add(key);
    return x;
   });
   render();notice(rows.some(r=>r.status==='invalid')?'В Excel найдены ошибки. Исправьте их и загрузите файл повторно.':'Проверено '+rows.length+' учеников. Можно создать учётные записи.',rows.some(r=>r.status==='invalid'));
  }catch(e){rows=[];render();notice('Не удалось прочитать Excel: '+friendly(e),true);}
 }
 async function run(){
  if(working||!rows.length||rows.some(r=>r.status==='invalid'))return;
  const pending=rows.filter(r=>r.status==='pending');
  if(!pending.length||!confirm('Создать учётные записи для '+pending.length+' учеников? Пароли будут показаны только один раз.'))return;
  working=true;render();let stopped=false;
  try{
   while(true){
    const batch=rows.filter(r=>r.status==='pending').slice(0,5);
    if(!batch.length)break;
    batch.forEach(r=>r.status='processing');render();
    let result;
    try{result=await accountsApi('bulk_create_students',{grade:state.grade,rows:batch.map(r=>({line:r.line,base:r.base,class_letter:r.letter}))});}
    catch(e){batch.forEach(r=>{r.status='uncertain';r.message=friendly(e);});notice('Ошибка сети. Проверьте список учеников перед повторной загрузкой.',true);stopped=true;break;}
    const answers=new Map((result.rows||[]).map(r=>[r.line,r]));
    for(const r of batch){
     const a=answers.get(r.line);
     if(!a){r.status='uncertain';stopped=true;continue;}
     r.status=['created','exists'].includes(a.status)?a.status:'error';
     r.login=a.login||'';r.password=a.status==='created'?(a.password||''):'';r.message=a.message||'';
    }
    render();if(stopped)break;
   }
   try{await reload();}catch(e){notice('Учётные записи созданы, но список не обновился: '+friendly(e),true);}
   if(!stopped)notice('Импорт завершён. Сохраните логины и пароли.');
  }finally{working=false;render();}
 }
 function csvValue(v){let s=String(v??'');if(/^\s*[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
 function exportCSV(){
  const table=[['№','Класс','Фамилия','Имя','Логин','Пароль','Результат'],...rows.map(r=>[r.line,r.grade?r.grade+r.letter:r.rawClass,r.surname,r.name,r.login,r.password,status(r)])];
  const data='\uFEFF'+table.map(row=>row.map(csvValue).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='Ученики_'+state.grade+'_логины_и_пароли.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 $('importStudentsFile').addEventListener('change',readFile);
 $('importStudentsStart').addEventListener('click',run);
 $('importStudentsExport').addEventListener('click',exportCSV);
 return {render,clear(){if(rows.some(r=>r.password)&&!confirm('Пароли из таблицы исчезнут. Вы сохранили их?'))return false;rows=[];$('importStudentsFile').value='';render();return true;}};
}
