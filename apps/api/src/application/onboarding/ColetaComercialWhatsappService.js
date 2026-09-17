import { prisma } from "../../infrastructure/db/prisma.js";
import { WHATSAPP_COLETA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
import { iniciarAtendimento, registrarCampos, proximaPergunta, encerrado } from "./LeadService.js";
import { identidadeDoCaso, filtroCasoDaConversa, exigirConversaDoCaso } from "./ContextoComercialService.js";
import { consultarPublicaLead } from "./FiscalLeadService.js";
import { OnboardingError } from "./OnboardingService.js";
import { coletaComercialHabilitada } from "./politicaColetaComercial.js";

const normalizar = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function pedidoOperacionalComercial(texto) {
  return /\b(guia|guias|boleto|boletos|faturamento|faturou|emitir|emissao|cancelar nota|documentos da empresa|mand[ae] o documento|envie o documento|trocar empresa|trocar de empresa|mudar de empresa)\b/.test(normalizar(texto));
}
export function identificarOrigemComercial(texto, interacao = null) {
  const id = typeof interacao === "string" ? interacao : interacao?.id || interacao?.button_reply?.id || interacao?.list_reply?.id;
  const botoes = { "altan.comercial.abertura.v1": "ABERTURA", "altan.comercial.transferencia.v1": "TRANSFERENCIA", "altan.comercial.inativa.v1": "INATIVA" };
  if (botoes[id]) return botoes[id];
  const t = normalizar(texto), tipos = [];
  if (/\b(abrir|abri|abertura|constituir)\b.{0,35}\b(empresa|cnpj|consultorio)\b|\babertura\b/.test(t)) tipos.push("ABERTURA");
  if (/\b(trocar|mudar|transferir)\b.{0,25}\b(contador|contabilidade)\b|\btransferir\b.{0,25}\bempresa\b|\btransferencia\b/.test(t)) tipos.push("TRANSFERENCIA");
  if (/\b(empresa|cnpj)\b.{0,30}\b(parad[ao]|inativ[ao]|regularizar)\b|\bregularizar\b.{0,25}\b(empresa|cnpj)\b/.test(t)) tipos.push("INATIVA");
  return tipos.length === 1 ? tipos[0] : tipos.length > 1 ? "MULTIPLOS" : null;
}
function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const digito = base => { let soma = 0, peso = base.length - 7; for (const d of base) { soma += Number(d) * peso--; if (peso < 2) peso = 9; } const resto = soma % 11; return resto < 2 ? 0 : 11 - resto; };
  return digito(cnpj.slice(0, 12)) === Number(cnpj[12]) && digito(cnpj.slice(0, 13)) === Number(cnpj[13]);
}
export function interpretarColetaComercial({ texto, origem, campoEsperado = null }) {
  const raw = String(texto || "").trim(), t = normalizar(raw), campos = new Map();
  const set = (campo, valor) => campos.set(campo, { campo, acao: "set", valor });
  const desconhecido = /\b(nao sei|nao tenho certeza|ainda nao sei|nao tenho ideia|a definir)\b/.test(t);
  const humano = /\b(falar com (alguem|uma pessoa|o contador|a equipe|atendente)|atendimento humano|quero um contador|reclamacao)\b/.test(t);
  const pergunta = /\?|\b(quanto custa|qual o valor|como funciona|voces fazem|o que inclui|quais documentos|quanto tempo)\b/.test(t);
  let resposta = pergunta ? "Podemos preparar uma proposta com os serviços e valores para seu caso. O contador confere o escopo antes do envio; você pode contratar só o serviço ou também a contabilidade mensal." : null;
  const nome = raw.match(/\b(?:me chamo|meu nome [ée]|nome\s*:)\s*([^;\n.,]+)/i)?.[1];
  if (nome?.trim()) set("responsavelNome", nome.trim());
  const email = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (email) set("responsavelEmail", email.toLowerCase());
  if (/\b(so|somente|apenas)\b.{0,20}\b(abrir|abertura|avulso|servico)|\bsem (mensalidade|contabilidade mensal)\b/.test(t)) set("modalidadeServico", "AVULSO");
  else if (/\b(comparar|duas opcoes|as duas|ambas)\b/.test(t)) set("modalidadeServico", "COMPARAR");
  else if (/\b(com|tambem|quero|preciso)\b.{0,25}\bcontabilidade\b|\bcontabilidade mensal\b/.test(t) && !/\b(trocar|mudar)\b/.test(t)) set("modalidadeServico", "RECORRENTE");
  const cnpj = raw.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)?.[0]?.replace(/\D/g, "");
  if (cnpj && origem !== "ABERTURA") {
    if (cnpjValido(cnpj)) set("cnpj", cnpj); else resposta = "Esse CNPJ não passou na conferência dos dígitos. Pode conferir e enviar novamente?";
  }
  const rotulos = { atividade: "atividadePretendida", cidade: "municipioAtendimento", municipio: "municipioAtendimento", endereço: "enderecoPretendido", endereco: "enderecoPretendido" };
  for (const [rotulo, campo] of Object.entries(rotulos)) { const v = raw.match(new RegExp(`(?:^|[;\\n])\\s*${rotulo}\\s*:\\s*([^;\\n]+)`, "i"))?.[1]; if (v && (origem === "ABERTURA" || campo === "municipioAtendimento")) set(campo, v.trim()); }
  if (origem === "ABERTURA") {
    const atividade = raw.match(/\bsou\s+(m[ée]dic[oa]|dentista|advogad[oa]|engenheir[oa]|psic[óo]log[oa]|arquiteto|arquiteta)\b/i)?.[1];
    if (atividade) set("atividadePretendida", atividade);
  }
  if (/\b(nao (tenho|tera|tem)|sem|nenhum)\b.{0,15}\bfuncionarios?\b/.test(t)) set("qtdFuncionarios", 0);
  else { const qtd = t.match(/\b(\d{1,4})\s+funcionarios?\b/)?.[1]; if (qtd) set("qtdFuncionarios", Number(qtd)); }
  const notas = t.match(/\b(\d{1,5})\s+notas?\b/)?.[1]; if (notas && /receb|compra|despesa/.test(t)) set("notasRecebidasMes", Number(notas));
  if (origem === "INATIVA") {
    if (/\b(reativar|voltar a (usar|operar|funcionar))\b/.test(t)) set("pretendeReativar", "REATIVAR");
    else if (/\b(dar baixa|encerrar a empresa|fechar a empresa)\b/.test(t)) set("pretendeReativar", "BAIXAR");
    else if (/\bindeciso\b/.test(t) || desconhecido && campoEsperado === "pretendeReativar") set("pretendeReativar", "INDECISO");
  }
  if (campoEsperado && !campos.has(campoEsperado) && !desconhecido && !pergunta && !humano && !identificarOrigemComercial(raw) && !/^(obrigad[oa]|ok|sim|nao|oi|ola)[.! ]*$/.test(t) && !campos.size) {
    if (["responsavelNome", "atividadePretendida", "municipioAtendimento", "enderecoPretendido", "motivoTroca"].includes(campoEsperado) && raw.length >= 2 && raw.length <= 1000) set(campoEsperado, raw);
    if (["qtdFuncionarios", "notasRecebidasMes"].includes(campoEsperado) && /^\d{1,5}$/.test(t)) set(campoEsperado, Number(t));
    if (campoEsperado === "qtdFuncionarios" && /^(nenhum|zero|nao tenho|sem funcionarios)$/.test(t)) set(campoEsperado, 0);
    if (campoEsperado === "paradaDesde") { const mes = raw.match(/^(\d{2})\/(\d{4})$/); if (mes && Number(mes[1]) >= 1 && Number(mes[1]) <= 12) set(campoEsperado, `${mes[2]}-${mes[1]}`); }
  }
  return { operacoes: [...campos.values()], desconhecido: desconhecido && campoEsperado && !campos.has(campoEsperado) ? campoEsperado : null, humano, resposta };
}

