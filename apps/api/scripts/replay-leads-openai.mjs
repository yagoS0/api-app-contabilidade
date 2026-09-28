// Reaplica a lógica atual às interpretações já gravadas. Zero rede/IA/banco.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prepararPreatendimento } from '../src/application/onboarding/preatendimentoComercial.js';
const arquivo = path.resolve(process.argv[2]);
const fonte = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
assert(Array.isArray(fonte.resultados), 'Informe uma avaliação existente.');
const resultados = fonte.resultados.map(c => {
  let anterior = {}; const turnos = [];
  for (const [i, t] of c.turnos.entries()) {
    if (!t.interpretacao) { turnos.push({ entrada: t.entrada, erroOriginal: t.erro }); break; }
    const r = prepararPreatendimento({ texto: t.entrada, intencao: anterior.intencao || t.interpretacao.intencao || 'ABERTURA', anterior, mensagemId: `${c.id}-${i}`, interpretacaoIa: t.interpretacao });
    anterior = r.pre;
    turnos.push({ entrada: t.entrada, interpretacaoOriginal: t.interpretacao, resumo: r.pre, encaminhar: r.encaminhar, revisaoIdentidade: Boolean(r.leitura.revisaoIdentidade) });
    if (r.encaminhar && i < c.turnos.length - 1) break;
  }
  return { id: c.id, repeticao: c.repeticao, aprovadoModeloOriginal: c.passou, erroOriginal: c.erro, turnos };
});
const saida = path.join(path.dirname(arquivo), 'replay-aplicacao.json');
const hash = crypto.createHash('sha256').update(fs.readFileSync(new URL('../src/application/onboarding/preatendimentoComercial.js', import.meta.url))).digest('hex');
fs.writeFileSync(saida, JSON.stringify({ origem: arquivo, codigoHash: hash, chamadasExternas: 0, resultados }, null, 2));
console.log(JSON.stringify({ evidencia: saida, execucoes: resultados.length, chamadasExternas: 0,
  pedidosIdentidadeEncaminhados: resultados.filter(r => r.turnos.some(t => t.revisaoIdentidade && t.encaminhar)).length }));
