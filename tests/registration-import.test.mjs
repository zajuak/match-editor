import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readRegistrationFile,readRegistrationFiles} from '../src/registration-import.mjs';
import {planRegistrationImport} from '../src/registration-plan.mjs';
import {registrationFile,fileFromXML,zip} from './helpers/registration-fixture.mjs';
const dom=new JSDOM(''),options={unzip:zip.unzipSync,Parser:dom.window.DOMParser};
const men='2026年新生杯男子足球赛';

test('Word import recognizes both registration layouts and sends only team and player names',async()=>{
  for(const women of [false,true]){
    const result=await readRegistrationFile(registrationFile({women,names:['甲','Karol','乙']}),men,options);
    assert.deepEqual(result,{fileName:'报名表.docx',teamName:'红队',players:['甲','Karol','乙']});
    assert.ok(!JSON.stringify(result).includes('13800138000'));assert.ok(!JSON.stringify(result).includes('敏感备注'));
  }
  const renamed=await readRegistrationFile(registrationFile({team:'法学院'}),men,options);
  assert.equal(renamed.teamName,'法学');
  assert.deepEqual((await readRegistrationFile(registrationFile({team:'数学',names:['申宇颢']}),men,options)).players,['申宇灏']);
  assert.equal((await readRegistrationFile(registrationFile({team:'法学院'}),'其他赛事',options)).teamName,'法学院');
});

test('Word import rejects ambiguous, duplicate, malformed and unsupported files without partial results',async()=>{
  await assert.rejects(readRegistrationFile(registrationFile({names:['甲','甲']}),men,options),/重复姓名/);
  await assert.rejects(readRegistrationFile(registrationFile({teamLine:'没有球队名称'}),men,options),/球队名称/);
  await assert.rejects(readRegistrationFile(registrationFile({names:['13800138000']}),men,options),/长数字/);
  await assert.rejects(readRegistrationFile(registrationFile({rows:[['姓名','电话'],['甲','13800138000']]}),men,options),/表头/);
  await assert.rejects(readRegistrationFile(fileFromXML('<broken>'),men,options),/损坏/);
  await assert.rejects(readRegistrationFile(fileFromXML('<!DOCTYPE a><a/>'),men,options),/XML/);
  await assert.rejects(readRegistrationFile({...registrationFile(),name:'旧文件.doc'},men,options),/另存为/);
  await assert.rejects(readRegistrationFile({...registrationFile(),size:6*1024*1024},men,options),/5 MB/);
  await assert.rejects(readRegistrationFiles([registrationFile(),registrationFile({names:['乙','乙']})],men,options),/报名表.docx/);
  await assert.rejects(readRegistrationFiles(Array(51).fill(registrationFile()),men,options),/1–50/);
  await assert.rejects(readRegistrationFiles(Array(6).fill({...registrationFile(),size:5*1024*1024}),men,options),/25 MB/);
});

test('import preview preserves identities, defaults to additions and explicitly lists replacement deletions',()=>{
  const tournament={teams:[{id:'t',name:'红队',players:[{id:'a',name:'甲',legacy_key:'old'},{id:'b',name:'乙'}]}]};
  const entries=[{teamId:'t',players:['甲','丙']},{name:'蓝队',players:['丁']}];
  const merge=planRegistrationImport(tournament,entries);
  assert.deepEqual(merge.teams[0].players,[{id:'a',name:'甲',legacy_key:'old'},{id:'b',name:'乙'},{name:'丙'}]);
  assert.deepEqual(merge.counts,{teams:2,newTeams:1,added:2,kept:1,removed:0});
  const replace=planRegistrationImport(tournament,entries,'replace');
  assert.deepEqual(replace.teams[0].removed,[{id:'b',name:'乙'}]);assert.equal(replace.teams[0].players[0].id,'a');
  assert.equal(replace.counts.removed,1);
  assert.throws(()=>planRegistrationImport(tournament,[{teamId:'other',players:['甲']}]),/不属于/);
  assert.throws(()=>planRegistrationImport(tournament,[{name:'红队',players:['甲']}]),/已存在/);
  assert.throws(()=>planRegistrationImport(tournament,[entries[0],entries[0]]),/多份/);
  assert.throws(()=>planRegistrationImport(tournament,[{name:'蓝队',players:['甲','甲']}]),/重复姓名/);
  assert.throws(()=>planRegistrationImport(tournament,[{name:'蓝队',players:[]}]),/1–300/);
  assert.throws(()=>planRegistrationImport(tournament,entries,'oops'),/方式无效/);
});
