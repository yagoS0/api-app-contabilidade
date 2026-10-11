// Uso: node apps/api/scripts/preparar-dps-simples-2027-offline.mjs entrada.json resultado.json
// Entrada: { xmlBase: "<DPS ...", company: { cnpj, regimeHistorico }, perfil: { id, codigoServicoNacional, cAtvSN }, indFinal?: "1" }
// Somente arquivos locais. Não carrega configuração, credenciais, banco, assinatura ou cliente HTTP.
import fs from 'node:fs';
import { prepararDpsSimples2027Offline } from '../src/application/nfse/laboratorio/dpsSimples2027.js';

const [entrada, saida, ...extras] = process.argv.slice(2);
if (!entrada || !saida || extras.length) {
  console.error('Uso: node apps/api/scripts/preparar-dps-simples-2027-offline.mjs entrada.json resultado.json');
  process.exitCode = 1;
} else {
  try {
    const resultado = prepararDpsSimples2027Offline(JSON.parse(fs.readFileSync(entrada, 'utf8')));
    // Resultado sempre inclui o estado bloqueado; não sobrescreve arquivos existentes.
    fs.writeFileSync(saida, JSON.stringify(resultado, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log('Preparação local gravada. XML não assinado, não homologado e bloqueado para emissão.');
  } catch (err) {
    console.error(`${err.code || 'ERRO_PREPARACAO'}: ${err.message}`);
    process.exitCode = 1;
  }
}
