// O ENVIO DA GUIA PELO WHATSAPP — individual e em LOTE. É o MVP da Entrega 1 (plano, P0).
//
// ⚠ ESTE É O PRIMEIRO ESCRITOR DE PRODUÇÃO DE `envios_guia`. Até aqui as funções de escrita de
// `EnvioGuiaService` não tinham um chamador sequer fora dos testes, e por isso `foiEnviadaComLegado`
// fazia TODA guia valer pelo `emailStatus` antigo. A partir daqui a tolerância começa a se desligar
// — para as guias que este serviço tocar, e só para elas. O que impede isso de virar estrago está em
// `EnvioGuiaService.linhaLegadoDoEmail` (leia o cabeçalho dela: é a armadilha mais cara desta
// tabela) e é exercido por `guides/__tests__/complianceAposEnvioWhatsapp.test.js`.
//
// ⚠ **`scripts/backfill-envio-guia.mjs` CONTINUA PROIBIDO.** Este serviço NÃO o substitui e NÃO o
// autoriza: ele converte TODOS os estados de uma vez (`PENDING`/`ERROR` viram `pendente`/`falhou`) e
// congelaria em "não enviada", para sempre, toda guia que estivesse pendente naquele instante. Aqui
// a conversão é **por guia tocada** e **só do que é `SENT`** — o oposto.
//
// ── AS CAMADAS, E O QUE CADA UMA JÁ RESOLVIA ────────────────────────────────────────────────────
//   `elegibilidadeEnvioGuia.js`  a regra pura: pode mandar? por que não? cai para qual canal?
//   `WhatsappCloudClient`        a conversa com a Meta (upload do PDF + template), `fetch` injetável
//   `errosMeta`                  a tradução do erro e as TRÊS respostas de "posso tentar de novo?"
//   `EnvioGuiaService`           ⚠ O ESTADO DO ENVIO MORA LÁ. Nada de tabela nem estado paralelo
//   `ContatoWhatsappService`     quem recebe — e o MOTIVO quando não há ninguém
//   `ConversaWhatsappService`    o fio (o balão de saída aponta para o envio por `envioGuiaId`)
//   `GuideService`               o PDF, pelo mesmo caminho do e-mail (`getGuidePdfBuffer`)
//
// ── ⚠ NADA SAI COM A FLAG OFF, EM AMBIENTE NENHUM ──────────────────────────────────────────────
// `INTEGRACAO_WHATSAPP` nasce OFF. Desligada, a recusa é DECLARADA (`INTEGRACAO_DESLIGADA`), com o
// motivo na resposta — e a guia continua no lote, caindo para e-mail. Duas guardas independentes: a
// deste serviço (que nem chega a registrar envio) e a do próprio cliente HTTP, que recusa operar.

import { prisma } from "../../infrastructure/db/prisma.js";
import {
  INTEGRACAO_WHATSAPP,
  WHATSAPP_TEMPLATE_GUIA,
  WHATSAPP_ENVIO_DELAY_MS,
  log as logPadrao,
} from "../../config.js";
import {
  WhatsappCloudClient,
  WhatsappError,
  variaveisDaGuia,
  nomeArquivoDaGuia,
  mascararTelefone,
} from "./WhatsappCloudClient.js";
import {
  destinatarioWhatsapp,
  destinatariosDeEnvio,
  gravarWaIdDoContato,
} from "./ContatoWhatsappService.js";
import { registrarMensagemEnviada } from "./ConversaWhatsappService.js";
import { avaliarCanal, avaliarLinha, CANAIS, MOTIVOS } from "./elegibilidadeEnvioGuia.js";
import { getGuidePdfBuffer } from "../guides/GuideService.js";
import { guideTypeEmailLabel } from "../guides/guideEmailCopy.js";
import { dataCivilBR } from "../../utils/dataCivil.js";
import {
  CANAL,
  enviosPorGuia,
  foiEnviadaComLegado,
  marcarEnviado,
  marcarEnviando,
  marcarFalhou,
  materializarEnvioDeEmailLegado,
  registrarEnvio,
} from "../guides/EnvioGuiaService.js";

export class EnvioGuiaWhatsappError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = extra.status || 400;
    Object.assign(this, extra);
  }
}

/** Recusas do próprio serviço, além das de `elegibilidadeEnvioGuia`. */
export const MOTIVOS_SERVICO = Object.freeze({
  ENVIO_EM_ANDAMENTO: "ENVIO_EM_ANDAMENTO",
  GUIA_SEM_PDF: "GUIA_SEM_PDF",
  /**
   * ⚠ A guia não tem valor gravado. A 4ª variável do template é o valor — mandá-la vazia produz
   * "Valor: R$ " no celular do cliente, e o zero por omissão afirmaria uma dívida de R$ 0,00.
   */
  GUIA_SEM_VALOR: "GUIA_SEM_VALOR",
  RECUSADA_PELA_META: "RECUSADA_PELA_META",
  /**
   * ⚠⚠ ERRO NOSSO, NÃO DA META (05/09/2026).
   *
   * O `catch` do envio marcava TODA exceção como `RECUSADA_PELA_META` — inclusive as que nunca
   * chegaram à Meta. Medido em produção: uma falha com `codigo=null` (ou seja, NÃO era um
   * `WhatsappError`) foi gravada como recusa da Meta, e o contador leu que "a Meta recusou" sobre um
   * defeito nosso. ⚠ Afirmar a origem errada de uma falha manda a pessoa consertar no lugar errado.
   *
   * Toda falha de transporte e toda recusa da Meta JÁ viram `WhatsappError` (o cliente as traduz).
   * Sobrar daqui significa exceção inesperada: bug nosso, ou banco.
   */
  FALHA_INESPERADA: "FALHA_INESPERADA",
});

