// DUAS EMISSÕES SIMULTÂNEAS NÃO PODEM PRODUZIR O MESMO NÚMERO.
// E NENHUMA EMISSÃO PODE REUSAR UM NÚMERO QUE JÁ SAIU — INCLUSIVE FORA DESTE PORTAL.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `NfseService.issue` montava o `nDPS` lendo `company.rpsNumero` e só DEPOIS gravava
// `String(Number(company.rpsNumero) + 1)`, num `prisma.company.update` **separado e fora de
// transação**. Duas chamadas concorrentes liam o mesmo valor, montavam o mesmo `nDPS` e o mesmo
// `Id` de DPS — e `ServiceInvoice` não tinha nenhum `@@unique`, então o banco aceitava as duas.
// Número repetido é rejeição **E0014**.
//
// E havia o caso pior, que não precisava de concorrência nenhuma: com `rpsNumero` NULO,
// `(company.rpsNumero || "1")` dava `"1"` e o `if (company.rpsNumero)` logo abaixo era FALSO — o
// contador nunca era criado. **Toda** emissão daquela empresa sairia como número 1, para sempre.
//
// ⚠ Como **não existe inutilização na NFS-e** (varrido nos 16 eventos do Anexo II e nas RNs do
// Anexo I), número pulado é buraco permanente: a reserva tem de ser transacional E sem furos.
//
// ⚠ A PARTIR DE 16/08/2026 (decisão do dono) O CONTADOR INTERNO NÃO BASTA. *"nem sempre o usuário
// vai emitir pelo nosso portal"* — as notas emitidas em outro sistema chegam pela captura do ADN e
// consumiram números da mesma série. Os dois desfechos proibidos, e os dois estão travados abaixo:
//   1. REUSAR número já emitido (E0014);
//   2. PULAR número em silêncio — leitura que falha vira RECUSA com motivo, nunca palpite.

import {
  normalizarSerie,
  reservarProximoNumero,
  reservarNumeracao,
  resolverSerieENumero,
  ORIGEM_SERIE,
  NfseNumeracaoError,
  SERIE_MIN,
  SERIE_MAX,
} from "../nfseNumeracao.js";
import { ESTADO, NfseUltimaNotaError } from "../nfseUltimaNota.js";

// A leitura da última nota é INJETADA nos testes. O default do módulo é a leitura real (que abre o
// Prisma) — passar a injeção aqui é o que mantém este arquivo sem banco, e é também o que deixa
// cada cenário de leitura explícito na chamada, em vez de escondido num mock global.
const semNota = async () => ({ estado: ESTADO.SEM_NOTA, notasLidas: 0 });

// ── Um Postgres de mentira que respeita o que importa: o `UPDATE … RETURNING` é UMA instrução, e
// a transação serializa. É essa semântica que torna a reserva livre de corrida — não a sorte do
// agendador do Node.
function fakeClient(estadoInicial) {
  const contadores = new Map(Object.entries(estadoInicial));
  const criadas = [];
  let fila = Promise.resolve();

  const tx = {
    async $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      // O teste trava a FORMA da instrução: ler-somar-escrever em JS é exatamente o defeito.
      expect(sql).toMatch(/UPDATE "Company"/);
      expect(sql).toMatch(/RETURNING "rpsNumero"/);
      // ⚠ E trava o GREATEST: sem ele o piso lido da última nota seria decorativo.
      expect(sql).toMatch(/GREATEST/);
      // A ordem dos parâmetros é a do template: primeiro o piso, depois o id.
      const [piso, id] = values;
      const atual = contadores.get(id);
      const digitos = String(atual ?? "").replace(/\D+/g, ""); // regexp_replace
      const base = digitos === "" ? 0 : Number(digitos); // COALESCE(NULLIF(...), '0')
      const proximo = String(Math.max(base, Number(piso) || 0) + 1); // GREATEST(…, piso) + 1
      contadores.set(id, proximo);
      return [{ rpsNumero: proximo }];
    },
    serviceInvoice: {
      async create({ data }) {
        const chave = `${data.companyId}|${data.rpsSerie}|${data.rpsNumero}`;
        if (criadas.some((c) => c.chave === chave)) {
          // O que o índice único `(companyId, rpsSerie, rpsNumero)` faz no banco de verdade.
          throw new Error(`Unique constraint failed: ${chave}`);
        }
        criadas.push({ chave, ...data });
        return { id: `inv-${criadas.length}`, ...data };
      },
    },
  };

  return {
    criadas,
    contadores,
    client: {
      // Transações serializadas, como o lock de linha do Postgres faz para o mesmo `id`.
      $transaction(cb) {
        const proxima = fila.then(() => cb(tx));
        fila = proxima.then(
          () => {},
          () => {}
        );
        return proxima;
      },
    },
  };
}

