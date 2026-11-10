export function publicRuntimeConfig(environment=process.env,{required=false}={}){
  const url=environment.MATCH_EDITOR_API_URL||'';
  if(required && !url)throw new Error('构建需要 MATCH_EDITOR_API_URL。');
  if(url){
    let parsed;try{parsed=new URL(url);}catch{throw new Error('MATCH_EDITOR_API_URL 不是有效 URL。');}
    if(parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))))throw new Error('API 地址必须使用 HTTPS；本地开发可使用 HTTP，地址不能包含密钥或查询参数。');
  }
  return {url};
}
export function renderRuntimeConfig(environment=process.env,options){return `export const API_BASE_URL = ${JSON.stringify(publicRuntimeConfig(environment,options).url)};\n`;}
