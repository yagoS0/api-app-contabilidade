// A TABELA DO ANEXO, NA PRÓPRIA ABA DA APURAÇÃO.
//
// > Dono, 24/08/2026: *"a aba de apuração de uma empresa do simples nacional está confusa, sem
// > tabela do anexo e muitas abas"*.
//
// ⚠⚠ ESTA TABELA É REFERÊNCIA, NÃO APURAÇÃO — e a distinção precisa estar NA TELA, não só aqui.
// Ela mostra as seis faixas do anexo e marca em qual a empresa caiu; ela **não** afirma qual DAS a
// empresa deve. Quem apura é a RFB. É a mesma disciplina de procedência que o `kpiDasApurado` já
// aplica ao distinguir "DAS oficial (SERPRO)" de "DAS calculado pelo portal", e a mesma das três
// colunas de DAS do `ApuracaoSnapshot`.
//
// ⚠ Os números vêm de `planejamento/lib/tabelasFiscais.js` — a única tabela do projeto com citação
// de lei POR VALOR. A cópia do backend (`AliquotaSimplesNacionalSeeds.js`) não tem partilha por
// tributo nenhuma; é a prova de que a segunda cópia nasce incompleta. Nada aqui é escrito à mão.
//
// ⚠ A decisão de QUAL anexo mostrar mora em `../lib/anexoDaEmpresa.js`, que é pura e testada. Este
// arquivo só desenha — inclusive os casos em que a resposta é "não dá para afirmar".

import { PANEL, fmtMoney } from "../../notas/components/notasStyles";
import { VIGENCIA_ATUAL, FONTES_VERIFICADAS_EM } from "../../planejamento/lib/tabelasFiscais";
import {
  anexosDaEmpresa,
  tabelaDoAnexo,
  SITUACAO_ANEXO,
  SITUACAO_FAIXA,
} from "../lib/anexoDaEmpresa";

const pct = (v, casas = 2) => (v == null ? "—" : `${(v * 100).toFixed(casas).replace(".", ",")}%`);

/** Rótulos dos tributos da partilha. ⚠ As chaves são as de `tabelasFiscais.js`, não inventadas. */
const NOME_DO_TRIBUTO = {
  irpj: "IRPJ",
  csll: "CSLL",
  cofins: "COFINS",
  pis: "PIS",
  cpp: "CPP",
  icms: "ICMS",
  iss: "ISS",
  ipi: "IPI",
};

function Legenda({ children, tom }) {
  return (
    <div style={{ fontSize: "0.78rem", color: tom || PANEL.muted, lineHeight: 1.5 }}>{children}</div>
  );
}