describe("série da DPS — faixa 00001–49999 (RN E0010, aplicativo próprio)", () => {
  it("aceita e formata com 5 dígitos", () => {
    expect(normalizarSerie("1")).toBe("00001");
    expect(normalizarSerie(900)).toBe("00900");
    expect(normalizarSerie(String(SERIE_MAX))).toBe("49999");
  });

  it("recusa série ausente", () => {
    expect(() => normalizarSerie(null)).toThrow(NfseNumeracaoError);
    expect(() => normalizarSerie("")).toThrow(/E0010/);
  });

  it("recusa série FORA da faixa — as outras faixas são de outros emissores", () => {
    // 50000+ pertence ao Emissor Móvel / Web / transcrição. Emitir de lá é rejeição.
    expect(() => normalizarSerie(String(SERIE_MAX + 1))).toThrow(/fora da faixa/i);
    expect(() => normalizarSerie(String(SERIE_MIN - 1))).toThrow(/fora da faixa/i);
  });

  it("recusa série não-numérica em vez de TRADUZIR a letra", () => {
    // ⚠ `buildDpsId` convertia letra em número (`A`→1). A série default do projeto é `"UNICA"`,
    // que virava `21` (a posição de `U`) sem ninguém pedir. Série é identificação fiscal: não se
    // traduz por conta própria.
    expect(() => normalizarSerie("UNICA")).toThrow(/não é numérica/i);
    expect(() => normalizarSerie("A")).toThrow(NfseNumeracaoError);
  });
});