export async function coletarComercialWhatsapp({ registro, item = {}, contexto = null, deps = {} } = {}) {
  const db = deps.client || prisma, agora = deps.agora || new Date();
  if (!(deps.flag ?? WHATSAPP_COLETA_COMERCIAL)) return { tratado: false, motivo: "COLETA_DESLIGADA" };
  const conversa = registro?.conversa, mensagem = registro?.mensagem;
  const piloto = deps.piloto || IA_COMERCIAL_TELEFONES_PILOTO;
  if (!conversa || !mensagem || !coletaComercialHabilitada(conversa.telefoneE164, { flag: true, piloto, canal: registro.canal, canalId: conversa.canalId })) return { tratado: false, motivo: "FORA_DO_PILOTO" };
  if (registro.vinculo?.situacao === "AMBIGUO") return { tratado: false, motivo: "IDENTIDADE_EM_REVISAO" };
  if (pedidoOperacionalComercial(item.corpo || mensagem.corpo)) return { tratado: false, motivo: "PEDIDO_OPERACIONAL" };
  const inicial = await db.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
  const anterior = await db.coletaComercialWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
  const bloqueada = c => !c || c.excluidaEm || c.atendidaPor || c.atendidaDesde || c.automacaoInvalidadaEm && new Date(mensagem.registradaEm) <= new Date(c.automacaoInvalidadaEm);
  const proprioHandoff = c => anterior?.resultado?.handoffEm && !c?.atendidaPor && c?.atendidaDesde && new Date(c.atendidaDesde).toISOString() === anterior.resultado.handoffEm;
  if (bloqueada(proprioHandoff(inicial) ? { ...inicial, atendidaDesde: null } : inicial)) return { tratado: false, motivo: "AUTOMACAO_INVALIDADA" };
  const interlocutorId = await identidadeDoCaso(inicial, db);
  const pessoa = interlocutorId ? await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }) : null;
  if (pessoa && (pessoa.estado !== "ATIVO" || pessoa.atendidaPor || pessoa.atendidaDesde && !proprioHandoff(pessoa))) return { tratado: false, motivo: "IDENTIDADE_OU_HUMANO" };
  const identidadeVersao = pessoa?.versao || 0;
  const escopo = filtroCasoDaConversa(inicial, interlocutorId);
  const existente = await db.atendimentoLead.findFirst({ where: { ...escopo, encerradoEm: null }, include: { onboarding: true } });
  const origem = identificarOrigemComercial(item.corpo || mensagem.corpo, item.interacao);
  if (!existente && (!origem || origem === "MULTIPLOS")) return { tratado: false, motivo: origem === "MULTIPLOS" ? "MULTIPLOS_PEDIDOS" : "SEM_INTENCAO_COMERCIAL" };
  const persistido = await db.$transaction(async tx => {
    const atual = await tx.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    if (bloqueada(proprioHandoff(atual) ? { ...atual, atendidaDesde: null } : atual) || atual.vinculoNumeroId !== inicial.vinculoNumeroId || atual.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou durante a coleta.", 409);
    await identidadeDoCaso(atual, tx, { travar: true });
    const recibo = await tx.coletaComercialWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
    if (recibo) return recibo;
    if (interlocutorId) { const p = await tx.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && !proprioHandoff(p)) throw new OnboardingError("identidade_alterada", "A identificação mudou durante a coleta.", 409); }
    let caso = await iniciarAtendimento({ conversaId: atual.id, origem: existente ? null : origem, client: tx });
    await exigirConversaDoCaso(caso, atual, tx);
    if (!caso.onboarding || encerrado(caso.onboarding)) throw new OnboardingError("atendimento_encerrado", "A solicitação não está em coleta.", 409);
    const triagem = caso.triagem || {};
    if (triagem.ultimaMensagemEm && new Date(mensagem.registradaEm) < new Date(triagem.ultimaMensagemEm)) return { resultado: { texto: null }, atendimentoLeadId: caso.id, identidadeVersao };
    const desconhecidos = [...(triagem.desconhecidos || [])];
    const esperada = proximaPergunta(caso.onboarding, { desconhecidos });
    // No primeiro pedido ainda não fizemos uma pergunta. "Minha empresa está
    // parada e não sei o que fazer" não significa que a pessoa desconhece o CNPJ.
    const leitura = interpretarColetaComercial({ texto: item.corpo || mensagem.corpo, origem: caso.onboarding.origem, campoEsperado: triagem.campoEsperado || (!origem ? esperada.campo : null) });
    const mudouOrigem = origem && origem !== caso.onboarding.origem;
    let encaminhar = leitura.humano || Boolean(mudouOrigem);
    if (!mudouOrigem && leitura.operacoes.length) caso.onboarding = await registrarCampos({ onboardingId: caso.onboardingId, versao: caso.onboarding.versao, operacoes: leitura.operacoes, mensagemId: mensagem.id, client: tx });
    if (leitura.desconhecido && !desconhecidos.includes(leitura.desconhecido)) desconhecidos.push(leitura.desconhecido);
    const proxima = proximaPergunta(caso.onboarding, { desconhecidos });
    const semInterpretacao = !leitura.operacoes.length && !leitura.desconhecido && !leitura.resposta && !origem && !leitura.humano;
    const esclarecimentos = semInterpretacao ? (triagem.esclarecimentos || 0) + 1 : 0;
    encaminhar ||= esclarecimentos > 1 || !proxima.campo || leitura.desconhecido === "cnpj";
    const texto = encaminhar ? mudouOrigem ? "Entendi que há outra solicitação. Vou chamar a equipe para separar os atendimentos e preservar os dados já informados." : "Registrei as informações. A equipe vai conferir o escopo e continuar o atendimento por aqui."
      : [leitura.resposta, leitura.desconhecido ? "Sem problema não saber agora; deixei essa informação para o contador conferir." : null, semInterpretacao ? "Não consegui identificar essa informação. " + proxima.pergunta : proxima.pergunta].filter(Boolean).join("\n\n");
    const handoffEm = encaminhar ? agora : null;
    if (encaminhar) {
      await tx.conversaWhatsapp.update({ where: { id: atual.id }, data: { atendidaDesde: agora } });
      if (interlocutorId) await tx.interlocutorComunicacao.update({ where: { id: interlocutorId }, data: { atendidaDesde: agora } });
    }
    const salva = await tx.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, triagem: { ...triagem, desconhecidos, campoEsperado: proxima.campo, esclarecimentos, ultimaMensagemEm: new Date(mensagem.registradaEm).toISOString(), ...(mudouOrigem ? { proximaSolicitacao: { origem, mensagemId: mensagem.id } } : {}) } } });
    return tx.coletaComercialWhatsapp.create({ data: { mensagemId: mensagem.id, atendimentoLeadId: caso.id, identidadeVersao, resultado: { texto, onboardingId: caso.onboardingId, atendimentoId: caso.id, casoVersao: salva.versao, fichaVersao: caso.onboarding.versao, cnpj: caso.onboarding.cnpj || null, consultarPublica: Boolean(caso.onboarding.cnpj && leitura.operacoes.some(o => o.campo === "cnpj")), encaminhar, handoffEm: handoffEm?.toISOString() || null, contexto: { interlocutorId, vinculoNumeroId: atual.vinculoNumeroId || null, canalId: atual.canalId || null, identidadeVersao } } } });
  });
  let resultado = persistido.resultado;
  if (!resultado.texto) return { tratado: true, resultado, motivo: "MENSAGEM_ANTIGA" };
  const conferir = async () => {
    const c = await db.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    const handoffDoTurno = resultado.handoffEm && !c?.atendidaPor && c?.atendidaDesde && new Date(c.atendidaDesde).toISOString() === resultado.handoffEm;
    if (bloqueada(handoffDoTurno ? { ...c, atendidaDesde: null } : c) || c.vinculoNumeroId !== inicial.vinculoNumeroId || c.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou antes da resposta.", 409);
    const caso = await db.atendimentoLead.findUnique({ where: { id: persistido.atendimentoLeadId }, include: { onboarding: true } });
    await exigirConversaDoCaso(caso, c, db);
    if (caso.versao !== resultado.casoVersao || caso.onboarding?.versao !== resultado.fichaVersao) throw new OnboardingError("atendimento_alterado", "A ficha mudou antes da resposta.", 409);
    if (interlocutorId) { const p = await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== persistido.identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && (!resultado.handoffEm || new Date(p.atendidaDesde).toISOString() !== resultado.handoffEm)) throw new OnboardingError("identidade_alterada", "A identificação ou o responsável mudou antes da resposta.", 409); }
    await deps.conferirContexto?.(resultado.contexto);
    return c;
  };
  await conferir();
  if (resultado.consultarPublica) {
    try {
      const consulta = await (deps.consultaPublica || consultarPublicaLead)(resultado.onboardingId, { db });
      const detalhe = [consulta.razaoSocial, consulta.atividadePrincipal, consulta.endereco, [consulta.municipio, consulta.uf].filter(Boolean).join(" / ")].filter(Boolean).join(" · ");
      resultado = { ...resultado, consultarPublica: false, texto: `Consultei os dados públicos: ${detalhe || "dados disponíveis"}. Situação cadastral: ${consulta.situacaoCadastral || "não informada"}. Isso não comprova regularidade fiscal.\n\n${resultado.texto}` };
    } catch { resultado = { ...resultado, consultarPublica: false, texto: `Não foi possível concluir a consulta pública agora; deixei o CNPJ registrado para a equipe conferir.\n\n${resultado.texto}` }; }
    await conferir();
    await db.coletaComercialWhatsapp.update({ where: { mensagemId: mensagem.id }, data: { resultado } });
  }
  if (deps.enviar) await deps.enviar({ conversa: await conferir(), texto: resultado.texto, referenciaComercial: { tipo: "COLETA_COMERCIAL", mensagemOrigemId: mensagem.id, atendimentoId: persistido.atendimentoLeadId }, antesDeEnviar: conferir, resultado });
  return { tratado: true, resultado, motivo: resultado.encaminhar ? "ENCAMINHADA" : "COLETA_COMERCIAL" };
}
