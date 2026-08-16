// A NUMERAÇÃO DA DPS — RESERVA TRANSACIONAL, SEM FURO, E COM O NÚMERO REUTILIZÁVEL.
//
// ─── O QUE HAVIA ────────────────────────────────────────────────────────────────────────────
//
// `NfseService.issue` montava o `nDPS` lendo `company.rpsNumero`, mandava a DPS, e só DEPOIS —
// num `prisma.company.update` **separado e fora de transação** — gravava
// `String(Number(company.rpsNumero) + 1)`. Clássico read-modify-write:
//
//   • duas emissões simultâneas leem o mesmo `rpsNumero`, montam o mesmo `nDPS` e o mesmo `Id` de
//     DPS. `ServiceInvoice` **não tinha nenhum `@@unique`**, então o banco aceitava as duas;
//   • se `rpsNumero` fosse NULO, `(company.rpsNumero || "1")` dava `"1"` e o `if (company.rpsNumero)`
//     logo abaixo era FALSO — o contador nunca era criado. **Toda** emissão daquela empresa sairia
//     como número 1, para sempre.
//
// Número repetido é rejeição **E0014**: *"Conjunto de Série, Número, Código do Município Emissor e
// CNPJ/CPF informado nesta DPS já existe…"*.
//
// ─── ⚠ NÃO EXISTE INUTILIZAÇÃO NA NFS-e ─────────────────────────────────────────────────────
//
// Varrido nos 16 eventos do Anexo II e nas RNs do Anexo I: não há evento de inutilização de
// numeração (a NF-e tem; a NFS-e não). **Número pulado é buraco permanente**, e não há ato fiscal
// que o feche. Isso tem duas consequências diretas no desenho deste módulo:
//
//   1. a reserva é **transacional** — o número sai do contador e entra na linha da nota no MESMO
//      commit, então não existe "reservei e perdi";
//   2. um envio que falha **não queima o número**: a mesma linha é reaproveitada na nova
//      tentativa, com o MESMO número. Quem decide se dá para reaproveitar é a CAMADA da falha —
//      ver `desfechoEmissao.js`, e o resumo abaixo.
//
// ⚠ **Falha de TRANSPORTE não libera o número.** Timeout/DNS/5xx significam "não sei se a DPS foi
// processada". Reemitir com o mesmo número pode bater em E0014 (se ela entrou) e pular para o
// número seguinte cria buraco permanente (se não entrou). O caminho certo é CONSULTAR o `Id` da
// DPS antes — por isso o número fica retido, e não liberado, nesse caso.

import { prisma } from "../../infrastructure/db/prisma.js";
import { ESTADO, lerUltimaNumeracaoDaEmpresa } from "./nfseUltimaNota.js";

export class NfseNumeracaoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ─── SÉRIE ──────────────────────────────────────────────────────────────────────────────────
//
// **RN E0010** (Anexo I): a faixa `00001–49999` é a do emissor por **aplicativo próprio**, que é
// o que este código é. As outras faixas pertencem ao Emissor Móvel, ao Emissor Web e à
// transcrição — usar uma delas é rejeição, não um detalhe cosmético.
export const SERIE_MIN = 1;
export const SERIE_MAX = 49999;

/**
 * Valida e normaliza a série da empresa para os 5 dígitos do XML/`Id`.
 *
 * ⚠ A conversão "letra vira número" que existia em `buildDpsId` (`A`→1, `B`→2…) foi ABANDONADA de
 * propósito: ela transformava a série `"UNICA"` em `21` (`U`) sem que ninguém pedisse, e uma
 * série é identificação fiscal — não se traduz por conta própria. Série não-numérica agora é
 * recusa nomeada, e o contador corrige o cadastro.
 */
