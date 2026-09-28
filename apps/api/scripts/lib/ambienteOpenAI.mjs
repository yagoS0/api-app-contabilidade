import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Só arquivo explicitamente indicado. Não importar config.js, banco nem serviços do app.
export function carregarAmbienteOpenAI(args, env = process.env) {
  const arquivos = args.filter(a => a.startsWith('--env-file='));
  if (arquivos.length > 1) throw Error('Informe apenas um --env-file.');
  if (arquivos.length) {
    const nome = arquivos[0].slice('--env-file='.length);
    if (!nome || !fs.existsSync(path.resolve(nome))) throw Error('Arquivo de ambiente não encontrado.');
    const dados = dotenv.parse(fs.readFileSync(path.resolve(nome)));
    for (const k of ['OPENAI_API_KEY', 'IA_LEADS_OPENAI', 'WHATSAPP_COLETA_COMERCIAL', 'IA_LEADS_TELEFONES_PILOTO', 'IA_LEADS_CANAIS_PILOTO', 'IA_LEADS_TETO_TOTAL_CENTAVOS']) {
      if (env[k] === undefined && dados[k] !== undefined) env[k] = dados[k];
    }
  }
  return args.filter(a => !a.startsWith('--env-file='));
}
