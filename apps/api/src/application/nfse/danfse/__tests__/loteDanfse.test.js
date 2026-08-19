// O LOTE DE DANFSe — o esquema de nomes, e a promessa de que o zip NÃO MENTE sobre o que faltou.
//
// ⚠ POR QUE ESTA SUÍTE EXISTE. O lote tem duas invariantes que, quebradas, produzem defeito
// SILENCIOSO — o pior tipo:
//
//   1. **dois arquivos com o mesmo nome dentro do zip.** `archiver` aceita sem reclamar e a maioria
//      dos descompactadores fica com o último: uma nota some, e a pessoa só descobre contando
//      arquivos.
//   2. **nota que não gerou e não aparece em lugar nenhum.** Baixar 47 PDFs de 50 notas sem saber
//      quais três faltaram nem por quê é exatamente o silêncio que o relatório existe para impedir.
//
// ⚠ O GERADOR É INJETADO. O que se mede aqui é o LOTE (nomes, contagem, relatório); que o PDF sai
// certo já é medido em `danfse.test.js`, sobre o gerador, e que a porta escopa por empresa é
// medido em `routes/__tests__/loteDanfseDoCliente.test.js`.
//
// ⚠ NADA AQUI EMITE, CANCELA OU CONSULTA COISA ALGUMA.

import {
  LOTE_MAXIMO,
  NOME_DO_RELATORIO,
  criarNomeadorDeLote,
  gerarLoteDanfse,
  motivoDaFalha,
  nomeNoLote,
  safeFilePart,
  textoDoRelatorio,
} from "../loteDanfseDoPortal.js";

const CNPJ = "12345678000199";

/** Um `archiver` de mentira que só guarda o que foi acrescentado. */
function arquivoFalso() {
  const entradas = [];
  return {
    entradas,
    append: (conteudo, { name }) => entradas.push({ name, conteudo }),
  };
}

function nota(over = {}) {
  return { id: "pi-1", type: "NFSE", numero: "13995", chaveAcesso: null, emitenteDoc: CNPJ, ...over };
}

