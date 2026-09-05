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
export async function registrarEnvio({ guideId, canal, destino, reenviar = false, tx = prisma }) {
  // ⚠ A CHAVE INCLUI O DESTINO desde 05/09/2026: mandar a mesma guia para OUTRO telefone não é
  // repetir, é outro destinatário. `destino` nulo é a linha LEGADA (ver `linhaLegadoDoEmail`).
  const alvo = destino || null;
  const existente = await tx.envioGuia.findFirst({
    where: { guideId: String(guideId), canal, destino: alvo },
  });
  if (existente && STATUS_TERMINAL.includes(existente.status)) {
    // ⚠ REENVIAR É DECISÃO DO CONTADOR, e ele a toma depois de a tela dizer que a guia já foi
    // (decisão do dono, 05/09/2026). Sem o pedido explícito, o comportamento é o de antes: recusa.
    // ⚠ O LOTE NUNCA passa `reenviar` — é o que impede a carteira inteira de sair duas vezes num
    // clique. Quem passa é o envio POR GUIA.
    if (!reenviar) return { envio: existente, jaEnviado: true };
  }
  if (existente) {
    // Retentativa limpa o erro anterior: erro velho ao lado de uma tentativa nova confunde mais que
    // ajuda, e o histórico do que falhou vive no log.
    const envio = await tx.envioGuia.update({
      where: { id: existente.id },
      data: { status: "pendente", erroCodigo: null, erroMensagemUsuario: null },
    });
    return { envio, jaEnviado: false, reenvio: STATUS_TERMINAL.includes(existente.status) };
  }
  const envio = await tx.envioGuia.create({
    data: { guideId: String(guideId), canal, destino: alvo, status: "pendente" },
  });
  return { envio, jaEnviado: false };
}

/**
 * RESERVA O ENVIO PARA ESTA TENTATIVA — e devolve se conseguiu.
 *
 * ⚠ NÃO É UM `update` SIMPLES, E A DIFERENÇA É A CORRIDA. `registrarEnvio` é check-then-act: entre
 * o `findUnique` e o `upsert` cabe outra requisição (duplo clique no botão, ou o lote rodando junto
 * do envio individual da mesma guia). As duas passariam pela verificação de "já enviado" antes de
 * qualquer uma escrever, e a guia sairia DUAS VEZES para o cliente.
 *
 * O idioma é o mesmo que este projeto já usa nas baixas (`updateMany` condicional dentro do estado
 * anterior, seguido de `count === 1`): quem conseguir mover `pendente → enviando` é quem manda; a
 * segunda tentativa recebe `false` e desiste **antes** de gastar upload e mensagem.
 *
 * `pendente` é o único estado que autoriza — é exatamente o que `registrarEnvio` acabou de gravar.
 * `enviando` não autoriza (há um envio em curso), e os terminais já foram barrados lá em cima.
 */
export async function marcarEnviando(envioId, tx = prisma) {
  const r = await tx.envioGuia.updateMany({
    where: { id: String(envioId), status: "pendente" },
    data: { status: "enviando", tentativas: { increment: 1 } },
  });
  return { reservado: r.count === 1 };
}

/**
 * A LINHA DE ENVIO QUE O HISTÓRICO DE E-MAIL DESTA GUIA JÁ PROVA — ou `null`. PURA.
 *
 * ⚠⚠ ESTA FUNÇÃO EXISTE POR CAUSA DA ARMADILHA MAIS CARA DESTA TABELA, e ela merece ser lida
 * inteira antes de qualquer mexida aqui.
 *
 * `foiEnviadaComLegado` desliga a tolerância na PRIMEIRA linha que existir para a guia
 * (`if (envios && envios.length)`). Enquanto ninguém escrevia em `envios_guia`, toda guia valia
 * pelo `emailStatus` antigo e a tela estava correta. O envio por WhatsApp é o **primeiro escritor
 * de produção** desta tabela — e, sem cuidado, ele produziria exatamente o estrago que o backfill
 * produziria:
 *
 *   guia já enviada por e-mail (`emailStatus: SENT`, nenhuma linha em `envios_guia`)
 *   → alguém tenta mandá-la também por WhatsApp e a Meta recusa
 *   → passa a existir UMA linha (`WHATSAPP/falhou`)
 *   → a tolerância se desliga e a guia vira **não enviada** — apesar de o cliente TER recebido.
 *
 * Card do dashboard eternamente aberto, "✓ Guias concluídas" que nunca condensa.
 *
 * A saída não é enfraquecer a tolerância (ela é o que segura a carteira inteira): é **trazer o
 * legado junto** no instante em que a guia é tocada. Quem liga a tabela para uma guia materializa,
 * na mesma transação, o que o e-mail dela já provava.
 *
 * ⚠ **SÓ `SENT` VIRA LINHA — e é aí que isto difere do backfill.** O backfill converte TODOS os
 * estados (`PENDING`/`SENDING` → `pendente`, `ERROR` → `falhou`), e é essa conversão que congela em
 * "não enviada" toda guia que estivesse pendente no instante em que ele roda. Aqui, um estado que
 * não seja `SENT` **não gera linha nenhuma**: a resposta do legado para ele já era "não enviada",
 * então não há nada a preservar e não se inventa histórico. A consequência é uma invariante que dá
 * para provar: **tocar uma guia por WhatsApp nunca rebaixa a resposta do `guideCompliance`.**
 *
 * ⚠ `destino` fica NULO de propósito. O destino é do ENVIO, não do cadastro — e para um e-mail
 * enviado antes desta tabela existir ninguém sabe para onde foi. Copiar o
 * `guideNotificationEmail` de hoje afirmaria um endereço que pode ter mudado desde então.
 */
