import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './runtime-config.mjs';
let client;
export function supabaseClient() {
  if(client)return client;
  if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)throw new Error('尚未配置共享名单服务。');
  if(!globalThis.supabase?.createClient)throw new Error('共享名单组件未能加载。');
  client=globalThis.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  return client;
}
