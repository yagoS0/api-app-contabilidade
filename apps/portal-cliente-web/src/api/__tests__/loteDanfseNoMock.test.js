// O LOTE DE DANFSe NO MOCK — o par do `realApi`, e o zip precisa ABRIR.
//
// ⚠⚠ POR QUE ESTA SUÍTE EXISTE, e são duas razões independentes:
//
//   1. **O ZIP DO MOCK TEM DE SER UM ZIP DE VERDADE.** Um Blob qualquer rotulado
//      `application/zip` faria a tela parecer certa e o arquivo baixado não abrir — o mesmo motivo
//      pelo qual `pdfDeUmaLinha` monta um PDF mínimo mas VÁLIDO em vez de fingir um. Aqui o zip é
//      aberto de verdade, byte a byte.
//   2. ⚠⚠ **AS AUSÊNCIAS PRECISAM SER ALCANÇÁVEIS OFFLINE.** Nem toda nota gera DANFSe, e é
//      justamente esse ramo que ninguém veria sem backend. Este projeto já foi mordido três vezes
//      por caminho inalcançável no mock (o Lucro Presumido recusado, entre outros): sem um caso
//      plantado, o `RELATORIO.txt` viria sempre vazio e a metade mais importante da entrega
//      passaria despercebida até a produção.

import { createMockApi } from "../mock/mockApi";
import { definirTokens, limparSessao } from "../sessionStore";

const EMPRESA = "pc-001";

// ⚠ `login` DEVOLVE os tokens; quem os GUARDA é a casca (`AppShell`), tanto no mock quanto no
// real. Sem guardá-los aqui, toda chamada seguinte cai em `session_expired`.
beforeEach(() => {
  window.localStorage.clear();
  limparSessao();
});

/** Lê um zip "stored" (sem compressão) — é o que o mock produz. */
function lerZip(bytes) {
  const buf = Buffer.from(bytes);
  const fimIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(fimIdx).toBeGreaterThanOrEqual(0); // ⚠ isto SOZINHO já prova que é um zip
  const total = buf.readUInt16LE(fimIdx + 10);
  let p = buf.readUInt32LE(fimIdx + 16);
  const arquivos = {};
  for (let i = 0; i < total; i += 1) {
    const metodo = buf.readUInt16LE(p + 10);
    expect(metodo).toBe(0); // stored
    const tam = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + nomeLen).toString("utf8");
    const inicio = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
    arquivos[nome] = buf.slice(inicio, inicio + tam);
    p += 46 + nomeLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return arquivos;
}

/**
 * Blob → bytes.
 *
 * ⚠ `blob.arrayBuffer()` NÃO existe no jsdom desta versão do jest (existe no navegador), e
 * `FileReader` existe nos dois. Isto é limitação do ambiente de teste, não do código de produção —
 * o app nunca lê o Blob: ele o entrega ao download (`lib/baixarBlob.js`).
 */
function bytesDoBlob(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error);
    leitor.onload = () => resolve(new Uint8Array(leitor.result));
    leitor.readAsArrayBuffer(blob);
  });
}

async function apiLogada() {
  const api = createMockApi();
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  return api;
}

/** A competência mais recente que o mock gera — é a que tem as notas plantadas. */
async function competenciaComPlantadas(api) {
  const { data } = await api.getInvoices(EMPRESA, { limit: 200 });
  const nota = data.find((n) => n.invoiceId === "inv-sem-qrcode");
  expect(nota).toBeDefined(); // a nota plantada precisa continuar existindo
  return nota.competencia;
}

