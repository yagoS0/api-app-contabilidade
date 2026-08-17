// OS CAMPOS FISCAIS SAEM DO CAMINHO CERTO — OU NÃO SAEM.
//
// ⚠ POR QUE ESTE TESTE EXISTE
//   • Estas colunas alimentam uma AUDITORIA pré-apuração ("a nota foi emitida na atividade certa?").
//     Ler a tag errada aqui não dá erro nenhum: dá a auditoria acusando a nota errada.
//   • O XML da NFS-e repete nomes de tag em grupos diferentes — `vBC` está em `infNFSe/valores`
//     (ISSQN) E em `IBSCBS/valores` (IBS/CBS). `getTextByLocalNames` devolveria o primeiro do
//     documento inteiro. Os testes de armadilha abaixo são exatamente esses casos.
//   • ⚠ A FIXTURE É XML DE VERDADE — a amostra de leiaute 1.01 versionada em `docs/leiaute-nfse/`,
//     não uma string inventada aqui. Duplicá-la no teste faria a amostra e o teste divergirem na
//     primeira correção de leiaute. (`import.meta.url` não serve: o jest deste projeto vira CJS.)

import fs from "node:fs";
import path from "node:path";
import {
  extrairCamposFiscaisNfse,
  CAMPOS,
  CAMPOS_DELEGADOS,
  IDS_DOS_CAMPOS,
  MOTIVO,
} from "../camposFiscaisNfse.js";
import { campoPorId, CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01 } from "../danfse/danfseLeiaute.js";

const RELATIVO = "docs/leiaute-nfse/nfse-nacional-substituicao.xml";
function acharFixture() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, RELATIVO);
    if (fs.existsSync(tentativa)) return tentativa;
    dir = path.dirname(dir);
  }
  throw new Error(`Amostra de NFS-e não encontrada a partir de ${process.cwd()} (${RELATIVO}).`);
}
const xmlBase = fs.readFileSync(acharFixture(), "utf8");

