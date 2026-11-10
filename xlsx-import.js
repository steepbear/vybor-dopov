// XLSX reader for local-only extraction of student names, no external network.
const MAX_FILE_SIZE=2*1024*1024,MAX_XML_SIZE=8*1024*1024;
const dec=new TextDecoder('utf-8');
const u16=(dv,i)=>dv.getUint16(i,true),u32=(dv,i)=>dv.getUint32(i,true);
function zipDirectory(buffer){
  if(buffer.byteLength>MAX_FILE_SIZE)throw Error('Размер файла превышает 2 МБ.');
  const dv=new DataView(buffer);let eocd=-1;
  for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--){
    if(u32(dv,i)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw Error('Неверный формат XLSX.');
  const count=u16(dv,eocd+10),offset=u32(dv,eocd+16);
  if(count>250||offset>=buffer.byteLength)throw Error('Слишком сложный XLSX.');
  let p=offset;const entries=new Map();
  for(let i=0;i<count;i++){
    if(p+46>buffer.byteLength||u32(dv,p)!==0x02014b50)throw Error('Повреждён XLSX.');
    const len=u16(dv,p+28),extra=u16(dv,p+30),comment=u16(dv,p+32);
    const name=dec.decode(new Uint8Array(buffer,p+46,len));
    if(name&&!name.endsWith('/'))entries.set(name,{method:u16(dv,p+10),compressed:u32(dv,p+20),uncompressed:u32(dv,p+24),offset:u32(dv,p+42)});
    p+=46+len+extra+comment;
  }
  return {buffer,dv,entries};
}
async function readEntry(archive,name){
  const info=archive.entries.get(name);if(!info)return null;
  if(info.uncompressed>MAX_XML_SIZE||info.compressed>MAX_FILE_SIZE)throw Error('Слишком большой XML внутри XLSX.');
  const {buffer,dv}=archive,p=info.offset;
  if(p+30>buffer.byteLength||u32(dv,p)!==0x04034b50)throw Error('Повреждён XLSX.');
  const start=p+30+u16(dv,p+26)+u16(dv,p+28);
  if(start+info.compressed>buffer.byteLength)throw Error('Повреждён XLSX.');
  const input=new Uint8Array(buffer.slice(start,start+info.compressed));
  if(info.method===0)return dec.decode(input);
  if(info.method!==8)throw Error('Неподдерживаемое сжатие XLSX.');
  if(typeof DecompressionStream!=='function')throw Error('Используйте актуальный Chrome или Edge.');
  let reader;
  try{reader=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();}
  catch{throw Error('Браузер не поддерживает распаковку XLSX.');}
  const chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_XML_SIZE){await reader.cancel();throw Error('Слишком большой XML.');}chunks.push(value);}
  const out=new Uint8Array(total);let at=0;for(const ch of chunks){out.set(ch,at);at+=ch.length;}
  return dec.decode(out);
}
function xml(source,name){
  if(!source)throw Error('В XLSX не найден '+name);
  const root=new DOMParser().parseFromString(source,'application/xml');
  if(root.getElementsByTagName('parsererror').length)throw Error('Повреждён XML '+name);
  return root;
}
const elems=(root,name)=>[...root.getElementsByTagNameNS('*',name)];
function firstSheetName(workbook,rels){
  const sheets=elems(workbook,'sheet');if(!sheets.length)throw Error('В XLSX нет листов.');
  const rid=[...sheets[0].attributes].find(a=>a.localName==='id')?.value;
  const rel=elems(rels,'Relationship').find(r=>r.getAttribute('Id')===rid);
  if(!rel)throw Error('Первый лист XLSX не найден.');
  const target=rel.getAttribute('Target')||'';
  const raw=target.startsWith('/')?target.slice(1):'xl/'+target;
  const parts=[];for(const p of raw.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}
  const path=parts.join('/');if(!path.startsWith('xl/worksheets/'))throw Error('Неверный путь листа XLSX.');
  return path;
}
function column(ref){
  const letters=/^([A-Z]+)\d+$/.exec(ref)?.[1];if(!letters)return -1;
  return [...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
}
function cellValue(cell,strings){
  const type=cell.getAttribute('t');
  if(type==='inlineStr')return elems(cell,'t').map(t=>t.textContent||'').join('');
  const value=elems(cell,'v')[0]?.textContent||'';
  return type==='s'?(strings[Number(value)]??''):value;
}
export async function readStudentsXlsx(file){
  if(!/\.xlsx$/i.test(file?.name||''))throw Error('Выберите XLSX-файл.');
  if(file.size>MAX_FILE_SIZE)throw Error('Файл больше 2 МБ.');
  const archive=zipDirectory(await file.arrayBuffer());
  const workbook=xml(await readEntry(archive,'xl/workbook.xml'),'workbook.xml');
  const rels=xml(await readEntry(archive,'xl/_rels/workbook.xml.rels'),'workbook.xml.rels');
  const path=firstSheetName(workbook,rels),sheet=xml(await readEntry(archive,path),path);
  const sxml=await readEntry(archive,'xl/sharedStrings.xml');
  const strings=sxml?elems(xml(sxml,'sharedStrings.xml'),'si').map(si=>elems(si,'t').map(t=>t.textContent||'').join('')):[];
  const rows=[];
  for(const row of elems(sheet,'row')){
    const number=Number(row.getAttribute('r'))||(rows.length+1);
    if(number>2000)throw Error('Слишком много строк.');
    const cells=[];
    for(const cell of elems(row,'c')){const i=column(cell.getAttribute('r')||'');if(i>=0&&i<=40)cells[i]=String(cellValue(cell,strings));}
    rows.push({number,cells});
  }
  return rows;
}
