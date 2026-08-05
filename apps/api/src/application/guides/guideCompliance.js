import { prisma } from "../../infrastructure/db/prisma.js";
import { GUIDE_COMPLIANCE_COMPETENCIA } from "../../config.js";
// Faturamento vem da MESMA função que a apuração usa. Duas definições de "o mês teve receita"
// fariam o chip da guia e o fechamento discordarem — com o contador no meio.
import { faturamentoEmitPorEmpresa } from "../notas/apuracao/v2/FechamentoService.js";
import { enviosPorGuia, foiEnviadaComLegado, envioParaExibir } from "./EnvioGuiaService.js";

/**
 * Competência YYYY-MM usada para alertas de guia (env fixo ou mês civil anterior).
 */
export function getReferenceCompetencia(now = new Date()) {
  const forced = String(GUIDE_COMPLIANCE_COMPETENCIA || "").trim();
  if (/^\d{4}-\d{2}$/.test(forced)) return forced;

  const y = now.getFullYear();
  const m = now.getMonth();
  if (m === 0) return `${y - 1}-12`;
  const prev = m;
  return `${y}-${String(prev).padStart(2, "0")}`;
}

function isRegimeSimples(regimeTributario) {
  return String(regimeTributario || "")
    .trim()
    .toUpperCase() === "SIMPLES";
}

function isRegimePresumido(regimeTributario) {
  const r = String(regimeTributario || "").trim().toUpperCase();
  return r === "LUCRO_PRESUMIDO" || r === "LUCRO_REAL";
}

function normalizeRegimeFromLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const r = legacy.regimeTributario ?? legacy.tipoTributario;
  return r != null ? String(r).trim() : null;
}

function getRequirements({ hasProlabore, regimeTributario, hasParcDasAtivo }) {
  const presumido = isRegimePresumido(regimeTributario);
  return {
    inssRequired: Boolean(hasProlabore),
    // ⚠ "Mês sem faturamento" NÃO zera mais esta exigência.
    //
    // Antes ele fazia `dasRequired: false`, e a tag do DAS SUMIA da tela. A intenção era boa (não
    // deixar vermelho aceso para sempre), mas criou a ambiguidade que o redesign existe para matar:
    // chip ausente passou a significar DUAS coisas — "esta empresa não deve DAS" e "o contador
    // confirmou que não houve movimento". São coisas diferentes e o contador não tinha como saber
    // qual estava vendo.
    //
    // Agora a exigência continua, e o mês sem faturamento resolve o nó como `vazio` (cinza,
    // terminal) mais abaixo. Decisão do dono, que revoga a anterior de "sumir com a tag".
    dasRequired: isRegimeSimples(regimeTributario),
    // Tributos federais/municipais exclusivos das empresas Presumidas (LUCRO_PRESUMIDO/LUCRO_REAL).
    // Simplificação v1: todo presumido tem ISS. Refinar com flag de atividade não-serviço se necessário.
    irpjRequired: presumido,
    csllRequired: presumido,
    pisCofinsRequired: presumido,
    issRequired: presumido,
    // Parcelamento — só "required" quando há PARCELA na competência: guia de parcelamento
    // capturada (caminho SERPRO/V2) ou lançamento `PARC_DAS` em aberto (modal manual antigo).
    // Ver as duas pré-queries em `computeGuideComplianceMap`.
    parcDasRequired: Boolean(hasParcDasAtivo),
  };
}

/**
 * @param {Array<{ portalId: string, hasProlabore: boolean, legacy: object | null }>} rows
 * @param {string} competencia YYYY-MM
 * @returns {Map<string, {
 *   competencia: string,
 *   inss: { required: boolean, ok: boolean },
 *   das: { required: boolean, ok: boolean },
 *   ok: boolean,
 *   expected: "INSS"|"SIMPLES"|null
 * }>}
 */