describe("a amostra REAL de leiaute 1.01 — cada campo, com o valor que está no arquivo", () => {
  const r = extrairCamposFiscaisNfse(xmlBase);

  it("lê tudo e não devolve motivo nenhum", () => {
    expect(r.ok).toBe(true);
    expect(r.motivo).toBeNull();
  });

  it("cTribNac — o código de serviço, 6 dígitos (item+subitem+desdobro), de `serv/cServ`", () => {
    expect(r.campos.cTribNac).toBe("310104");
    expect(r.origem.cTribNac).toBe("DPS/infDPS/serv/cServ/cTribNac");
  });

  it("cTribMun — e a ORIGEM fica registrada, porque a NT o declara em outro grupo", () => {
    // A NT §2.4.5 aponta o municipal para `NFSe/infNFSe/`; nesta amostra ele vem em `serv/cServ`.
    // As duas leituras existem, nesta ordem (a mesma de `danfseDados.js`), e qual respondeu é dado.
    expect(r.campos.cTribMun).toBe("001");
    expect(r.origem.cTribMun).toBe("DPS/infDPS/serv/cServ/cTribMun");
  });

  it("xTribNac / xTribMun — as descrições que a própria NFS-e já devolve prontas", () => {
    expect(r.campos.xTribNac).toBe("Serviços técnicos em telecomunicações e congêneres.");
    expect(r.campos.xTribMun).toBe("Serviços técnicos em telecomunicações.");
    expect(r.origem.xTribNac).toBe("xTribNac");
  });

  it("xDescServ — a descrição escrita pelo emitente", () => {
    expect(r.campos.xDescServ).toBe("serviço de telemetria");
  });

  it("cLocPrestacao — o município da prestação, código IBGE de 7 dígitos", () => {
    expect(r.campos.cLocPrestacao).toBe("3304557");
    expect(r.origem.cLocPrestacao).toBe("DPS/infDPS/serv/locPrest/cLocPrestacao");
  });

  it("ISSQN — base, alíquota e apurado, como STRING decimal (dinheiro não anda em float)", () => {
    expect(r.campos.issqnBaseCalculo).toBe("198.00");
    expect(r.campos.issqnAliquota).toBe("5.00");
    expect(r.campos.issqnValor).toBe("9.90");
    // ⚠ String, não Number: a coluna é `Decimal` e o Prisma aceita a string sem passar por float.
    expect(typeof r.campos.issqnValor).toBe("string");
  });

  it("série e número da DPS — série normalizada em 5 dígitos, e o número NÃO é o `nNFSe`", () => {
    expect(r.campos.dpsSerie).toBe("00900"); // a amostra traz <serie>900</serie>
    expect(r.campos.dpsNumero).toBe("35"); // <nDPS>35</nDPS>
    // <nNFSe>18</nNFSe> é OUTRO contador (do município/SEFIN) e é ele que `PortalInvoice.numero`
    // guarda. Confundir os dois é o erro que `nfseUltimaNota.js` existe para impedir.
    expect(r.campos.dpsNumero).not.toBe("18");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AS ARMADILHAS — nome de tag repetido em grupos diferentes
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("leitura por CAMINHO, nunca por nome de tag", () => {
  it("⚠ `vBC` existe em DOIS grupos — lê o do ISSQN, não o do IBS/CBS", () => {
    // Este é o caso literal: `infNFSe/valores/vBC` (ISSQN) × `infNFSe/IBSCBS/valores/vBC` (base
    // após exclusões do IBS/CBS). Uma varredura por nome pegaria o primeiro do documento.
    // ⚠ O grupo isca entra ANTES do grupo bom no documento — é o pior caso para uma varredura por
    // nome, e é o caso real: no leiaute 2.0 o `IBSCBS` aparece dentro de `infNFSe`.
    const comIbsCbs = xmlBase.replace(
      "<xLocEmi>",
      "<IBSCBS><valores><vBC>999999.99</vBC></valores></IBSCBS><xLocEmi>",
    );
    expect(comIbsCbs).toContain("999999.99"); // a armadilha foi mesmo plantada
    const r = extrairCamposFiscaisNfse(comIbsCbs);
    expect(r.campos.issqnBaseCalculo).toBe("198.00");
    expect(r.campos.issqnBaseCalculo).not.toBe("999999.99");
  });

  it("⚠ um `cTribNac` em outro grupo do documento não sequestra a leitura", () => {
    const comIsca = xmlBase.replace(
      "<nNFSe>18</nNFSe>",
      "<nNFSe>18</nNFSe><outroGrupo><cTribNac>999999</cTribNac><xDescServ>ISCA</xDescServ></outroGrupo>",
    );
    const r = extrairCamposFiscaisNfse(comIsca);
    expect(r.campos.cTribNac).toBe("310104");
    expect(r.campos.xDescServ).toBe("serviço de telemetria");
  });

  it("⚠ um `vISSQN` dentro de outro grupo não vira o ISS apurado da nota", () => {
    const comIsca = xmlBase.replace(
      "<nNFSe>18</nNFSe>",
      "<nNFSe>18</nNFSe><totCIBS><valores><vISSQN>4242.42</vISSQN></valores></totCIBS>",
    );
    expect(extrairCamposFiscaisNfse(comIsca).campos.issqnValor).toBe("9.90");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O CAMINHO NÃO FOI REDESCOBERTO — ele vem do leiaute transcrito
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("os caminhos batem com `danfse/danfseLeiaute.js` (NT 008 §2.4.5)", () => {
  // Se a NT for corrigida e o caminho mudar lá, este teste cai aqui — que é o ponto: um caminho
  // escrito duas vezes, em dois arquivos, é um caminho que vai divergir.
  const PREFIXO = "NFSe/infNFSe/";

  it.each(
    CAMPOS.filter((c) => c.id !== "cLocPrestacao").map((c) => [c.id, c]),
  )("%s — o diretório está no `caminho` e a tag está no `tag` do leiaute", (_id, campo) => {
    const doLeiaute = campoPorId(campo.leiauteCampoId);
    expect(doLeiaute).not.toBeNull();
    for (const caminho of campo.caminhos) {
      const partes = caminho.split("/");
      const tag = partes.pop();
      const diretorio = `${PREFIXO}${partes.length ? `${partes.join("/")}/` : ""}`;
      expect(doLeiaute.tag).toContain(tag);
      expect(doLeiaute.caminho).toContain(diretorio);
    }
  });

  it("série e nDPS vêm do bloco DADOS DA NFS-e, e são lidos por `nfseUltimaNota`", () => {
    for (const c of CAMPOS_DELEGADOS) {
      const doLeiaute = campoPorId(c.leiauteCampoId);
      expect(doLeiaute.caminho).toBe("NFSe/infNFSe/DPS/infDPS/");
      expect(c.lidoPor).toBe("nfseUltimaNota.lerSerieENumeroDaDps");
    }
  });

  it("⚠ `cLocPrestacao` é a exceção declarada: a NT nomeia o GRUPO, não a tag", () => {
    // O DANFSe imprime o NOME do município (`xLocPrestacao`), então a NT não precisa nomear o
    // código. O caminho vem da amostra versionada + de `NfseService.buildDpsXml` +
    // `docs/nfse-preenchimento.md` §2 — não de suposição. O que o leiaute confirma é o grupo.
    const doLeiaute = campoPorId("locPrest");
    expect(doLeiaute.caminho).toContain("NFSe/infNFSe/DPS/infDPS/serv/locPrest/");
    expect(doLeiaute.tag).not.toContain("cLocPrestacao");
    expect(xmlBase).toContain("<locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest>");
  });

  it("⚠ NENHUM campo extraído vem dos grupos IBS/CBS, que não existem no leiaute 1.01", () => {
    // `CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01` lista o que a NT (DANFSe v2.0) pede e o nosso XML não tem.
    // Extrair qualquer um deles daria coluna sempre nula com cara de bug.
    for (const campo of CAMPOS) {
      for (const caminho of campo.caminhos) expect(caminho).not.toContain("IBSCBS");
      expect(CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01).not.toContain(campo.leiauteCampoId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AUSÊNCIA É RESPOSTA — nunca zero, nunca string vazia, nunca "provável"
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("o que não dá para ler fica NULO, com motivo", () => {
  it("campo que o XML não traz sai `null` — e não `0`", () => {
    const semIss = xmlBase.replace("<vISSQN>9.90</vISSQN>", "");
    const r = extrairCamposFiscaisNfse(semIss);
    expect(r.campos.issqnValor).toBeNull();
    expect(r.campos.issqnValor).not.toBe(0);
    expect(r.campos.issqnValor).not.toBe("0");
    expect(r.campos.issqnValor).not.toBe("");
    // O resto continua sendo lido: ausência de UM campo não invalida a nota.
    expect(r.ok).toBe(true);
    expect(r.campos.issqnBaseCalculo).toBe("198.00");
  });

  it("valor presente mas fora da forma numérica NÃO vira zero — vira nulo com motivo nomeado", () => {
    // Um `0` aqui AFIRMARIA "ISS apurado de R$ 0,00", que é declaração fiscal.
    const torto = xmlBase.replace("<vISSQN>9.90</vISSQN>", "<vISSQN>N/D</vISSQN>");
    const r = extrairCamposFiscaisNfse(torto);
    expect(r.campos.issqnValor).toBeNull();
    expect(r.motivo).toContain(`${MOTIVO.CAMPO_ILEGIVEL}:issqnValor`);
  });

  it("XML ausente e XML vazio têm motivo próprio, e todos os campos vêm nulos", () => {
    for (const entrada of [null, undefined, "", "   "]) {
      const r = extrairCamposFiscaisNfse(entrada);
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe(MOTIVO.XML_AUSENTE);
      for (const id of IDS_DOS_CAMPOS) expect(r.campos[id]).toBeNull();
    }
  });

  it("⚠ NF-e RECUSA com motivo próprio — não devolve um resultado vazio que parece sucesso", () => {
    // O XML da NF-e é outro documento: `nfeProc/NFe/infNFe`. Sem `infNFSe`, aplicar este leiaute
    // devolveria tudo nulo — indistinguível de "NFS-e cujo XML não deu para ler".
    // (Identificadores fabricados; nenhuma nota real entra no repositório.)
    const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe33260800000000000191550010000000011000000019" versao="4.00">
    <ide><cUF>33</cUF><serie>1</serie><nNF>1</nNF></ide>
    <emit><CNPJ>00000000000191</CNPJ><xNome>EMPRESA EXEMPLO LTDA</xNome></emit>
    <det nItem="1"><prod><cProd>1</cProd><NCM>84713012</NCM><CFOP>5102</CFOP><vProd>100.00</vProd></prod></det>
    <total><ICMSTot><vBC>100.00</vBC><vNF>100.00</vNF></ICMSTot></total>
  </infNFe></NFe>
</nfeProc>`;
    const r = extrairCamposFiscaisNfse(nfe);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.NAO_E_NFSE);
    for (const id of IDS_DOS_CAMPOS) expect(r.campos[id]).toBeNull();
    // ⚠ E em particular: o `vBC` do ICMS NÃO virou base de cálculo de ISSQN.
    expect(r.campos.issqnBaseCalculo).toBeNull();
  });

  it("uma DPS crua também recusa — o documento da auditoria é a NFS-e, não a declaração", () => {
    const dps = '<?xml version="1.0"?><DPS versao="1.01"><infDPS Id="DPS1"><serie>1</serie><nDPS>9</nDPS></infDPS></DPS>';
    expect(extrairCamposFiscaisNfse(dps).motivo).toBe(MOTIVO.NAO_E_NFSE);
  });

  it("`infNFSe` presente e NENHUM campo lido tem motivo próprio — é sinal de leiaute diferente", () => {
    const oco = '<?xml version="1.0"?><NFSe><infNFSe Id="NFS1"><nNFSe>7</nNFSe></infNFSe></NFSe>';
    const r = extrairCamposFiscaisNfse(oco);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.NENHUM_CAMPO);
  });
});

describe("⚠ forma do `cTribNac` — sinal de auditoria, nunca correção", () => {
  it("comprimento diferente de 6 é MARCADO, e o valor é gravado como está", () => {
    // Dar `padStart(6)` seria adivinhar o que o emitente quis dizer — e é a armadilha `010101` ×
    // `10101` já registrada no gerador da lista de serviço nacional. Nota fora da forma é
    // exatamente o que a auditoria quer ENXERGAR.
    const curto = xmlBase.replace("<cTribNac>310104</cTribNac>", "<cTribNac>31010</cTribNac>");
    const r = extrairCamposFiscaisNfse(curto);
    expect(r.campos.cTribNac).toBe("31010");
    expect(r.motivo).toContain(MOTIVO.CTRIBNAC_FORA_DA_FORMA);
    expect(r.avisos.join(" ")).toContain("31010");
  });
});

describe("pureza e idempotência — é o que torna o backfill re-executável", () => {
  it("o mesmo XML devolve exatamente o mesmo resultado", () => {
    expect(extrairCamposFiscaisNfse(xmlBase)).toEqual(extrairCamposFiscaisNfse(xmlBase));
  });

  it("devolve SEMPRE todos os ids, mesmo quando não leu nada", () => {
    const chaves = Object.keys(extrairCamposFiscaisNfse("").campos).sort();
    expect(chaves).toEqual([...IDS_DOS_CAMPOS].sort());
  });

  it("não devolve campo algum fora da lista — a coluna e o extrator não podem divergir", () => {
    expect(Object.keys(extrairCamposFiscaisNfse(xmlBase).campos).sort()).toEqual(
      [...IDS_DOS_CAMPOS].sort(),
    );
  });
});