export function normalizarSerie(rpsSerie) {
  const bruta = String(rpsSerie ?? "").trim();
  if (!bruta) {
    throw new NfseNumeracaoError(
      "SERIE_NAO_CADASTRADA",
      "Esta empresa não tem série de DPS cadastrada. A RN E0010 exige série na faixa " +
        `${SERIE_MIN}–${SERIE_MAX} para emissão por aplicativo próprio.`
    );
  }
  if (!/^\d+$/.test(bruta)) {
    throw new NfseNumeracaoError(
      "SERIE_NAO_NUMERICA",
      `A série cadastrada ("${bruta}") não é numérica. A série da DPS é numérica e tem de estar na ` +
        `faixa ${SERIE_MIN}–${SERIE_MAX} (RN E0010). Corrija em Editar Cadastro.`
    );
  }
  const n = Number(bruta);
  if (!Number.isInteger(n) || n < SERIE_MIN || n > SERIE_MAX) {
    throw new NfseNumeracaoError(
      "SERIE_FORA_DA_FAIXA",
      `A série ${n} está fora da faixa ${SERIE_MIN}–${SERIE_MAX}, que é a do emissor por ` +
        "APLICATIVO PRÓPRIO (RN E0010). As demais faixas pertencem ao Emissor Móvel, ao Emissor " +
        "Web e à transcrição — emitir fora da faixa é rejeitado."
    );
  }
  return String(n).padStart(5, "0");
}

// ─── NÚMERO ─────────────────────────────────────────────────────────────────────────────────

/**
 * Incrementa `Company.rpsNumero` e devolve o número reservado, **atomicamente**.
 *
 * ⚠ POR QUE SQL CRU AQUI, se o `apps/api/CLAUDE.md` diz para evitá-lo. Porque `Company.rpsNumero`
 * é **TEXT**, e o `increment` do Prisma só existe para colunas numéricas. Sem isso, a única
 * alternativa é ler-somar-escrever em JS — que é exatamente o defeito que este módulo conserta.
 * Um `UPDATE … RETURNING` é uma instrução só: o Postgres trava a linha, e duas emissões
 * simultâneas saem com números diferentes por construção, não por sorte.
 *
 * ⚠ POR QUE NÃO UMA COLUNA NOVA (`dpsUltimoNumero INTEGER`), que dispensaria o SQL cru: porque
 * seriam **duas colunas com o mesmo significado** — o erro que o `apps/api/CLAUDE.md` documenta em
 * "TRÊS NÚMEROS DE DAS, TRÊS COLUNAS". O cadastro da empresa escreve `rpsNumero`; um contador
 * paralelo divergiria dele no primeiro ajuste manual, e ninguém saberia qual dos dois manda.
 *
 * O `regexp_replace` protege contra `rpsNumero` com lixo (`"RPS 12"`), e o `COALESCE`/`NULLIF`
 * resolve o caso NULO: contador zerado ⇒ o primeiro número emitido é 1, e ele é GRAVADO.
 *
 * ─── ⚠ O `piso`, E POR QUE ELE É UM `GREATEST` DENTRO DA MESMA INSTRUÇÃO ────────────────────
 *
 * `piso` é o maior `nDPS` que JÁ EXISTE na série — lido do XML da última nota da empresa, inclusive
 * das notas emitidas FORA deste portal (ver `nfseUltimaNota.js`). O contador interno não sabe
 * dessas: ele conta só o que nós emitimos. Sem o piso, a primeira emissão nossa numa empresa que já
 * emite pelo Emissor Web sairia com o número 1 — que já existe, e é a rejeição **E0014**.
 *
 * ⚠ **`GREATEST`, não substituição.** O contador continua valendo porque ele sabe de algo que o
 * piso não sabe: as notas que NÓS acabamos de emitir e que o ADN ainda não devolveu (a captura é
 * assíncrona — pode levar horas). Trocar o contador pelo piso reemitiria esse número.
 *
 * ⚠ **Uma instrução só, de novo.** Fazer `SELECT` do contador, comparar em JS e depois `UPDATE`
 * devolveria exatamente o read-modify-write que este módulo conserta. O `GREATEST` vai DENTRO do
 * `UPDATE`, e o Postgres trava a linha.
 *
 * ⚠ EFEITO COLATERAL CONHECIDO, e é o lado seguro do trade-off: `Company.rpsNumero` é **um contador
 * só para todas as séries**. Se a série mudar (porque a última nota mostrou outra), o `GREATEST`
 * pode pular números na série nova. Pular é buraco permanente — ruim —, mas repetir é rejeição
 * E0014 numa nota que talvez já exista. Na dúvida, o desenho prefere o buraco. Uma segunda coluna
 * "contador por série" seria duas colunas com o mesmo significado, o erro documentado em
 * "TRÊS NÚMEROS DE DAS, TRÊS COLUNAS".
 */
