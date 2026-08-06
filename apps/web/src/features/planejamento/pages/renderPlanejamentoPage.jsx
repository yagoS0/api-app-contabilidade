// PLANEJAMENTO TRIBUTÁRIO — a tela de simulação.
//
// Dois modos, mesma tela de resultado:
//  • CARTEIRA — pré-preenchido com os dados da empresa, editável como cenário.
//  • SIMULAÇÃO LIVRE — formulário em branco, sem empresa. É o cenário de reunião com prospect,
//    e por isso não exige empresa cadastrada.
//
// ⚠ TRÊS EXIGÊNCIAS DE PRODUTO QUE VÊM DO MOTOR, e nenhuma é detalhe de layout:
//
//  1. A RECUSA DE CALCULAR TEM O MESMO PESO DO RESULTADO. Ver `CardRegime` — se o Lucro Real
//     aparecesse em cinza pequeno, o usuário compararia os dois visíveis e decidiria sem o
//     terceiro, que é o cenário que o `null` do motor existe para impedir.
//  2. O QUE FICOU DE FORA DA SOMA VAI NO CORPO DO CARD, não em rodapé: um total sem ISS parece
//     completo.
//  3. O PDF CIRCULA SOZINHO. Ele vai para o cliente do contador sem esta tela por perto, então
//     data de vigência das tabelas e avisos de escopo têm de sair IMPRESSOS junto dos números —
//     não adianta estarem visíveis aqui.

import { useMemo, useState, useEffect } from "react";
import { compararRegimes, pontoDeEquilibrio } from "../lib/comparador";
import { custoAnualSimples } from "../lib/simplesNacional";
import { ATIVIDADES_PRESUMIDO, avisoTravaServicos16 } from "../lib/lucroPresumido";
import { ANEXOS, ISS_FAIXA_LEGAL } from "../lib/tabelasFiscais";
import { CardRegime } from "../components/CardRegime";
import { GaugeFatorR } from "../components/GaugeFatorR";

