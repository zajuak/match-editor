export function publicRuntimeConfig(environment=process.env,{required=false}={}) {
  const url=environment.SUPABASE_URL||'',key=environment.SUPABASE_PUBLISHABLE_KEY||'';
  if(required && (!url || !key))throw new Error('构建需要 SUPABASE_URL 和 SUPABASE_PUBLISHABLE_KEY。');
  if(url){
    let parsed;try{parsed=new URL(url);}catch{throw new Error('SUPABASE_URL 不是有效 URL。');}
    if(!['http:','https:'].includes(parsed.protocol))throw new Error('SUPABASE_URL 必须使用 HTTP 或 HTTPS。');
  }
  if(key.startsWith('sb_secret_') || key.includes('service_role') || (environment.SUPABASE_SERVICE_ROLE_KEY && key===environment.SUPABASE_SERVICE_ROLE_KEY))throw new Error('公开配置不能包含 service role 密钥。');
  if(key.split('.').length===3){
    let payload;try{payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));}catch{throw new Error('公开配置包含无效的 JWT 密钥。');}
    if(payload.role!=='anon')throw new Error('公开配置只允许 publishable 或 anon 密钥，不能包含 service role 或用户令牌。');
  }
  return {url,key};
}
export function renderRuntimeConfig(environment=process.env,options) {
  const {url,key}=publicRuntimeConfig(environment,options);
  return `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(key)};\n`;
}
