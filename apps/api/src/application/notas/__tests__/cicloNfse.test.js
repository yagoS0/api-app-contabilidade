// O CICLO DE VIDA DA NFS-e — cancelada × substituída × substituta × "não temos o evento".
//
// As fixtures de XML abaixo têm a ESTRUTURA dos documentos reais capturados do ADN (a mesma que os
// leiautes oficiais ANEXO_I e ANEXO_II v1.01 descrevem), com CNPJ, chaves e nomes FABRICADOS —
// mesmo formato e comprimento dos reais, dígitos inventados. Fixture entra no histórico do git
// para sempre; identificador real, não.

import { parseNfseEvento, parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { derivarCiclo, montarIndiceDeCiclo, SITUACAO } from "../cicloNota.js";

// Chaves fabricadas, 50 dígitos (o comprimento real da chave da NFS-e Nacional).
const CH_VELHA = "33045572200000000000191000000000000926088310270000";
const CH_NOVA = "33045572200000000000191000000000001026088310271111";

// ── XML de EVENTO, como o ADN devolve ────────────────────────────────────────────────────────
// ⚠ Repare no que NÃO existe aqui: não há elemento <tpEvento>. O código do evento vive só no
// atributo Id. Foi essa ausência que fez `parseNfseEvento` devolver `tpEvento: null` sempre.
const eventoCancelamento = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT${CH_VELHA}101101001">
    <verAplic>EmissorWeb_1.6.0.0</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>
    <dhProc>2026-08-05T12:47:22-03:00</dhProc><nDFe>0</nDFe>
    <pedRegEvento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
      <infPedReg Id="PRE${CH_VELHA}101101">
        <tpAmb>1</tpAmb><verAplic>EmissorWeb</verAplic>
        <dhEvento>2026-08-05T12:45:00-03:00</dhEvento>
        <CNPJAutor>00000000000191</CNPJAutor><chNFSe>${CH_VELHA}</chNFSe>
        <e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>99</cMotivo>
          <xMotivo>erro na emissao</xMotivo></e101101>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;

const eventoSubstituicao = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT${CH_VELHA}105102001">
    <nSeqEvento>1</nSeqEvento><dhProc>2026-08-05T13:30:21-03:00</dhProc>
    <pedRegEvento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
      <infPedReg Id="PRE${CH_VELHA}105102">
        <dhEvento>2026-08-05T13:29:00-03:00</dhEvento><chNFSe>${CH_VELHA}</chNFSe>
        <e105102><xDesc>Cancelamento de NFS-e por Substituição</xDesc><cMotivo>99</cMotivo>
          <xMotivo>valor da nota esta incorreto</xMotivo>
          <chSubstituta>${CH_NOVA}</chSubstituta></e105102>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;

// ── XML de NOTA substituta — o vínculo mora DENTRO da DPS ────────────────────────────────────
const notaSubstituta = `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${CH_NOVA}"><nNFSe>10</nNFSe><cStat>101</cStat>
    <DPS><infDPS Id="DPS1"><dhEmi>2026-08-05T13:30:21-03:00</dhEmi>
      <serie>1</serie><nDPS>12</nDPS><dCompet>2026-07-01</dCompet><tpEmit>1</tpEmit>
      <subst><chSubstda>${CH_VELHA}</chSubstda><cMotivo>99</cMotivo>
        <xMotivo>valor da nota esta incorreto</xMotivo></subst>
      <prest><CNPJ>00000000000191</CNPJ></prest>
      <serv><cServ><cTribNac>140101</cTribNac><xDescServ>Servico</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>21034.26</vServ></vServPrest></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;

describe("parseNfseEvento — o código do evento vem do Id, não de <tpEvento>", () => {
  it("lê tpEvento/nSeq do atributo Id quando o elemento não existe", () => {
    const ev = parseNfseEvento(eventoCancelamento);
    expect(ev.tpEvento).toBe("101101");
    expect(ev.nSeqEvento).toBe(1);
    expect(ev.chave).toBe(CH_VELHA);
    expect(ev.isCancelamento).toBe(true);
  });

  it("NÃO colapsa cancelamento e substituição no mesmo fato", () => {
    expect(parseNfseEvento(eventoCancelamento).tipo).toBe("cancelamento");
    expect(parseNfseEvento(eventoSubstituicao).tipo).toBe("canc_por_substituicao");
  });

  it("extrai a chave da substituta de <chSubstituta> (nome do padrão)", () => {
    const ev = parseNfseEvento(eventoSubstituicao);
    expect(ev.chaveSubstituta).toBe(CH_NOVA);
    expect(ev.xMotivo).toBe("valor da nota esta incorreto");
    expect(ev.dhEvento).toBeInstanceOf(Date);
  });

  // Regressão do achado que originou tudo: o cancelamento simples NÃO pode trazer chave substituta.
  it("cancelamento simples não inventa chave substituta", () => {
    expect(parseNfseEvento(eventoCancelamento).chaveSubstituta).toBeNull();
    expect(parseNfseEvento(eventoCancelamento).tipo).not.toBe("canc_por_substituicao");
  });

  it("XML vazio não vira cancelamento", () => {
    const ev = parseNfseEvento("");
    expect(ev.isCancelamento).toBe(false);
    expect(ev.tipo).toBeNull();
  });
});

describe("parseXmlMetadata — o vínculo <subst><chSubstda> da nota substituta", () => {
  it("extrai a chave da substituída e o motivo", () => {
    const m = parseXmlMetadata(notaSubstituta);
    expect(m.chaveSubstituida).toBe(CH_VELHA);
    expect(m.motivoSubstituicao).toBe("valor da nota esta incorreto");
  });

  it("nota comum não ganha vínculo nenhum", () => {
    const semSubst = notaSubstituta.replace(/<subst>[\s\S]*?<\/subst>/, "");
    const m = parseXmlMetadata(semSubst);
    expect(m.chaveSubstituida).toBeNull();
    expect(m.motivoSubstituicao).toBeNull();
  });

  // ⚠ `cMotivo`/`xMotivo` existem em mais de um lugar do XML — buscá-los no documento inteiro
  // traria o motivo errado. O motivo tem de sair de DENTRO do bloco <subst>.
  it("não confunde o xMotivo do <subst> com outro xMotivo do documento", () => {
    const comOutro = notaSubstituta.replace("<prest>", "<xMotivo>motivo de outro bloco</xMotivo><prest>");
    expect(parseXmlMetadata(comOutro).motivoSubstituicao).toBe("valor da nota esta incorreto");
  });
});

describe("derivarCiclo — as quatro coisas que não são a mesma", () => {
  const notaCancelada = { id: "v", chaveAcesso: CH_VELHA, statusEfetivo: "cancelada" };

  it("autorizada continua autorizada", () => {
    const c = derivarCiclo({ nota: { id: "a", chaveAcesso: CH_NOVA, statusEfetivo: "autorizada" } });
    expect(c.situacao).toBe(SITUACAO.AUTORIZADA);
    expect(c.avisos).toHaveLength(0);
  });

  it("cancelada COM evento de cancelamento simples = cancelada, e sabemos por quê", () => {
    const c = derivarCiclo({
      nota: notaCancelada,
      evento: { type: "cancelamento", tpEvento: "101101", date: new Date("2026-08-05"), reason: "erro na emissao" },
    });
    expect(c.situacao).toBe(SITUACAO.CANCELADA);
    expect(c.eventoRegistrado).toBe(true);
    expect(c.evento.motivo).toBe("erro na emissao");
    expect(c.avisos).toHaveLength(0);
  });

  it("cancelada por SUBSTITUIÇÃO é substituída, e aponta a substituta", () => {
    const c = derivarCiclo({
      nota: notaCancelada,
      evento: { type: "canc_por_substituicao", tpEvento: "105102", chaveSubstituta: CH_NOVA },
      substituta: { id: "n", numero: "10", chaveAcesso: CH_NOVA, chaveSubstituida: CH_VELHA },
    });
    expect(c.situacao).toBe(SITUACAO.SUBSTITUIDA);
    expect(c.substituidaPor).toMatchObject({ numero: "10", naBase: true });
  });

  // ⚠ ESTE É O TESTE QUE IMPORTA MAIS. É o estado das 556 canceladas de produção.
  it('cancelada SEM evento diz "não temos o evento" — nunca "não houve evento"', () => {
    const c = derivarCiclo({ nota: notaCancelada });
    expect(c.situacao).toBe(SITUACAO.CANCELADA);
    expect(c.eventoRegistrado).toBe(false);
    expect(c.avisos.map((a) => a.codigo)).toContain("evento_nao_registrado");
    expect(c.avisos[0].texto).toMatch(/não quer dizer que o evento não existiu/i);
  });

  it("a SUBSTITUTA é reconhecida pelo vínculo da própria nota, mesmo sem evento", () => {
    const c = derivarCiclo({
      nota: { id: "n", chaveAcesso: CH_NOVA, statusEfetivo: "autorizada", chaveSubstituida: CH_VELHA, motivoSubstituicao: "valor incorreto" },
      substituida: { id: "v", numero: "9", chaveAcesso: CH_VELHA },
    });
    expect(c.situacao).toBe(SITUACAO.AUTORIZADA);
    expect(c.ehSubstituta).toBe(true);
    expect(c.substitui).toMatchObject({ numero: "9", naBase: true });
    expect(c.motivoSubstituicao).toBe("valor incorreto");
  });

  // O vínculo é real mesmo quando a outra ponta não foi capturada — 4 casos medidos em produção.
  it("vínculo que aponta para fora da base é dito, não escondido", () => {
    const c = derivarCiclo({
      nota: { id: "n", chaveAcesso: CH_NOVA, statusEfetivo: "autorizada", chaveSubstituida: CH_VELHA },
      substituida: null,
    });
    expect(c.substitui).toMatchObject({ chaveAcesso: CH_VELHA, naBase: false });
    expect(c.avisos.map((a) => a.codigo)).toContain("substituida_ausente");
  });

  // ⚠ Medido em produção: 4 notas TÊM substituta e continuam marcadas "autorizada" — todas são
  // linhas do lote de 62 em que o XML do evento sobrescreveu a nota (ficaram sem número e sem
  // valor). A contradição não pode ficar muda; corrigir o dado é decisão do dono.
  it("nota AUTORIZADA que alguém substituiu grita a contradição", () => {
    const c = derivarCiclo({
      nota: { id: "x", chaveAcesso: CH_VELHA, statusEfetivo: "autorizada", numero: null },
      substituta: { id: "n", numero: "66388", chaveAcesso: CH_NOVA, chaveSubstituida: CH_VELHA },
    });
    expect(c.situacao).toBe(SITUACAO.AUTORIZADA);
    expect(c.avisos.map((a) => a.codigo)).toContain("substituida_mas_autorizada");
  });

  it("nota autorizada SEM substituta não recebe esse aviso", () => {
    const c = derivarCiclo({ nota: { id: "x", chaveAcesso: CH_VELHA, statusEfetivo: "autorizada" } });
    expect(c.avisos).toHaveLength(0);
  });

  // Medido em produção: 3 notas são substitutas E foram substituídas depois.
  it("uma nota pode ser substituta E ter sido substituída", () => {
    const c = derivarCiclo({
      nota: { id: "m", chaveAcesso: "33045572200000000000191000000000000926088310279999", statusEfetivo: "cancelada", chaveSubstituida: CH_VELHA },
      evento: { type: "canc_por_substituicao", chaveSubstituta: CH_NOVA },
      substituida: { id: "v", numero: "285", chaveAcesso: CH_VELHA },
      substituta: { id: "n", numero: "287", chaveAcesso: CH_NOVA },
    });
    expect(c.situacao).toBe(SITUACAO.SUBSTITUIDA);
    expect(c.ehSubstituta).toBe(true);
    expect(c.substitui.numero).toBe("285");
    expect(c.substituidaPor.numero).toBe("287");
  });
});

describe("montarIndiceDeCiclo — a página inteira sem consulta por linha", () => {
  it("liga as duas pontas do par substituta/substituída", () => {
    const notas = [
      { id: "v", numero: "9", chaveAcesso: CH_VELHA, statusEfetivo: "cancelada" },
      { id: "n", numero: "10", chaveAcesso: CH_NOVA, statusEfetivo: "autorizada", chaveSubstituida: CH_VELHA },
    ];
    const eventos = [{ invoiceId: "v", type: "canc_por_substituicao", chaveSubstituta: CH_NOVA, date: new Date("2026-08-05") }];
    const [velha, nova] = montarIndiceDeCiclo({ notas, eventos, relacionadas: notas });

    expect(velha.ciclo.situacao).toBe(SITUACAO.SUBSTITUIDA);
    expect(velha.ciclo.substituidaPor.numero).toBe("10");
    expect(nova.ciclo.ehSubstituta).toBe(true);
    expect(nova.ciclo.substitui.numero).toBe("9");
  });

  it("substituição vence cancelamento quando a nota tem os dois eventos", () => {
    const notas = [{ id: "v", chaveAcesso: CH_VELHA, statusEfetivo: "cancelada" }];
    const eventos = [
      { invoiceId: "v", type: "cancelamento", date: new Date("2026-08-06") },
      { invoiceId: "v", type: "canc_por_substituicao", chaveSubstituta: CH_NOVA, date: new Date("2026-08-05") },
    ];
    const [n] = montarIndiceDeCiclo({ notas, eventos, relacionadas: [] });
    expect(n.ciclo.situacao).toBe(SITUACAO.SUBSTITUIDA);
  });

  it("nota sem evento nenhum não deixa de ser processada", () => {
    const notas = [{ id: "a", chaveAcesso: CH_NOVA, statusEfetivo: "autorizada" }];
    const [n] = montarIndiceDeCiclo({ notas, eventos: [], relacionadas: [] });
    expect(n.ciclo.situacao).toBe(SITUACAO.AUTORIZADA);
    expect(n.ciclo.eventoRegistrado).toBe(false);
  });
});
