import { criarCifraFs12 } from '../modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarCifraEnvelopeFs12 } from '../modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
import { criarStageRespostaFs12 } from '../modules/fiscal/infrastructure/custody/stageRespostaFs12.js';
import { prepararChavesCustodiaFs12, criarSincronizacaoDiretorioFs12, conferirDiretorioCustodiaFs12 } from '../modules/fiscal/infrastructure/custody/configuracaoCustodiaFs12.js';
import { criarRuntimeFiscalFs12 } from './criarRuntimeFiscalFs12.js';
import { registrarRuntimeFs12, registrarIndisponibilidadeFs12 } from './execucaoFs12.js';

const idValido = value => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
const mensagens = {
  FS12_CHAVE_ATIVA_NAO_CONFIGURADA: 'A chave ativa da custódia fiscal não está configurada.',
  FS12_CHAVEIRO_INVALIDO: 'A configuração das chaves de custódia fiscal é inválida.',
  FS12_CHAVE_ATIVA_AUSENTE: 'A chave ativa não consta no conjunto de chaves de custódia.',
  FS12_DIRETORIO_NAO_CONFIGURADO: 'O diretório persistente de custódia fiscal não está configurado.',
  FS12_DIRETORIO_INVALIDO: 'O diretório de custódia fiscal não atende ao contrato de armazenamento.',
  FS12_DURABILIDADE_CONFIG_INVALIDA: 'A garantia de durabilidade configurada não é permitida neste ambiente.',
  FS12_IDENTIDADE_CUSTODIA_INVALIDA: 'A identidade da capacidade de custódia fiscal não está configurada.',
};

// Called before accepting requests or starting workers. Failure blocks only the
// new fiscal capability; old periods and read-only/documentary services remain.
export async function inicializarCustodiaFiscalFs12({ config, db, identificarEnvelope, log }) {
  let chaves;
  try {
    if (!idValido(config.custodianteId) || !idValido(config.capacidadeId))
      throw Object.assign(new Error('FS12_IDENTIDADE_CUSTODIA_INVALIDA'), {code:'FS12_IDENTIDADE_CUSTODIA_INVALIDA'});
    chaves = prepararChavesCustodiaFs12(config);
    const syncDirectory = criarSincronizacaoDiretorioFs12(config);
    const probe = await conferirDiretorioCustodiaFs12({root:config.root,syncDirectory});
    const cifraResposta = criarCifraFs12({resolveKey:chaves.resolveKey});
    const cifraEnvelope = criarCifraEnvelopeFs12({keyId:chaves.keyIdAtivo,resolveKey:chaves.resolveKey});
    const stageResposta = criarStageRespostaFs12({root:probe.root,cifra:cifraResposta,syncDirectory});
    const garantiaCustodia = config.modo === 'PROCESS_RESTART_ONLY' ? 'PROCESS_RESTART_ONLY' : 'DIRECTORY_SYNC_REQUIRED';
    const runtime = criarRuntimeFiscalFs12({db,cifraResposta,cifraEnvelope,stageResposta,
      custodianteId:config.custodianteId,capacidadeId:config.capacidadeId,keyIdAtivo:chaves.keyIdAtivo,
      identificarEnvelope,garantiaCustodia});
    registrarRuntimeFs12(runtime);
    // Logging is not part of capability installation and cannot destroy active keys.
    try { log?.info?.({garantiaCustodia,directorySynced:probe.directorySynced},'Capacidade local de custódia FS12 inicializada; não comprova homologação fiscal.'); } catch { /* installed capability remains usable */ }
    return Object.freeze({disponivel:true,garantiaCustodia,directorySynced:probe.directorySynced});
  } catch (error) {
    chaves?.destruir();
    const codigo = Object.hasOwn(mensagens,error?.code) ? error.code : 'FS12_CUSTODIA_ARMAZENAMENTO_INDISPONIVEL';
    const motivo = mensagens[codigo] || 'Não foi possível preparar o armazenamento recuperável da resposta fiscal.';
    const acao = 'Solicitar ao administrador a revisão da configuração de custódia fiscal. Não repetir uma tentativa com resultado desconhecido.';
    registrarIndisponibilidadeFs12({codigo,motivo,acao});
    try { log?.warn?.({codigo},motivo); } catch { /* unavailability remains registered */ } // Never log raw errors, paths, keys or configuration.
    return Object.freeze({disponivel:false,codigo,motivo,acao});
  }
}
