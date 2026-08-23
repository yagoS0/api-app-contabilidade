// O LEITOR DE ZIP — o Fisco Fácil entrega o lote zipado e não havia leitor de ZIP no projeto.
//
// ⚠ Nada aqui toca banco, rede, SEFAZ ou ADN. Só disco temporário.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { montarZip } from "./fixtures/montarZip.js";
import {
  ehArquivoZip,
  lerDiretorioCentral,
  percorrerZip,
  decodificarXml,
  ZipError,
} from "../zipLeitura.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lote-nfe-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("um ZIP, N documentos", () => {
  test("lê todas as entradas comprimidas (deflate)", async () => {
    const caminho = join(dir, "lote.zip");
    await montarZip(caminho, [
      { nome: "nota-1.xml", conteudo: "<a>1</a>" },
      { nome: "nota-2.xml", conteudo: "<a>2</a>" },
      { nome: "evento-1.xml", conteudo: "<b>3</b>" },
    ]);

    expect(await ehArquivoZip(caminho)).toBe(true);

    const lidos = [];
    for await (const e of percorrerZip(caminho)) lidos.push(e);

    expect(lidos.map((e) => e.nome).sort()).toEqual(["evento-1.xml", "nota-1.xml", "nota-2.xml"]);
    expect(lidos.find((e) => e.nome === "nota-2.xml").texto).toBe("<a>2</a>");
  });

  test("lê entrada SEM compressão (método 0 = stored)", async () => {
    const caminho = join(dir, "stored.zip");
    await montarZip(caminho, [{ nome: "nota.xml", conteudo: "<a>guardado</a>" }], { store: true });

    const entradas = await lerDiretorioCentral(caminho);
    expect(entradas[0].metodo).toBe(0);

    const lidos = [];
    for await (const e of percorrerZip(caminho)) lidos.push(e);
    expect(lidos[0].texto).toBe("<a>guardado</a>");
  });

  test("entradas dentro de PASTAS aparecem com o caminho e são lidas", async () => {
    const caminho = join(dir, "pastas.zip");
    await montarZip(caminho, [
      { nome: "2026-01/nota-1.xml", conteudo: "<a>jan</a>" },
      { nome: "2026-02/nota-2.xml", conteudo: "<a>fev</a>" },
    ]);
    const lidos = [];
    for await (const e of percorrerZip(caminho)) lidos.push(e);
    expect(lidos).toHaveLength(2);
    expect(lidos.map((e) => e.texto).sort()).toEqual(["<a>fev</a>", "<a>jan</a>"]);
  });

  // ⚠ O ZIP VAZIO É RESPOSTA LEGÍTIMA — o portal tem o estado "Processada sem resultado".
  // Ler zero entradas NÃO pode ser erro; quem traduz isso em texto é o serviço.
  test("ZIP legitimamente vazio devolve zero entradas, sem estourar", async () => {
    const caminho = join(dir, "vazio.zip");
    await montarZip(caminho, []);
    expect(await ehArquivoZip(caminho)).toBe(true);
    const lidos = [];
    for await (const e of percorrerZip(caminho)) lidos.push(e);
    expect(lidos).toEqual([]);
  });

  test("volume grande: 500 entradas, todas lidas", async () => {
    const caminho = join(dir, "grande.zip");
    const entradas = Array.from({ length: 500 }, (_, i) => ({
      nome: `nota-${i}.xml`,
      conteudo: `<a>${i}</a>`,
    }));
    await montarZip(caminho, entradas);
    let n = 0;
    for await (const e of percorrerZip(caminho)) {
      expect(e.texto).toBe(`<a>${e.nome.match(/(\d+)/)[1]}</a>`);
      n += 1;
    }
    expect(n).toBe(500);
  });

  test("arquivo que não é ZIP é reconhecido como tal", async () => {
    const caminho = join(dir, "solto.xml");
    await writeFile(caminho, "<nfeProc/>", "utf8");
    expect(await ehArquivoZip(caminho)).toBe(false);
    await expect(lerDiretorioCentral(caminho)).rejects.toBeInstanceOf(ZipError);
  });

  // ⚠ UMA ENTRADA RUIM NÃO DERRUBA O LOTE — ela vira `{ erro }` e as outras seguem.
  test("entrada grande demais vira erro NA ENTRADA, e o resto do lote continua", async () => {
    const caminho = join(dir, "bomba.zip");
    await montarZip(caminho, [
      { nome: "ok.xml", conteudo: "<a>ok</a>" },
      { nome: "gorda.xml", conteudo: "x".repeat(5000) },
    ]);
    const lidos = [];
    for await (const e of percorrerZip(caminho, { maxBytes: 100 })) lidos.push(e);
    const gorda = lidos.find((e) => e.nome === "gorda.xml");
    const ok = lidos.find((e) => e.nome === "ok.xml");
    expect(gorda.erro).toBe("zip_entrada_grande_demais");
    expect(gorda.texto).toBeNull();
    expect(ok.texto).toBe("<a>ok</a>"); // o vizinho passou
  });
});

describe("codificação — o XML de NF-e nem sempre é UTF-8", () => {
  // ⚠ Decodar ISO-8859-1 como UTF-8 não quebra o parser (a estrutura é ASCII): quebra o NOME.
  // "COMÉRCIO" viraria "COM<?>RCIO" gravado em `emitenteNome`, em silêncio, para sempre.
  test("respeita o prólogo ISO-8859-1", () => {
    const texto = '<?xml version="1.0" encoding="ISO-8859-1"?><x>COMÉRCIO</x>';
    const buf = Buffer.from(texto, "latin1");
    expect(decodificarXml(buf)).toContain("COMÉRCIO");
  });

  test("UTF-8 continua UTF-8, e o BOM é descartado", () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<?xml version="1.0" encoding="UTF-8"?><x>COMÉRCIO</x>', "utf8"),
    ]);
    const saida = decodificarXml(buf);
    expect(saida.startsWith("<?xml")).toBe(true);
    expect(saida).toContain("COMÉRCIO");
  });

  test("o ZIP entrega o texto já decodificado pelo prólogo", async () => {
    const caminho = join(dir, "latin.zip");
    await montarZip(caminho, [{
      nome: "nota.xml",
      conteudo: Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><x>ATACADÃO</x>', "latin1"),
    }]);
    const lidos = [];
    for await (const e of percorrerZip(caminho)) lidos.push(e);
    expect(lidos[0].texto).toContain("ATACADÃO");
  });
});
