import { assertDisposablePostgres } from '../disposablePostgresGuard.js';
const raw='postgresql://usability_test@127.0.0.1:55490/usability_governance_test';
const env={NODE_ENV:'test',CI:'true',GITHUB_ACTIONS:'true',GITHUB_JOB:'usability-regression'};
const actual={name:'usability_governance_test',username:'usability_test',port:5432,versionNumber:'150014',address:'172.18.0.2'};
test('accepts only the explicit existing CI Docker service identity',()=>{
 expect(()=>assertDisposablePostgres({raw,env,actual})).not.toThrow();
});
test.each(['127.0.0.1','::1','::ffff:127.0.0.1'])('preserves local loopback guard: %s',address=>{
 expect(()=>assertDisposablePostgres({raw:'postgresql://altan_test@127.0.0.1:54661/altan_rotinas_governance_test',env:{NODE_ENV:'test'},actual:{name:'altan_rotinas_governance_test',username:'altan_test',address}})).not.toThrow();
});
test.each([
 ['CI',undefined],['CI','false'],['GITHUB_ACTIONS',undefined],['GITHUB_ACTIONS','false'],['GITHUB_JOB','other'],['NODE_ENV','production'],
])('rejects Docker when environment %s is %s',(key,value)=>{
 expect(()=>assertDisposablePostgres({raw,actual,env:{...env,[key]:value}})).toThrow();
});
test.each([
 ['name','production'],['username','postgres'],['port',55490],['versionNumber','160001'],['address','172.18.0.3'],['address','172.19.0.2'],['address','10.0.0.2'],['address','192.168.1.2'],['address','8.8.8.8'],['address','::ffff:172.18.0.2'],['address',null],
])('rejects changed server %s',(key,value)=>{
 expect(()=>assertDisposablePostgres({raw,env,actual:{...actual,[key]:value}})).toThrow();
});
test.each([
 raw.replace('127.0.0.1','172.18.0.2'),raw.replace('127.0.0.1','localhost'),raw.replace('55490','5432'),raw.replace('usability_test@','postgres@'),raw.replace('/usability_governance_test','/other_governance_test'),raw+'?host=other',raw+'#fragment','invalid',undefined,
])('rejects changed CI connection %s',connection=>{
 expect(()=>assertDisposablePostgres({raw:connection,env,actual})).toThrow();
});
test('loopback also requires disposable name and exact returned database',()=>{
 expect(()=>assertDisposablePostgres({raw:raw.replace('/usability_governance_test','/production'),env:{NODE_ENV:'test'},actual:{...actual,address:'127.0.0.1',name:'production'}})).toThrow();
 expect(()=>assertDisposablePostgres({raw,env:{NODE_ENV:'test'},actual:{...actual,address:'127.0.0.1',name:'different_governance_test'}})).toThrow();
});
