// Fonte fixa e revisada; atualizar snapshot/hash conscientemente, nunca durante uma consulta.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('../apps/api/src/application/tomador/dados/', import.meta.url);
const bytes = readFileSync(new URL('municipios-tom.csv', base));
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== '60da8e582c1021c4be21cc9b45c4bf791f98f75a40df242b4b2ff4a4121da89b') throw new Error('Snapshot TOM não revisado');
const linhas = bytes.toString('latin1').trim().split(/\r?\n/).slice(1).map(l => l.split(';'));
const mapa = {};
for (const [tom, ibge, nomeTom, nomeIbge, uf, extra] of linhas) {
  if (tom === '9707' && ibge === '0' && nomeTom === 'EXTERIOR' && nomeIbge === '' && uf === 'EX' && extra === undefined) continue;
  if (tom === '9997' && ibge === '5003157' && nomeTom === 'CORONEL SAPUCAIA' && nomeIbge === '' && uf === 'MS' && extra === undefined) continue;
  if (extra !== undefined || !/^\d{1,4}$/.test(tom) || !/^\d{7}$/.test(ibge)
      || !nomeTom || !nomeIbge || !/^[A-Z]{2}$/.test(uf) || mapa[tom]) throw new Error(`Linha TOM inválida: ${tom}`);
  mapa[tom] = [ibge, nomeTom, nomeIbge, uf];
}
writeFileSync(new URL('municipiosTom.data.js', base),
  '// Gerado por scripts/gerar-municipios-tom.mjs. Fonte e limites em municipios-tom.fonte.md.\n'
  + `export default {\n${Object.entries(mapa).map(([k,v]) => `  "${k}": ${JSON.stringify(v)}`).join(',\n')}\n};\n`);
console.log(`${Object.keys(mapa).length} relações TOM/IBGE geradas; SHA256 ${hash}`);
