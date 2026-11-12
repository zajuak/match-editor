import {wordDocument,registrationTableToRecords} from './importers.mjs';
import {normalizeRosterRecord} from './core.mjs';

// Only allowlisted name columns leave the browser; document metadata is never sent.
export async function readRegistrationFile(file,tournament,{unzip=globalThis.fflate?.unzipSync,Parser=globalThis.DOMParser}={}){
  if(!/\.docx$/i.test(file.name))throw new Error('请选择 .docx 报名表；旧版 .doc 请先另存为 .docx。');
  if(file.size>5*1024*1024)throw new Error('单份报名表不能超过 5 MB。');
  if(!unzip)throw new Error('Word 解析组件未加载，请刷新页面重试。');
  let files;
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length>5*1024*1024)throw new Error();
    files=unzip(bytes,{filter:entry=>entry.name==='word/document.xml' && entry.originalSize<=10*1024*1024});
  }catch{throw new Error('无法读取 Word 文档，请检查文件是否损坏或加密。');}
  const xml=files['word/document.xml'];
  if(!xml || xml.length>10*1024*1024)throw new Error('不是有效的 .docx 文档，或文档内容超过 10 MB。');
  const {tables,paragraphs}=wordDocument(new TextDecoder().decode(xml),{Parser});
  const candidates=paragraphs.map(text=>text.match(/球队\s*[:：]\s*(.*?)\s*(?:球衣颜色\s*[:：]|$)/)?.[1]?.trim()).filter(Boolean);
  const teamNames=[...new Set(candidates)];
  if(teamNames.length!==1)throw new Error('未能确定唯一球队名称，请在表格外填写“球队：球队名”。');
  const recognized=tables.filter(rows=>{
    const headers=rows[0]?.map(value=>String(value).replace(/\s/g,''))||[];
    return (headers.length===10 && headers[0]==='姓名' && headers[5]==='姓名') || (headers.length===6 && headers[0]==='序号' && headers[1]==='球员姓名');
  });
  if(recognized.length!==1)throw new Error('应包含一张男足双栏或女足单栏名单表，请检查表头。');
  const records=registrationTableToRecords(recognized[0],{tournament,team:teamNames[0]});
  if(records.some(p=>/\d{7,}|[\u0000-\u001f\u007f]/.test(p.name)))throw new Error('姓名列含长数字或控制字符，请检查报名表。');
  const normalized=normalizeRosterRecord({tournament,team:teamNames[0],name:''});
  return {fileName:file.name,teamName:normalized.team,players:records.map(p=>p.name)};
}

export async function readRegistrationFiles(files,tournament,options){
  const list=Array.from(files);
  if(!list.length || list.length>50)throw new Error('每次请选择 1–50 份报名表。');
  if(list.reduce((sum,file)=>sum+file.size,0)>25*1024*1024)throw new Error('本次文件总大小不能超过 25 MB。');
  const results=[];
  for(const file of list){
    try{results.push(await readRegistrationFile(file,tournament,options));}
    catch(error){throw new Error(`${file.name}：${error.message}`);}
  }
  return results;
}
