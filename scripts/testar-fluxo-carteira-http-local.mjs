import assert from 'node:assert/strict';
const database = new URL(process.env.DATABASE_URL);
assert(database.hostname === '127.0.0.1' && database.port === '5433' && database.pathname === '/contabilidade_dev');
const base = 'http://127.0.0.1:3000';
const login = await fetch(`${base}/auth/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL || 'admin@contabilidade.local',password:process.env.ADMIN_PASSWORD})});
assert.equal(login.status,200,'Login local');
const session = await login.json();
const headers = {Authorization:`Bearer ${session.accessToken}`};
async function get(path) { const r=await fetch(`${base}${path}`,{headers}); assert.equal(r.status,200,path); return r.json(); }
const list=await get('/firm/companies?competencia=2026-09');
assert(Array.isArray(list.data));
for(const c of list.data) assert(c.fluxoCarteira?.status?.chave && Array.isArray(c.fluxoCarteira.tarefas));
if(list.data.length) {
  const detail=await get(`/firm/companies/${list.data[0].companyId}/fluxo-carteira?competencia=2026-09`);
  assert.equal(detail.fluxo.status.chave,list.data[0].fluxoCarteira.status.chave);
}
const agenda=await get('/firm/agenda/carteira?inicio=2026-10-01&fim=2026-10-31');assert(Array.isArray(agenda.itens));
console.log(`PASS HTTP local: login, ${list.data.length} empresas com fluxo, detalhe consistente e agenda. Somente leituras locais.`);
