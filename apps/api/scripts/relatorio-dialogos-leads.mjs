import fs from 'node:fs';
import path from 'node:path';
import { metricasDialogos } from './lib/metricasDialogos.mjs';
const arquivo = path.resolve(process.argv[2]);
const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const metricas = metricasDialogos(dados.resultados, dados.modelo);
const dir = path.dirname(arquivo);
fs.writeFileSync(path.join(dir, 'metricas.json'), JSON.stringify({ origem: arquivo, modelo: dados.modelo, esforco: dados.esforco, ...metricas }, null, 2));
const linhas = ['# Conversas fictícias do laboratório', '', 'Linguagem realista; nenhuma mensagem pertence a cliente real. As respostas abaixo foram produzidas pelo fluxo do app e capturadas sem envio por WhatsApp.', ''];
for (const c of dados.resultados.filter(r => r.repeticao === 1)) {
  linhas.push(`## ${c.id} — ${c.passou ? 'aprovado' : 'pendente'}`, '', `Consumo estimado: US$ ${c.custoUsd.toFixed(6)}; ${c.chamadas} chamadas.`, '');
  for (const t of c.turnos) {
    linhas.push(`**Pessoa:** ${t.tipo === 'text' ? t.entrada : '[anexo fictício]'}`, '');
    for (const saida of t.saida) linhas.push(`**Altan:** ${saida}`, '');
  }
  if (c.falhas.length) linhas.push(`Falhas: ${c.falhas.join('; ')}`, '');
}
fs.writeFileSync(path.join(dir, 'conversas.md'), linhas.join('\n'));
console.log(JSON.stringify(metricas, null, 2));