function recusa(code, message = "recusado") {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe("o nome do arquivo: CNPJ da empresa + o NÚMERO da nota", () => {
  test("é `{CNPJ}_{numero}.pdf`", () => {
    expect(nomeNoLote({ cnpj: CNPJ, numero: "13995" })).toBe("12345678000199_13995.pdf");
  });

  test("o CNPJ entra só com dígitos — pontuação do cadastro não vira nome de arquivo", () => {
    expect(nomeNoLote({ cnpj: "12.345.678/0001-99", numero: "7" }))
      .toBe("12345678000199_7.pdf");
  });

  // ⚠⚠ ESTA É A ESCOLHA QUE O RELATÓRIO DA ENTREGA DEFENDE. O pedido dizia "um número"; um contador
  // sequencial atenderia a letra e seria instável (o `_3` de hoje aponta para outra nota amanhã).
  // O número da NFS-e é estável, único por emitente e fiscalmente significativo.
  test("o número É o da NOTA, não a posição dela no lote", () => {
    const notas = [nota({ id: "a", numero: "900" }), nota({ id: "b", numero: "12" })];
    const nomes = notas.map((n) => nomeNoLote({ cnpj: CNPJ, numero: n.numero }));
    expect(nomes).toEqual(["12345678000199_900.pdf", "12345678000199_12.pdf"]);
    // Se fosse sequencial, seriam `_1` e `_2` — e trocar a ordem trocaria os nomes.
    expect(nomes.join()).not.toMatch(/_1\.pdf|_2\.pdf/);
  });

  test("nota SEM número cai na chave de acesso, e depois no id — nunca fica sem nome", () => {
    expect(nomeNoLote({ cnpj: CNPJ, numero: null, chaveAcesso: "3312" }))
      .toBe("12345678000199_3312.pdf");
    expect(nomeNoLote({ cnpj: CNPJ, numero: null, chaveAcesso: null, id: "pi-77" }))
      .toBe("12345678000199_pi-77.pdf");
    expect(nomeNoLote({ cnpj: CNPJ })).toBe("12345678000199_sem-numero.pdf");
  });

  test("sem CNPJ o nome DIZ que não há CNPJ, em vez de começar com `_`", () => {
    expect(nomeNoLote({ cnpj: null, numero: "9" })).toBe("sem-cnpj_9.pdf");
  });

  // ⚠ Barra num nome dentro de zip vira PASTA e `../` sobe um nível — não é teoria. O que a
  // sanitização garante é que NENHUM SEPARADOR sobrevive: o ponto continua permitido (ele é a
  // extensão), então `..` vira texto inerte no meio do nome, e sem barra ele não navega nada.
  test("barra, contrabarra e dois-pontos não sobrevivem ao nome", () => {
    const travessia = nomeNoLote({ cnpj: CNPJ, numero: "../../etc/passwd" });
    expect(travessia).toBe("12345678000199_.._.._etc_passwd.pdf");
    expect(travessia).not.toMatch(/[/\\:]/);

    const windows = nomeNoLote({ cnpj: CNPJ, numero: "C:\\nota" });
    expect(windows).toBe("12345678000199_C_nota.pdf");
    expect(windows).not.toMatch(/[/\\:]/);

    expect(safeFilePart("a/b:c")).toBe("a_b_c");
  });
});

describe("o nomeador NÃO deixa dois arquivos com o mesmo nome", () => {
  test("a segunda nota de mesmo número ganha sufixo — e a colisão é DECLARADA", () => {
    const nomear = criarNomeadorDeLote();
    const um = nomear({ cnpj: CNPJ, numero: "13995" });
    const dois = nomear({ cnpj: CNPJ, numero: "13995" });
    expect(um).toEqual({ nome: "12345678000199_13995.pdf", colidiu: false });
    expect(dois).toEqual({ nome: "12345678000199_13995-2.pdf", colidiu: true });
  });

  test("duas notas SEM número não se sobrescrevem", () => {
    const nomear = criarNomeadorDeLote();
    const a = nomear({ cnpj: CNPJ, id: null });
    const b = nomear({ cnpj: CNPJ, id: null });
    expect(a.nome).not.toBe(b.nome);
  });

  // ⚠ Uma nota chamada `RELATORIO` sobrescreveria o relatório — que é justamente o arquivo que
  // conta o que ficou de fora.
  test("nenhuma nota pode ocupar o nome do relatório", () => {
    const nomear = criarNomeadorDeLote();
    expect(nomear({ cnpj: "", numero: "" }).nome).not.toBe(NOME_DO_RELATORIO);
    expect(NOME_DO_RELATORIO).toBe("RELATORIO.txt");
  });
});

describe("o lote conta o que NÃO pôde gerar", () => {
  test("o caminho feliz: um PDF por nota, com o nome do esquema", async () => {
    const archive = arquivoFalso();
    const gerar = jest.fn(async () => ({ pdf: Buffer.from("%PDF") }));
    const r = await gerarLoteDanfse({
      notas: [nota({ id: "a", numero: "10" }), nota({ id: "b", numero: "11" })],
      portalClientId: "pc-1",
      cnpjDaEmpresa: CNPJ,
      archive,
      gerar,
    });
    expect(r).toMatchObject({ geradas: 2, falhas: [], colisoes: [] });
    expect(archive.entradas.map((e) => e.name)).toEqual([
      "12345678000199_10.pdf",
      "12345678000199_11.pdf",
    ]);
  });

  // ⚠⚠ O RAMO QUE ESTA SUÍTE EXISTE PARA PRENDER. NF-e não é filtrada no SQL de propósito: a tela
  // do cliente a mostra na mesma tabela, e removê-la calada faria a pessoa ver 2 linhas e receber
  // 1 PDF.
  test("NF-e não vira PDF — ela vira LINHA no relatório, e o gerador nem é chamado", async () => {
    const archive = arquivoFalso();
    const gerar = jest.fn(async () => ({ pdf: Buffer.from("%PDF") }));
    const r = await gerarLoteDanfse({
      notas: [nota({ id: "a", numero: "10", type: "NFE" }), nota({ id: "b", numero: "11" })],
      portalClientId: "pc-1",
      cnpjDaEmpresa: CNPJ,
      archive,
      gerar,
    });
    expect(r.geradas).toBe(1);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0].motivo).toMatch(/NF-e/);
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(gerar).toHaveBeenCalledWith({ portalClientId: "pc-1", notaId: "b" });
    expect(archive.entradas.map((e) => e.name)).toEqual(["12345678000199_11.pdf"]);
  });

  // ⚠⚠ O 503 da porta individual É espelhado — não afrouxado. Um DANFSe sem QR Code não é um
  // DANFSe (NT 008 §2.2 e §2.4.3): incluí-lo no zip entregaria ao tomador o documento inválido
  // que aquela recusa existe para impedir.
  test.each([
    ["DANFSE_SEM_QRCODE", /QR Code/],
    ["DANFSE_XML_INDISPONIVEL", /XML/],
    ["DANFSE_XML_NAO_E_NFSE", /NFS-e/],
    ["DANFSE_NOTA_NAO_ENCONTRADA", /não foi encontrada/],
  ])("a recusa %s vira linha no relatório, e o zip não ganha PDF", async (code, esperado) => {
    const archive = arquivoFalso();
    const gerar = jest.fn(async () => { throw recusa(code); });
    const r = await gerarLoteDanfse({
      notas: [nota()],
      portalClientId: "pc-1",
      cnpjDaEmpresa: CNPJ,
      archive,
      gerar,
    });
    expect(r.geradas).toBe(0);
    expect(archive.entradas).toHaveLength(0);
    expect(r.falhas[0].motivo).toMatch(esperado);
  });

  // ⚠ Uma nota estourando não pode derrubar as outras 199 — mas também não pode sumir calada.
  test("erro inesperado numa nota não interrompe o lote, e sai nomeado", async () => {
    const archive = arquivoFalso();
    const gerar = jest.fn(async ({ notaId }) => {
      if (notaId === "b") throw new Error("banco caiu");
      return { pdf: Buffer.from("%PDF") };
    });
    const r = await gerarLoteDanfse({
      notas: [nota({ id: "a", numero: "1" }), nota({ id: "b", numero: "2" }), nota({ id: "c", numero: "3" })],
      portalClientId: "pc-1",
      cnpjDaEmpresa: CNPJ,
      archive,
      gerar,
    });
    expect(r.geradas).toBe(2);
    expect(r.falhas[0].motivo).toContain("banco caiu");
  });

  test("o CNPJ do arquivo é o do EMITENTE da nota, com o da empresa como reserva", async () => {
    const archive = arquivoFalso();
    const gerar = async () => ({ pdf: Buffer.from("%PDF") });
    await gerarLoteDanfse({
      notas: [
        nota({ id: "a", numero: "1", emitenteDoc: "99999999000191" }),
        nota({ id: "b", numero: "2", emitenteDoc: null }),
      ],
      portalClientId: "pc-1",
      cnpjDaEmpresa: CNPJ,
      archive,
      gerar,
    });
    expect(archive.entradas.map((e) => e.name)).toEqual([
      "99999999000191_1.pdf",
      "12345678000199_2.pdf",
    ]);
  });

  test("`motivoDaFalha` não inventa motivo para código desconhecido", () => {
    expect(motivoDaFalha(recusa("COISA_NOVA", "algo"))).toBe("falha inesperada: algo");
    expect(motivoDaFalha({})).toMatch(/sem motivo informado/);
  });
});