export function linhaLegadoDoEmail(guide) {
  if (String(guide?.emailStatus || "").toUpperCase() !== "SENT") return null;
  return {
    guideId: String(guide.id),
    canal: CANAL.EMAIL,
    status: "enviado",
    destino: null,
    enviadoEm: guide.emailSentAt || null,
    tentativas: Number(guide.emailAttempts || 0),
  };
}

/**
 * Grava a linha acima, se houver e se ainda não existir. Idempotente pela unique `(guideId, canal)`.
 *
 * Devolve `{ materializou }` — o chamador registra isso no log/resposta, porque é uma escrita que
 * ninguém pediu explicitamente e que muda o que a tela responde sobre aquela guia.
 */
export async function materializarEnvioDeEmailLegado(guide, tx = prisma) {
  const linha = linhaLegadoDoEmail(guide);
  if (!linha) return { materializou: false };
  // ⚠ `findFirst` com `destino: null`, não `findUnique`: a chave passou a incluir o destino, e a
  // linha legada é justamente a que não tem um. Quem garante que ela é única é o índice PARCIAL da
  // migration `20260905150000` — este `if` é a leitura, o índice é a garantia.
  const existente = await tx.envioGuia.findFirst({
    where: { guideId: linha.guideId, canal: linha.canal, destino: null },
  });
  if (existente) return { materializou: false };
  await tx.envioGuia.create({ data: linha });
  return { materializou: true };
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

/**
 * FALHA vinda do webhook (`statuses[].status === "failed"`).
 *
 * ⚠ **POR QUE ELA NÃO PASSA POR `aplicarStatusDoProvedor`.** Aquela função traduz qualquer status
 * que não seja `read`/`delivered` para **`enviado`** (`const novo = … : "enviado"`). Entregar-lhe um
 * `failed` PROMOVERIA a falha a enviada: a guia apareceria concluída no chip, com "✓ Guias
 * concluídas" no card, para um cliente que não recebeu nada. Falha já tem função própria
 * (`marcarFalhou`), e é ela que se usa.
 *
 * ⚠ **ELA REBAIXA, E ISSO É O CONTRÁRIO DA REGRA "NUNCA REBAIXA" — na parte que importa.** O que
 * `aplicarStatusDoProvedor` protege é a escada de SUCESSO chegando fora de ordem. Aqui:
 *   · de `pendente`/`enviando`/`enviado` o rebaixamento é obrigatório — `enviado` é exatamente o
 *     estado em que a guia fica quando a Meta ACEITA a chamada e só depois descobre que não
 *     entrega, e é esse o caso que o webhook de `failed` existe para contar;
 *   · de `entregue`/`lido` o estado FICA. Esses dois são confirmação do aparelho do cliente; um
 *     `failed` posterior é contradição, não novidade. A contradição sobe no retorno em vez de
 *     apagar uma entrega comprovada.
 *
 * ⚠ `proximaTentativaEm` fica NULO de propósito. Quem responde "posso tentar de novo?" é
 * `errosMeta.podeTentarDeNovo` — com `true`/`false`/**`null`** —, e neste projeto **não existe laço
 * que drene retentativa** (`emailNextRetryAt` já é o precedente: gravado e sem leitor; os loops
 * automáticos saíram na Q55). Gravar um instante que ninguém lê seria uma promessa de reenvio que
 * não acontece.
 *
 * @returns {null|{envio, aplicada: boolean, motivo: string|null}} `null` = nenhum envio de guia com
 *   esse `providerMessageId` (caso NORMAL: o status pode ser de uma mensagem de conversa, que não é
 *   envio de guia nenhum).
 */
export async function aplicarFalhaDoProvedor({ providerMessageId, codigo, mensagemUsuario }, tx = prisma) {
  const envio = await tx.envioGuia.findFirst({ where: { providerMessageId: String(providerMessageId) } });
  if (!envio) return null;
  if (envio.status === "entregue" || envio.status === "lido") {
    return { envio, aplicada: false, motivo: "CHEGADA_JA_CONFIRMADA" };
  }
  const atualizado = await marcarFalhou(
    { envioId: envio.id, codigo, mensagemUsuario, proximaTentativaEm: null },
    tx,
  );
  return { envio: atualizado, aplicada: true, motivo: null };
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
