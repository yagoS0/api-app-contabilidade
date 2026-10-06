// Geração offline e reproduzível; novas fontes exigem revisão do manifesto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import XLSX from 'xlsx';

const raiz = fileURLToPath(new URL('../../../', import.meta.url));
const pasta = path.join(raiz, 'docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05');
const fontes = JSON.parse(fs.readFileSync(path.join(pasta, 'fontes.json'), 'utf8').replace(/^\uFEFF/, ''));
function ler(nome) {
  const bytes = fs.readFileSync(path.join(pasta, nome));
  const fonte = fontes.find(f => f.file === nome);
  if (!fonte || createHash('sha256').update(bytes).digest('hex') !== fonte.sha256) throw Error(`Fonte alterada: ${nome}`);
  return bytes;
}
const html = gunzipSync(ler('svrs-classificacao.html.gz')).toString('utf8');
const trecho = html.match(/var dadosOriginais\s*=\s*(\[.*?\]);/s);
if (!trecho) throw Error('Tabela SVRS não encontrada');
const dados = JSON.parse(trecho[1]);
const data = v => v?.slice(0, 10) || null;
const csts = dados.map(r => ({ codigo: r.Cst, descricao: r.NomeCst,
  inicio: data(r.DthIniVig), fim: data(r.DthFimVig) }));
const classificacoes = dados.flatMap(r => r.ClassificacoesTributarias.map(c => ({
  codigo: c.CodClassTrib, cst: c.Cst, descricao: c.NomeClassTrib, nfse: c.IndNfse,
  inicio: data(c.DthIniVig), fim: data(c.DthFimVig),
})));
const planilha = XLSX.read(ler('anexo-c-v1.01.xlsx'), { type: 'buffer' });
const operacoes = XLSX.utils.sheet_to_json(planilha.Sheets[planilha.SheetNames[0]], { header: 1 })
  .filter(r => /^[0-9]{6}$/.test(String(r[6] ?? '')))
  .map(r => ({ codigo: String(r[6]), local: r[7] || null }));
for (const [nome, lista, forma] of [['CST', csts, /^\d{3}$/], ['classificações', classificacoes, /^\d{6}$/], ['operações', operacoes, /^\d{6}$/]]) {
  if (!lista.length || lista.some(r => !forma.test(r.codigo)) || new Set(lista.map(r => r.codigo)).size !== lista.length) throw Error(`Extração inválida: ${nome}`);
}
if (classificacoes.some(c => typeof c.nfse !== 'boolean' || !csts.some(s => s.codigo === c.cst))) throw Error('Relação CST/classificação inválida');
const resultado = { consultadoEm: '2026-10-05', contrato: 'DPS 1.01 / Anexo C v1.01', csts, classificacoes, operacoes };
fs.writeFileSync(path.join(raiz, 'apps/api/src/application/fiscal/ibscbs/tabelasRtc.data.js'),
  '// Gerado por apps/api/scripts/gerar-tabelas-rtc.mjs. Não editar manualmente.\nexport const TABELAS_RTC = ' + JSON.stringify(resultado, null, 2) + ';\n');
console.log(`${csts.length} CSTs, ${classificacoes.length} classificações, ${operacoes.length} operações.`);