describe("o relatório dentro do zip", () => {
  // ⚠ ELE VAI SEMPRE. Relatório que só aparece quando há problema é indistinguível de relatório
  // que não foi gerado — e "50 de 50" é a confirmação que o silêncio não dá.
  test("sem falha, ele CONFIRMA que nada ficou de fora", () => {
    const txt = textoDoRelatorio({ empresa: "ACME", cnpj: CNPJ, competencia: "2026-08", geradas: 50 });
    expect(txt).toContain("PDFs neste zip ........: 50");
    expect(txt).toContain("Notas SEM DANFSe ......: 0");
    expect(txt).toContain("Todas as notas do filtro geraram DANFSe");
  });

  test("com falha, ele NOMEIA a nota e o motivo", () => {
    const txt = textoDoRelatorio({
      empresa: "ACME",
      cnpj: CNPJ,
      competencia: "2026-08",
      geradas: 47,
      falhas: [
        { nota: { numero: "13995" }, motivo: "o QR Code não pôde ser gerado" },
        { nota: { numero: null, chaveAcesso: "3312" }, motivo: "é NF-e" },
        { nota: { numero: null, chaveAcesso: null, id: "pi-9" }, motivo: "sem XML" },
      ],
    });
    expect(txt).toContain("Notas SEM DANFSe ......: 3");
    expect(txt).toContain("Notas no filtro .......: 50");
    expect(txt).toContain("• nota 13995 — o QR Code não pôde ser gerado");
    expect(txt).toContain("• nota sem número (chave 3312) — é NF-e");
    expect(txt).toContain("• nota sem número (id pi-9) — sem XML");
  });

  test("a colisão de nomes também é dita — sobrescrever em silêncio é o que ela impede", () => {
    const txt = textoDoRelatorio({
      geradas: 2,
      colisoes: ["12345678000199_13995-2.pdf (nota 13995)"],
    });
    expect(txt).toContain("Nomes repetidos");
    expect(txt).toContain("12345678000199_13995-2.pdf");
  });

  test("o teto é um número declarado, não uma constante escondida", () => {
    expect(LOTE_MAXIMO).toBe(200);
  });
});
