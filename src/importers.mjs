import {validateRecords,normalizeRosterRecord} from './core.mjs';
const WORD='http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wordDocument(xml) {
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('Word 文档内容损坏，无法读取。');
  const paragraphText=p=>[...p.getElementsByTagNameNS(WORD,'t')].map(t=>t.textContent).join('').trim();
  const tables=[...doc.getElementsByTagNameNS(WORD,'tbl')].map(table=>[...table.children].filter(n=>n.localName==='tr').map(row=>[...row.children].filter(n=>n.localName==='tc').flatMap(cell=>{
    const value=[...cell.getElementsByTagNameNS(WORD,'p')].map(paragraphText).join(' ').trim();
    const span=Number(cell.getElementsByTagNameNS(WORD,'gridSpan')[0]?.getAttributeNS(WORD,'val')||1);
    return [value,...Array(Math.max(0,Math.min(span,100)-1)).fill('')];
  })));
  return {tables,paragraphs:[...doc.getElementsByTagNameNS(WORD,'p')].map(paragraphText)};
}

export function registrationTableToRecords(rows,{tournament,team}) {
  const headers=rows[0]?.map(value=>String(value).replace(/\s/g,''))||[];
  const columns=headers.length===10 && headers[0]==='姓名' && headers[5]==='姓名'?[0,5]:headers.length===6 && headers[0]==='序号' && headers[1]==='球员姓名'?[1]:null;
  if(!columns)throw new Error('名单表格应为左右双栏报名表，或含“序号、球员姓名”的六列表格。');
  const records=rows.slice(1).flatMap((row,index)=>columns.flatMap(column=>{
    const name=String(row[column]??'').trim();
    return name?[normalizeRosterRecord({tournament,team,name,number:'',sourceRow:index+2})]:[];
  }));
  if(!records.length)throw new Error('名单表格中没有球员。');
  validateRecords(records);
  return records;
}

async function loadTournament(tournament,manifestUrl) {
  if(tournament.roster){
    const response=await fetch(new URL(tournament.roster,manifestUrl),{cache:'no-cache'});
    if(!response.ok)throw new Error(`${tournament.name} 名单加载失败（${response.status}）。`);
    const data=await response.json();
    if(!Array.isArray(data) || !data.length)throw new Error(`${tournament.name} 名单为空或格式不正确。`);
    const records=data.map(r=>normalizeRosterRecord({tournament:tournament.name,team:r.team,name:r.name,number:''}));
    validateRecords(records);return records;
  }
  const records=[],teams=new Set();
  for(const file of tournament.files){
    try{
      const response=await fetch(new URL(`${tournament.directory}${file}`,manifestUrl),{cache:'no-cache'});
      if(!response.ok)throw new Error(`下载失败（${response.status}）。`);
      const data=new Uint8Array(await response.arrayBuffer());
      if(data.byteLength>5*1024*1024)throw new Error('文件超过 5 MB。');
      if(!globalThis.fflate)throw new Error('Word 解析组件未能加载。');
      const files=globalThis.fflate.unzipSync(data,{filter:entry=>entry.name==='word/document.xml' && entry.originalSize<10*1024*1024});
      if(!files['word/document.xml'])throw new Error('不是有效的 .docx 文档，或文档内容过大。');
      const {tables,paragraphs}=wordDocument(new TextDecoder().decode(files['word/document.xml']));
      const teamLine=paragraphs.find(text=>text.includes('球队：'))||'';
      const team=teamLine.match(/球队：\s*(.*?)\s*(?:球衣颜色：|$)/)?.[1]?.trim();
      if(!team)throw new Error('未找到表外球队名称。');
      if(teams.has(team))throw new Error(`球队“${team}”重复。`);
      teams.add(team);
      if(tables.length!==1)throw new Error('每份报名表应恰好包含一张名单表格。');
      records.push(...registrationTableToRecords(tables[0],{tournament:tournament.name,team}));
    }catch(error){throw new Error(`${tournament.name} / ${file}：${error.message}`);}
  }
  return records;
}

export async function loadOfficialData(manifestUrl) {
  const response=await fetch(manifestUrl,{cache:'no-cache'});
  if(!response.ok)throw new Error(`官方名单清单加载失败（${response.status}）。`);
  const manifest=await response.json();
  if(manifest.version!==1 || !Array.isArray(manifest.tournaments) || !manifest.tournaments.length)throw new Error('官方名单清单格式不正确。');
  for(const tournament of manifest.tournaments)if(!tournament.name || !(tournament.roster || (tournament.directory && Array.isArray(tournament.files) && tournament.files.length)))throw new Error('官方名单清单缺少赛事或名单文件。');
  const records=(await Promise.all(manifest.tournaments.map(tournament=>loadTournament(tournament,manifestUrl)))).flat();
  validateRecords(records);
  return {records,tournaments:manifest.tournaments.map(({name,lineups})=>({name,lineups:lineups!==false}))};
}

export async function loadOfficialRosters(manifestUrl) {
  return (await loadOfficialData(manifestUrl)).records;
}
