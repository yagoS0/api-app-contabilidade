import { verificarConexaoOpenAI } from '../src/application/assistente/VerificacaoOpenAI.js';
import { carregarAmbienteOpenAI } from './lib/ambienteOpenAI.mjs';
try {
  const args = carregarAmbienteOpenAI(process.argv.slice(2));
  if (args.some(a => a !== '--live' && !a.startsWith('--max-usd='))) throw Error('Use --env-file=CAMINHO, --live e --max-usd=VALOR. A chave nunca é um argumento.');
  const r = await verificarConexaoOpenAI({ env: process.env, live: args.includes('--live'), maxUsd: args.find(a => a.startsWith('--max-usd='))?.slice(10) });
  console.log(JSON.stringify(r, null, 2));
  if (r.ok === false) process.exitCode = 1;
} catch {
  console.error('Não foi possível ler a configuração. Confira o arquivo e os argumentos; não informe a chave na linha de comando.');
  process.exitCode = 1;
}