/** Os campos da guia que o envio precisa — um `select` só, para os dois caminhos. */
export const SELECT_GUIA_PARA_ENVIO = Object.freeze({
  id: true,
  portalClientId: true,
  tipo: true,
  competencia: true,
  valor: true,
  vencimento: true,
  status: true,
  sourcePath: true,
  // ⚠ O legado do e-mail viaja junto porque é ele que `linhaLegadoDoEmail` materializa antes de a
  // primeira linha de `envios_guia` desligar a tolerância. Sem estes três campos aqui, o serviço
  // teria de reler a guia no meio do envio.
  emailStatus: true,
  emailSentAt: true,
  emailAttempts: true,
});

/**
 * O PDF DA GUIA — buscado POR ID, na hora de enviar.
 *
 * ⚠⚠ ELE NÃO VEM NO `SELECT_GUIA_PARA_ENVIO`, E ISSO É DELIBERADO NOS DOIS SENTIDOS.
 *
 * `getGuidePdfBuffer` lê `guide.pdfBytes` e `guide.storageKey`. Nenhum dos dois está naquele
 * `select` — e coluna fora de `select` explícito volta `undefined`, **sem erro nenhum**. O
 * resultado, medido em produção em 05/09/2026: `GUIA_SEM_PDF` em TODA guia, sempre, com o PDF
 * gravado no banco (160.184 bytes na guia que recusou). O e-mail da MESMA guia saiu com o anexo no
 * mesmo instante — ele carrega a guia inteira, sem `select`.
 *
 * ⚠ A saída NÃO é pôr `pdfBytes` no `select`: ele também alimenta o LOTE (`executarLote`), que lê
 * N guias de uma vez. Um `Bytes` por linha ali carrega a carteira inteira de PDFs na memória para
 * enviar um por um. O byte é buscado onde é usado — uma guia, no instante do envio.
 *
 * ⚠ Quinta vez que esta família de defeito morde este projeto (`legacyCompanySelect`,
 * `codigosServicoNacional`, carga tributária, `codigoMunicipioIbge`). O teste não pegou porque
 * `carregarPdf` é INJETÁVEL e todo teste injetava um dublê: o loader real nunca rodou ao lado do
 * `select` real. Seam que esconde defeito é seam sem teste de ligação.
 */
export async function carregarPdfDaGuia(guide, client = prisma) {
  if (!guide?.id) return null;
  const completo = await client.guide.findUnique({
    where: { id: String(guide.id) },
    select: { pdfBytes: true, storageKey: true },
  });
  return getGuidePdfBuffer(completo);
}

// ⚠ Cópia local e deliberada: `competenciaPorExtenso` de `RelatorioFaturamentoService` é privada, e
// importar um serviço de apuração dentro do módulo de WhatsApp para pegar doze strings acoplaria os
// dois por nada. Formatação de apresentação, não regra.
const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** `"2026-07"` → `"Julho/2026"`. Formato do esqueleto do dono [E]. Sem competência, string vazia. */
export function competenciaPorExtenso(competencia) {
  const [ano, mes] = String(competencia || "").split("-");
  const i = Number(mes) - 1;
  if (!ano || !MESES_PT[i]) return String(competencia || "");
  return `${MESES_PT[i]}/${ano}`;
}

/**
 * `1243.8` → `"1.243,80"`. Valor entra no template JÁ FORMATADO (ver `variaveisDaGuia`).
 *
 * ⚠⚠ AUSÊNCIA NÃO VIRA ZERO (05/09/2026). `Number(null)` é `0`, que é finito — então guia sem valor
 * gravado saía para o cliente afirmando **R$ 0,00**, dentro de uma mensagem sobre imposto a pagar.
 * A guarda é por **TIPO ACEITO**, nunca por lista de recusas: enumerar `null`/`undefined`/`""`
 * deixaria `[]` passar (`Number([])` também é `0`). É a mesma lição de `dispensadaPeloPiso`
 * (retenção federal) e de `formatarPAliq` (alíquota do ISS) — a terceira vez neste projeto.
 *
 * Sem valor, devolve `""` — e quem chama RECUSA o envio (`GUIA_SEM_VALOR`), porque a 4ª variável do
 * template é o valor e mandá-la vazia produz "Valor: R$ " no celular do cliente.
 */
