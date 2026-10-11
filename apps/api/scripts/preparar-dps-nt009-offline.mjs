import fs from 'node:fs';
import { prepararDpsNovembro2026Offline } from '../src/application/nfse/laboratorio/dpsNovembro2026.js';
const [entrada,saida,...extras]=process.argv.slice(2);
try {
 if(!entrada||!saida||extras.length) throw Error('Uso: node preparar-dps-nt009-offline.mjs entrada.json resultado.json');
 const resultado=prepararDpsNovembro2026Offline(JSON.parse(fs.readFileSync(entrada,'utf8').replace(/^\uFEFF/,'')));
 fs.writeFileSync(saida,JSON.stringify(resultado,null,2)+'\n',{encoding:'utf8',flag:'wx'});
 console.log('XML preparado localmente; emissão bloqueada, sem assinatura ou transmissão.');
} catch(e){console.error(`${e.code||'PREPARACAO_INVALIDA'}: ${e.message}`);process.exitCode=1;}
