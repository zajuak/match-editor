import {createServer} from 'node:http';
import {readFile,realpath,stat,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import worker from '../cloudflare/worker.mjs';
import {normalizeRosterSnapshot} from '../src/rosters.mjs';
import {openDatabase} from './database.mjs';

const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const bodyLimit=2*1024*1024;
const fail=(message,status)=>{throw Object.assign(new Error(message),{status});};
export async function startCampusServer(env=process.env){
  const origin=new URL(env.PUBLIC_ORIGIN||'http://127.0.0.1:8083').origin;
  if(!/^pbkdf2\$[^$]+\$[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_HASH||''))throw new Error('必须配置有效的 ADMIN_PASSWORD_HASH。');
  const directory=path.resolve(env.DATA_DIR||'/var/lib/match-editor');
  await mkdir(directory,{recursive:true,mode:0o700});
  const root=await realpath(env.STATIC_DIR||fileURLToPath(new URL('../campus-dist',import.meta.url)));
  const db=await openDatabase(path.join(directory,'rosters.sqlite'),{seedFile:env.SEED_FILE});
  const config={DB:db,ADMIN_PASSWORD_HASH:env.ADMIN_PASSWORD_HASH,ALLOWED_ORIGIN:origin};
  const server=createServer(async(req,res)=>{
    try{
      if(!req.url.startsWith('/') || req.url.startsWith('//'))fail('请求地址无效。',400);
      const url=new URL(req.url,origin);
      if(url.origin!==origin)fail('请求地址无效。',400);
      if(url.pathname.startsWith('/api/') || url.pathname==='/health'){
        if(Number(req.headers['content-length'])>bodyLimit)fail('请求内容过大。',413);
        const headers=new Headers();
        for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
        // Never trust a client-supplied Cloudflare or forwarded IP for login throttling.
        headers.set('CF-Connecting-IP',req.socket.remoteAddress||'local');
        let size=0;const chunks=[];
        for await(const chunk of req.iterator({destroyOnReturn:false})){
          size+=chunk.length;if(size>bodyLimit)fail('请求内容过大。',413);chunks.push(chunk);
        }
        const body=Buffer.concat(chunks);
        const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method) && body.length?{body}:{})});
        const response=await worker.fetch(request,config);
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(!['GET','HEAD'].includes(req.method))fail('请求方法不支持。',405);
      let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{fail('请求地址无效。',400);}
      if(pathname.includes('\0') || pathname.split('/').some(part=>part.startsWith('.')))fail('文件不存在。',404);
      // The campus default reads only its local database, so new visitors see local edits.
      if(pathname==='/data/default-rosters.json'){
        const response=await worker.fetch(new Request(new URL('/api/rosters',origin)),config);
        if(!response.ok)fail('本地名单暂时不可用。',503);
        const snapshot=normalizeRosterSnapshot(await response.json());
        res.writeHead(200,{'Content-Type':types['.json'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(req.method==='HEAD'?undefined:JSON.stringify(snapshot));return;
      }
      let file=path.resolve(root,`.${pathname}`);
      if(file!==root && !file.startsWith(root+path.sep))fail('文件不存在。',404);
      if((await stat(file)).isDirectory())file=path.join(file,'index.html');
      file=await realpath(file);
      if(!file.startsWith(root+path.sep))fail('文件不存在。',404);
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){
      req.resume();
      const status=error.status||(error.code==='ENOENT'||error.code==='ENOTDIR'?404:500);
      if(status===500)console.error('Campus request failed:',error.message);
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:error.status?error.message:status===404?'文件不存在。':'服务器暂时不可用。'}));
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  server.on('close',()=>db.close());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.PORT||8083),env.HOST||'0.0.0.0',resolve);});}
  catch(error){db.close();throw error;}
  return server;
}

if(process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href===import.meta.url){
  const server=await startCampusServer();
  console.log(`Match editor listening on port ${server.address().port} (independent database)`);
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));});
}
