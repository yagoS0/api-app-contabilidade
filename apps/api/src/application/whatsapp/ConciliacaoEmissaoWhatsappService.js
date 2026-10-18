import { NFSE_CONCILIACAO_SUPERVISIONADA_ENABLED } from '../../config.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/db/prisma.js';
import { NfseService } from '../nfse/NfseService.js';
import { comControleEmissao, execucaoEmissaoAtiva, conferirControleEmissao } from './ControleEmissaoWhatsapp.js';

const falha = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const versao = a => createHash('sha256').update(JSON.stringify([a.id, a.status, a.updatedAt, a.resultado])).digest('hex');
const elegivel = a => a.tipo === 'EMITIR_NFSE' && (a.status === 'confirmada' || a.resultado?.indeterminado || a.resultado?.supervisoes?.length);
const historico = a => (a.resultado?.supervisoes || []).map(({ id, autorId, motivo, iniciadaEm, concluidaEm, estado }) => ({ id, autorId, motivo, iniciadaEm, concluidaEm, estado }));

async function carregar({ conversaId, acaoId, client, conferirEscopo }) {
  const conversa = await conferirEscopo();
  if (!conversa?.portalClientId || conversa.id !== conversaId) throw falha('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
  const acao = await client.acaoPendenteWhatsapp.findFirst({ where: { id: acaoId, conversaId, portalClientId: conversa.portalClientId, tipo: 'EMITIR_NFSE' } });
  if (!acao || !elegivel(acao)) throw falha('ACAO_NAO_ENCONTRADA', 'Emissão interrompida não encontrada.', 404);
  const portal = await client.portalClient.findUnique({ where: { id: acao.portalClientId }, select: { id: true, companyId: true, razao: true, cnpj: true } });
  const tentativa = acao.resultado?.nfseId && portal?.companyId ? await client.serviceInvoice.findFirst({ where: { id: acao.resultado.nfseId, companyId: portal.companyId } }) : null;
  return { acao, portal, tentativa };
}

function itemDe({ acao, portal, tentativa }, ativa = false, habilitada = NFSE_CONCILIACAO_SUPERVISIONADA_ENABLED) {
  const recuperada = acao.resultado?.status === 'issued' && acao.resultado?.indeterminado === false;
  const situacao = ativa ? 'PROCESSANDO' : recuperada ? 'RECUPERADA' : !tentativa ? 'LEGADO_SEM_TENTATIVA'
    : acao.resultado?.supervisoes?.length ? 'INCONCLUSIVA' : 'AGUARDANDO_CONFERENCIA';
  return { acaoId: acao.id, conversaId: acao.conversaId, versao: versao(acao), portalClientId: acao.portalClientId,
    empresa: portal ? { id: portal.id, razao: portal.razao, cnpj: portal.cnpj } : null,
    tipo: acao.tipo, status: acao.status, confirmadaEm: acao.confirmadaEm,
    tentativa: tentativa ? { id: tentativa.id, idDps: tentativa.idDps, status: tentativa.status, numeroNfse: tentativa.numeroNfse, chaveAcesso: tentativa.chaveAcesso, updatedAt: tentativa.updatedAt } : null,
    situacao, podeConferir: habilitada && !ativa && !recuperada, historico: historico(acao),
    mensagem: !habilitada ? 'Conferência supervisionada indisponível enquanto a atualização segura do sistema não for concluída.' : ativa ? 'A emissão ainda está sendo processada.' : recuperada ? 'Resultado recuperado sem emitir nova nota.'
      : !tentativa ? 'Tentativa não identificada. Registre o encaminhamento para análise; nenhuma emissão será liberada.'
        : 'Confira o resultado da tentativa. Esta ação não emite nota nem autoriza reenvio.' };
}

export async function listarEmissoesInterrompidas({ conversaId, conferirEscopo, client = prisma, habilitada = NFSE_CONCILIACAO_SUPERVISIONADA_ENABLED }) {
  const conversa = await conferirEscopo();
  if (!conversa?.portalClientId || conversa.id !== conversaId) throw falha('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
  const acoes = await client.acaoPendenteWhatsapp.findMany({ where: { conversaId, portalClientId: conversa.portalClientId, tipo: 'EMITIR_NFSE', status: { in: ['confirmada', 'executada'] } }, orderBy: { createdAt: 'desc' } });
  const itens = [];
  for (const acao of acoes.filter(elegivel)) {
    const dados = await carregar({ conversaId, acaoId: acao.id, client, conferirEscopo });
    itens.push(itemDe(dados, await execucaoEmissaoAtiva({ acaoId: acao.id, client }), habilitada));
  }
  return { itens };
}

export async function conferirEmissaoInterrompida({ conversaId, acaoId, versao: esperada, motivo, autorId, conferirEscopo, client = prisma, habilitada = NFSE_CONCILIACAO_SUPERVISIONADA_ENABLED, consultar = NfseService.conciliarTentativa.bind(NfseService) }) {
  if (!habilitada) throw falha('NFSE_SUPERVISAO_DESABILITADA', 'Conferência supervisionada indisponível durante a atualização segura do sistema.', 503);
  if (!autorId || typeof motivo !== 'string' || motivo.trim().length < 10 || motivo.trim().length > 1000 || typeof esperada !== 'string') throw falha('SUPERVISAO_DADOS_INVALIDOS', 'Informe a versão e um motivo entre 10 e 1000 caracteres.', 400);
  return comControleEmissao({ acaoId, client, executar: async controle => {
    controle.conferirEscopo = conferirEscopo;
    const dados = await carregar({ conversaId, acaoId, client, conferirEscopo });
    controle.invoiceId = dados.tentativa?.id || null;
    controle.companyId = dados.portal?.companyId || null;
    let acao = dados.acao;
    if (versao(acao) !== esperada) throw falha('NFSE_CONCILIACAO_ESTADO_ALTERADO', 'A emissão mudou. Atualize os dados antes de conferir.');
    const entrada = { id: controle.token, autorId, motivo: motivo.trim(), iniciadaEm: new Date().toISOString(), estado: 'EM_CONFERENCIA' };
    const gravarAcao = async alteracao => {
      const r = await client.acaoPendenteWhatsapp.updateMany({ where: { id: acao.id, conversaId, portalClientId: acao.portalClientId, status: acao.status,
        resultado: { equals: acao.resultado ?? Prisma.DbNull } }, data: alteracao });
      if (r.count !== 1) throw falha('NFSE_CONCILIACAO_ESTADO_ALTERADO', 'O resultado mudou durante a conferência.');
      acao = await client.acaoPendenteWhatsapp.findUnique({ where: { id: acao.id } });
    };
    await gravarAcao({ resultado: { ...(acao.resultado || {}), indeterminado: true, controleEmissaoToken: controle.token, supervisoes: [...(acao.resultado?.supervisoes || []), entrada] }, encaminharHumano: true });
    if (dados.tentativa) {
      // Claim persistido cerca finalizações do executor anterior mesmo se sua
      // conexão expirar entre a última guarda e a escrita em outra conexão.
      let claimed = false;
      for (let i = 0; i < 4 && !claimed; i++) {
        await conferirControleEmissao(controle);
        const atual = await client.serviceInvoice.findFirst({ where: { id: dados.tentativa.id, companyId: dados.portal.companyId } });
        if (!atual) throw falha('NFSE_RETRY_INVOICE_NOT_FOUND', 'Tentativa não encontrada.', 404);
        await conferirControleEmissao(controle);
        const configuracaoFiscal = { ...(atual.configuracaoFiscal || {}), controleEmissaoToken: controle.token };
        const r = await client.serviceInvoice.updateMany({ where: { id: atual.id, companyId: atual.companyId, status: atual.status, updatedAt: atual.updatedAt,
          configuracaoFiscal: { equals: atual.configuracaoFiscal ?? Prisma.DbNull } }, data: { configuracaoFiscal } });
        if (r.count === 1) { dados.tentativa = { ...atual, configuracaoFiscal }; claimed = true; }
      }
      if (!claimed) throw falha('NFSE_CONCILIACAO_ESTADO_ALTERADO', 'A tentativa mudou durante a conferência.');
    }
    let resultado;
    try {
      await conferirEscopo();
      await conferirControleEmissao(controle);
      resultado = dados.tentativa ? await consultar({ companyId: dados.portal.companyId, invoiceId: dados.tentativa.id, supervisao: controle })
        : { estado: 'LEGADO_SEM_TENTATIVA', recuperada: false, message: 'Encaminhamento registrado. A tentativa precisa ser identificada antes de qualquer decisão.' };
    } catch (err) {
      resultado = { estado: 'INCONCLUSIVA', recuperada: false, message: 'Não foi possível confirmar o resultado. A emissão permanece bloqueada.', codigo: err.code || 'CONSULTA_FALHOU' };
    }
    await conferirControleEmissao(controle);
    await conferirEscopo();
    const recuperada = resultado.estado === 'MESMA' && resultado.recuperada === true && resultado.nfse?.status === 'issued'
      && resultado.nfse?.chaveAcesso && resultado.nfse?.numeroNfse && resultado.nfse?.id === dados.tentativa?.id;
    const resultadoFinal = { ...acao.resultado, indeterminado: !recuperada,
      ...(recuperada ? { status: 'issued', nfseId: resultado.nfse.id, numero: resultado.nfse.numeroNfse, recuperada: true } : {}),
      supervisoes: acao.resultado.supervisoes.map(h => h.id === entrada.id ? { ...h, concluidaEm: new Date().toISOString(), estado: resultado.estado, codigo: resultado.codigo || null } : h) };
    await gravarAcao({ resultado: resultadoFinal, ...(recuperada ? { status: 'executada', executadaEm: new Date(), respostaAoCliente: `Nota emitida — número ${resultado.nfse.numeroNfse}. Resultado recuperado sem nova emissão.`, encaminharHumano: false } : { encaminharHumano: true }) });
    return { item: itemDe({ ...dados, acao, tentativa: resultado.nfse || dados.tentativa }, false, habilitada), estado: resultado.estado, recuperada: Boolean(recuperada), message: resultado.message };
  } });
}
