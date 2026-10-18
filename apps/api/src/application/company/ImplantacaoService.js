import { prisma } from '../../infrastructure/db/prisma.js';
import { carregarEvidenciasJornada } from '../onboarding/JornadaLeadService.js';
import { evidenciasDiagnostico, etapasComEvidencias } from '../onboarding/ProjecaoComercialService.js';

export const STATUS_IMPLANTACAO = ['A_FAZER', 'AGUARDANDO_CLIENTE', 'AGENDADO', 'CONCLUIDO', 'NAO_SE_APLICA'];
export const TAREFAS_IMPLANTACAO = [
  ['cadastro', 'Conferir cadastro e regime', 'Revise os dados definitivos, inscrições, atividades e vigência do regime.', 'cadastro'],
  ['certificado_a1', 'Configurar certificado A1', 'Instale e confira titularidade e validade; se faltar, registre quem vai obter o certificado.', 'certificado'],
  ['procuracao_ecac', 'Conferir procurações e acessos', 'Confira as autorizações necessárias ao serviço contratado. Guarde senhas somente no cofre.', 'credenciais'],
  ['emissao_nfse', 'Configurar emissão de notas', 'Confira serviços, perfis, códigos e parâmetros fiscais e municipais.', 'emissao-nfse'],
  ['liberacao_nfse', 'Conferir liberação da emissão ao cliente', 'Decida quem poderá emitir. A autorização é feita nas configurações de emissão.', 'emissao-nfse'],
  ['comunicacao', 'Conferir contatos, acessos e envios', 'Revise usuários do portal, destinatários e autorizações de comunicação.', 'comunicacao'],
  ['base_apuracao', 'Preparar a base da apuração', 'Confira receitas anteriores, declarações, folha e pró-labore conforme o serviço contratado.', 'cadastro-fiscal'],
  ['obrigacoes', 'Conferir obrigações e rotinas', 'Confira as regras aplicadas, responsáveis, prazos e início do acompanhamento.', 'obrigacoes'],
  ['contabilidade', 'Preparar a contabilidade', 'Confira plano de contas, saldos iniciais e integração quando aplicáveis.', 'plano-contas'],
  ['documentos', 'Conferir documentos e transferência', 'Aproveite os documentos já recebidos e registre o que ainda falta.', 'documentos'],
];
const erro = (message, status = 400) => Object.assign(new Error(message), { status });
const final = status => ['CONCLUIDO', 'NAO_SE_APLICA'].includes(status);
const dia = v => v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null;
function hojeSp(agora) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function projetarImplantacao(onboarding, salvas = [], agora = new Date()) {
  const tarefas = TAREFAS_IMPLANTACAO.map(([chave, titulo, descricao, destino]) => ({ chave, titulo, descricao, destino, status: 'A_FAZER', responsavel: null, prazo: null, pendencia: null, versao: 0, origem: null, historico: [], concluidaEm: null, concluidaPorId: null }));
  for (const etapa of onboarding?.etapas || []) {
    if (etapa.acao === 'CONVERSAO' || etapa.chave === 'conversao') continue;
    let t = tarefas.find(x => x.chave === etapa.chave);
    if (!t) {
      t = { chave: `onboarding:${etapa.id}`, titulo: etapa.titulo, descricao: etapa.descricao, destino: etapa.acao === 'SITFIS' ? 'sitfis' : null, status: 'A_FAZER', responsavel: null, prazo: null, versao: 0, historico: [] };
      tarefas.push(t);
    }
    Object.assign(t, { status: etapa.concluidaEm ? 'CONCLUIDO' : 'A_FAZER', pendencia: etapa.observacao || null,
      concluidaEm: etapa.concluidaEm || null, concluidaPorId: etapa.concluidaPorId || null,
      origem: { onboardingId: onboarding.id, etapaId: etapa.id, titulo: etapa.titulo, concluidaEm: etapa.concluidaEm ? new Date(etapa.concluidaEm).toISOString() : null, concluidaPorId: etapa.concluidaPorId || null, observacao: etapa.observacao || null } });
    t.evidencias = etapa.evidencias || [];
    // Evidência somente satisfaz a tarefa específica, nunca acessos amplos.
    const prova = t.evidencias.find(e => e.satisfaz);
    if (!etapa.concluidaEm && prova) Object.assign(t, { status: 'CONCLUIDO', concluidaEm: prova.em, conclusaoPorEvidencia: true });
  }
  for (const salva of salvas) {
    const i = tarefas.findIndex(t => t.chave === salva.chave);
    if (i < 0) tarefas.push(salva); else tarefas[i] = { ...salva, evidencias: tarefas[i].evidencias || [] };
  }
  const hoje = hojeSp(agora);
  const itens = tarefas.map(t => ({ ...t, prazo: dia(t.prazo), atrasada: !final(t.status) && Boolean(t.prazo) && dia(t.prazo) < hoje }));
  return { onboardingId: onboarding?.id || null, tarefas: itens, resumo: { total: itens.length, pendentes: itens.filter(t => !final(t.status)).length,
    concluidas: itens.filter(t => t.status === 'CONCLUIDO').length, naoSeAplica: itens.filter(t => t.status === 'NAO_SE_APLICA').length,
    atrasadas: itens.filter(t => t.atrasada).length, semResponsavel: itens.filter(t => !final(t.status) && !t.responsavel).length } };
}