export async function reservarProximoNumero(tx, companyId, { piso = 0 } = {}) {
  const pisoSeguro = Number.isSafeInteger(Number(piso)) && Number(piso) > 0 ? Math.floor(Number(piso)) : 0;
  const linhas = await tx.$queryRaw`
    UPDATE "Company"
       SET "rpsNumero" = (
             GREATEST(
               COALESCE(NULLIF(regexp_replace(COALESCE("rpsNumero", ''), '\D', '', 'g'), ''), '0')::bigint,
               ${pisoSeguro}::bigint
             ) + 1
           )::text
     WHERE "id" = ${String(companyId)}
    RETURNING "rpsNumero"
  `;
  const numero = Array.isArray(linhas) ? linhas[0]?.rpsNumero : null;
  if (!numero) {
    throw new NfseNumeracaoError(
      "NUMERO_NAO_RESERVADO",
      "Não foi possível reservar o número da DPS (empresa não encontrada na reserva)."
    );
  }
  return String(numero);
}

// ─── A SÉRIE É AUTOMÁTICA — DECISÃO DO DONO, 16/08/2026 ─────────────────────────────────────
//
// > *"sobre a série RPS, deve ser automática, devemos consultar a última nota emitida e extrair o
// > RPS dela, e colocar para emissão, nem sempre o usuário vai emitir pelo nosso portal, então
// > precisamos que isso seja feito automático."*
//
// ⚠ **A SÉRIE CADASTRADA À MÃO NÃO FOI REMOVIDA, e a decisão está aqui com o motivo.**
// `Company.rpsSerie` continua no banco e continua no formulário, com dois papéis que a leitura
// automática NÃO consegue cobrir:
//
//   1. **Empresa nova.** Não há nota de onde ler, e a primeira DPS precisa de uma série. Ela é
//      escolha do emitente (a RN E0010 só delimita a faixa) — o sistema não tem de onde tirá-la.
//   2. **A última nota está numa faixa que não é nossa.** A E0010 reserva `00001–49999` para o
//      emissor por APLICATIVO PRÓPRIO; as outras faixas são do Emissor Móvel, do Emissor Web e da
//      transcrição. Se o contribuinte emitiu pelo Emissor Web, aquela série **não é continuável por
//      nós** — e a nossa é a cadastrada.
//
// Remover a coluna, além de ser migration destrutiva (decisão do dono), deixaria esses dois casos
// sem saída: a emissão recusaria e não haveria campo para destravá-la. O que mudou é a PRECEDÊNCIA:
// quando existe nota legível na nossa faixa, **ela vence o cadastro**.
//
// ⚠ E não há como recusar a série vazia mais cedo do que já se recusa: `NfseService.issue` chama
// `normalizarSerie(company.rpsSerie)` no pré-voo do cadastro, antes de encostar na numeração.

export const ORIGEM_SERIE = Object.freeze({
  /** Não há nota nenhuma: primeira emissão, série do cadastro. */
  CADASTRO_PRIMEIRA_EMISSAO: "CADASTRO_PRIMEIRA_EMISSAO",
  /** Lida da última NFS-e da empresa (inclusive emitida fora deste portal). */
  ULTIMA_NOTA: "ULTIMA_NOTA",
  /** A última nota está fora da faixa E0010 do aplicativo próprio: não é nossa para continuar. */
  CADASTRO_SERIE_FORA_DA_FAIXA: "CADASTRO_SERIE_FORA_DA_FAIXA",
});

/**
 * Decide a série e o piso do número, sem escrever nada.
 *
 * ⚠ **RECUSA EM VEZ DE CHUTAR.** Se a consulta falhar, ou se houver notas e nenhuma render
 * série/número, `lerUltimaNumeracaoDaEmpresa` **lança** — e o erro sobe daqui inteiro, com o motivo.
 * "Não consegui ler" nunca vira "então continue do meu contador": esse é o caminho que repete
 * número (E0014) ou pula (buraco permanente, porque não existe inutilização na NFS-e).
 *
 * @returns {Promise<{serie: string, piso: number, origem: string, leitura: object}>}
 */
