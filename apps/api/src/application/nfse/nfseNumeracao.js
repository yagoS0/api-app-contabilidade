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
 */
export async function reservarProximoNumero(tx, companyId) {
  const linhas = await tx.$queryRaw`
    UPDATE "Company"
       SET "rpsNumero" = (
             COALESCE(NULLIF(regexp_replace(COALESCE("rpsNumero", ''), '\D', '', 'g'), ''), '0')::bigint + 1
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

/**
 * Reserva série + número e cria a linha `ServiceInvoice` que os SEGURA, tudo num commit só.
 *
 * A linha nasce `status:"pending"`. É ela que o `@@unique([companyId, rpsSerie, rpsNumero])`
 * protege: a segunda emissão concorrente que chegasse com o mesmo par bateria no índice em vez de
 * virar uma segunda DPS com o mesmo `Id`.
 *
 * @param {(tx: any, dados: {rpsSerie: string, rpsNumero: string}) => Promise<any>} criarLinha
 */
export async function reservarNumeracao({ companyId, rpsSerie, criarLinha, client = prisma }) {
  const serie = normalizarSerie(rpsSerie);
  return client.$transaction(async (tx) => {
    const numero = await reservarProximoNumero(tx, companyId);
    const linha = await criarLinha(tx, { rpsSerie: serie, rpsNumero: numero });
    return { rpsSerie: serie, rpsNumero: numero, linha };
  });
}