// Leitura sem escrita: empresas já convertidas recebem as mesmas pendências,
// sem backfill em massa nem alteração do histórico comercial.
export async function lerImplantacao(portalClientId, db = prisma, agora = new Date()) {
  const empresa = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true } });
  if (!empresa) throw erro('Empresa não encontrada.', 404);
  const [onboarding, salvas] = await Promise.all([
    db.onboarding.findUnique({ where: { portalClientId }, include: { etapas: { orderBy: { ordem: 'asc' } } } }),
    db.implantacaoTarefa.findMany({ where: { portalClientId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!onboarding) return projetarImplantacao(null, salvas, agora);
  const [jornada, atendimento] = await Promise.all([
    carregarEvidenciasJornada(onboarding, db),
    db.atendimentoLead.findFirst({ where: { onboardingId: onboarding.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  return projetarImplantacao({ ...onboarding, etapas: etapasComEvidencias(onboarding.etapas, evidenciasDiagnostico(onboarding, jornada, atendimento)) }, salvas, agora);
}

export function validarEdicaoImplantacao(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) || Object.keys(corpo).some(k => !['versao', 'status', 'responsavel', 'prazo', 'pendencia'].includes(k))) throw erro('Campos da tarefa inválidos.');
  if (!Number.isInteger(corpo.versao) || corpo.versao < 0 || !STATUS_IMPLANTACAO.includes(corpo.status)) throw erro('Confira a versão e a situação da tarefa.');
  const texto = (v, max) => { if (v === null || v === '') return null; if (typeof v !== 'string' || v.length > max) throw erro('Responsável ou pendência inválidos.'); return v.trim() || null; };
  const responsavel = texto(corpo.responsavel, 120), pendencia = texto(corpo.pendencia, 3000);
  let prazo = null;
  if (corpo.prazo !== null && corpo.prazo !== '') {
    if (typeof corpo.prazo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(corpo.prazo)) throw erro('Informe um prazo válido.');
    prazo = new Date(`${corpo.prazo}T00:00:00.000Z`);
    if (!Number.isFinite(prazo.getTime()) || dia(prazo) !== corpo.prazo || corpo.prazo < '1900-01-01') throw erro('Informe um prazo válido.');
  }
  if (corpo.status === 'AGENDADO' && (!prazo || !responsavel)) throw erro('Para agendar, informe responsável e prazo.');
  if (['AGUARDANDO_CLIENTE', 'NAO_SE_APLICA'].includes(corpo.status) && !pendencia) throw erro('Registre o que falta do cliente ou o motivo de não se aplicar.');
  return { status: corpo.status, responsavel, pendencia, prazo };
}

export async function salvarImplantacao(portalClientId, chave, corpo, atorId, db = prisma, agora = new Date()) {
  const data = validarEdicaoImplantacao(corpo);
  if (!atorId) throw erro('Usuário não identificado.', 401);
  try {
    return await db.$transaction(async tx => {
      const { tarefas } = await lerImplantacao(portalClientId, tx, agora);
      const atual = tarefas.find(t => t.chave === chave);
      if (!atual) throw erro('Tarefa não encontrada nesta empresa.', 404);
      if (atual.versao !== corpo.versao) throw erro('Esta tarefa foi alterada. Confira a versão atual antes de salvar novamente.', 409);
      const campos = t => ({ status: t.status, responsavel: t.responsavel, prazo: dia(t.prazo), pendencia: t.pendencia });
      const historico = [...(atual.historico || []), { em: agora.toISOString(), atorId, antes: campos(atual), depois: campos(data) }];
      const escrita = { ...data, historico,
        concluidaEm: data.status === 'CONCLUIDO' ? (atual.status === 'CONCLUIDO' ? atual.concluidaEm : agora) : null,
        concluidaPorId: data.status === 'CONCLUIDO' ? (atual.status === 'CONCLUIDO' ? atual.concluidaPorId : atorId) : null };
      if (atual.versao === 0) {
        await tx.implantacaoTarefa.create({ data: { ...escrita, portalClientId, chave, titulo: atual.titulo, descricao: atual.descricao || null, destino: atual.destino || null, ...(atual.origem ? { origem: atual.origem } : {}) } });
      } else {
        const r = await tx.implantacaoTarefa.updateMany({ where: { portalClientId, chave, versao: corpo.versao }, data: { ...escrita, versao: { increment: 1 } } });
        if (r.count !== 1) throw erro('Esta tarefa foi alterada. Confira a versão atual antes de salvar novamente.', 409);
      }
      return lerImplantacao(portalClientId, tx, agora);
    }, { isolationLevel: 'Serializable' });
  } catch (e) {
    if (['P2002', 'P2034'].includes(e.code)) throw erro('Esta tarefa foi alterada. Confira a versão atual antes de salvar novamente.', 409);
    throw e;
  }
}
