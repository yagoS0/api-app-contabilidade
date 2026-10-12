import { AsyncLocalStorage } from 'node:async_hooks';
import { carregarGrupo, transacao, ultimaConfiguracao } from '../../application/fiscal/consumo/ApuracaoConsumoService.js';
import { criarClienteCbs } from './CbsClient.js';
import { criarProvedorTokenCbs } from './CbsOAuth.js';
import { criarReservaEmissaoCbs } from './CbsTokenReserva.js';
import { criarProtecaoCbsComRotacao } from '../../application/fiscal/consumo/CbsProtecao.js';

const fail = () => Object.assign(new Error('Integração CBS não autorizada para este contexto.'), { code: 'CBS_RUNTIME_BLOQUEADO', status: 503, resultadoIncerto: false });
const texto = v => typeof v === 'string' && v.trim().length > 0;
const versao = v => v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : null;

// Não consulta banco/cofre/rede ao iniciar. Qualquer erro de configuração mantém OFF.
export function criarRuntimeCbsDoAmbiente({ db, env = process.env } = {}) {
  const off = async () => ({});
  try {
    const encoded = env.CBS_APURACAO_CHAVE_BASE64;
    if (!encoded) return off;
    const chave = value => {
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw fail();
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length !== 32 || bytes.toString('base64') !== value) throw fail();
      return bytes;
    };
    const anteriores = env.CBS_APURACAO_CHAVES_ANTERIORES_BASE64 ? JSON.parse(env.CBS_APURACAO_CHAVES_ANTERIORES_BASE64) : [];
    if (!Array.isArray(anteriores) || anteriores.length > 8) return off;
    const protecao = criarProtecaoCbsComRotacao({ chaveAtiva: chave(encoded), chavesAnteriores: anteriores.map(chave) });
    const autorizacoes = env.CBS_APURACAO_AUTORIZACOES ? JSON.parse(env.CBS_APURACAO_AUTORIZACOES) : [];
    if (!Array.isArray(autorizacoes) || autorizacoes.length > 1000 || autorizacoes.some(p => !p || typeof p !== 'object' || Array.isArray(p))) return off;
    return criarCompositorCbs({ db, autorizacoes, protecao });
  } catch { return off; }
}

// Autorizacoes são provisionamento exclusivo do servidor; nenhuma configuração HTTP
// de preparação local habilita este compositor. Construir não abre cofre ou rede.
export function criarCompositorCbs({ db, autorizacoes = [], protecao, decifrarCredencial = async valor => (await import('../../utils/crypto.js')).decryptSecret(valor), fetchImpl, downloadFetchImpl } = {}) {
  if (!Array.isArray(autorizacoes)) throw fail();
  const permissoes = structuredClone(autorizacoes), tokens = new Map(), atores = new AsyncLocalStorage();
  const desligado = () => protecao ? { protecao } : {};
  const reservarEmissao = criarReservaEmissaoCbs(db);
  async function conferir({ companyId, ambiente, usuario }, permissao, segredo = false) {
    return transacao(db, async tx => {
      const grupo = await carregarGrupo(tx, companyId, usuario, true);
      if (!grupo || grupo.id !== permissao.contribuinteId || !grupo.estabelecimentos.some(e => e.id === permissao.credencialPortalClientId)) throw fail();
      const cfg = await ultimaConfiguracao(tx, grupo.id, { tributo: 'CBS', ambiente });
      if (!cfg?.habilitado || cfg.id !== permissao.configuracaoId || cfg.dados?.credencialId !== permissao.credencialId || cfg.dados?.credencialPortalClientId !== permissao.credencialPortalClientId) throw fail();
      const cred = await tx.companyCredential.findFirst({ where: { id: permissao.credencialId, portalClientId: permissao.credencialPortalClientId, senhaCifrada: { not: null } },
        select: { id: true, updatedAt: true, ...(segredo ? { login: true, senhaCifrada: true } : {}) } });
      if (!cred || versao(cred.updatedAt) !== permissao.credencialAtualizadaEm) throw fail();
      if (segredo) await tx.companyCredentialAcesso.create({ data: { portalClientId: permissao.credencialPortalClientId, credentialId: cred.id,
        acao: 'REVELADA', rotuloNoMomento: 'Integração CBS', usuarioId: String(usuario.id), motivo: 'Uso interno em autenticação CBS solicitada pelo operador; segredo não exibido.' } });
      return cred;
    });
  }
  return async function resolver({ companyId, ambiente, usuario } = {}) {
    if (!['HOMOLOGACAO','PRODUCAO'].includes(ambiente) || !usuario?.id || !protecao || typeof decifrarCredencial !== 'function') return desligado();
    const grupo = await transacao(db, tx => carregarGrupo(tx, companyId, usuario, true));
    const encontradas = permissoes.filter(p => p.contribuinteId === grupo?.id && p.ambiente === ambiente && p.habilitado === true);
    if (encontradas.length !== 1) return desligado();
    const p = encontradas[0];
    if (!['configuracaoId','credencialId','credencialPortalClientId','credencialAtualizadaEm','referenciaHomologacao','referenciaContrato','referenciaCallback','urlRetorno'].every(k => texto(p[k]))
      || p.matrizConfirmada !== true || !Array.isArray(p.hostsDownloadPermitidos) || !p.hostsDownloadPermitidos.length) return desligado();
    const contexto = { companyId, ambiente, usuario };
    try { await conferir(contexto, p); } catch (e) { if ([401,403,404].includes(e.status)) throw e; return desligado(); }
    const chave = `${p.credencialId}:${p.credencialAtualizadaEm}`;
    if (!tokens.has(chave)) tokens.set(chave, criarProvedorTokenCbs({ credencialId: p.credencialId, reservarEmissao, fetchImpl,
      lerCredencial: async ({ signal }) => {
        const chamada = atores.getStore(); if (!chamada || signal?.aborted) throw fail();
        // Auditoria commitada antes de abrir o segredo, reutilizando cifra do cofre.
        const cred = await conferir(chamada.contexto, chamada.permissao, true);
        if (signal?.aborted) throw fail();
        const clientSecret = await decifrarCredencial(cred.senhaCifrada);
        if (!texto(clientSecret) || !texto(cred.login) || signal?.aborted) throw fail();
        return { clientId: cred.login, clientSecret };
      },
    }));
    const obterToken = options => atores.run({ contexto, permissao: p }, () => tokens.get(chave)(options));
    let cliente;
    try { cliente = criarClienteCbs({ ambiente, contexto: { contribuinteId: grupo.id, credencialId: p.credencialId }, obterToken,
      urlRetorno: p.urlRetorno, hostsDownloadPermitidos: p.hostsDownloadPermitidos, fetchImpl, downloadFetchImpl }); }
    catch { return desligado(); }
    const protegido = { ambiente, contexto: cliente.contexto };
    for (const acao of ['abrir','consultar','baixar']) protegido[acao] = async entrada => {
      try { await conferir(contexto, p); } catch { throw fail(); } // Revogação invalida inclusive cache.
      return cliente[acao](entrada);
    };
    return { protecao, cliente: Object.freeze(protegido) };
  };
}