function TabelaDeUmAnexo({ chave, rbt12 }) {
  const t = tabelaDoAnexo(chave, rbt12);
  if (!t) return null;

  const marcada = t.faixaDaEmpresa;
  const porTributo = t.reparticao?.porTributo || null;

  return (
    <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, color: PANEL.text }}>{t.anexo.nome}</div>
        {t.situacao === SITUACAO_FAIXA.RESOLVIDA && t.aliquotaEfetiva != null ? (
          <div style={{ fontFamily: "monospace", color: PANEL.text }}>
            <span style={{ color: PANEL.muted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Alíquota efetiva{" "}
            </span>
            <strong>{pct(t.aliquotaEfetiva, 4)}</strong>
          </div>
        ) : null}
      </div>

      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ color: PANEL.muted, textAlign: "left" }}>
              <th style={{ padding: 6 }}>Faixa</th>
              <th style={{ padding: 6 }}>Receita bruta em 12 meses</th>
              <th style={{ padding: 6, textAlign: "right" }}>Alíquota nominal</th>
              <th style={{ padding: 6, textAlign: "right" }}>Parcela a deduzir</th>
            </tr>
          </thead>
          <tbody>
            {t.faixas.map((f) => {
              const ehDaEmpresa = marcada === f.faixa;
              return (
                <tr
                  key={f.faixa}
                  style={{
                    borderTop: `1px solid ${PANEL.border}`,
                    // ⚠ Cor de token, e NUNCA `--state-danger`: vermelho, nesta casa, bloqueia
                    // fechamento, e esta tabela não bloqueia nada.
                    background: ehDaEmpresa ? "var(--surface-raised, rgba(255,255,255,0.06))" : "transparent",
                    fontWeight: ehDaEmpresa ? 700 : 400,
                    color: PANEL.text,
                  }}
                >
                  <td style={{ padding: 6 }}>
                    {f.faixa}ª
                    {/* ⚠ A marca é TEXTO, não só cor de fundo: fundo sozinho some na impressão em
                        preto e branco, e esta aba é impressa (`data-print-area`). */}
                    {ehDaEmpresa ? <span style={{ marginLeft: 6, color: "var(--accent-cyan)" }}>◀ esta empresa</span> : null}
                  </td>
                  <td style={{ padding: 6, fontFamily: "monospace" }}>
                    {fmtMoney(f.de)} a {fmtMoney(f.ate)}
                  </td>
                  <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace" }}>{pct(f.aliquota)}</td>
                  <td style={{ padding: 6, textAlign: "right", fontFamily: "monospace" }}>
                    {/* `pd: 0` na 1ª faixa é o "—" da tabela oficial: não há parcela a deduzir. */}
                    {f.pd === 0 ? "—" : fmtMoney(f.pd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* A repartição sai SÓ da faixa da empresa. Oito colunas × seis faixas seria ruído, e o
          contador quer a partilha do caso dele. */}
      {porTributo ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: "0.72rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Repartição da alíquota efetiva, nesta faixa
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(porTributo).map(([trib, valor]) => (
              <span
                key={trib}
                style={{
                  border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: "4px 8px",
                  fontSize: "0.78rem", fontFamily: "monospace", color: PANEL.text,
                }}
              >
                {NOME_DO_TRIBUTO[trib] || trib.toUpperCase()} {pct(valor, 4)}
              </span>
            ))}
          </div>
          {t.reparticao.tetoIssAplicado ? (
            <Legenda>
              ⚠ O ISS está travado no teto legal de 5% da receita, e o que passa disso foi repartido
              entre os tributos federais por percentuais próprios da faixa.
            </Legenda>
          ) : null}
        </div>
      ) : null}

      {t.situacao === SITUACAO_FAIXA.RBT12_DESCONHECIDO ? (
        <Legenda>
          A receita dos últimos 12 meses ainda não é conhecida nesta competência, então nenhuma faixa
          está marcada. A tabela acima é a do anexo, inteira.
        </Legenda>
      ) : null}

      {t.situacao === SITUACAO_FAIXA.RBT12_ACIMA_DO_LIMITE ? (
        <Legenda tom="var(--state-warn)">
          ⚠ A receita dos últimos 12 meses passa do limite do Simples Nacional, e acima dele não há
          faixa — a empresa não pode permanecer optante.
        </Legenda>
      ) : null}

      {t.cppForaDoDas ? (
        <Legenda tom="var(--state-warn)">
          ⚠ Neste anexo a CPP <strong>não</strong> é recolhida no DAS: o INSS patronal é pago por
          fora, pela regra geral.
        </Legenda>
      ) : null}

      {t.foraDoDasNaSextaFaixa.length ? (
        <Legenda>
          Na 6ª faixa {t.foraDoDasNaSextaFaixa.map((x) => NOME_DO_TRIBUTO[x] || x).join(" e ")} sai do
          DAS e passa a ser recolhido por fora — o DAS encolhe sem a empresa pagar menos.
        </Legenda>
      ) : null}
    </div>
  );
}

/**
 * @param {object} p
 * @param {Array} p.atividades  `atividades[]` do payload do fechamento
 * @param {number|string|null} p.rbt12
 * @param {number|string|null} p.folha12m  ⚠ `null` é "não informada", e NÃO zero
 */
export function TabelaAnexoReferencia({ atividades, rbt12, folha12m }) {
  const { anexos, situacao, fatorR, limiteFatorR } = anexosDaEmpresa({ atividades, folha12m, rbt12 });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>Tabela do anexo — referência</h3>
        {/* ⚠ A VIGÊNCIA VAI IMPRESSA, como o Planejamento Tributário já faz. Tabela fiscal sem data
            de vigência não é conferível: quem lê não sabe se está olhando a regra do ano dele. */}
        <span style={{ fontSize: "0.72rem", color: PANEL.muted, fontFamily: "monospace" }}>
          vigência {VIGENCIA_ATUAL} · fontes conferidas em {FONTES_VERIFICADAS_EM}
        </span>
      </div>

      {/* ⚠⚠ A frase que separa referência de apuração. Sem ela, uma tabela ao lado do DAS se lê como
          a memória de cálculo do imposto — e quem calcula o DAS é a Receita, não esta tela. */}
      <Legenda>
        Serve para conferir em que faixa a empresa está e como a alíquota se reparte. <strong>Não é a
        apuração</strong> — o valor do DAS é o que a Receita calcula.
      </Legenda>

      {situacao === SITUACAO_ANEXO.SEM_ATIVIDADE ? (
        <Legenda>
          Nenhuma atividade escolhida nesta competência, então não há anexo a mostrar. As atividades
          ficam no perfil fiscal da empresa.
        </Legenda>
      ) : null}

      {situacao === SITUACAO_ANEXO.DEPENDE_DO_FATOR_R ? (
        // ⚠⚠ O CASO QUE JUSTIFICA A REGRA PURA: a atividade é de Fator R, o catálogo grava
        // `anexoImplicito: "III"`, e sem a folha o anexo pode ser III ou V. Mostrar só o III seria
        // desenhar a alíquota MENOR como se fosse a resposta.
        <Legenda tom="var(--state-warn)">
          ⚠ A atividade é de Fator R e a folha de 12 meses não foi informada nesta competência —
          então o anexo pode ser o III ou o V, e é a folha que decide (limite de {pct(limiteFatorR)}
          {" "}da receita). As duas tabelas estão abaixo.
        </Legenda>
      ) : null}

      {situacao === SITUACAO_ANEXO.RESOLVIDO && fatorR != null ? (
        <Legenda>
          Fator R desta competência: <strong style={{ fontFamily: "monospace" }}>{pct(fatorR)}</strong>
          {" "}(limite {pct(limiteFatorR)}).
        </Legenda>
      ) : null}

      {anexos.map((chave) => (
        <TabelaDeUmAnexo key={chave} chave={chave} rbt12={rbt12} />
      ))}
    </section>
  );
}
