// O ESTADO DE ENVIO DE UMA GUIA — agora por canal.
//
// ⚠ POR QUE ESTA CAMADA EXISTE
// Até aqui quem respondia "esta guia foi enviada?" era `Guide.emailStatus`. Não era um detalhe do
// e-mail: é dele que `guideCompliance.resolveNode` deriva o estado `enviada`, e daí saem o chip da
// listagem, o selo "Guias concluídas" e a barra de progresso. Funcionava com UM canal.
//
// Com o WhatsApp, um campo só não representa "enviada por WhatsApp, ainda não por e-mail" — e o
// contador pode escolher "Ambos". Daqui em diante `envios_guia` é a fonte da verdade do ENVIO, e
// `emailStatus` continua existindo como detalhe de transporte do e-mail (o worker segue escrevendo
// nele, e o backfill garante que nada nasce sem histórico).

import { prisma } from "../../infrastructure/db/prisma.js";

export const CANAL = Object.freeze({ EMAIL: "EMAIL", WHATSAPP: "WHATSAPP" });

/** Estados em que não há mais nada a fazer — a guia chegou. */
export const STATUS_TERMINAL = Object.freeze(["enviado", "entregue", "lido"]);

/**
 * A guia foi enviada?
 *
 * ⚠ TERMINAL EM QUALQUER CANAL BASTA. Se foi por e-mail e o WhatsApp falhou, ela chegou — cobrar
 * o segundo canal seria transformar uma escolha de conveniência em pendência. O contrário também
 * vale: enviada só por WhatsApp é enviada.
 */
export function foiEnviada(envios) {
  return (envios || []).some((e) => STATUS_TERMINAL.includes(String(e.status)));
}

/**
 * A mesma pergunta, tolerando guia que ainda não foi convertida pelo backfill.
 *
 * ⚠ POR QUE ESTE CAMINHO EXISTE
 * Entre o deploy e o `backfill-envio-guia.mjs` há uma janela: a tabela está vazia e o código já lê
 * dela. Sem esta tolerância, nessa janela a carteira INTEIRA aparece como não enviada — e o
 * contador reenvia guias que o cliente já recebeu. Depender de "rodar o script rápido" seria trocar
 * uma garantia por uma corrida.
 *
 * Não é invenção: `emailStatus: SENT` é exatamente o dado que o backfill converteria. A tolerância
 * só vale quando NÃO existe nenhum envio registrado — assim que houver um, ele manda, e uma guia
 * cujo e-mail falhou mas o WhatsApp entregou continua sendo lida corretamente pelos envios.
 *
 * É caminho de TRANSIÇÃO: depois do backfill rodado em todos os ambientes, ele fica inerte.
 */
export function foiEnviadaComLegado(envios, guideLegado) {
  if (envios && envios.length) return foiEnviada(envios);
  return String(guideLegado?.emailStatus || "").toUpperCase() === "SENT";
}

/** O envio mais "adiantado" — é o que o popover do chip mostra. */
export function envioParaExibir(envios) {
  const ordem = { lido: 4, entregue: 3, enviado: 2, enviando: 1, pendente: 0, falhou: -1 };
  return (envios || [])
    .slice()
    .sort((a, b) => (ordem[b.status] ?? -2) - (ordem[a.status] ?? -2))[0] || null;
}

/**
 * Registra a intenção de enviar. Idempotente por `(guideId, canal)` — é o que faz reexecutar o
 * lote não redisparar nada.
 *
 * Devolve `{ envio, jaEnviado }`: quem chama precisa saber que não deve mandar de novo, e o painel
 * de revisão do lote precisa mostrar "já enviada" em vez de fingir que vai enviar.
 */
export async function registrarEnvio({ guideId, canal, destino, tx = prisma }) {
  const existente = await tx.envioGuia.findUnique({
    where: { guideId_canal: { guideId: String(guideId), canal } },
  });
  if (existente && STATUS_TERMINAL.includes(existente.status)) {
    return { envio: existente, jaEnviado: true };
  }
  const envio = await tx.envioGuia.upsert({
    where: { guideId_canal: { guideId: String(guideId), canal } },
    create: { guideId: String(guideId), canal, destino: destino || null, status: "pendente" },
    // Retentativa limpa o erro anterior: erro velho ao lado de uma tentativa nova confunde mais que
    // ajuda, e o histórico do que falhou vive no log.
    update: { destino: destino || null, status: "pendente", erroCodigo: null, erroMensagemUsuario: null },
  });
  return { envio, jaEnviado: false };
}

export async function marcarEnviando(envioId, tx = prisma) {
  return tx.envioGuia.update({
    where: { id: String(envioId) },
    data: { status: "enviando", tentativas: { increment: 1 } },
  });
}

export async function marcarEnviado({ envioId, providerMessageId }, tx = prisma) {
  return tx.envioGuia.update({
    where: { id: String(envioId) },
    data: {
      status: "enviado",
      providerMessageId: providerMessageId || null,
      enviadoEm: new Date(),
      erroCodigo: null,
      erroMensagemUsuario: null,
      proximaTentativaEm: null,
    },
  });
}

/**
 * ⚠ O erro chega aqui JÁ TRADUZIDO. Código cru da Meta não passa deste ponto: a tela mostra o que
 * o contador tem que fazer, não um número. Mesma lição do `validation_failed`, que exibia o código
 * e escondia o campo.
 */
export async function marcarFalhou({ envioId, codigo, mensagemUsuario, proximaTentativaEm }, tx = prisma) {
  return tx.envioGuia.update({
    where: { id: String(envioId) },
    data: {
      status: "falhou",
      erroCodigo: codigo ? String(codigo) : null,
      erroMensagemUsuario: mensagemUsuario || null,
      proximaTentativaEm: proximaTentativaEm || null,
    },
  });
}

/**
 * Status vindo do webhook (`delivered` / `read`).
 *
 * ⚠ NUNCA REBAIXA. A Meta entrega eventos fora de ordem: um `delivered` atrasado chegando depois do
 * `read` faria a mensagem "desler". A comparação por peso é o que impede isso.
 */
export async function aplicarStatusDoProvedor({ providerMessageId, status }, tx = prisma) {
  const envio = await tx.envioGuia.findFirst({ where: { providerMessageId: String(providerMessageId) } });
  if (!envio) return null;

  const peso = { pendente: 0, enviando: 1, enviado: 2, entregue: 3, lido: 4 };
  const novo = status === "read" ? "lido" : status === "delivered" ? "entregue" : "enviado";
  if ((peso[novo] ?? 0) <= (peso[envio.status] ?? 0)) return envio;

  return tx.envioGuia.update({
    where: { id: envio.id },
    data: {
      status: novo,
      ...(novo === "entregue" ? { entregueEm: new Date() } : {}),
      ...(novo === "lido" ? { lidoEm: new Date(), entregueEm: envio.entregueEm || new Date() } : {}),
    },
  });
}

/** Envios de um conjunto de guias, agrupados — uma query para a listagem inteira. */
export async function enviosPorGuia(guideIds) {
  const ids = [...new Set((guideIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const envios = await prisma.envioGuia.findMany({ where: { guideId: { in: ids } } });
  const mapa = new Map();
  for (const e of envios) {
    if (!mapa.has(e.guideId)) mapa.set(e.guideId, []);
    mapa.get(e.guideId).push(e);
  }
  return mapa;
}
