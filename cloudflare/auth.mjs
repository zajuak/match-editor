const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function passwordHash(password,salt=crypto.randomUUID()){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$${salt}$${hex(bits)}`;
}
export async function checkPassword(password,hash){
  if(typeof password!=='string' || password.length>200 || !/^pbkdf2\$[^$]+\$[a-f0-9]{64}$/.test(hash||''))return false;
  const actual=await passwordHash(password,hash.split('$')[1]);
  let difference=actual.length^hash.length;for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^hash.charCodeAt(i);
  return difference===0;
}
export async function sessionFor(request,env){
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token || !env.ADMIN_PASSWORD_HASH)return null;
  const hash=await digest(token),row=await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND password_version=? AND expires_at>?').bind(hash,await digest(env.ADMIN_PASSWORD_HASH),Date.now()).first();
  return row?{tokenHash:hash,user:{id:'admin',name:'管理员'}}:null;
}
export async function login(request,env,password){
  if(!env.ADMIN_PASSWORD_HASH)throw Object.assign(new Error('管理员登录尚未配置。'),{status:503});
  const now=Date.now(),reset=now+15*60*1000,key=await digest(request.headers.get('CF-Connecting-IP')||'local');
  const attempt=await env.DB.prepare('INSERT INTO login_attempts(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts').bind(key,reset,now,now,reset).first();
  if(attempt.attempts>8)throw Object.assign(new Error('登录尝试过多，请 15 分钟后重试。'),{status:429});
  if(!await checkPassword(password,env.ADMIN_PASSWORD_HASH))throw Object.assign(new Error('管理员密码不正确。'),{status:401});
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),expiresAt=now+8*60*60*1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE reset_at<=?').bind(now),
    env.DB.prepare('INSERT INTO admin_sessions(token_hash,password_version,expires_at) VALUES(?,?,?)').bind(await digest(token),await digest(env.ADMIN_PASSWORD_HASH),expiresAt)
  ]);
  return {authenticated:true,token,expiresAt,user:{id:'admin',name:'管理员'}};
}