describe("o zip do mock é um zip de verdade", () => {
  test("abre, e traz um PDF por nota mais o RELATORIO.txt", async () => {
    const api = await apiLogada();
    const comp = await competenciaComPlantadas(api);
    const blob = await api.baixarDanfseEmLote(EMPRESA, { competencia: comp });

    expect(blob.type).toBe("application/zip");
    const arquivos = lerZip(await bytesDoBlob(blob));

    expect(Object.keys(arquivos)).toContain("RELATORIO.txt");
    const pdfs = Object.keys(arquivos).filter((n) => n.endsWith(".pdf"));
    expect(pdfs.length).toBeGreaterThan(0);
    // ⚠ Cada entrada é o PDF mínimo do mock — não um Blob vazio com nome bonito.
    expect(arquivos[pdfs[0]].toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  // ⚠ O ESQUEMA DE NOMES É O DO SERVIDOR: CNPJ da empresa + o NÚMERO da nota.
  test("os arquivos se chamam {CNPJ}_{número}.pdf", async () => {
    const api = await apiLogada();
    const [empresa] = await api.getCompanies();
    const comp = await competenciaComPlantadas(api);
    const arquivos = lerZip(
      await bytesDoBlob(await api.baixarDanfseEmLote(EMPRESA, { competencia: comp }))
    );
    const cnpj = String(empresa.cnpj).replace(/\D+/g, "");
    for (const nome of Object.keys(arquivos).filter((n) => n.endsWith(".pdf"))) {
      expect(nome).toMatch(new RegExp(`^${cnpj}_[\\w.-]+\\.pdf$`));
    }
  });
});

describe("⚠⚠ o caminho da nota que NÃO gera é alcançável offline", () => {
  test("o relatório NOMEIA as notas que ficaram de fora, com o motivo", async () => {
    const api = await apiLogada();
    const comp = await competenciaComPlantadas(api);
    const arquivos = lerZip(
      await bytesDoBlob(await api.baixarDanfseEmLote(EMPRESA, { competencia: comp }))
    );
    const relatorio = arquivos["RELATORIO.txt"].toString("utf8");

    expect(relatorio).toContain("Estas notas NÃO geraram DANFSe:");
    // A nota plantada sem QR Code — a recusa 503 da porta individual, espelhada no lote.
    expect(relatorio).toContain("nota 13995 — o QR Code não pôde ser gerado");
    // E a nota emitida que o ADN ainda não devolveu.
    expect(relatorio).toMatch(/sistema nacional ainda não a devolveu/);
  });

  test("a contagem do relatório fecha com o que está no zip", async () => {
    const api = await apiLogada();
    const comp = await competenciaComPlantadas(api);
    const arquivos = lerZip(
      await bytesDoBlob(await api.baixarDanfseEmLote(EMPRESA, { competencia: comp }))
    );
    const pdfs = Object.keys(arquivos).filter((n) => n.endsWith(".pdf")).length;
    expect(arquivos["RELATORIO.txt"].toString("utf8"))
      .toContain(`PDFs neste zip ........: ${pdfs}`);
  });
});

describe("⚠ as recusas do lote também são alcançáveis offline", () => {
  // ⚠ Sem uma competência acima do teto, `lote_muito_grande` só apareceria em produção — e ela é
  // a única resposta desta ação que a tela precisa EXPLICAR.
  test("`lote_muito_grande`, com os números, na competência do volume", async () => {
    const api = await apiLogada();
    // Varre TODAS as páginas: a competência do volume é a mais antiga que o mock gera, e ela não
    // cabe na primeira página.
    const competencias = new Set();
    for (let pagina = 1; ; pagina += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await api.getInvoices(EMPRESA, { limit: 200, page: pagina });
      r.data.forEach((n) => competencias.add(n.competencia));
      if (pagina * 200 >= r.total) break;
    }
    const maisAntiga = [...competencias].sort()[0];

    const erro = await api.baixarDanfseEmLote(EMPRESA, { competencia: maisAntiga })
      .then(() => null, (e) => e);
    expect(erro).toMatchObject({ status: 400, code: "lote_muito_grande" });
    // ⚠ Os NÚMEROS viajam no corpo — é o que a tela mostra em vez de "falha ao baixar".
    expect(erro.corpo.maximo).toBe(200);
    expect(erro.corpo.encontradas).toBeGreaterThan(200);
    expect(erro.message).toContain(String(erro.corpo.encontradas));
  });

  test("`lote_vazio` numa competência sem nota", async () => {
    const api = await apiLogada();
    await expect(api.baixarDanfseEmLote(EMPRESA, { competencia: "1999-01" }))
      .rejects.toMatchObject({ code: "lote_vazio" });
  });

  test("empresa fora do acesso do usuário é recusada antes de qualquer coisa", async () => {
    const api = await apiLogada();
    await expect(api.baixarDanfseEmLote("pc-999", {})).rejects.toMatchObject({ status: 403 });
  });
});
