// O LEITOR DE ZIP — o Fisco Fácil entrega o lote zipado e não havia leitor de ZIP no projeto.
//
// ⚠ Nada aqui toca banco, rede, SEFAZ ou ADN. Só disco temporário.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { montarZip } from "./fixtures/montarZip.js";
import {
  ehArquivoZip,
  lerDiretorioCentral,
  lerTextoDaEntrada,
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

  /**
   * ⚠⚠ TETO DE TEMPO DESTE CASO — 20 s, e ele é DAQUI, não do `jest.config` (02/09/2026).
   *
   * ⚠ O precedente é da casa: `nfse/danfse/__tests__/danfse.test.js` já faz `jest.setTimeout(30000)`
   * pelo mesmo motivo — geração de PDF de verdade, trabalho pesado e legítimo.
   *
   * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**: foi ele que expôs, em 01/09/2026, uma rota que
   * PENDURAVA (a varredura de notas consultando o banco sem dublê). Global, aquele defeito teria
   * virado *"a suíte está lenta hoje"*.
   *
   * ⚠⚠ **E AQUI ELE JÁ COBROU O PREÇO CERTO ANTES**: era esta linha vermelha que apontava para o
   * leitor lento — 75 ms por entrada, 37,6 s para 500 notas. Consertado (1,5 s), o caso passou a
   * medir ~5,0 s de trabalho REAL: montar um ZIP de 500 entradas com `archiver` e percorrê-lo
   * inteiro. Cinco milissegundos acima do corte não é sinal de nada — é a máquina do dia.
   * ⚠ Um teto por CASO, e não por arquivo: os outros nove daqui são rápidos e continuam com 5 s.
   */
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
  }, 20000);

  // -----------------------------------------------------------------------------------------------
  // ⚠⚠ O CONSERTO DE 02/09/2026 — a leitura de um lote levava 75 ms POR ENTRADA, e não era o
  // `inflate`: eram DUAS aberturas de arquivo por entrada (uma para os 30 bytes do cabeçalho local,
  // outra para o `createReadStream` dos dados). Num ZIP de 500 notas: **37,6 s → 1,5 s**.
  //
  // ⚠ O que estes casos travam é o que NÃO podia mudar junto: os tetos continuam valendo, a entrada
  // com defeito continua sendo erro DELA, e quem chama `lerTextoDaEntrada` solto continua servido.
  // -----------------------------------------------------------------------------------------------
  test("⚠⚠ o COMPRIMIDO também tem teto — o cabeçalho pode estar mentindo", async () => {
    // ⚠⚠ A guarda antiga confiava no tamanho DECLARADO pelo diretório central. Um ZIP hostil declara
    // 1 KB inflado e guarda 4 GB comprimidos: a guarda passava, e quem lê os bytes comia a memória
    // inteira ANTES de inflar coisa nenhuma.
    //
    // ⚠ Aqui a entrada é montada À MÃO, mentindo de propósito — é a única forma de exercitar o
    // ataque sem forjar bytes: `lerTextoDaEntrada` é exportada e recebe a entrada pronta.
    const caminho = join(dir, "mentiroso.zip");
    await montarZip(caminho, [{ nome: "grande.xml", conteudo: "x".repeat(5000) }]);
    const [real] = await lerDiretorioCentral(caminho);

    const mentirosa = { ...real, tamanho: 10 }; // declara 10 bytes inflados; o comprimido é maior
    const erro = await lerTextoDaEntrada(caminho, mentirosa, { maxBytes: 20 }).catch((e) => e);
    expect(erro.codigo).toBe("zip_entrada_grande_demais");
    // ⚠⚠ A MENSAGEM É A PROVA DE QUAL GUARDA PEGOU, e sem ela este teste não media nada: o teto do
    // INFLADO (contado pedaço a pedaço) devolve o MESMO código, então o caso passava verde com a
    // guarda nova removida. A diferença que importa é ANTES × DEPOIS de alocar o bloco comprimido —
    // e é justamente a alocação que o ataque quer provocar.
    expect(erro.message).toMatch(/comprimidos/);
  });

  test("⚠ e o teto do comprimido NÃO recusa arquivo legítimo", async () => {
    // Deflate praticamente nunca expande: comprimido acima do teto significa inflado acima do teto,
    // que já era recusado. O que a guarda pega é o cabeçalho mentindo — não o arquivo honesto.
    const caminho = join(dir, "honesto.zip");
    await montarZip(caminho, [{ nome: "ok.xml", conteudo: "<a>ok</a>" }]);
    const lidos = [];
    for await (const e of percorrerZip(caminho, { maxBytes: 1000 })) lidos.push(e);
    expect(lidos[0].texto).toBe("<a>ok</a>");
    expect(lidos[0].erro).toBeUndefined();
  });

  test("⚠ `lerTextoDaEntrada` continua servindo quem a chama SOLTA, sem handle", async () => {
    // ⚠ O `fh` é opcional de propósito: `percorrerZip` passa o dele, e quem chama a função direto
    // (inclusive daqui) não muda de comportamento. Tirar o ramo sem handle quebraria a exportação.
    const caminho = join(dir, "solta.zip");
    await montarZip(caminho, [{ nome: "n.xml", conteudo: "<a>1</a>" }]);
    const [entrada] = await lerDiretorioCentral(caminho);
    expect(await lerTextoDaEntrada(caminho, entrada)).toBe("<a>1</a>");
  });

  test("⚠⚠ o handle é fechado mesmo quando o consumidor DESISTE no meio", async () => {
    // ⚠ O gerador pode ser abandonado (um `break` no laço de quem lê). Sem o `finally`, o descritor
    // vazaria a cada lote interrompido — e o arquivo temporário não poderia ser apagado no Windows.
    const caminho = join(dir, "desiste.zip");
    await montarZip(caminho, Array.from({ length: 20 }, (_, i) => ({ nome: `n-${i}.xml`, conteudo: `<a>${i}</a>` })));
    for await (const e of percorrerZip(caminho)) {
      expect(e.texto).toBe("<a>0</a>");
      break; // desiste na primeira
    }
    // ⚠⚠ A PROVA NO WINDOWS: com descritor aberto, apagar o arquivo FALHA (EBUSY/EPERM). Que o
    // `rm` complete e o arquivo suma é o que diz que o `finally` do gerador fechou o handle.
    // ⚠ Nada de `ehArquivoZip` aqui: ela devolve `false` para arquivo ausente em vez de estourar,
    // e `false` não distingue "sumiu" de "não é ZIP".
    await rm(caminho, { force: true });
    await expect(stat(caminho)).rejects.toMatchObject({ code: "ENOENT" });
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
