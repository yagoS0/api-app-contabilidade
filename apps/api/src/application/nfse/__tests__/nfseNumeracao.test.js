// DUAS EMISSÕES SIMULTÂNEAS NÃO PODEM PRODUZIR O MESMO NÚMERO.
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

import {
  normalizarSerie,
  reservarProximoNumero,
  reservarNumeracao,
  NfseNumeracaoError,
  SERIE_MIN,
  SERIE_MAX,
} from "../nfseNumeracao.js";

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
      const id = values[0];
      const atual = contadores.get(id);
      const digitos = String(atual ?? "").replace(/\D+/g, ""); // regexp_replace
      const base = digitos === "" ? 0 : Number(digitos); // COALESCE(NULLIF(...), '0')
      const proximo = String(base + 1);
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
      reservarNumeracao({ companyId: "c1", rpsSerie: "UNICA", client, criarLinha: async () => ({}) })
    ).rejects.toThrow(/não é numérica/i);
    expect(contadores.get("c1")).toBe("10"); // intacto
  });
});
