import fs from 'node:fs';
import { conferirFontesNovembro2026 } from '../src/application/nfse/laboratorio/conferirFontesNovembro2026.js';
import { criarClienteRfbCnpj } from '../src/application/nfse/rfbCnpjClient.js';
const [entrada,saida,opcao,fonte = '--fonte=publica',...extras] = process.argv.slice(2);
try {
  if (!entrada || !saida || opcao !== '--consultar-cadastros' || !['--fonte=publica','--fonte=serpro'].includes(fonte) || extras.length) throw Error('Uso: node conferir-dps-nt009-fontes.mjs entrada.json resultado.json --consultar-cadastros [--fonte=publica|--fonte=serpro]');
  if (fs.existsSync(saida)) throw Error('Arquivo de saída já existe.');
  const dependencias = fonte === '--fonte=serpro' ? { cadastroCnpj: criarClienteRfbCnpj({ consumerKey: process.env.NFSE_RFB_CNPJ_CONSUMER_KEY, consumerSecret: process.env.NFSE_RFB_CNPJ_CONSUMER_SECRET }) } : {};
  const resultado = await conferirFontesNovembro2026(JSON.parse(fs.readFileSync(entrada,'utf8').replace(/^\uFEFF/,'')),dependencias);
  fs.writeFileSync(saida,JSON.stringify(resultado,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log('Conferência gravada. Dados atuais não comprovam vigência histórica; emissão bloqueada.');
} catch (e) {
  console.error(e.code || 'CONFERENCIA_NAO_CONCLUIDA'); process.exitCode = 1;
}