describe("reserva do número — atômica, sem furo e sem repetição", () => {
  it("contador NULO produz 1 e o GRAVA (não 'sempre 1')", async () => {
    const { client, contadores } = fakeClient({ c1: null });
    const primeiro = await client.$transaction((tx) => reservarProximoNumero(tx, "c1"));
    const segundo = await client.$transaction((tx) => reservarProximoNumero(tx, "c1"));
    expect(primeiro).toBe("1");
    expect(segundo).toBe("2"); // o defeito antigo devolveria "1" de novo, para sempre
    expect(contadores.get("c1")).toBe("2");
  });

  it("contador com lixo ('RPS 12') não quebra e continua de 12", async () => {
    const { client } = fakeClient({ c1: "RPS 12" });
    await expect(client.$transaction((tx) => reservarProximoNumero(tx, "c1"))).resolves.toBe("13");
  });

  it("⚠ 20 reservas CONCORRENTES: 20 números distintos, sem repetir e sem pular", async () => {
    const { client, criadas } = fakeClient({ c1: "0" });

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () =>
        reservarNumeracao({
          companyId: "c1",
          rpsSerie: "1",
          client,
          lerUltimaNota: semNota,
          criarLinha: (tx, dados) => tx.serviceInvoice.create({ data: { companyId: "c1", ...dados } }),
        })
      )
    );

    const numeros = resultados.map((r) => Number(r.rpsNumero)).sort((a, b) => a - b);
    // Sem repetição — é a rejeição E0014 que se evita.
    expect(new Set(numeros).size).toBe(20);
    // Sem furo — não há inutilização na NFS-e, então buraco na numeração é permanente.
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(criadas).toHaveLength(20);
    // A série vai formatada nas linhas, igual ao que entra no XML e no Id.
    expect(resultados.every((r) => r.rpsSerie === "00001")).toBe(true);
  });

  it("o índice único é a segunda rede: mesma tupla duas vezes NÃO entra", async () => {
    const { client } = fakeClient({ c1: "0" });
    await client.$transaction((tx) =>
      tx.serviceInvoice.create({ data: { companyId: "c1", rpsSerie: "00001", rpsNumero: "7" } })
    );
    await expect(
      client.$transaction((tx) =>
        tx.serviceInvoice.create({ data: { companyId: "c1", rpsSerie: "00001", rpsNumero: "7" } })
      )
    ).rejects.toThrow(/Unique constraint/);
  });

  it("série inválida recusa ANTES de mexer no contador — número não se queima à toa", async () => {
    const { client, contadores } = fakeClient({ c1: "10" });
    await expect(
      reservarNumeracao({
        companyId: "c1",
        rpsSerie: "UNICA",
        client,
        lerUltimaNota: semNota,
        criarLinha: async () => ({}),
      })
    ).rejects.toThrow(/não é numérica/i);
    expect(contadores.get("c1")).toBe("10"); // intacto
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// A SÉRIE AUTOMÁTICA — a última nota que EXISTE, não a nossa contagem
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("⚠ INVARIANTE 1 — nunca reusar número já emitido (E0014)", () => {
  it("nota de FORA com nDPS 127 e contador interno em 5: o próximo é 128, não 6", async () => {
    // Este é o caso do dono: *"nem sempre o usuário vai emitir pelo nosso portal"*. O contador
    // interno conta só as NOSSAS emissões; as 127 notas emitidas em outro sistema chegaram pela
    // captura do ADN. Sem o piso, a emissão sairia com o número 6 — que já existe.
    const { client, contadores } = fakeClient({ c1: "5" });
    const r = await reservarNumeracao({
      companyId: "c1",
      rpsSerie: "1",
      client,
      lerUltimaNota: async () => ({ estado: ESTADO.LIDA, serie: "00001", numero: 127, notasLidas: 40, porSerie: { "00001": 127 } }),
      criarLinha: (tx, dados) => tx.serviceInvoice.create({ data: { companyId: "c1", ...dados } }),
    });
    expect(r.rpsNumero).toBe("128");
    expect(r.rpsSerie).toBe("00001");
    expect(r.origemSerie).toBe(ORIGEM_SERIE.ULTIMA_NOTA);
    // E o contador FICA gravado no piso novo: a próxima não recomeça do 6.
    expect(contadores.get("c1")).toBe("128");
  });

  it("o contador interno ainda vence quando é MAIOR — nota nossa que o ADN ainda não devolveu", async () => {
    // ⚠ Por que não trocar o contador pelo piso: a captura é assíncrona. Uma nota que emitimos hoje
    // pode levar horas para voltar do ADN. Se o piso substituísse o contador, esse número seria
    // reemitido — E0014 numa nota que nós mesmos acabamos de gerar.
    const { client } = fakeClient({ c1: "200" });
    const r = await reservarNumeracao({
      companyId: "c1",
      rpsSerie: "1",
      client,
      lerUltimaNota: async () => ({ estado: ESTADO.LIDA, serie: "00001", numero: 127, notasLidas: 40, porSerie: { "00001": 127 } }),
      criarLinha: (tx, dados) => tx.serviceInvoice.create({ data: { companyId: "c1", ...dados } }),
    });
    expect(r.rpsNumero).toBe("201");
  });

  it("a série da última nota VENCE a cadastrada — é o pedido do dono", async () => {
    const { client } = fakeClient({ c1: "0" });
    const r = await reservarNumeracao({
      companyId: "c1",
      rpsSerie: "1", // cadastro diz 00001
      client,
      lerUltimaNota: async () => ({ estado: ESTADO.LIDA, serie: "00007", numero: 42, notasLidas: 3, porSerie: { "00007": 42 } }),
      criarLinha: (tx, dados) => tx.serviceInvoice.create({ data: { companyId: "c1", ...dados } }),
    });
    expect(r.rpsSerie).toBe("00007");
    expect(r.rpsNumero).toBe("43");
  });
});

describe("⚠ INVARIANTE 2 — leitura que falha RECUSA, nunca chuta o próximo", () => {
  it("notas existem e nenhuma rende série/nDPS ⇒ recusa nomeada, e o contador NÃO se move", async () => {
    const { client, contadores } = fakeClient({ c1: "10" });
    const ilegivel = async () => {
      throw new NfseUltimaNotaError("NFSE_ULTIMA_NOTA_ILEGIVEL", "não deu para ler", { notasLidas: 12 });
    };
    await expect(
      reservarNumeracao({
        companyId: "c1",
        rpsSerie: "1",
        client,
        lerUltimaNota: ilegivel,
        criarLinha: async () => ({}),
      })
    ).rejects.toMatchObject({ code: "NFSE_ULTIMA_NOTA_ILEGIVEL" });
    // ⚠ O ponto do invariante: NADA foi escrito. O contador está onde estava, e nenhum número
    // foi queimado por uma tentativa que não podia acontecer.
    expect(contadores.get("c1")).toBe("10");
  });

  it("a consulta ao banco não voltou ⇒ recusa nomeada, e o contador NÃO se move", async () => {
    const { client, contadores } = fakeClient({ c1: "10" });
    const caiu = async () => {
      throw new NfseUltimaNotaError("NFSE_LEITURA_ULTIMA_NOTA_FALHOU", "banco fora");
    };
    await expect(
      reservarNumeracao({ companyId: "c1", rpsSerie: "1", client, lerUltimaNota: caiu, criarLinha: async () => ({}) })
    ).rejects.toMatchObject({ code: "NFSE_LEITURA_ULTIMA_NOTA_FALHOU" });
    expect(contadores.get("c1")).toBe("10");
  });

  it("⚠ o que NÃO pode existir: um caminho que engula a falha e crie a linha assim mesmo", async () => {
    // Experimento invertido. Se algum dia alguém puser um `try/catch` em volta da leitura e cair
    // para o contador interno, `criarLinha` passa a ser chamada — e ESTE teste cai. É a trava
    // contra o "pular número em silêncio": a linha da nota só nasce com numeração decidida.
    const { client } = fakeClient({ c1: "10" });
    const criarLinha = jest.fn(async () => ({}));
    await expect(
      reservarNumeracao({
        companyId: "c1",
        rpsSerie: "1",
        client,
        lerUltimaNota: async () => {
          throw new NfseUltimaNotaError("NFSE_LEITURA_ULTIMA_NOTA_FALHOU", "banco fora");
        },
        criarLinha,
      })
    ).rejects.toThrow(/RECUSADA|banco fora/);
    expect(criarLinha).not.toHaveBeenCalled();
  });
});

describe("de onde saiu a série — as três origens, cada uma com nome", () => {
  it("empresa NOVA: sem nota, a série é a do cadastro e o piso é 0", async () => {
    const r = await resolverSerieENumero({ companyId: "c1", rpsSerie: "3", lerUltimaNota: semNota });
    expect(r).toMatchObject({ serie: "00003", piso: 0, origem: ORIGEM_SERIE.CADASTRO_PRIMEIRA_EMISSAO });
  });

  it("última nota na NOSSA faixa: ela manda", async () => {
    const r = await resolverSerieENumero({
      companyId: "c1",
      rpsSerie: "3",
      lerUltimaNota: async () => ({ estado: ESTADO.LIDA, serie: "00009", numero: 88, porSerie: { "00009": 88 } }),
    });
    expect(r).toMatchObject({ serie: "00009", piso: 88, origem: ORIGEM_SERIE.ULTIMA_NOTA });
  });

  it("⚠ última nota FORA da faixa E0010 (Emissor Web) não é continuável — volta ao cadastro", async () => {
    // A RN E0010 reserva 00001–49999 para o emissor por APLICATIVO PRÓPRIO. Uma nota em série
    // 900001 foi emitida por outro tipo de emissor; continuá-la seria rejeição, não continuidade.
    const r = await resolverSerieENumero({
      companyId: "c1",
      rpsSerie: "3",
      lerUltimaNota: async () => ({
        estado: ESTADO.LIDA,
        serie: "900001",
        numero: 500,
        // ⚠ E o piso da NOSSA série continua valendo: a empresa pode emitir pelos dois caminhos.
        porSerie: { 900001: 500, "00003": 17 },
      }),
    });
    expect(r).toMatchObject({ serie: "00003", piso: 17, origem: ORIGEM_SERIE.CADASTRO_SERIE_FORA_DA_FAIXA });
  });

  it("série fora da faixa E cadastro vazio ⇒ recusa — não há série de onde partir", async () => {
    await expect(
      resolverSerieENumero({
        companyId: "c1",
        rpsSerie: null,
        lerUltimaNota: async () => ({ estado: ESTADO.LIDA, serie: "900001", numero: 500, porSerie: {} }),
      })
    ).rejects.toMatchObject({ code: "SERIE_NAO_CADASTRADA" });
  });
});
