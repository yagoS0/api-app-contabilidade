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
  const [mesesAtividade, setMesesAtividade] = useState("");
  const [detalharMeses, setDetalharMeses] = useState(false);
  const [serieMensal, setSerieMensal] = useState([]);
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

  // ⚠ SÓ do 1º ao 12º mês. Do 13º em diante a empresa TEM os 12 meses de histórico, e o RBT12 real
  // volta a ser o campo comum — a transição do art. 22, § 4º, II é isto, na tela. Passar um valor
  // ≥ 13 ao motor faria ele sobrescrever o RBT12 informado pelo derivado, sem o usuário pedir.
  const mesesInicioAtividade = useMemo(() => {
    const n = num(mesesAtividade);
    return n != null && n >= 1 && n <= 12 ? Math.trunc(n) : null;
  }, [mesesAtividade]);

  // ⚠ O DETALHAMENTO SÓ APARECE EM INÍCIO DE ATIVIDADE, E ISSO É PROPOSITAL. No motor a série
  // mensal alimenta duas coisas — o RBT12 proporcionalizado e o limite proporcional do ano de
  // início — e as duas só existem nesse caso. Para empresa estabelecida o RBT12 é informado
  // direto, e doze campos que não mudam número nenhum seriam um controle mentiroso: dão ao usuário
  // a impressão de estar refinando a conta enquanto o resultado fica igual.
  const podeDetalhar = mesesInicioAtividade != null;
  const detalhando = podeDetalhar && detalharMeses;

  // Ao abrir, cada mês já vem com a receita uniforme — o usuário EDITA o que sabe, não digita tudo.
  useEffect(() => {
    if (!detalhando) return;
    setSerieMensal((atual) => {
      const media = (num(receita) || 0) / 12;
      const padrao = media ? String(Math.round(media * 100) / 100) : "";
      return Array.from({ length: mesesInicioAtividade }, (_, i) => atual[i] ?? padrao);
    });
  }, [detalhando, mesesInicioAtividade, receita]);

  const receitasMensais = useMemo(() => {
    if (!detalhando) return null;
    return Array.from({ length: mesesInicioAtividade }, (_, i) => num(serieMensal[i]) || 0);
  }, [detalhando, mesesInicioAtividade, serieMensal]);

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
    mesesDeAtividade: mesesInicioAtividade,
    receitasMensais,
  }), [receita, rbt12, folha, anexo, sujeitoFatorR, atividade, iss, margem, creditos, mesesInicioAtividade, receitasMensais]);

  const temReceita = entradas.receitaAnual > 0;
  const resultado = useMemo(() => (temReceita ? compararRegimes(entradas) : null), [entradas, temReceita]);
  const equilibrio = useMemo(
    () => (temReceita ? pontoDeEquilibrio({ ...entradas, passo: 50_000 }) : null),
    [entradas, temReceita],
  );

  // A economia de migrar de anexo pelo Fator R: a diferença entre o V e o III, com os mesmos dados.
  const economiaAnexo = useMemo(() => {
    if (!temReceita || !sujeitoFatorR) return null;
    const comum = {
      rbt12: entradas.rbt12,
      receitaAnual: entradas.receitaAnual,
      folhaAnual: entradas.folhaAnual,
      mesesDeAtividade: entradas.mesesDeAtividade,
    };
    const v = custoAnualSimples({ ...comum, anexoChave: "V" });
    const iii = custoAnualSimples({ ...comum, anexoChave: "III" });
    if (!v || !iii || v.indisponivel || iii.indisponivel) return null;
    return v.total - iii.total;
  }, [entradas, temReceita, sujeitoFatorR]);

  const avisoTrava = temReceita && atividade === "servicos" ? avisoTravaServicos16(entradas.receitaAnual) : null;

  // ⚠ EXIGÊNCIA DE PRODUTO, NÃO ENFEITE. Em início de atividade o RBT12 é PREMISSA, não histórico —
  // e é premissa que muda o número. Sem esta frase, "RBT12 de R$ 360.000" se lê como faturamento
  // apurado, e o contador leva à reunião um dado que a empresa nunca teve.
  const inicio = resultado?.inicioAtividade?.proporcionalizado ? resultado.inicioAtividade : null;

  // ⚠ A PREMISSA EM USO SAI ESCRITA. Dois PDFs da mesma empresa com números diferentes precisam
  // explicar por quê no próprio papel — senão a diferença parece erro de cálculo, e quem recebe não
  // tem como saber que um saiu de receita uniforme e o outro da série informada.
  const premissaReceita = detalhando
    ? "série mensal informada"
    : `receita uniforme de ${brl(entradas.receitaAnual / 12)} por mês (receita anual ÷ 12)`;

  const premissaInicio = inicio
    ? `Empresa no ${inicio.mesAtividade}º mês de atividade: o RBT12 de ${brl(inicio.rbt12)} NÃO é histórico real — `
      + "é a receita anualizada pela regra de início de atividade (LC 123/2006, art. 18, § 2º; "
      + `Resolução CGSN 140/2018, art. 22, ${inicio.regra.replace("art. 22, ", "")}). `
      + `Premissa de receita: ${premissaReceita}. `
      + "A partir do 13º mês passa a valer o RBT12 real dos 12 meses anteriores."
    : null;
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
              <input
                value={mesesInicioAtividade ? "" : rbt12}
                onChange={(e) => setRbt12(e.target.value)}
                inputMode="decimal"
                disabled={Boolean(mesesInicioAtividade)}
                placeholder={mesesInicioAtividade ? "proporcionalizado — empresa em início de atividade" : "igual à receita anual"}
                style={{ ...campo, opacity: mesesInicioAtividade ? 0.5 : 1 }}
              />
            </label>
            {/* ⚠ Entrada, não inferência: a receita não diz em que mês a empresa está. Duas empresas
                com o mesmo acumulado podem estar no 2º ou no 9º mês, e a alíquota sai diferente. */}
            <label style={rotulo}>Meses de atividade — só se a empresa está começando
              <input
                value={mesesAtividade}
                onChange={(e) => setMesesAtividade(e.target.value)}
                inputMode="numeric"
                placeholder="vazio = 12 meses ou mais"
                style={campo}
              />
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

          {mesesInicioAtividade && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: "0.78rem", color: C.alerta }}>
                ⚠ Início de atividade: o RBT12 deixa de ser digitado e passa a ser <strong>proporcionalizado</strong> a
                partir da receita informada — o campo acima está desativado de propósito.
              </div>

              {/* ⚠ SUGESTÃO ATIVA, NÃO CAIXINHA MUDA. O efeito da rampa é invisível para quem não
                  conhece a regra: o usuário não tem como adivinhar que detalhar os meses pode
                  baixar a alíquota E revelar um estouro de limite. Se a tela não disser, o padrão
                  (receita uniforme) vira a resposta por omissão. */}
              {!detalharMeses && (
                <div style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.borda}`, fontSize: "0.78rem", lineHeight: 1.5 }}>
                  Empresa em rampa costuma pagar <strong>menos</strong> nos primeiros meses — e é também
                  quando o limite proporcional pode estourar sem aparecer no total do ano.{" "}
                  <button
                    type="button"
                    onClick={() => setDetalharMeses(true)}
                    style={{ background: "transparent", border: "none", color: C.accent, font: "inherit", fontSize: "0.78rem", textDecoration: "underline", cursor: "pointer", padding: 0 }}
                  >
                    Detalhar a receita mês a mês
                  </button>{" "}
                  para ver o efeito.
                </div>
              )}

              {detalhando && (
                <div style={{ padding: 10, borderRadius: 8, border: `1px solid ${C.borda}`, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.78rem" }}>Receita mês a mês ({mesesInicioAtividade} {mesesInicioAtividade === 1 ? "mês" : "meses"})</strong>
                    <button
                      type="button"
                      onClick={() => { setDetalharMeses(false); setSerieMensal([]); }}
                      style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "3px 9px", font: "inherit", fontSize: "0.74rem", cursor: "pointer" }}
                    >
                      Voltar à receita uniforme
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                    {Array.from({ length: mesesInicioAtividade }, (_, i) => (
                      <label key={i} style={rotulo}>{i + 1}º mês
                        <input
                          value={serieMensal[i] ?? ""}
                          onChange={(e) => setSerieMensal((a) => { const p = [...a]; p[i] = e.target.value; return p; })}
                          inputMode="decimal"
                          style={campo}
                        />
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: "0.74rem", color: C.muted, lineHeight: 1.5 }}>
                    A <strong>receita anual</strong> continua sendo a base da comparação entre regimes. A série
                    define o <strong>RBT12 proporcionalizado</strong> (média dos meses anteriores × 12) e a receita
                    acumulada que o <strong>limite proporcional</strong> do ano de início verifica.
                  </div>
                </div>
              )}
            </div>
          )}
          {num(mesesAtividade) != null && !mesesInicioAtividade && (
            <div style={{ fontSize: "0.78rem", color: C.alerta }}>
              Informe de 1 a 12 meses. Do 13º mês em diante a empresa já tem os 12 meses de histórico:
              deixe o campo vazio e preencha o RBT12 real.
            </div>
          )}
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
              {/* A premissa vai IMPRESSA: o PDF circula sem esta tela por perto, e um RBT12
                  proporcionalizado sem a ressalva vira faturamento real aos olhos de quem receber. */}
              {premissaInicio && (
                <p style={{ margin: "0 0 10px", fontSize: "0.8rem" }}><strong>⚠ {premissaInicio}</strong></p>
              )}
            </div>

            {premissaInicio && (
              <div data-print-hide style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.alerta}`, fontSize: "0.82rem", lineHeight: 1.5, color: C.alerta }}>
                ⚠ {premissaInicio}
              </div>
            )}

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
