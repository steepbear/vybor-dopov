// Small local-only XLSX writer for freshly issued student credentials.
// No CDN and no network requests: all XLSX bytes are generated in the browser.
const utf8=new TextEncoder();
const xmlEscape=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const xmlHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const mainNs='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkgNs='http://schemas.openxmlformats.org/package/2006/relationships';
const contentNs='http://schemas.openxmlformats.org/package/2006/content-types';

const crcTable=Array.from({length:256},(_,index)=>{
 let c=index;
 for(let bit=0;bit<8;bit++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;
 return c>>>0;
});
function crc32(bytes){
 let c=0xFFFFFFFF;
 for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);
 return (c^0xFFFFFFFF)>>>0;
}
function packZip(entries){
 const chunks=[];const central=[];let offset=0;
 const add=bytes=>{chunks.push(bytes);offset+=bytes.length;};
 for(const [name,content] of entries){
  const nameBytes=utf8.encode(name),body=utf8.encode(content);
  const crc=crc32(body),localOffset=offset;
  const header=new Uint8Array(30+nameBytes.length),dv=new DataView(header.buffer);
  dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0x0800,true);
  dv.setUint16(8,0,true);dv.setUint32(14,crc,true);
  dv.setUint32(18,body.length,true);dv.setUint32(22,body.length,true);dv.setUint16(26,nameBytes.length,true);
  header.set(nameBytes,30);add(header);add(body);
  const record=new Uint8Array(46+nameBytes.length),cdv=new DataView(record.buffer);
  cdv.setUint32(0,0x02014b50,true);cdv.setUint16(4,20,true);cdv.setUint16(6,20,true);
  cdv.setUint16(8,0x0800,true);cdv.setUint16(10,0,true);
  cdv.setUint32(16,crc,true);cdv.setUint32(20,body.length,true);cdv.setUint32(24,body.length,true);
  cdv.setUint16(28,nameBytes.length,true);cdv.setUint32(42,localOffset,true);
  record.set(nameBytes,46);central.push(record);
 }
 const directoryStart=offset;
 for(const record of central)add(record);
 const end=new Uint8Array(22),edv=new DataView(end.buffer);
 edv.setUint32(0,0x06054b50,true);edv.setUint16(8,entries.length,true);
 edv.setUint16(10,entries.length,true);
 edv.setUint32(12,offset-directoryStart,true);edv.setUint32(16,directoryStart,true);
 add(end);
 return new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function makeSheet(data){
 const widths=[8,12,20,19,35,23,18];
 const cols=widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
 const cell=(value,col,row,header)=>{
  const letter=String.fromCharCode(65+col);
  return '<c r="'+letter+row+'" t="inlineStr"'+(header?' s="1"':'')+'><is><t xml:space="preserve">'+xmlEscape(value)+'</t></is></c>';
 };
 const rows=data.map((values,index)=>'<row r="'+(index+1)+'">'+values.map((value,col)=>cell(value,col,index+1,index===0)).join('')+'</row>').join('');
 const last=data.length;
 return xmlHeader+'<worksheet xmlns="'+mainNs+'"><dimension ref="A1:G'+last+'"/>'+
  '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
  '<sheetFormatPr defaultRowHeight="17"/><cols>'+cols+'</cols><sheetData>'+rows+
  '</sheetData><autoFilter ref="A1:G'+last+'"/></worksheet>';
}
const styles=xmlHeader+'<styleSheet xmlns="'+mainNs+'">'+
 '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'+
 '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'+
 '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
 '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
 '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'+
 '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
function buildWorkbook(data){
 const types=xmlHeader+'<Types xmlns="'+contentNs+'">'+
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
  '<Default Extension="xml" ContentType="application/xml"/>'+
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
 const rels=xmlHeader+'<Relationships xmlns="'+pkgNs+'"><Relationship Id="rId1" Type="'+relNs+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 const workbook=xmlHeader+'<workbook xmlns="'+mainNs+'" xmlns:r="'+relNs+'"><sheets><sheet name="Учётные записи" sheetId="1" r:id="rId1"/></sheets></workbook>';
 const workbookRels=xmlHeader+'<Relationships xmlns="'+pkgNs+'">'+
  '<Relationship Id="rId1" Type="'+relNs+'/worksheet" Target="worksheets/sheet1.xml"/>'+
  '<Relationship Id="rId2" Type="'+relNs+'/styles" Target="styles.xml"/></Relationships>';
 return packZip([
  ['[Content_Types].xml',types],['_rels/.rels',rels],
  ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',workbookRels],
  ['xl/worksheets/sheet1.xml',makeSheet(data)],['xl/styles.xml',styles]
 ]);
}
export function downloadCreatedStudentsXlsx(students,filename){
 if(!Array.isArray(students)||!students.length)throw Error('Нет созданных учётных записей для выгрузки.');
 const table=[['№','Класс','Фамилия','Имя','Полное имя','Логин','Пароль']];
 for(let i=0;i<students.length;i++){
  const s=students[i];
  if(!s.login||!s.password)throw Error('В одной из строк отсутствует логин или пароль.');
  table.push([String(i+1),s.className,String(s.surname||''),String(s.name||''),[s.surname,s.name].filter(Boolean).join(' '),s.login,s.password]);
 }
 const file=buildWorkbook(table);
 const url=URL.createObjectURL(file);
 const link=document.createElement('a');
 link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),5000);
 return students.length;
}