const C = { page: "#1A1B26", surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", accent: "#BD93F9", alerta: "#FFB347" };
const campo = { background: "#1A1B26", border: `1px solid ${C.borda}`, borderRadius: 6, color: C.texto, padding: "7px 9px", fontSize: "0.86rem", width: "100%", boxSizing: "border-box" };
const rotulo = { display: "grid", gap: 4, fontSize: "0.76rem", color: C.muted };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function PlanejamentoPage({ empresa = null, onVoltar }) {
  const [receita, setReceita] = useState("");
  const [rbt12, setRbt12] = useState("");
  const [folha, setFolha] = useState("");
  const [anexo, setAnexo] = useState("III");
  const [sujeitoFatorR, setSujeitoFatorR] = useState(false);
  const [atividade, setAtividade] = useState("servicos");
  const [iss, setIss] = useState("");
  const [margem, setMargem] = useState("");
  const [creditos, setCreditos] = useState("");
  const [abertos, setAbertos] = useState({});
  const [imprimindo, setImprimindo] = useState(false);

  // Modo carteira: pré-preenche com o que a empresa já tem. Editável — é cenário, não cadastro.
  useEffect(() => {
    if (!empresa) return;
    if (empresa.receitaAnual != null) setReceita(String(empresa.receitaAnual));
    if (empresa.rbt12 != null) setRbt12(String(empresa.rbt12));
    if (empresa.folhaAnual != null) setFolha(String(empresa.folhaAnual));
    if (empresa.aliquotaIss != null) setIss(String(empresa.aliquotaIss * 100));
  }, [empresa]);

  const entradas = useMemo(() => ({
    receitaAnual: num(receita) || 0,
    rbt12: num(rbt12) ?? num(receita),
    folhaAnual: num(folha) || 0,
    anexoSimples: anexo,
    sujeitoAoFatorR: sujeitoFatorR,
    atividadePresumido: atividade,
    aliquotaIss: num(iss) == null ? null : num(iss) / 100,
    margemLucro: num(margem) == null ? null : num(margem) / 100,
    creditosPisCofins: num(creditos),
  }), [receita, rbt12, folha, anexo, sujeitoFatorR, atividade, iss, margem, creditos]);

  const temReceita = entradas.receitaAnual > 0;
  const resultado = useMemo(() => (temReceita ? compararRegimes(entradas) : null), [entradas, temReceita]);
  const equilibrio = useMemo(
    () => (temReceita ? pontoDeEquilibrio({ ...entradas, passo: 50_000 }) : null),
    [entradas, temReceita],
  );

  // A economia de migrar de anexo pelo Fator R: a diferença entre o V e o III, com os mesmos dados.
  const economiaAnexo = useMemo(() => {
    if (!temReceita || !sujeitoFatorR) return null;
    const v = custoAnualSimples({ anexoChave: "V", rbt12: entradas.rbt12, receitaAnual: entradas.receitaAnual, folhaAnual: entradas.folhaAnual });
    const iii = custoAnualSimples({ anexoChave: "III", rbt12: entradas.rbt12, receitaAnual: entradas.receitaAnual, folhaAnual: entradas.folhaAnual });
    if (!v || !iii || v.indisponivel || iii.indisponivel) return null;
    return v.total - iii.total;
  }, [entradas, temReceita, sujeitoFatorR]);

  const avisoTrava = temReceita && atividade === "servicos" ? avisoTravaServicos16(entradas.receitaAnual) : null;
  const issForaDaFaixa = num(iss) != null && (num(iss) / 100 < ISS_FAIXA_LEGAL.minimo || num(iss) / 100 > ISS_FAIXA_LEGAL.maximo);

  useEffect(() => {
    if (!imprimindo) return undefined;
    document.body.classList.add("imprimindo");
    const limpar = () => setImprimindo(false);
    window.addEventListener("afterprint", limpar);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove("imprimindo");
    };
  }, [imprimindo]);

  return (
    <div style={{ background: C.page, minHeight: "100vh", color: C.texto, padding: "20px 0" }}>
      <div style={{ width: "var(--content-wide)", margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {onVoltar && (
            <button type="button" onClick={onVoltar} style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "5px 11px", font: "inherit", cursor: "pointer" }}>←</button>
          )}
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Planejamento tributário</h1>
          <span style={{ fontSize: "0.8rem", color: C.muted }}>
            {empresa ? empresa.razao : "Simulação livre — sem empresa vinculada"}
          </span>
        </div>

        {/* ── ENTRADAS ─────────────────────────────────────────────────────── */}
        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <label style={rotulo}>Receita anual (R$)
              <input value={receita} onChange={(e) => setReceita(e.target.value)} inputMode="decimal" placeholder="0,00" style={campo} />
            </label>
            <label style={rotulo}>RBT12 (R$) — receita dos 12 meses anteriores
              <input value={rbt12} onChange={(e) => setRbt12(e.target.value)} inputMode="decimal" placeholder="igual à receita anual" style={campo} />
            </label>
            <label style={rotulo}>Folha anual, com pró-labore (R$)
              <input value={folha} onChange={(e) => setFolha(e.target.value)} inputMode="decimal" placeholder="0,00" style={campo} />
            </label>
            <label style={rotulo}>Atividade no Lucro Presumido
              <select value={atividade} onChange={(e) => setAtividade(e.target.value)} style={campo}>
                {Object.entries(ATIVIDADES_PRESUMIDO).map(([k, a]) => <option key={k} value={k}>{a.rotulo}</option>)}
              </select>
            </label>
            <label style={rotulo}>Anexo do Simples
              <select value={anexo} onChange={(e) => setAnexo(e.target.value)} disabled={sujeitoFatorR} style={{ ...campo, opacity: sujeitoFatorR ? 0.5 : 1 }}>
                {Object.entries(ANEXOS).map(([k, a]) => <option key={k} value={k}>{a.nome}</option>)}
              </select>
            </label>
            <label style={rotulo}>Alíquota de ISS do município (%)
              <input value={iss} onChange={(e) => setIss(e.target.value)} inputMode="decimal" placeholder="deixe vazio se não souber" style={campo} />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", cursor: "pointer" }}>
            <input type="checkbox" checked={sujeitoFatorR} onChange={(e) => setSujeitoFatorR(e.target.checked)} />
            Atividade sujeita ao Fator R (o anexo passa a sair da folha, não da escolha)
          </label>

          {/* O Lucro Real só entra com estes dois — e o card diz isso enquanto faltarem. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, paddingTop: 8, borderTop: `1px solid ${C.borda}` }}>
            <label style={rotulo}>Margem de lucro real (%) — só para comparar com o Lucro Real
              <input value={margem} onChange={(e) => setMargem(e.target.value)} inputMode="decimal" placeholder="não estimamos por você" style={campo} />
            </label>
            <label style={rotulo}>Créditos anuais de PIS/COFINS (R$)
              <input value={creditos} onChange={(e) => setCreditos(e.target.value)} inputMode="decimal" placeholder="não estimamos por você" style={campo} />
            </label>
          </div>

          {issForaDaFaixa && (
            <div style={{ fontSize: "0.78rem", color: C.alerta }}>
              A alíquota de ISS informada está fora da faixa legal de 2% a 5% (LC 116/2003) — confira o cadastro.
            </div>
          )}
          {avisoTrava && <div style={{ fontSize: "0.78rem", color: C.alerta }}>⚠ {avisoTrava}</div>}
        </div>

        {!temReceita && (
          <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: "0.86rem" }}>
            Informe a receita anual para comparar os regimes.
          </div>
        )}

        {/* ── RESULTADO ────────────────────────────────────────────────────── */}
        {resultado && (
          <div data-print-area style={{ display: "grid", gap: 14 }}>
            {/* ⚠ CABEÇALHO SÓ-NO-PAPEL. O PDF vai para o cliente do contador sem esta tela por
                perto: sem isto, ele circula como um número sem data, sem escopo e sem ressalva. */}
            <div data-print-only style={{ display: "none" }}>
              <h2 style={{ margin: "0 0 2px" }}>Simulação de regime tributário</h2>
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
                {empresa ? empresa.razao : "Simulação livre"} · ano-base {resultado.anoBase} ·
                emitida em {new Date().toLocaleDateString("pt-BR")}
              </p>
              <p style={{ margin: "0 0 10px", fontSize: "0.8rem" }}>
                <strong>Tabelas fiscais verificadas em {resultado.fontesVerificadasEm}.</strong> {resultado.aviso}
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {resultado.regimes.map((r) => (
                <CardRegime
                  key={r.regime}
                  resultado={r}
                  vencedor={resultado.vencedor?.regime === r.regime}
                  aberto={Boolean(abertos[r.regime])}
                  onToggle={() => setAbertos((a) => ({ ...a, [r.regime]: !a[r.regime] }))}
                />
              ))}
            </div>

            {resultado.economiaAnual > 0 && (
              <div style={{ fontSize: "0.9rem" }}>
                O <strong>{resultado.vencedor.regime}</strong> sai{" "}
                <strong style={{ color: "#50FA7B" }}>{brl(resultado.economiaAnual)}</strong> mais barato por ano
                que a segunda opção.
              </div>
            )}

            {resultado.fatorR && <GaugeFatorR fatorR={resultado.fatorR} economiaSeMudar={economiaAnexo} />}

            {equilibrio && (
              <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, fontSize: "0.88rem" }}>
                <strong style={{ display: "block", marginBottom: 4, fontSize: "0.8rem", color: C.muted }}>Ponto de equilíbrio</strong>
                {equilibrio.frase}
              </div>
            )}

            {/* Na TELA o aviso aparece aqui; no PAPEL ele já saiu no cabeçalho — os dois porque o
                PDF e a tela são lidos em situações diferentes. */}
            <div style={{ fontSize: "0.76rem", color: C.muted, lineHeight: 1.5 }}>
              Tabelas fiscais verificadas em <strong>{resultado.fontesVerificadasEm}</strong> · ano-base {resultado.anoBase}.
              {" "}{resultado.aviso}
            </div>

            <div data-print-hide>
              <button
                type="button"
                onClick={() => setImprimindo(true)}
                style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "6px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}
              >
                🖨 Imprimir / salvar em PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
