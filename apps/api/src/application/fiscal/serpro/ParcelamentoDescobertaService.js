import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { montarRelatorioSitfis, lerLeituraPosicionalGravada } from "./lerRelatorioSitfis.js";
import { SerproParcelamentoService } from "./SerproParcelamentoService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { MODALIDADES_AUTOMATICAS } from "./serproParcelamentoMap.js";
import { TIPOS_PARCELAMENTO, grupoDoParcelamento } from "../../accounting/parcelamento/contracts.js";

const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const json = value => JSON.parse(JSON.stringify(value));
export function erroAcompanhamento(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }

/** Apenas evidência do relatório; não materializa prestações nem conclui contrato ativo. */
export function extrairIndicacoesParcelamento(relatorio) {
  const saida = [];
  for (const diagnostico of relatorio?.diagnosticos || []) {
    for (const bloco of diagnostico.blocos || []) {
      const textoBloco = norm([bloco.titulo, ...(bloco.descricao || []), ...(bloco.anotacoes || [])].join(" "));
      if (!/PARCELAMENTO|PARCSN|PARCMEI/.test(textoBloco)) continue;
      const registros = bloco.registros?.length ? bloco.registros : [null];
      for (const registro of registros) {
        const entries = Object.entries(registro || {});
        const text = [bloco.titulo, ...(bloco.descricao || []), ...entries.map(([k,v]) => `${k}: ${v}`), ...(bloco.anotacoes || [])].join(" · ");
        const upper = norm(text);
        const numeroCampo = entries.find(([k]) => /^(NUMERO (DO )?PARCELAMENTO|PARCELAMENTO|N[º°.]? (DO )?PARCELAMENTO)$/.test(norm(k)))?.[1];
        const numeroParcelamento = numeroCampo != null && /^[\d.\/-]+$/.test(String(numeroCampo).trim()) ? String(numeroCampo).trim() : null;
        const modalidadeCampo = norm(entries.find(([k]) => /MODALIDADE/.test(norm(k)))?.[1]);
        const modalidade = /PARCMEI/.test(modalidadeCampo) ? "PARCMEI" : /PARCSN/.test(modalidadeCampo) ? "PARCSN"
          : /PARCSN/.test(upper) && !/PARCMEI/.test(upper) ? "PARCSN" : /PARCMEI/.test(upper) && !/PARCSN/.test(upper) ? "PARCMEI" : null;
        const atrasoCampo = entries.find(([k]) => /PARCELAS?/.test(norm(k)) && /ATRAS/.test(norm(k)))?.[1];
        const atrasoTexto = upper.match(/(\d+)\s+PARCELAS?\s+(?:EM\s+)?ATRAS/)?.[1] || upper.match(/PARCELAS?\s+(?:EM\s+)?ATRASO\s*[:\-]?\s*(\d+)/)?.[1];
        const qtd = atrasoCampo ?? atrasoTexto;
        const parcelasEmAtraso = /^\d+$/.test(String(qtd ?? "").trim()) ? Number(qtd) : null;
        // Sem número, agrupa por bloco. A mudança de quantidade/data atualiza a evidência, não cria outro acordo.
        const identidade = numeroParcelamento ? `${modalidade || "?"}:${numeroParcelamento}` : `${diagnostico.chave}:${norm(bloco.titulo)}:${modalidade || "?"}`;
        const chaveOrigem = crypto.createHash("sha256").update(identidade).digest("hex");
        if (!saida.some(i => i.chaveOrigem === chaveOrigem)) saida.push({ chaveOrigem, modalidade, numeroParcelamento, parcelasEmAtraso, descricao: text.slice(0, 4000), rawPayload: json({ orgao: diagnostico.chave, bloco, registro }) });
      }
    }
  }
  return saida;
}

