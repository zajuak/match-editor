import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const argument=(flag,fallback)=>{const index=process.argv.indexOf(flag);return index<0?fallback:process.argv[index+1];};
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)),argument('--dir','src'));
const port=Number(argument('--port',process.env.PORT||'4323'));
const base=`/${argument('--base','/').split('/').filter(Boolean).join('/')}`.replace(/\/?$/,'/');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(base!=='/' && pathname===base.slice(0,-1)){res.writeHead(302,{location:base});res.end();return;}
    if(!pathname.startsWith(base)){res.writeHead(404);res.end('Not found');return;}
    let file=path.resolve(root,pathname.slice(base.length)||'.');
    if(file!==root && !file.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    const content=await readFile(file);
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Match editor: http://127.0.0.1:${port}${base}`));
