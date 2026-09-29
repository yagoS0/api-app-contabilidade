// Uso: node scripts/gerar-catalogos-ibscbs.mjs SVRS.html ANEXO_C.xlsx 2026-09-28
// Entrada pública preservada pelo operador. Não executa scripts da página.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import xlsx from 'xlsx';
const [htmlPath, anexoPath, data] = process.argv.slice(2);
if (!htmlPath || !anexoPath || !/^\d{4}-\d{2}-\d{2}$/.test(data ?? '')) throw new Error('Informe HTML SVRS, XLSX Anexo C e data da consulta (AAAA-MM-DD).');
const html = fs.readFileSync(htmlPath,'utf8');
const raw = html.match(/var dadosOriginais = (\[[\s\S]*?\]);/)?.[1];
if (!raw) throw new Error('Formato da página SVRS mudou; revisar o importador.');
const linhas = JSON.parse(raw);
const anexo = fs.readFileSync(anexoPath);
const wb = xlsx.read(anexo,{type:'buffer'});
const operacoes = xlsx.utils.sheet_to_json(wb.Sheets.IndOp,{header:1})
  .filter(r=>/^\d{6}$/.test(String(r[6]))).map(r=>({codigo:String(r[6]),localFornecimento:r[7]??null}));
const classificacoes = linhas.flatMap(c=>c.ClassificacoesTributarias.map(({CstNavigation,Anexos,AnexoNew,TexRegCbs,TexRegIbs,...t})=>t));
if (!linhas.length || !operacoes.length || !classificacoes.length || new Set(classificacoes.map(c=>c.CodClassTrib)).size !== classificacoes.length) throw new Error('Catálogo vazio ou com classificações duplicadas; revisão obrigatória.');
const hash = v => createHash('sha256').update(v).digest('hex');
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/application/fiscal/ibscbs');
const escrever = (nome,dados) => fs.writeFileSync(path.join(dir,`${nome}.data.js`),'// Fonte oficial e hash registrados no próprio catálogo. Não editar manualmente.\nexport default '+JSON.stringify(dados,null,2)+'\n;\n');
escrever('classificacaoTributaria',{versao:`svrs-${data.replaceAll('-','')}`,consultadoEm:data,
  fonte:'https://dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria',sha256:hash(raw),
  csts:linhas.map(({ClassificacoesTributarias,...c})=>c),classificacoes});
escrever('indicadoresOperacao',{versao:'anexo-c-v1.01',consultadoEm:data,
  fonte:'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo-c-indop-ibscbs-snnfse-v1-01.xlsx',sha256:hash(anexo),operacoes});
console.log(JSON.stringify({csts:linhas.length,classificacoes:classificacoes.length,operacoes:operacoes.length}));