export async function reprocessarSitfisParcelamentos({ portalClientId, client = prisma }) {
  const status = await client.companyFiscalStatus.findUnique({ where: { portalClientId }, select: { texto: true, rawPayload: true, ultimoRelatorioEm: true, checkedAt: true } });
  if (!status) return { identificadas: 0, motivo: "sem_relatorio_salvo" };
  const { relatorio } = montarRelatorioSitfis({ texto: status.texto, posicional: lerLeituraPosicionalGravada(status.rawPayload) });
  const evidenciaEm = status.ultimoRelatorioEm || status.checkedAt;
  if (!evidenciaEm) return { identificadas: 0, motivo: "relatorio_sem_data" };
  const indicacoes = extrairIndicacoesParcelamento(relatorio);
  for (const dado of indicacoes) {
    await client.$transaction(async tx => {
      const anterior = await tx.parcelamentoIndicacao.findUnique({ where: { portalClientId_chaveOrigem: { portalClientId, chaveOrigem: dado.chaveOrigem } } });
      if (anterior && new Date(anterior.evidenciaEm).getTime() >= new Date(evidenciaEm).getTime()) return;
      const indicacao = await tx.parcelamentoIndicacao.upsert({ where: { portalClientId_chaveOrigem: { portalClientId, chaveOrigem: dado.chaveOrigem } }, create: { ...dado, portalClientId, evidenciaEm }, update: { ...dado, evidenciaEm } });
      await tx.parcelamentoIndicacaoEvento.create({ data: { indicacaoId: indicacao.id, portalClientId, tipo: "EVIDENCIA_SITFIS", dados: json({ evidenciaEm, ...dado }) } });
    });
  }
  return { identificadas: indicacoes.length, evidenciaEm, motivo: indicacoes.length ? null : "sem_indicio_no_relatorio" };
}

export async function resolverIndicacaoParcelamento({ portalClientId, indicacaoId, status, motivo, parcelamentoId, usuarioId, client = prisma }) {
  if (!["DESCARTADO", "VINCULADO"].includes(status) || String(motivo || "").trim().length < 5) throw erroAcompanhamento("MOTIVO_OBRIGATORIO", "Informe o motivo da resolução (mínimo de 5 caracteres).");
  return client.$transaction(async tx => {
    const indicacao = await tx.parcelamentoIndicacao.findFirst({ where: { id: indicacaoId, portalClientId } });
    if (!indicacao) throw erroAcompanhamento("INDICACAO_NAO_ENCONTRADA", "Indicação não encontrada.", 404);
    if (status === "VINCULADO") {
      const contrato = await tx.parcelamento.findFirst({ where: { id: parcelamentoId || "", portalClientId, status: { not: "EXCLUIDO" } } });
      if (!contrato) throw erroAcompanhamento("CONTRATO_NAO_ENCONTRADO", "Selecione um contrato desta empresa.", 404);
      if (indicacao.numeroParcelamento && indicacao.numeroParcelamento !== contrato.numeroParcelamento) throw erroAcompanhamento("CONTRATO_DIVERGENTE", "O número do contrato diverge do relatório.");
      if (indicacao.modalidade && indicacao.modalidade !== contrato.tipo) throw erroAcompanhamento("CONTRATO_DIVERGENTE", "A modalidade do contrato diverge do relatório.");
    }
    const dados = { status, motivo: String(motivo).trim(), parcelamentoId: status === "VINCULADO" ? parcelamentoId : null, resolvidoEm: new Date(), resolvidoPor: usuarioId || null };
    const saved = await tx.parcelamentoIndicacao.update({ where: { id: indicacaoId }, data: dados });
    await tx.parcelamentoIndicacaoEvento.create({ data: { indicacaoId, portalClientId, tipo: status, usuarioId: usuarioId || null, dados: json({ anterior: indicacao.status, ...dados }) } });
    return saved;
  });
}

