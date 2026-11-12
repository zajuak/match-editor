import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const sandbox={self:{},Uint8Array,Uint16Array,Uint32Array,Int32Array,TextEncoder,TextDecoder};
runInNewContext(await readFile(new URL('../../src/vendor/fflate.min.js',import.meta.url),'utf8'),sandbox);
export const zip=sandbox.self.fflate;
const escape=value=>String(value).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const paragraph=value=>`<w:p><w:r><w:t>${escape(value)}</w:t></w:r></w:p>`;
export function registrationFile({team='红队',names=['甲','乙'],women=false,fileName='报名表.docx',rows,teamLine}={}){
  const headers=women?['序号','球员姓名','球员身份','是否登场','球员号码','备注']:['姓名','球员身份','备注','是否首发','号码','姓名','球员身份','备注','是否首发','号码'];
  const data=rows||[headers,...(women?names.map((n,i)=>[String(i+1),n,'球员','','','敏感备注 13800138000']):Array.from({length:Math.ceil(names.length/2)},(_,i)=>[names[i*2],'球员','敏感备注','','99',names[i*2+1]||'','球员','','','1']))];
  const xml=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(teamLine??`球队：${team} 球衣颜色：红色`)}${paragraph('领队：测试领队 电话：13800138000')}<w:tbl>${data.map(row=>`<w:tr>${row.map(value=>`<w:tc>${paragraph(value)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl></w:body></w:document>`;
  return fileFromXML(xml,fileName);
}
export function fileFromXML(xml,fileName='报名表.docx'){
  const bytes=zip.zipSync({'word/document.xml':new TextEncoder().encode(xml)});
  return {name:fileName,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