export function valorFormatado(valor) {
  const ehNumero = typeof valor === "number";
  const ehTextoNumerico = typeof valor === "string" && valor.trim() !== "";
  // Decimal do Prisma chega como objeto com `toNumber`/`toString` — é dado de verdade, não ausência.
  const ehDecimal = valor !== null && typeof valor === "object" && typeof valor.toString === "function"
    && String(valor).trim() !== "" && Number.isFinite(Number(valor));
  if (!ehNumero && !ehTextoNumerico && !ehDecimal) return "";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * O CANAL — uma consulta por lote (a flag + o template no banco).
 *
 * ⚠ O estado do template é LIDO DO BANCO, nunca suposto. Hoje ele responde `DECLARADO` para as cinco
 * chaves (nenhuma foi submetida à Meta), e a resposta correta é RECUSAR dizendo isso.
 */
export async function carregarCanal({ chaveTemplate = WHATSAPP_TEMPLATE_GUIA, integracaoLigada = INTEGRACAO_WHATSAPP } = {}) {
  // Com a flag OFF nem se consulta o banco: a resposta já está decidida, e ler o template daria a
  // impressão de que faltava só a aprovação.
  if (!integracaoLigada) return avaliarCanal({ integracaoLigada: false, template: null, chaveTemplate });
  const template = await prisma.templateWhatsapp.findUnique({ where: { chave: String(chaveTemplate) } });
  return avaliarCanal({ integracaoLigada: true, template, chaveTemplate });
}

/**
 * A PRÉVIA DO LOTE — a tabela que o contador confere ANTES de qualquer mensagem sair.
 *
 * ⚠ NENHUMA LINHA SOME. Empresa sem contato, sem opt-in, ou com o canal indisponível aparece com o
 * motivo e `canalSugerido: "EMAIL"`. Guia já enviada aparece marcada como tal (não é oferecida de
 * novo, e também não desaparece — o painel precisa dizer que ela já foi).
 *
 * ⚠ "Já enviada" é a MESMA pergunta do dashboard (`foiEnviadaComLegado`): envios registrados quando
 * existem, `emailStatus: SENT` como tolerância enquanto não existirem. Uma segunda definição aqui
 * faria a prévia e o chip discordarem sobre a mesma guia.
 */
export async function preverLote({ portalClientIds, competencia, guideIds = null, chaveTemplate = WHATSAPP_TEMPLATE_GUIA }) {
  const ids = [...new Set((portalClientIds || []).map((v) => String(v || "").trim()).filter(Boolean))];
  const comp = String(competencia || "").trim();
  if (!ids.length) throw new EnvioGuiaWhatsappError("EMPRESAS_OBRIGATORIAS", "Informe ao menos uma empresa.");
  if (!/^\d{4}-\d{2}$/.test(comp)) {
    throw new EnvioGuiaWhatsappError("COMPETENCIA_INVALIDA", "Informe a competência no formato AAAA-MM.");
  }

  const canal = await carregarCanal({ chaveTemplate });

  const guias = await prisma.guide.findMany({
    where: {
      // ⚠ O escopo vem de fora (`empresasVisiveis` / `requireFirmCompanyAccess`) e viaja no `where`.
      portalClientId: { in: ids },
      competencia: comp,
      // `VAZIO` (ausência confirmada) não tem PDF e não se envia; `ERROR`/`NEEDS_REVIEW` também não.
      status: "PROCESSED",
      ...(Array.isArray(guideIds) && guideIds.length ? { id: { in: guideIds.map(String) } } : {}),
    },
    select: { ...SELECT_GUIA_PARA_ENVIO, portalClient: { select: { id: true, razao: true, cnpj: true } } },
    orderBy: [{ portalClientId: "asc" }, { tipo: "asc" }],
  });

  const envios = await enviosPorGuia(guias.map((g) => g.id));

  // Um destinatário por EMPRESA, não por guia: a empresa que tem cinco guias no lote responde uma
  // vez só, e o motivo da falta é o mesmo para as cinco.
  const empresasDoLote = [...new Set(guias.map((g) => g.portalClientId).filter(Boolean))];
  const destinatarios = new Map();
  // ⚠⚠ TODOS OS TELEFONES, como no envio por guia (05/09/2026). O lote mandava para UM contato (o
  // primeiro com opt-in) enquanto a rota individual mandava para TODOS — a MESMA guia saía para
  // gente diferente conforme o botão que o contador clicasse, e a prévia mostrava um telefone só.
  const telefonesPorEmpresa = new Map();
  for (const portalClientId of empresasDoLote) {
    // eslint-disable-next-line no-await-in-loop
    destinatarios.set(portalClientId, await destinatarioWhatsapp(portalClientId));
    // eslint-disable-next-line no-await-in-loop
    const { telefones } = await destinatariosDeEnvio(portalClientId);
    telefonesPorEmpresa.set(portalClientId, telefones);
  }

  const linhas = guias.map((g) => {
    const enviosDaGuia = envios.get(g.id) || [];
    const jaEnviada = foiEnviadaComLegado(enviosDaGuia, g);
    const destinatario = destinatarios.get(g.portalClientId) || { contato: null, motivo: "sem contato de WhatsApp cadastrado" };
    const avaliacao = avaliarLinha({ canal, guide: g, destinatario, envios: enviosDaGuia, jaEnviada });
    return {
      guideId: g.id,
      portalClientId: g.portalClientId,
      empresa: g.portalClient?.razao || null,
      cnpj: g.portalClient?.cnpj || null,
      tipo: g.tipo,
      tipoLabel: guideTypeEmailLabel(g.tipo),
      competencia: g.competencia,
      valor: g.valor != null ? Number(g.valor) : null,
      vencimento: g.vencimento || null,
      jaEnviada,
      canalSugerido: avaliacao.canalSugerido,
      // ⚠ O destino sai do CONTATO só na PRÉVIA (é para onde mandaríamos hoje). O destino do ENVIO
      // é gravado no próprio envio, na hora — são coisas diferentes, e confundi-las já fez o
      // popover mostrar "enviada por WhatsApp para fulano@email.com".
      destino: avaliacao.contato?.telefoneE164 || null,
      contatoNome: avaliacao.contato?.nome || null,
      // ⚠⚠ TODOS os telefones cadastrados desta empresa (05/09/2026). `destino` continua sendo o
      // primeiro, para a tela e para o contrato antigo; quem ENVIA percorre esta lista. Sem ela, o
      // lote mandava para um só, e a decisão do dono — *"enviar para todos os canais cadastrados"* —
      // valia no botão da guia e não valia no lote.
      destinatarios: avaliacao.contato ? (telefonesPorEmpresa.get(g.portalClientId) || []) : [],
      motivo: avaliacao.motivo,
      aviso: avaliacao.mensagem,
    };
  });

  const porWhatsapp = linhas.filter((l) => l.canalSugerido === CANAIS.WHATSAPP);
  const porEmail = linhas.filter((l) => l.canalSugerido === CANAIS.EMAIL);
  const jaEnviadas = linhas.filter((l) => l.jaEnviada);

  return {
    competencia: comp,
    canal,
    linhas,
    // ⚠ ESTES SÃO OS NÚMEROS QUE A CONFIRMAÇÃO TEM DE REPETIR. Ver `executarLote`.
    resumo: {
      total: linhas.length,
      porWhatsapp: porWhatsapp.length,
      porEmail: porEmail.length,
      jaEnviadas: jaEnviadas.length,
    },
  };
}

/**
 * ENVIA UMA GUIA POR WHATSAPP. Individual — e é também o passo do lote.
 *
 * ⚠ A ORDEM DAS ESCRITAS É A GARANTIA, e cada passo existe por um motivo:
 *
 *   1. **materializa o legado do e-mail** — ANTES de qualquer linha de WhatsApp existir, senão a
 *      tolerância se desliga e uma guia já entregue por e-mail vira "não enviada" (ver
 *      `linhaLegadoDoEmail`);
 *   2. **`registrarEnvio`** — idempotência: envio TERMINAL naquele canal devolve `jaEnviado` e nada
 *      é disparado. Envio que FALHOU volta a `pendente` e pode ser tentado de novo (foi por isso que
 *      o dono recusou a `UNIQUE (guia_id, canal)` do esqueleto: aqui a unique existe, e quem
 *      distingue "de novo" de "duas vezes" é o ESTADO da linha, não a existência dela);
 *   3. **`marcarEnviando`** — a reserva ATÔMICA (`pendente → enviando`). É ela que impede o duplo
 *      clique e o lote correndo junto do individual de mandarem a mesma guia duas vezes;
 *   4. o upload do PDF e o template;
 *   5. **`marcarEnviado`** com o `wamid` — é por ele que o webhook (do outro lado) casa
 *      `entregue`/`lido` depois.
 */
export async function enviarGuiaPorWhatsapp({
  guide,
  contato,
  canal,
  /**
   * ⚠⚠ ELE PRECISA DE DEFAULT, e a falta dele era um defeito de PRODUÇÃO (05/09/2026).
   *
   * A rota (`whatsappGuias.js`) nunca passou `cliente` — nem antes nem depois da mudança de hoje —,
   * e sem default isto chegava `undefined` em `cliente.enviarGuia`, estourando
   * `TypeError: Cannot read properties of undefined`. O envio de guia POR GUIA nunca funcionou.
   *
   * ⚠ Ficou escondido porque a recusa `GUIA_SEM_PDF` abortava ANTES desta linha, e ela também era
   * defeito (o `select` não trazia os bytes). Dois defeitos na MESMA execução: consertar o primeiro
   * só descobriu o segundo. Aqui é o segundo.
   *
   * ⚠ `executarLote` já fazia certo (`cliente || new WhatsappCloudClient()`), e é essa assimetria
   * que enganava: o lote construía o cliente, o individual esperava recebê-lo de alguém.
   * ⚠ Continua INJETÁVEL — é o que trava a rede nos testes.
   */
  cliente = new WhatsappCloudClient(),
  carregarPdf = carregarPdfDaGuia,
  log = logPadrao,
  reenviar = false,
}) {
  const { materializou } = await materializarEnvioDeEmailLegado(guide);

  const { envio, jaEnviado } = await registrarEnvio({
    guideId: guide.id,
    canal: CANAL.WHATSAPP,
    destino: contato.telefoneE164,
    // ⚠ Só com o pedido explícito do contador — ver `registrarEnvio`.
    reenviar,
  });
  if (jaEnviado) {
    return { ok: true, enviada: false, jaEnviada: true, guideId: guide.id, envioId: envio.id, legadoMaterializado: materializou };
  }

  const { reservado } = await marcarEnviando(envio.id);
  if (!reservado) {
    // Outra requisição já está mandando ESTA guia. Recusar aqui é o que impede a segunda cópia de
    // chegar ao cliente — e é recusa nomeada, não erro genérico.
    return {
      ok: false,
      guideId: guide.id,
      envioId: envio.id,
      motivo: MOTIVOS_SERVICO.ENVIO_EM_ANDAMENTO,
      mensagem: "Já existe um envio desta guia em andamento — aguarde o resultado antes de tentar de novo.",
      podeTentarDeNovo: true,
      legadoMaterializado: materializou,
    };
  }

  const tipoLabel = guideTypeEmailLabel(guide.tipo);
  const competenciaLabel = competenciaPorExtenso(guide.competencia);

  try {
    // ⚠⚠ SEM VALOR, NÃO SAI. A 4ª variável do template é o valor; vazia, o cliente lê "Valor: R$ "
    // — e o zero por omissão seria pior ainda ("Valor: R$ 0,00" sobre uma guia a pagar). A recusa é
    // NOSSA e vem antes do upload: nada é gasto, e o conserto (o valor da guia) é nomeado.
    const valorDaGuia = valorFormatado(guide.valor);
    if (!valorDaGuia) {
      const mensagem = "Esta guia está sem valor gravado — sem ele a mensagem sairia dizendo um valor "
        + "que não existe. Reprocesse a guia antes de enviar.";
      await marcarFalhou({
        envioId: envio.id,
        codigo: MOTIVOS_SERVICO.GUIA_SEM_VALOR,
        mensagemUsuario: mensagem,
        proximaTentativaEm: null,
      });
      return {
        ok: false, guideId: guide.id, envioId: envio.id,
        motivo: MOTIVOS_SERVICO.GUIA_SEM_VALOR, mensagem, podeTentarDeNovo: false,
        legadoMaterializado: materializou,
      };
    }

    const conteudoPdf = await carregarPdf(guide);
    if (!conteudoPdf?.length) {
      // ⚠ "Registro existe, arquivo não" é caso REAL neste projeto (o volume do Railway é efêmero).
      // Falha declarada, com o motivo que o contador consegue agir.
      const mensagem = "O PDF desta guia não está disponível no armazenamento — recapture a guia antes de enviar.";
      await marcarFalhou({
        envioId: envio.id,
        codigo: MOTIVOS_SERVICO.GUIA_SEM_PDF,
        mensagemUsuario: mensagem,
        proximaTentativaEm: null,
      });
      return {
        ok: false, guideId: guide.id, envioId: envio.id,
        motivo: MOTIVOS_SERVICO.GUIA_SEM_PDF, mensagem, podeTentarDeNovo: false,
        legadoMaterializado: materializou,
      };
    }

    const comecouEm = Date.now();
    const { wamid, waId, input } = await cliente.enviarGuia({
      telefone: contato.telefoneE164,
      conteudoPdf,
      nomeArquivo: nomeArquivoDaGuia({ tipoGuia: tipoLabel, competencia: guide.competencia }),
      template: canal.nomeMeta,
      variaveis: variaveisDaGuia({
        // Primeiro nome, como no esqueleto do dono [E]: a mensagem cumprimenta a pessoa.
        nomeContato: String(contato.nome || "").trim().split(/\s+/)[0] || "",
        tipoGuia: tipoLabel,
        competencia: competenciaLabel,
        valorFormatado: valorDaGuia,
        // ⚠ `dataCivilBR`, nunca `toLocaleDateString` sem fuso: `Guide.vencimento` é DATA CIVIL em
        // meia-noite UTC, e o e-mail já anunciou vencimento um dia antes por causa disso.
        vencimentoFormatado: guide.vencimento ? dataCivilBR(guide.vencimento) : "",
      }),
    });

    await marcarEnviado({ envioId: envio.id, providerMessageId: wamid });

    // ⚠⚠ O LOG DE SUCESSO — ele NÃO EXISTIA, e a falta dele custou três rodadas de investigação em
    // 05/09/2026. Uma guia que "saiu" e não chegou não deixava uma linha sequer ligando guia,
    // envio, destino e `wamid`; a única evidência era a linha do banco, que não diz quando nem quem.
    //
    // ⚠ SEM SEGREDO E SEM DADO PESSOAL INTEIRO: telefone e `wa_id` mascarados, e **nenhuma variável
    // do template** (a 1ª é o nome do cliente e a 4ª é o valor da guia) — só a contagem delas.
    log?.info?.(
      {
        evento: "whatsapp.envio.aceito",
        guideId: guide.id,
        envioId: envio.id,
        portalClientId: guide.portalClientId,
        competencia: guide.competencia,
        tipoGuia: tipoLabel,
        canal: CANAL.WHATSAPP,
        destino: mascararTelefone(contato.telefoneE164),
        waId: mascararTelefone(waId),
        // ⚠ A Meta reescreveu o número? É o nono dígito aparecendo — e é o que o webhook vai usar.
        destinoReescritoPelaMeta: Boolean(waId) && waId !== contato.telefoneE164,
        wamid,
        template: canal.nomeMeta,
        variaveisContagem: 5,
        bytesPdf: conteudoPdf.length,
        duracaoMs: Date.now() - comecouEm,
        reenvio: reenviar === true,
      },
      "guia enviada por WhatsApp",
    );

    // ⚠ A COLUNA `waId` DO CONTATO NUNCA TEVE ESCRITOR — o schema afirmava que ela era "descoberta
    // no primeiro contato" e nada a descobria; o ramo `casouPor: "WA_ID"` de `vinculoTelefone` era
    // código morto. Este é o único momento em que a Meta diz qual número ELA usa, e é ele que volta
    // no webhook: sem gravá-lo, a resposta do cliente com o nono dígito diferente cai na fila de
    // "não vinculados". ⚠ BEST-EFFORT pelo mesmo motivo do balão: a mensagem já saiu.
    try {
      await gravarWaIdDoContato({ contatoId: contato.id, waId });
    } catch (e) {
      log?.warn?.({ err: e?.message || e, envioId: envio.id }, "guia enviada, mas o waId do contato não foi gravado");
    }

    // O balão no fio. ⚠ BEST-EFFORT: a mensagem JÁ saiu para o cliente; falha ao registrar histórico
    // não pode virar "falhou" e mandar o contador reenviar.
    try {
      await registrarMensagemEnviada({
        telefone: contato.telefoneE164,
        portalClientId: guide.portalClientId,
        tipo: "template",
        providerMessageId: wamid,
        envioGuiaId: envio.id,
      });
    } catch (e) {
      log?.warn?.({ err: e?.message || e, guideId: guide.id }, "guia enviada por WhatsApp, mas o balão do fio não foi registrado");
    }

    return {
      ok: true, enviada: true, jaEnviada: false, guideId: guide.id, envioId: envio.id,
      providerMessageId: wamid, destino: contato.telefoneE164, legadoMaterializado: materializou,
    };
  } catch (err) {
    const traduzido = err instanceof WhatsappError;
    const mensagem = traduzido
      ? err.mensagemUsuario
      : "Não foi possível enviar a guia por WhatsApp agora — houve uma falha inesperada no servidor, "
        + "e ela ficou registrada no log. Não é recusa da Meta.";
    // ⚠ TRÊS RESPOSTAS, NÃO DUAS. `podeTentarDeNovo` vem de `errosMeta` e vale `true`/`false`/`null`
    // — e `null` NÃO é `false` disfarçado: significa que a documentação da Meta descreve o erro sem
    // dizer se reenviar resolve. Ele sobe para a tela como está, para o contador decidir.
    const podeTentarDeNovo = traduzido ? err.podeTentarDeNovo : null;
    await marcarFalhou({
      envioId: envio.id,
      codigo: traduzido ? err.codigo : MOTIVOS_SERVICO.FALHA_INESPERADA,
      mensagemUsuario: mensagem,
      // ⚠ `proximaTentativaEm` FICA NULO, DE PROPÓSITO — inclusive quando a fonte diz que dá para
      // reenviar. NADA drena esse campo hoje (é o defeito já documentado de `emailNextRetryAt`:
      // escrito pelo worker de e-mail e nunca lido por ninguém). Gravar uma data aqui prometeria uma
      // fila que não existe. O que se oferece honestamente é o botão "tentar de novo", e é isso que
      // `podeTentarDeNovo` na resposta habilita.
      proximaTentativaEm: null,
    });
    // ⚠⚠ A MENSAGEM DO ERRO ENTRA NO LOG, e a ausência dela era um buraco de diagnóstico medido em
    // produção: a linha saía `codigo=null` e mais nada, então uma falha inesperada era
    // indistinguível de qualquer outra — não havia como saber O QUE quebrou sem outro deploy.
    // ⚠ Nada aqui carrega segredo: `WhatsappCloudClient` garante que token e headers não saem em
    // erro nenhum, e o que sobra é mensagem da nossa própria pilha.
    log?.warn?.(
      {
        guideId: guide.id,
        codigo: traduzido ? err.codigo : MOTIVOS_SERVICO.FALHA_INESPERADA,
        podeTentarDeNovo,
        err: err?.message || String(err),
        tipo: err?.name || typeof err,
        // ⚠ Sem o `fbtrace_id` não se abre chamado com a Meta — e ele só existia no log do cliente.
        ...(traduzido
          ? {
            codigoMeta: err.codigoMeta ?? null,
            httpStatus: err.httpStatus ?? null,
            fbtraceId: err.fbtraceId ?? null,
            onde: err.onde ?? null,
          }
          : {}),
        ...(traduzido ? {} : { pilha: String(err?.stack || "").slice(0, 300) }),
      },
      "envio de guia por WhatsApp falhou",
    );
    return {
      ok: false, guideId: guide.id, envioId: envio.id,
      motivo: traduzido ? err.codigo : MOTIVOS_SERVICO.FALHA_INESPERADA,
      mensagem, podeTentarDeNovo, legadoMaterializado: materializou,
    };
  }
}

/**
 * ⚠ ATO DE CONSEQUÊNCIA: A CONFIRMAÇÃO REPETE OS NÚMEROS.
 *
 * Enviar guia ao cliente é irreversível — a mensagem chega no celular dele. Mesmo padrão do
 * `totalConferido` da baixa de parcela e do estorno (`CONFERENCIA_DIVERGENTE`): o servidor recalcula
 * a prévia no instante do clique e compara com o que a tela disse ter mostrado. Se divergiu, a
 * carteira mudou entre abrir a tela e clicar (uma guia nova capturada, um opt-in registrado, um
 * envio que outra sessão acabou de fazer) — e o contador estaria confirmando um lote diferente do
 * que viu.
 *
 * A conferência é sobre os TRÊS números que a frase de confirmação repete: total, quantos por
 * WhatsApp e quantos por e-mail ("enviar 23 guias da competência Julho — 19 por WhatsApp, 4 por
 * e-mail").
 */
export function conferirLote(resumoAtual, conferencia) {
  if (!conferencia || typeof conferencia !== "object") {
    throw new EnvioGuiaWhatsappError(
      "CONFERENCIA_OBRIGATORIA",
      "Confirme os números do lote antes de enviar: quantas guias, quantas por WhatsApp e quantas por e-mail.",
      { status: 400, resumo: resumoAtual },
    );
  }
  const iguais = ["total", "porWhatsapp", "porEmail"].every(
    (k) => Number(conferencia[k]) === Number(resumoAtual[k]),
  );
  if (!iguais) {
    throw new EnvioGuiaWhatsappError(
      "CONFERENCIA_DIVERGENTE",
      `O lote mudou desde que a tela foi aberta: agora são ${resumoAtual.total} guia(s) — `
      + `${resumoAtual.porWhatsapp} por WhatsApp e ${resumoAtual.porEmail} por e-mail. Confira de novo.`,
      { status: 409, resumo: resumoAtual, conferencia },
    );
  }
}

/**
 * ENVIA A MESMA GUIA PARA TODOS OS DESTINATÁRIOS DA EMPRESA — uma definição só (05/09/2026).
 *
 * ⚠⚠ ELA EXISTE PORQUE HAVIA DUAS. A rota individual percorria `destinatariosDeEnvio(...).telefones`
 * (todos) e o lote mandava para `destinatarioWhatsapp(...)` (o primeiro com opt-in): a MESMA guia
 * saía para gente diferente conforme o botão que o contador clicasse, e a prévia do lote mostrava
 * um telefone só. Duas regras para "quem recebe" divergem na primeira correção — e esta já tinha
 * divergido.
 *
 * ⚠ SEQUENCIAL, sem parâmetro de concorrência: cada destinatário é uma chamada à Meta, e o
 * espaçamento protege a qualidade do número, que é o canal de TODOS os clientes de uma vez.
 *
 * ⚠⚠ O RESUMO NÃO ESCONDE FALHA. Com dois destinatários, um entregue e um falhado, o retorno diz
 * `parcial: true` e carrega o motivo de QUEM FALHOU — antes, o chamador espalhava `resultados[0]` e
 * a falha do segundo simplesmente não existia para a tela.
 */
export async function enviarParaTodosOsDestinatarios({
  guide,
  linha,
  canal,
  cliente,
  carregarPdf,
  log,
  reenviar = false,
  destinatarios = null,
}) {
  const lista = (destinatarios || linha?.destinatarios || []).filter((c) => String(c?.telefoneE164 || "").trim());
  // ⚠ Sem lista, o comportamento é o de antes: o contato único que a prévia escolheu. É o que
  // mantém funcionando quem chama esta função sem passar destinatários.
  const alvos = lista.length ? lista : [{ telefoneE164: linha?.destino, nome: linha?.contatoNome }];

  const resultados = [];
  for (const contato of alvos) {
    // eslint-disable-next-line no-await-in-loop
    resultados.push(await enviarGuiaPorWhatsapp({ guide, contato, canal, cliente, carregarPdf, log, reenviar }));
  }

  const enviadas = resultados.filter((r) => r.ok && r.enviada !== false).length;
  const falhou = resultados.find((r) => !r.ok) || null;
  const algumOk = resultados.some((r) => r.ok);
  // O corpo base é o do primeiro resultado (contrato antigo), MAS o motivo e a mensagem vêm de quem
  // falhou, quando alguém falhou — é o que impede a falha de sumir atrás de um sucesso.
  const base = resultados[0] || {};
  return {
    ...base,
    ok: algumOk,
    destinatarios: resultados.length,
    enviadas,
    falhas: resultados.length - resultados.filter((r) => r.ok).length,
    parcial: Boolean(falhou) && algumOk,
    ...(falhou
      ? { motivo: falhou.motivo, mensagem: falhou.mensagem, podeTentarDeNovo: falhou.podeTentarDeNovo }
      : {}),
    resultados,
  };
}

/**
 * O LOTE. Prévia → conferência → envio em série, com espaçamento.
 *
 * ⚠ EM SÉRIE E ESPAÇADO, e não é preciosismo: número novo na Meta tem teto de conversas iniciadas
 * por 24h, e disparar em paralelo é o caminho mais curto para derrubar a qualidade do número — que
 * é o canal de TODOS os clientes de uma vez. Precedente do projeto: `ADN_DELAY_MS` no
 * `dfeNotasWorker`, também em série, também com `setTimeout` entre chamadas.
 *
 * ⚠ AS LINHAS DE E-MAIL NÃO SÃO ENVIADAS AQUI. Elas voltam na resposta, nomeadas, para o chamador
 * usar o caminho de e-mail que já existe (`runGuideEmailWorkerSelected`) — reescrever o envio de
 * e-mail aqui dentro seria uma segunda implementação do que já funciona.
 */
export async function executarLote({
  portalClientIds,
  competencia,
  guideIds = null,
  conferencia = null,
  chaveTemplate = WHATSAPP_TEMPLATE_GUIA,
  cliente = null,
  carregarPdf = carregarPdfDaGuia,
  delayMs = WHATSAPP_ENVIO_DELAY_MS,
  log = logPadrao,
  aoProgredir = null,
}) {
  const previa = await preverLote({ portalClientIds, competencia, guideIds, chaveTemplate });
  conferirLote(previa.resumo, conferencia);

  const paraWhatsapp = previa.linhas.filter((l) => l.canalSugerido === CANAIS.WHATSAPP);
  const paraEmail = previa.linhas.filter((l) => l.canalSugerido === CANAIS.EMAIL);

  const clienteUsado = cliente || new WhatsappCloudClient();
  const resultados = [];

  // As guias vêm da prévia (que já filtrou por escopo); aqui só se recarrega o que o envio precisa.
  // ⚠ O escopo VIAJA DE NOVO no `where`. Os ids já vieram filtrados, mas buscar guia só pelo id é
  // exatamente a forma dos dois furos de multi-tenancy que a F1 teve de fechar — a segunda leitura
  // não pode ser a que confia.
  const guiasPorId = new Map(
    (paraWhatsapp.length
      ? await prisma.guide.findMany({
        where: {
          id: { in: paraWhatsapp.map((l) => l.guideId) },
          portalClientId: { in: [...new Set(paraWhatsapp.map((l) => l.portalClientId))] },
        },
        select: SELECT_GUIA_PARA_ENVIO,
      })
      : []).map((g) => [g.id, g]),
  );

  for (let i = 0; i < paraWhatsapp.length; i += 1) {
    const linha = paraWhatsapp[i];
    const guide = guiasPorId.get(linha.guideId);
    let resultado;
    if (!guide) {
      resultado = {
        ok: false, guideId: linha.guideId, motivo: MOTIVOS.GUIA_NAO_PROCESSADA,
        mensagem: "A guia não está mais disponível para envio.", podeTentarDeNovo: false,
      };
    } else {
      // eslint-disable-next-line no-await-in-loop
      resultado = await enviarParaTodosOsDestinatarios({
        guide,
        linha,
        canal: previa.canal,
        cliente: clienteUsado,
        carregarPdf,
        log,
      });
    }
    resultados.push({ ...linha, ...resultado });
    aoProgredir?.({ atual: i + 1, total: paraWhatsapp.length, resultado: resultados[i] });

    if (delayMs > 0 && i < paraWhatsapp.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, delayMs); });
    }
  }

  return {
    competencia: previa.competencia,
    canal: previa.canal,
    resumo: previa.resumo,
    whatsapp: {
      total: paraWhatsapp.length,
      enviadas: resultados.filter((r) => r.ok && r.enviada).length,
      jaEnviadas: resultados.filter((r) => r.jaEnviada).length,
      falhas: resultados.filter((r) => !r.ok),
      resultados,
    },
    // ⚠ NUNCA SOMEM: as que não puderam ir por WhatsApp voltam com o motivo, para o chamador
    // mandá-las por e-mail. Elas contam no total que a confirmação repetiu.
    email: {
      total: paraEmail.length,
      guideIds: paraEmail.map((l) => l.guideId),
      linhas: paraEmail,
    },
  };
}
