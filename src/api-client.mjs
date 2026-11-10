import {API_BASE_URL} from './runtime-config.mjs';
const storageKey='match-editor-admin-session-v1';
export class RosterClient {
  constructor(baseURL,{storage,fetcher=globalThis.fetch}={}){
    if(!baseURL)throw new Error('尚未配置共享名单服务。');
    // Native browser fetch requires the global receiver, even when stored on a client.
    this.baseURL=baseURL.replace(/\/$/,'');this.storage=storage;this.fetcher=fetcher.bind(globalThis);this.revision=null;this.listeners=new Set();
    if(storage===undefined){try{this.storage=globalThis.sessionStorage;}catch{this.storage=null;}}
    try{this.token=this.storage?.getItem(storageKey)||'';}catch{this.token='';}
  }
  onSessionChange(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  setToken(token){this.token=token;try{if(token)this.storage?.setItem(storageKey,token);else this.storage?.removeItem(storageKey);}catch{}if(!token)for(const listener of this.listeners)listener(null);}
  async request(path,{method='GET',body,write=false}={}){
    const headers={};if(this.token)headers.Authorization=`Bearer ${this.token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    if(write){if(!Number.isSafeInteger(this.revision))await this.getRosters();headers['If-Match']=String(this.revision);}
    // Avoid AbortSignal.timeout(), which is unavailable in some otherwise supported browsers.
    const controller=typeof globalThis.AbortController==='function'?new globalThis.AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),20000):null;
    let response,data;
    try{
      try{response=await this.fetcher(this.baseURL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:controller?.signal});}
      catch(cause){throw new Error(controller?.signal.aborted?'连接名单服务超时，请稍后重试。':'无法连接共享名单服务，请检查网络后重试。',{cause});}
      try{data=await response.json();if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('Invalid API response');}
      catch(cause){throw new Error(controller?.signal.aborted?'连接名单服务超时，请稍后重试。':'共享名单服务返回了无效内容。',{cause});}
    }finally{if(timer!==null)clearTimeout(timer);}
    if(!response.ok){if(response.status===401)this.setToken('');const error=new Error(data.error||'操作失败，请稍后重试。');error.status=response.status;throw error;}
    if(Number.isSafeInteger(data.revision))this.revision=data.revision;
    return data;
  }
  async getRosters(){return this.request('/api/rosters');}
  async getSession(){const data=await this.request('/api/session');if(!data.authenticated){this.setToken('');return null;}return {user:data.user};}
  async login(password){const data=await this.request('/api/login',{method:'POST',body:{password}});this.setToken(data.token);return {user:data.user};}
  async logout(){await this.request('/api/logout',{method:'POST'});this.setToken('');}
}
let instance;
export function rosterClient(){return instance||(instance=new RosterClient(API_BASE_URL));}
