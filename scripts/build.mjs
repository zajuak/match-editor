import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {renderRuntimeConfig} from './runtime-config.mjs';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export async function build(destination=path.join(projectRoot,'dist'),{environment=process.env,requireConfig=false}={}){
  const source=path.join(projectRoot,'src'),runtimeConfig=renderRuntimeConfig(environment,{required:requireConfig});
  const files=(await readdir(source)).filter(name=>/\.(mjs|css|html)$/.test(name)).sort();
  const hash=createHash('sha256').update(runtimeConfig).update(await readFile(path.join(source,'data/default-rosters.json')));
  for(const file of files)hash.update(file).update(await readFile(path.join(source,file)));
  const version=hash.digest('hex').slice(0,12);
  await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
  await cp(source,destination,{recursive:true});
  await writeFile(path.join(destination,'runtime-config.mjs'),runtimeConfig);
  for(const file of files){
    const target=path.join(destination,file);
    const content=(await readFile(target,'utf8')).replace(/(['"])(\.\/[a-z0-9-]+\.(?:mjs|css))\1/gi,(_,quote,url)=>`${quote}${url}?v=${version}${quote}`);
    await writeFile(target,content);
  }
  await writeFile(path.join(destination,'.nojekyll'),'');
  return {destination,version};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await build(undefined,{requireConfig:true});console.log(`Built ${result.destination} (assets ${result.version})`);
}