export async function cadastrarAcompanhamentoFiscal({ portalClientId, tipo, numeroParcelamento, label, formaPagamento, usuarioId, client = prisma }) {
  tipo = norm(tipo);
  numeroParcelamento = String(numeroParcelamento || "").trim();
  if (!TIPOS_PARCELAMENTO.includes(tipo) || !numeroParcelamento || numeroParcelamento.length > 80) throw erroAcompanhamento("IDENTIFICACAO_INVALIDA", "Informe modalidade e número do parcelamento.");
  if (formaPagamento && !["GUIA_MENSAL", "DEBITO_AUTOMATICO"].includes(formaPagamento)) throw erroAcompanhamento("FORMA_PAGAMENTO_INVALIDA", "Forma de pagamento inválida.");
  return client.parcelamento.upsert({
    where: { portalClientId_tipo_numeroParcelamento: { portalClientId, tipo, numeroParcelamento } },
    create: { portalClientId, tipo, numeroParcelamento, label: String(label || `Parcelamento ${tipo} nº ${numeroParcelamento}`).slice(0, 500), kind: tipo.includes("MEI") ? "INSS" : tipo.includes("SN") ? "SIMPLES" : "OUTRO", grupo: grupoDoParcelamento(tipo), formaPagamento: formaPagamento || null, fiscalSituacao: "NAO_CONFERIDO", status: "ATIVO", createdByUserId: usuarioId || null },
    update: {},
  });
}

export async function reconciliarPedidosFiscais({ portalClientId, tipo, pedidos, raw, client = prisma, agora = new Date() }) {
  const contratos = [];
  for (const pedido of pedidos) {
    const contrato = await client.parcelamento.upsert({
      where: { portalClientId_tipo_numeroParcelamento: { portalClientId, tipo, numeroParcelamento: pedido.numeroParcelamento } },
      create: { portalClientId, tipo, numeroParcelamento: pedido.numeroParcelamento, label: `Parcelamento ${tipo} nº ${pedido.numeroParcelamento}`, kind: tipo === "PARCMEI" ? "INSS" : "SIMPLES", grupo: "sn_mei", origem: "SERPRO", status: pedido.fiscalSituacao === "QUITADO" ? "QUITADO" : pedido.fiscalSituacao === "RESCINDIDO" ? "RESCINDIDO" : "ATIVO", dataAdesao: pedido.dataAdesao, fiscalSituacao: pedido.fiscalSituacao, fiscalConfirmadoEm: agora, fiscalRawPayload: json({ pedido, raw }) },
      // Estado contábil/atos locais não são alterados pela consulta fiscal.
      update: { fiscalSituacao: pedido.fiscalSituacao, fiscalConfirmadoEm: agora, fiscalRawPayload: json({ pedido, raw }) },
    });
    contratos.push(contrato);
    const indicacoes = await client.parcelamentoIndicacao.findMany({ where: { portalClientId, status: "PENDENTE", modalidade: tipo, numeroParcelamento: pedido.numeroParcelamento } });
    for (const indicacao of indicacoes) await resolverIndicacaoParcelamento({ portalClientId, indicacaoId: indicacao.id, status: "VINCULADO", motivo: "Número e modalidade confirmados pela Receita.", parcelamentoId: contrato.id, client });
  }
  return contratos;
}