export async function resolverSerieENumero({ companyId, rpsSerie, client = prisma, lerUltimaNota = lerUltimaNumeracaoDaEmpresa }) {
  const leitura = await lerUltimaNota({ companyId, client });

  if (leitura?.estado === ESTADO.SEM_NOTA) {
    // Primeira emissão. O piso é 0 — quem manda é o contador do cadastro, que também é 0/nulo.
    return {
      serie: normalizarSerie(rpsSerie),
      piso: 0,
      origem: ORIGEM_SERIE.CADASTRO_PRIMEIRA_EMISSAO,
      leitura,
    };
  }

  // A série da última nota só serve se estiver na faixa do aplicativo próprio (RN E0010). Fora
  // dela, ela pertence a outro emissor e continuá-la é rejeição — não é "quase certo".
  let serieDaNota = null;
  try {
    serieDaNota = normalizarSerie(leitura?.serie);
  } catch {
    serieDaNota = null;
  }

  if (serieDaNota) {
    return { serie: serieDaNota, piso: Number(leitura.numero) || 0, origem: ORIGEM_SERIE.ULTIMA_NOTA, leitura };
  }

  const serieCadastro = normalizarSerie(rpsSerie);
  // Se a janela lida também contém notas NA NOSSA série, o maior número delas ainda é piso — a
  // empresa pode emitir pelos dois caminhos.
  const piso = Number(leitura?.porSerie?.[serieCadastro]) || 0;
  return { serie: serieCadastro, piso, origem: ORIGEM_SERIE.CADASTRO_SERIE_FORA_DA_FAIXA, leitura };
}

/**
 * Reserva série + número e cria a linha `ServiceInvoice` que os SEGURA, tudo num commit só.
 *
 * A linha nasce `status:"pending"`. É ela que o `@@unique([companyId, rpsSerie, rpsNumero])`
 * protege: a segunda emissão concorrente que chegasse com o mesmo par bateria no índice em vez de
 * virar uma segunda DPS com o mesmo `Id`.
 *
 * ⚠ **A ASSINATURA NÃO MUDOU** — `NfseService.issue` continua chamando exatamente
 * `reservarNumeracao({ companyId, rpsSerie, criarLinha })`. O que mudou é que `rpsSerie` deixou de
 * ser a resposta e virou o FALLBACK: a série e o piso do número saem de `resolverSerieENumero`,
 * que consulta a última nota que existe. Foi feito assim de propósito — a decisão da numeração
 * pertence a este módulo, e espalhá-la pelo serviço de emissão criaria a segunda regra de
 * numeração que o cabeçalho deste arquivo existe para impedir.
 *
 * ⚠ **A LEITURA ACONTECE FORA DA TRANSAÇÃO**, e de propósito: ela é uma consulta pesada (lê o
 * `xmlRaw` de até 50 notas) e segurar a linha da empresa travada durante isso serializaria as
 * emissões da carteira. O que precisa ser atômico é a reserva — e ela continua sendo, com o piso
 * entrando como parâmetro do mesmo `UPDATE … RETURNING`.
 *
 * @param {(tx: any, dados: {rpsSerie: string, rpsNumero: string}) => Promise<any>} criarLinha
 * @param {Function} [lerUltimaNota] injeção para teste; o default é a leitura real.
 */
export async function reservarNumeracao({
  companyId,
  rpsSerie,
  criarLinha,
  client = prisma,
  lerUltimaNota = lerUltimaNumeracaoDaEmpresa,
}) {
  const { serie, piso, origem } = await resolverSerieENumero({ companyId, rpsSerie, client, lerUltimaNota });
  return client.$transaction(async (tx) => {
    const numero = await reservarProximoNumero(tx, companyId, { piso });
    const linha = await criarLinha(tx, { rpsSerie: serie, rpsNumero: numero });
    return { rpsSerie: serie, rpsNumero: numero, origemSerie: origem, linha };
  });
}