export async function computeGuideComplianceMap(rows, competencia) {
  const map = new Map();
  const needQuery = [];

  // Pre-query: a empresa tem PARCELA nesta competência? Duas fontes, porque são dois caminhos
  // reais e nenhum cobre o outro:
  //
  // (1) `AccountingEntry` com `subtipo:"PARC_DAS"` — escrito SÓ pelo modal manual antigo
  //     (`routes/firm/accountingEntries.js`, POST /entries/parcelamento). O V1 grava
  //     `PARC_SIMPLES`/`PARC_INSS`; o V2 grava `PARC_<TIPO>` (PARC_PARCSN…) e só na competência de
  //     ABERTURA. Ou seja: esta query sozinha quase nunca casa.
  // (2) a GUIA da parcela — é assim que o caminho de hoje (SERPRO/V2) materializa a parcela do mês:
  //     `CaptureSerproParcelaService` grava uma Guide e `ParcelamentoV2Service` carimba
  //     `parcelamentoId`. O V2 NÃO cria linha por parcela (`numeroParcela: null` em todo entry).
  //
  // É a (2) que tem PDF, e-mail e vencimento — logo é ela que alimenta o chip.
  const allPortalIds = rows.map((r) => r.portalId).filter(Boolean);
  let parcDasAtivoSet = new Set();
  const parcGuiaByPortal = new Map();
  if (allPortalIds.length > 0) {
    const [parcEntries, parcGuides] = await Promise.all([
      prisma.accountingEntry.findMany({
        where: {
          portalClientId: { in: allPortalIds },
          subtipo: "PARC_DAS",
          statusPagamento: "ABERTO",
          competencia,
        },
        select: { portalClientId: true },
      }),
      prisma.guide.findMany({
        where: {
          portalClientId: { in: allPortalIds },
          competencia,
          parcelamentoId: { not: null },
          status: "PROCESSED",
        },
        select: {
          portalClientId: true, id: true, emailStatus: true, emailSentAt: true,
          numeroParcela: true, quantidadeParcelas: true,
          // Parcelamento EM DIA e parcelamento EM ATRASO pedem reações opostas do contador — um é
          // acordo funcionando, o outro é risco de rescisão. Sem vencimento e pagamento não dá para
          // distinguir os dois, e a listagem acabaria pintando os dois iguais.
          vencimento: true, paymentStatus: true,
          parcelamento: { select: { tipo: true, numeroParcelamento: true } },
        },
        orderBy: { numeroParcela: "asc" },
      }),
    ]);
    parcDasAtivoSet = new Set(parcEntries.map((e) => e.portalClientId));
    // A parcela é uma guia como as outras: o estado de envio dela vem da mesma fonte, senão o chip
    // de parcelamento continuaria preso ao e-mail enquanto os demais já leem o canal.
    const enviosDasParcelas = await enviosPorGuia(parcGuides.map((g) => g.id));
    for (const g of parcGuides) {
      // Primeiro a chegar vence — a ordem é estável e duas parcelas do mesmo parcelamento na mesma
      // competência não deveriam existir.
      if (!g.portalClientId || parcGuiaByPortal.has(g.portalClientId)) continue;
      const enviosParc = enviosDasParcelas.get(g.id) || [];
      const exibirParc = envioParaExibir(enviosParc);
      parcGuiaByPortal.set(g.portalClientId, {
        guideId: g.id,
        enviada: foiEnviadaComLegado(enviosParc, g),
        canalEnvio: exibirParc?.canal || null,
        envioStatus: exibirParc?.status || null,
        envioEm: exibirParc?.lidoEm || exibirParc?.entregueEm || exibirParc?.enviadoEm || null,
        envioErro: exibirParc?.erroMensagemUsuario || null,
        emailStatus: g.emailStatus || null,
        emailSentAt: g.emailSentAt || null,
        numeroParcela: g.numeroParcela || null,
        quantidadeParcelas: g.quantidadeParcelas || null,
        tipoParcelamento: g.parcelamento?.tipo || null,
        numeroParcelamento: g.parcelamento?.numeroParcelamento || null,
        // Vencida E não paga. `PAID` vence a data: parcela paga no vencimento não é atraso, e
        // marcar como atraso mandaria o contador atrás de algo já resolvido.
        atrasada: Boolean(
          g.vencimento
          && new Date(g.vencimento) < new Date()
          && String(g.paymentStatus || "").toUpperCase() !== "PAID",
        ),
      });
    }
  }

  // Pre-query simétrica à de cima: meses declarados SEM FATURAMENTO. Uma query para a carteira
  // inteira, não uma por empresa — mesmo molde do `GET /companies/annual`.
  let semFaturamentoSet = new Set();
  if (allPortalIds.length > 0) {
    const semFat = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: allPortalIds }, competencia, semFaturamento: true },
      select: { portalClientId: true },
    });
    semFaturamentoSet = new Set(semFat.map((c) => c.portalClientId));
  }

  for (const row of rows) {
    const regime = normalizeRegimeFromLegacy(row.legacy);
    const hasParcDasAtivo = parcDasAtivoSet.has(row.portalId) || parcGuiaByPortal.has(row.portalId);
    const req = getRequirements({
      hasProlabore: Boolean(row.hasProlabore),
      regimeTributario: regime,
      hasParcDasAtivo,
    });
    // Estado por tributo — o CICLO DE VIDA da guia, não só "tem ou não tem":
    //
    //                       ┌─→ gerada ─→ enviada        (terminais bons)
    //   missing ────────────┤
    //                       └─→ vazio                    (terminal: ausência confirmada)
    //
    // `conflito` = marcado vazio MAS há nota emitida na competência. Volta a exigir ação.
    // `na` = não exigido para o regime → o chip nem renderiza.
    const node = (required) => ({ required, ok: !required, state: required ? "missing" : "na" });
    const base = {
      competencia,
      inss: node(req.inssRequired),
      das: node(req.dasRequired),
      irpj: node(req.irpjRequired),
      csll: node(req.csllRequired),
      pisCofins: node(req.pisCofinsRequired),
      iss: node(req.issRequired),
      // Parcelamento ganha o MESMO ciclo de vida dos outros (missing → gerada → enviada). Antes era
      // `{required, ok}` sem `state`, e `todasConcluidas` no front exige estado terminal — então o
      // selo "✓ Guias concluídas" nunca condensava numa empresa com parcelamento.
      parcDas: node(req.parcDasRequired),
      ok:
        !req.inssRequired && !req.dasRequired
        && !req.irpjRequired && !req.csllRequired
        && !req.pisCofinsRequired && !req.issRequired
        && !req.parcDasRequired,
      // Compatibilidade com front antigo (CompanyCard formato legado).
      expected: req.inssRequired ? "INSS" : req.dasRequired ? "SIMPLES" : null,
    };
    map.set(row.portalId, base);
    if (
      req.inssRequired || req.dasRequired
      || req.irpjRequired || req.csllRequired
      || req.pisCofinsRequired || req.issRequired
      // Sem isto, a empresa cujo ÚNICO nó exigido é a parcela sai do laço final e fica `missing`
      // para sempre — mesmo com a guia da parcela existindo.
      || req.parcDasRequired
    ) needQuery.push(row.portalId);
  }

  if (!needQuery.length) return map;

  const portalIds = [...new Set(needQuery)];
  const guides = await prisma.guide.findMany({
    where: {
      portalClientId: { in: portalIds },
      competencia,
      // Q17: inclui marcadores VAZIO (ausência confirmada) além das guias PROCESSED.
      status: { in: ["PROCESSED", "VAZIO"] },
      // C5: "OUTRA" entra porque a captura do Lucro Presumido grava UMA DARF consolidada com
      // esse tipo (não pode ser split) — sem ela, as tags IRPJ/CSLL/PIS-COFINS do card ficavam
      // vermelhas mesmo com a guia capturada. A composição abaixo resolve o tributo de cada uma.
      tipo: { in: ["INSS", "SIMPLES", "IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "OUTRA"] },
      // ⚠ A PARCELA de parcelamento é gravada como `tipo:"SIMPLES"` (CaptureSerproParcelaService).
      // Sem este filtro ela satisfazia o nó `das`: a empresa aparecia com "DAS gerada" sem nunca
      // ter gerado o DAS do mês — foi o que o dono viu na ERISANGELA. Ela tem nó PRÓPRIO
      // (`parcDas`), alimentado pela pré-query lá em cima.
      parcelamentoId: null,
    },
    // `id`, `emailStatus` e `emailSentAt` entram para a listagem poder distinguir "gerada" de
    // "enviada" e ENVIAR direto do chip — antes ela só sabia o agregado "3 de 5 enviadas", sem
    // saber quais. Nenhuma query nova: são colunas a mais na que já existia.
    select: {
      portalClientId: true, tipo: true, status: true, extracted: true,
      id: true, emailStatus: true, emailSentAt: true,
      vazioEm: true, vazioPor: true, vazioMotivo: true,
    },
  });

  // ⚠ O ESTADO DE ENVIO NÃO SAI MAIS DE `emailStatus`.
  //
  // Ele respondia "esta guia foi enviada?" enquanto havia UM canal. Com o WhatsApp, um campo só não
  // representa "enviada por WhatsApp e ainda não por e-mail" — e o contador pode escolher "Ambos".
  // `envios_guia` tem um registro por canal; enviada = terminal em QUALQUER um deles.
  //
  // Uma query para todas as guias da carteira, no mesmo molde das pré-queries acima.
  const enviosPorGuiaId = await enviosPorGuia(guides.map((g) => g.id));

  // Faturamento da competência, uma query para a carteira inteira. É o que permite desmentir uma
  // marcação de "sem movimento" que envelheceu: nota emitida depois da marcação devolve o chip ao
  // vermelho. Mesma definição de faturamento da apuração — importada, não copiada.
  const faturamentoPorEmpresa = await faturamentoEmitPorEmpresa({ portalIds, competencia })
    .catch(() => new Map());

  const CODIGO_TO_GROUP = {
    "2089": "IRPJ", "2362": "IRPJ", "2456": "IRPJ", "0220": "IRPJ",
    "2372": "CSLL", "2484": "CSLL", "6012": "CSLL",
    "2172": "PIS_COFINS", "8109": "PIS_COFINS",
  };
  // presentByPortal = guias PROCESSED; vazioByPortal = marcadores VAZIO.
  // ⚠ Guardam o CARIMBO da guia (id, e-mail, auditoria do vazio), não só a chave: é dele que saem
  // o botão de enviar e o "quem marcou, quando" do popover.
  const presentByPortal = new Map();
  const vazioByPortal = new Map();
  const addTo = (mapp, portalId, key, stamp) => {
    if (!mapp.has(portalId)) mapp.set(portalId, new Map());
    // Primeiro a chegar vence: a query já vem ordenada de forma estável e um segundo marcador do
    // mesmo tributo não deveria existir.
    if (!mapp.get(portalId).has(key)) mapp.get(portalId).set(key, stamp);
  };
  for (const g of guides) {
    if (!g.portalClientId) continue;
    const tipo = String(g.tipo || "").toUpperCase();
    const target = g.status === "VAZIO" ? vazioByPortal : presentByPortal;
    const envios = enviosPorGuiaId.get(g.id) || [];
    const exibir = envioParaExibir(envios);
    const stamp = {
      guideId: g.id,
      // A resposta agora vem dos envios; `emailStatus` continua no carimbo só como detalhe de
      // transporte, para quem ainda quiser saber especificamente do e-mail.
      // Tolera guia ainda não convertida pelo backfill — ver `foiEnviadaComLegado`. Sem isto, a
      // janela entre o deploy e o script mostra a carteira inteira como não enviada.
      enviada: foiEnviadaComLegado(envios, g),
      canalEnvio: exibir?.canal || null,
      envioStatus: exibir?.status || null,
      envioEm: exibir?.lidoEm || exibir?.entregueEm || exibir?.enviadoEm || null,
      envioErro: exibir?.erroMensagemUsuario || null,
      // ⚠ O destino vem DO ENVIO, não do cadastro. São coisas diferentes: o cadastro diz para onde
      // mandaríamos hoje, o envio diz para onde FOI. Sem isto o popover mostrava o e-mail da
      // empresa ao lado de "enviada por WhatsApp" — e o contador iria procurar a mensagem no lugar
      // errado quando o cliente dissesse que não recebeu.
      envioDestino: exibir?.destino || null,
      emailStatus: g.emailStatus || null,
      emailSentAt: g.emailSentAt || null,
      vazioEm: g.vazioEm || null,
      vazioPor: g.vazioPor || null,
      vazioMotivo: g.vazioMotivo || null,
    };
    addTo(target, g.portalClientId, tipo, stamp);
    if (tipo === "PIS" || tipo === "COFINS") addTo(target, g.portalClientId, "PIS_COFINS", stamp);
    // DARF/OUTRA real (PROCESSED) explode pela composição; VAZIO não tem composição.
    // O `tributo` do extrato tem prioridade sobre o código (mesma regra do parser do DCTFWeb);
    // PIS e COFINS caem no mesmo grupo PIS_COFINS.
    if ((tipo === "DARF" || tipo === "OUTRA") && g.status === "PROCESSED") {
      const composicao = Array.isArray(g.extracted?.composicao) ? g.extracted.composicao : [];
      for (const c of composicao) {
        const t = String(c.tributo || "").toUpperCase();
        const group = (t === "PIS" || t === "COFINS")
          ? "PIS_COFINS"
          : (t === "IRPJ" || t === "CSLL")
            ? t
            : CODIGO_TO_GROUP[String(c.codigo || "")];
        // ⚠ Os três grupos recebem o MESMO `guideId`: no Lucro Presumido é uma DARF só para
        // IRPJ+CSLL+PIS/COFINS. Quem renderiza precisa saber disso para não oferecer três botões
        // de enviar do mesmo documento.
        if (group) addTo(presentByPortal, g.portalClientId, group, stamp);
      }
    }
  }

  /**
   * Resolve o nó no ciclo de vida. Precedência: guia real > ausência confirmada > falta.
   *
   * ⚠ A PRECEDÊNCIA É ESCRITA AQUI, de propósito. Antes ela emergia de um `if` lá em cima
   * (`semFaturamento` zerava `required` e curto-circuitava tudo), e um marcador VAZIO de SIMPLES
   * na mesma competência ficava órfão: ignorado pelo compliance, invisível na matriz, mas visível
   * na tabela de guias. Dois estados coexistiam no banco e um vencia o outro em silêncio.
   */
  const resolveNode = (node, presente, vazio, { semFaturamento = false, faturamento = 0 } = {}) => {
    if (!node.required) return { ...node, ok: true, state: "na" };

    if (presente) {
      // Guia existe: falta enviá-la ou já foi. É esta distinção que a listagem não conseguia fazer.
      //
      // ⚠ "Enviada" agora é terminal em QUALQUER canal (ver `EnvioGuiaService.foiEnviada`). Se foi
      // por e-mail e o WhatsApp falhou, ela chegou — cobrar o segundo canal transformaria uma
      // escolha de conveniência em pendência.
      return {
        ...node, ok: true, state: presente.enviada ? "enviada" : "gerada",
        guideId: presente.guideId,
        canalEnvio: presente.canalEnvio,
        envioStatus: presente.envioStatus,
        envioEm: presente.envioEm,
        envioErro: presente.envioErro,
        emailStatus: presente.emailStatus,
        emailSentAt: presente.emailSentAt,
      };
    }

    // Ausência CONFIRMADA — pelo marcador da guia ou pela afirmação de mês sem faturamento.
    if (vazio || semFaturamento) {
      // Conflito: alguém afirmou "sem movimento" e depois entrou nota emitida na competência.
      // A afirmação envelheceu e volta a exigir ação — é o oposto de deixá-la calada.
      if (faturamento > 0) {
        return {
          ...node, ok: false, state: "conflito", faturamento,
          origem: vazio ? "guia_vazia" : "sem_faturamento",
          guideId: vazio?.guideId || null,
          vazioEm: vazio?.vazioEm || null,
          vazioPor: vazio?.vazioPor || null,
        };
      }
      return {
        ...node, ok: true, state: "vazio",
        origem: vazio ? "guia_vazia" : "sem_faturamento",
        guideId: vazio?.guideId || null,
        vazioEm: vazio?.vazioEm || null,
        vazioPor: vazio?.vazioPor || null,
        vazioMotivo: vazio?.vazioMotivo || null,
      };
    }

    return { ...node, ok: false, state: "missing" };
  };

  for (const portalId of portalIds) {
    const current = map.get(portalId);
    if (!current) continue;
    const pres = presentByPortal.get(portalId) || new Map();
    const vaz = vazioByPortal.get(portalId) || new Map();
    // "Mês sem faturamento" vale SÓ para o DAS: ele afirma ausência de receita, e receita é o que
    // gera o DAS. Folha, ISS e parcelas seguem exigidas.
    const semFat = semFaturamentoSet.has(portalId);
    const faturamento = faturamentoPorEmpresa.get(portalId) || 0;

    const inss = resolveNode(current.inss, pres.get("INSS"), vaz.get("INSS"), { faturamento });
    const das = resolveNode(current.das, pres.get("SIMPLES"), vaz.get("SIMPLES"), { semFaturamento: semFat, faturamento });
    const irpj = resolveNode(current.irpj, pres.get("IRPJ"), vaz.get("IRPJ"), { faturamento });
    const csll = resolveNode(current.csll, pres.get("CSLL"), vaz.get("CSLL"), { faturamento });
    const pisCofins = resolveNode(current.pisCofins, pres.get("PIS_COFINS"), vaz.get("PIS_COFINS"), { faturamento });
    const iss = resolveNode(current.iss, pres.get("ISS"), vaz.get("ISS"), { faturamento });
    // Parcela NÃO tem marcador VAZIO (não se declara ausência de parcela contratada) e
    // `semFaturamento` não vale aqui: mês sem receita não suspende parcelamento — mesma regra já
    // escrita acima ("folha, ISS e parcelas seguem exigidas"). Por isso os dois últimos argumentos
    // ficam vazios de propósito.
    const parcGuia = parcGuiaByPortal.get(portalId);
    const parcDas = {
      ...resolveNode(current.parcDas, parcGuia, undefined, {}),
      // Contexto para o popover do chip: "PARCSN nº 123 · parcela 3/60". É o que impede o chip de
      // se apresentar como "PARC DAS" numa parcela de INSS.
      tipoParcelamento: parcGuia?.tipoParcelamento || null,
      numeroParcelamento: parcGuia?.numeroParcelamento || null,
      numeroParcela: parcGuia?.numeroParcela || null,
      quantidadeParcelas: parcGuia?.quantidadeParcelas || null,
      atrasada: Boolean(parcGuia?.atrasada),
    };
    map.set(portalId, {
      ...current, inss, das, irpj, csll, pisCofins, iss, parcDas,
      // `parcDas.ok` entra no agregado: parcela do mês sem guia É pendência. O `base.ok` lá em cima
      // já a considerava — as duas metades discordavam entre si.
      ok: inss.ok && das.ok && irpj.ok && csll.ok && pisCofins.ok && iss.ok && parcDas.ok,
    });
  }

  return map;
}