export async function localizarParcelamentosFiscais({ portalClientId, modalidades = MODALIDADES_AUTOMATICAS, client = prisma, serpro = new SerproParcelamentoService(), assertActive = () => {} }) {
  if (!Array.isArray(modalidades) || !modalidades.length || modalidades.some(t => !MODALIDADES_AUTOMATICAS.includes(t))) throw erroAcompanhamento("MODALIDADE_NAO_SUPORTADA", "A localização automática atende Simples Nacional e MEI ordinários.");
  const empresa = await client.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  if (!empresa) throw erroAcompanhamento("EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.", 404);
  const runtime = await getResolvedSerproCredentials();
  const args = { contratanteCnpj: runtime.certificate.document, contribuinteCnpj: empresa.cnpj };
  const resultados = [];
  for (const tipo of [...new Set(modalidades)]) {
    const key = `parcelamento_localizar:${portalClientId}:${tipo}`;
    const agora = new Date();
    const registro = await client.appSetting.upsert({ where: { key }, create: { key, value: {} }, update: {} });
    const ultimo = registro.value || {};
    const idade = ultimo.tentativaEm ? agora.getTime() - new Date(ultimo.tentativaEm).getTime() : Infinity;
    const intervalo = ultimo.resultado?.ok ? 4 * 3600000 : ultimo.estado === "PROCESSANDO" ? 5 * 60000 : 60000;
    if (idade < intervalo) {
      resultados.push(ultimo.resultado ? { ...ultimo.resultado, cache: true } : { tipo, ok: false, error: "CONSULTA_EM_ANDAMENTO", reason: "Já existe uma consulta em andamento para esta modalidade." });
      continue;
    }
    const owner = crypto.randomUUID();
    const tentativaEm = agora.toISOString();
    // CAS no documento evita colisão inclusive entre atualizações no mesmo milissegundo.
    const reservado = await client.appSetting.updateMany({ where: { key, value: { equals: registro.value || {} } }, data: { value: { owner, tentativaEm, estado: "PROCESSANDO" } } });
    if (reservado.count !== 1) { resultados.push({ tipo, ok: false, error: "CONSULTA_EM_ANDAMENTO", reason: "A consulta foi assumida por outra execução." }); continue; }
    let resultado;
    try {
      assertActive();
      const { pedidos, raw } = await serpro.listarPedidos({ ...args, tipo });
      const contratos = await reconciliarPedidosFiscais({ portalClientId, tipo, pedidos, raw, client });
      resultado = { tipo, ok: true, contratos: contratos.map(c => c.id), quantidade: contratos.length };
    } catch (err) { resultado = { tipo, ok: false, error: err.code || "CONSULTA_FALHOU", reason: err.message }; }
    // A resposta antiga não substitui reserva nova após expiração.
    await client.appSetting.updateMany({ where: { key, value: { path: ["owner"], equals: owner } }, data: { value: json({ tentativaEm, estado: "CONCLUIDA", resultado }) } });
    resultados.push(resultado);
  }
  return { resultados, ok: resultados.every(r => r.ok) };
}

/** Agenda descoberta somente para pendências, com orçamento de uma tentativa por dia/empresa. */
export async function prepararAcompanhamentoParcelamentosEmpresa({ portalClientId, client = prisma, assertActive = () => {} }) {
  const cache = await reprocessarSitfisParcelamentos({ portalClientId, client });
  const [indicacoes, contratos] = await Promise.all([
    client.parcelamentoIndicacao.findMany({ where: { portalClientId, status: "PENDENTE" } }),
    client.parcelamento.findMany({ where: { portalClientId, status: "ATIVO", fiscalSituacao: "NAO_CONFERIDO" } }),
  ]);
  const modalidades = new Set(contratos.map(c => c.tipo).filter(t => MODALIDADES_AUTOMATICAS.includes(t)));
  for (const i of indicacoes) {
    if (MODALIDADES_AUTOMATICAS.includes(i.modalidade)) modalidades.add(i.modalidade);
    else if (!i.modalidade && /PARCSN|PARCMEI|SIMPLES|MEI/i.test(i.descricao)) MODALIDADES_AUTOMATICAS.forEach(t => modalidades.add(t));
  }
  if (!modalidades.size) return { ...cache, skipped: "sem_pendencia_de_identificacao" };
  const key = `parcelamento_descoberta:${portalClientId}`;
  const anterior = await client.appSetting.findUnique({ where: { key } });
  if (anterior?.value?.tentativaEm && Date.now() - new Date(anterior.value.tentativaEm).getTime() < 86400000) return { ...cache, skipped: "consulta_recente", resultado: anterior.value.resultado };
  assertActive();
  const tentativaEm = new Date().toISOString();
  await client.appSetting.upsert({ where: { key }, create: { key, value: { tentativaEm } }, update: { value: { tentativaEm } } });
  const resultado = await localizarParcelamentosFiscais({ portalClientId, modalidades: [...modalidades], client, assertActive });
  await client.appSetting.update({ where: { key }, data: { value: json({ tentativaEm, resultado }) } });
  return { ...cache, ...resultado };
}
