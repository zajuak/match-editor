import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../scripts/build.mjs';

test('standalone build resolves versioned entrypoints, modules and roster assets',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'match-editor-build-'));
  try{
    const {destination,version}=await build(path.join(temp,'dist'),{environment:{MATCH_EDITOR_API_URL:'https://example.workers.dev',ADMIN_PASSWORD_HASH:'private-hash'},requireConfig:true});
    const html=await readFile(path.join(destination,'index.html'),'utf8');
    assert.ok(html.includes(`./editor.mjs?v=${version}`));assert.ok(html.includes(`./editor.css?v=${version}`));
    for(const file of ['index.html','admin.html','editor.mjs','admin.mjs','admin-api.mjs','rosters.mjs','api-client.mjs','importers.mjs']){
      const content=await readFile(path.join(destination,file),'utf8');
      const references=file==='index.html'?/(?:src=|href=)['"](\.\/[^'"]+)['"]/g:/from ['"](\.\/[^'"]+)['"]/g;
      for(const [,relative] of content.matchAll(references)){
        assert.ok((await stat(path.join(destination,relative.split('?')[0]))).isFile(),relative);
      }
    }
    const runtime=await readFile(path.join(destination,'runtime-config.mjs'),'utf8');
    assert.ok(runtime.includes('https://example.workers.dev'));assert.ok(!runtime.includes('private-hash'));assert.ok(!runtime.includes('service_role'));
    const manifest=JSON.parse(await readFile(path.join(destination,'data/manifest.json'),'utf8'));
    for(const tournament of manifest.tournaments){
      const roster=JSON.parse(await readFile(path.join(destination,'data',tournament.roster),'utf8'));
      assert.ok(roster.length);assert.ok(roster.every(p=>Object.keys(p).sort().join(',')==='name,team'));
    }
    assert.ok(!html.includes('astro'));
  }finally{await rm(temp,{recursive:true,force:true});}
});
