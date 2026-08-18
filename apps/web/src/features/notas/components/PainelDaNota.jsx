// O ESPELHO AO VIVO — a nota como ela vai sair, ao lado do formulário, a cada tecla.
//
// ⚠ ELE NÃO É UMA SEGUNDA DESCRIÇÃO DA NOTA. As linhas saem de `linhasDoEspelho`
// (`notas/lib/declaracaoNfse.js`), a MESMA função que o passo "Conferir" e o texto do `window.
// confirm` já usavam. O projeto pagou caro por ter duas listas descrevendo a mesma nota (o espelho
// tinha sete linhas, o confirm tinha duas) e a correção foi reduzi-las a uma; um painel novo com
// linhas próprias reabriria o mesmo buraco por outro lado.
//
// ⚠ O QUE É NOVO AQUI É A CONTA, NÃO A DECLARAÇÃO. O bloco "Quanto sobra" responde a uma pergunta
// que o espelho não respondia — quanto a empresa recebe — e vem de `notas/lib/tributosDaNota.js`,
// que não sabe nada de XML nem de regra fiscal.
//
// ⚠ VER O ESPELHO NÃO É AUTORIZAÇÃO PARA EMITIR. O botão Emitir continua morando SÓ no passo de
// conferência; este painel é leitura contínua, não a porta. A garantia de que ninguém emite sem ver
// a declaração fica mais forte com ele, não mais fraca.

import { PANEL } from "./notasStyles";
import { linhasDoEspelho } from "../lib/declaracaoNfse";
import { AVISO_ESTIMATIVA, calcularTributosDaNota, dinheiroOuTraco } from "../lib/tributosDaNota";

function Linha({ rotulo, valor, forte, separadorAntes }) {
  return (
    <>
      {separadorAntes && <div style={{ borderTop: `1px solid ${PANEL.border}`, margin: "4px 0" }} />}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ color: PANEL.muted, flex: "0 0 auto" }}>{rotulo}</span>
        <span style={{ textAlign: "right", fontWeight: forte ? 800 : 500, minWidth: 0, wordBreak: "break-word" }}>
          {valor}
        </span>
      </div>
    </>
  );
}

export function PainelDaNota({ dados, pTotTribSN, destaque = false }) {
  const tributos = calcularTributosDaNota({
    valor: dados?.servico?.valor,
    aliquota: dados?.servico?.aliquota,
    issRetido: dados?.servico?.issRetido,
    pTotTribSN,
  });

  return (
    <aside
      className="emitir-nfse-painel"
      aria-label="A nota como ela vai sair"
      style={{
        border: `1px solid ${destaque ? PANEL.accent : PANEL.border}`,
        borderRadius: 8,
        background: "var(--bg-page)",
        padding: 12,
        display: "grid",
        gap: 10,
        fontSize: "0.82rem",
      }}
    >
      <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em", color: PANEL.muted, textTransform: "uppercase" }}>
        A nota como ela vai sair
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {linhasDoEspelho(dados).map((l) => (
          <Linha key={l.rotulo} rotulo={l.rotulo} valor={l.valor} forte={l.forte} separadorAntes={l.separadorAntes} />
        ))}
      </div>

      {/* ── Quanto sobra ─────────────────────────────────────────────────────
          ⚠ O LÍQUIDO EM DESTAQUE COM O ISS LOGO ACIMA, sem a linha do "não sai do líquido", parece
          erro de conta: R$ 1.500 de valor, R$ 30 de ISS e R$ 1.500 de líquido. A linha existe para
          que o número não precise ser adivinhado nem desconfiado. */}
      <div style={{ borderTop: `1px solid ${PANEL.border}`, paddingTop: 10, display: "grid", gap: 6 }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em", color: PANEL.muted, textTransform: "uppercase" }}>
          Quanto sobra
        </div>

        <Linha rotulo="Valor do serviço" valor={dinheiroOuTraco(tributos.valor)} />
        <Linha
          rotulo={tributos.issRetido ? "ISS (retido pelo tomador)" : "ISS (recolhido pelo prestador)"}
          valor={tributos.iss == null ? "—" : dinheiroOuTraco(tributos.iss)}
        />
        {tributos.motivoIss && (
          <div style={{ fontSize: "0.72rem", color: PANEL.muted, marginTop: -2 }}>{tributos.motivoIss}</div>
        )}

        <div
          style={{
            display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline",
            borderTop: `1px solid ${PANEL.border}`, paddingTop: 8, marginTop: 2,
          }}
        >
          <span style={{ color: PANEL.text, fontWeight: 700 }}>Líquido a receber</span>
          {/* ⚠ Accent, não verde: verde é CONCLUÍDO neste app, e um número calculado não concluiu
              nada. */}
          <strong style={{ fontSize: "1.05rem", color: tributos.liquido == null ? PANEL.muted : PANEL.accent }}>
            {dinheiroOuTraco(tributos.liquido)}
          </strong>
        </div>
        {tributos.motivoLiquido && (
          <div style={{ fontSize: "0.72rem", color: PANEL.muted }}>{tributos.motivoLiquido}</div>
        )}

        {tributos.naoSaemDoLiquido.length > 0 && (
          <div style={{ fontSize: "0.72rem", color: PANEL.muted, display: "grid", gap: 4, marginTop: 2 }}>
            <span style={{ fontWeight: 700 }}>Não sai do líquido:</span>
            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3 }}>
              {tributos.naoSaemDoLiquido.map((item) => (
                <li key={item.rotulo}>
                  <strong style={{ color: PANEL.text }}>{item.rotulo}</strong> — {item.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 2 }}>{AVISO_ESTIMATIVA}</div>
      </div>
    </aside>
  );
}
