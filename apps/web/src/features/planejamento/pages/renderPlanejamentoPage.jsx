// PLANEJAMENTO TRIBUTÁRIO — a tela de simulação.
//
// Dois modos, mesma tela de resultado:
//  • CARTEIRA — pré-preenchido com os dados da empresa, editável como cenário.
//  • SIMULAÇÃO LIVRE — formulário em branco, sem empresa. É o cenário de reunião com prospect,
//    e por isso não exige empresa cadastrada.
//
// ⚠ A SIMULAÇÃO LIVRE FICA, e o modo carteira é ACRÉSCIMO. O seletor abaixo nasce em "Simulação
// livre": exigir empresa cadastrada para simular mataria o uso comercial do módulo.
//
// ⚠ TRÊS EXIGÊNCIAS DE PRODUTO QUE VÊM DO MOTOR, e nenhuma é detalhe de layout:
//
//  1. A RECUSA DE CALCULAR TEM O MESMO PESO DO RESULTADO. Ver `CardRegime` — se o Lucro Real
//     aparecesse em cinza pequeno, o usuário compararia os dois visíveis e decidiria sem o
//     terceiro, que é o cenário que o `null` do motor existe para impedir.
//  2. O QUE FICOU DE FORA DA SOMA VAI NO CORPO DO CARD, não em rodapé: um total sem ISS parece
//     completo.
//  3. O PDF CIRCULA SOZINHO. Ele vai para o cliente do contador sem esta tela por perto, então
//     data de vigência das tabelas, avisos de escopo E A PROCEDÊNCIA DE CADA CAMPO têm de sair
//     IMPRESSOS junto dos números — não adianta estarem visíveis aqui.
//
// ⚠⚠ E A QUARTA, que é a razão do modo carteira existir: FOLHA AUSENTE NÃO É ZERO. Campo que a
// empresa não tem chega `null`, o input fica VAZIO e a linha de origem diz que não foi possível
// apurar. Ver `lib/prefillDaEmpresa.js` e a recusa do Fator R em `lib/comparador.js`.

import { useMemo, useState, useEffect } from "react";
import { compararRegimes, pontoDeEquilibrio } from "../lib/comparador";
import { custoAnualSimples } from "../lib/simplesNacional";
import { ATIVIDADES_PRESUMIDO, avisoTravaServicos16 } from "../lib/lucroPresumido";
import { ANEXOS, ISS_FAIXA_LEGAL } from "../lib/tabelasFiscais";
import { prefillDaEmpresa, procedenciaDosCampos } from "../lib/prefillDaEmpresa";
import { CardRegime } from "../components/CardRegime";
import { GaugeFatorR } from "../components/GaugeFatorR";
import { BackButton } from "../../../components/ui/BackButton";
import { LogoAltan } from "../../../components/ui/LogoAltan";

const C = { page: "#1A1B26", surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", accent: "#BD93F9", alerta: "#FFB347" };
const campo = { background: "#1A1B26", border: `1px solid ${C.borda}`, borderRadius: 6, color: C.texto, padding: "7px 9px", fontSize: "0.86rem", width: "100%", boxSizing: "border-box" };
const rotulo = { display: "grid", gap: 4, fontSize: "0.76rem", color: C.muted };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const ROTULO_REGIME = {
  SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real", MEI: "MEI",
};

/**
 * A LINHA DE ORIGEM DE UM CAMPO — regra do módulo, não enfeite.
 *
 * ⚠ A ausência tem COR DE PENDÊNCIA (âmbar), não cinza: campo vazio sem explicação parece campo
 * quebrado, e o contador preencheria "o que estava lá antes". A origem apurada é discreta de
 * propósito — ela informa, não alerta. E nada aqui é verde: verde é concluído, nunca "confie".
 */
function OrigemDoCampo({ campo }) {
  if (!campo) return null;
  if (campo.apurado) {
    return <span style={{ fontSize: "0.68rem", color: C.muted, lineHeight: 1.35 }}>da empresa · {campo.origem}</span>;
  }
  return <span style={{ fontSize: "0.68rem", color: C.alerta, lineHeight: 1.35 }}>⚠ {campo.motivoAusencia}</span>;
}

export function PlanejamentoPage({ api = null, empresas = [], empresa = null, onVoltar }) {
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

  // ── SELETOR DE EMPRESA ────────────────────────────────────────────────────────────────────────
  // ⚠ A lista vem PRONTA de fora (`empresas`), da mesma leitura que o dashboard usa
  // (`GET /firm/companies`), que já é escopada pela carteira de quem está logado — o mesmo critério
  // de `empresasVisiveis`. Não há uma segunda leitura de escopo aqui, e não pode haver: escopo
  // escrito duas vezes é escopo que diverge, e divergir nisto é mostrar empresa de outro escritório.
  // O backend confere de novo o id do path (`requireFirmCompanyAccess`) — a tela nunca é a guarda.
  const [empresaId, setEmpresaId] = useState(empresa?.id || "");
  const [dadosEmpresa, setDadosEmpresa] = useState(empresa || null);
  const [carregando, setCarregando] = useState(false);
  const [erroCarga, setErroCarga] = useState(null);

  useEffect(() => {
    let cancelado = false;
    if (!empresaId) { setDadosEmpresa(null); setErroCarga(null); return () => { cancelado = true; }; }
    if (!api?.getDadosPlanejamento) {
      setErroCarga("Esta instalação não expõe os dados de planejamento por empresa.");
      return () => { cancelado = true; };
    }
    setCarregando(true);
    setErroCarga(null);
    api.getDadosPlanejamento(empresaId)
      .then((r) => {
        if (cancelado) return;
        if (!r || r.ok === false) throw new Error(r?.error || "falha");
        setDadosEmpresa(r);
      })
      .catch(() => {
        if (cancelado) return;
        setDadosEmpresa(null);
        // ⚠ RECUSA COM MOTIVO, e sem cair para simulação livre em silêncio: um formulário em branco
        // depois de escolher a empresa se lê como "a empresa não tem dado nenhum".
        setErroCarga("Não foi possível carregar os dados desta empresa. Os campos continuam em branco — nada foi preenchido por suposição.");
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [api, empresaId]);

  const prefill = useMemo(() => prefillDaEmpresa(dadosEmpresa), [dadosEmpresa]);

  // Modo carteira: pré-preenche com o que a empresa já tem. Editável — é cenário, não cadastro.
  //
  // ⚠⚠ CAMPO NÃO APURADO LIMPA O INPUT, não o deixa com o valor da empresa ANTERIOR. Trocar de
  // empresa e herdar a folha da outra é a forma mais silenciosa possível de calcular o Fator R da
  // empresa errada — e o resultado tem cara de certo.
  useEffect(() => {
    if (!prefill.temEmpresa) return;
    const v = prefill.valores;
    setReceita(v.receitaAnual == null ? "" : String(v.receitaAnual));
    setRbt12(v.rbt12 == null ? "" : String(v.rbt12));
    setFolha(v.folhaAnual == null ? "" : String(v.folhaAnual));
    setIss(v.aliquotaIss == null ? "" : String(Math.round(v.aliquotaIss * 1e6) / 1e4));
    if (v.sujeitoFatorR != null) setSujeitoFatorR(Boolean(v.sujeitoFatorR));
    if (v.anexo != null) setAnexo(v.anexo);
    // `atividadePresumido` NÃO é pré-preenchida: o projeto não tem de-para CNAE→presunção de
    // IRPJ/CSLL, e chutar entre 8% e 32% inverteria a comparação. Fica com a escolha da tela, e a
    // linha de origem diz que não veio da empresa.
  }, [prefill]);

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
    // ⚠⚠ `num(folha)`, NÃO `num(folha) || 0`. Campo vazio significa FOLHA NÃO INFORMADA, e o motor
    // trata `null` como ausência: sem folha o Fator R não se calcula e o Simples sai indisponível,
    // em vez de cair no Anexo V (a alíquota maior) por causa de um zero que ninguém digitou. Folha
    // realmente zero continua sendo possível — digite 0.
    folhaAnual: num(folha),
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

  // ⚠ A PROCEDÊNCIA DE CADA CAMPO, PARA O PAPEL. O PDF circula sozinho: dois PDFs da mesma empresa
  // com números diferentes têm de se distinguir NELE, senão a diferença parece erro de cálculo.
  // Cada linha diz se o valor veio da empresa (e de onde), se foi digitado por cima, se foi
  // informado nesta simulação, ou se não foi possível apurar.
  const procedencias = useMemo(() => procedenciaDosCampos(prefill, {
    receitaAnual: num(receita),
    rbt12: num(rbt12),
    folhaAnual: num(folha),
    // O regime atual não é editável na tela: ele descreve de onde a empresa está saindo.
    regimeAtual: prefill.valores?.regimeAtual ?? null,
    // ⚠ Sujeito ao Fator R: o anexo do seletor não vale nada (o campo fica desabilitado e quem
    // decide é a folha). Imprimir "Anexo III · informado nesta simulação" nesse caso afirmaria uma
    // escolha que não existiu — a linha tem de dizer que o anexo sai da folha.
    anexo: sujeitoFatorR ? null : anexo,
    sujeitoFatorR,
    aliquotaIss: num(iss) == null ? null : num(iss) / 100,
    atividadePresumido: atividade,
  }), [prefill, receita, rbt12, folha, anexo, sujeitoFatorR, iss, atividade]);

  const valorImpresso = (linha) => {
    if (linha.valor === null || linha.valor === undefined || linha.valor === "") return "—";
    if (linha.tipo === "brl") return brl(linha.valor);
    if (linha.tipo === "percentual") return `${(Number(linha.valor) * 100).toFixed(2).replace(".", ",")}%`;
    if (linha.tipo === "booleano") return linha.valor ? "sim" : "não";
    if (linha.chave === "regimeAtual") return ROTULO_REGIME[linha.valor] || String(linha.valor);
    if (linha.chave === "atividadePresumido") return ATIVIDADES_PRESUMIDO[linha.valor]?.rotulo || String(linha.valor);
    if (linha.chave === "anexo") return ANEXOS[linha.valor]?.nome || `Anexo ${linha.valor}`;
    return String(linha.valor);
  };

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
            <BackButton onClick={onVoltar} />
          )}
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Planejamento tributário</h1>
          <span style={{ fontSize: "0.8rem", color: C.muted }}>
            {prefill.empresa?.razao || "Simulação livre — sem empresa vinculada"}
          </span>
        </div>

        {/* ── SELETOR DE EMPRESA ─────────────────────────────────────────────
            A porta de entrada do modo carteira. Nasce em "Simulação livre" de propósito: a tela
            continua servindo à reunião com prospect, onde a empresa ainda não existe no sistema.
            A lista é a da carteira de quem está logado — ver o comentário do estado acima. */}
        {empresas.length > 0 && (
          <div data-print-hide style={{ padding: 12, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, display: "grid", gap: 8 }}>
            <label style={{ ...rotulo, maxWidth: 520 }}>Empresa
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} style={campo}>
                <option value="">Simulação livre — sem empresa vinculada</option>
                {empresas.map((e) => (
                  <option key={e.companyId || e.id} value={e.companyId || e.id}>
                    {e.razao}{e.cnpj ? ` — ${e.cnpj}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {carregando && <span style={{ fontSize: "0.76rem", color: C.muted }}>Carregando os dados da empresa…</span>}
            {erroCarga && <span style={{ fontSize: "0.76rem", color: C.alerta }}>⚠ {erroCarga}</span>}
            {prefill.temEmpresa && prefill.referencia && (
              <span style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.45 }}>
                Campos apurados sobre os 12 meses de <strong>{prefill.referencia.janelaRotulo}</strong>.
                Tudo abaixo é <strong>editável</strong> — isto é um cenário, não o cadastro da empresa,
                e nada aqui grava nada. O que for digitado por cima sai marcado no PDF.
              </span>
            )}
          </div>
        )}

        {/* ── ENTRADAS ─────────────────────────────────────────────────────── */}
        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <label style={rotulo}>Receita anual (R$)
              <input value={receita} onChange={(e) => setReceita(e.target.value)} inputMode="decimal" placeholder="0,00" style={campo} />
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.receitaAnual} />}
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
              {prefill.temEmpresa && !mesesInicioAtividade && <OrigemDoCampo campo={prefill.campos.rbt12} />}
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
            {/* ⚠ A FOLHA É O CAMPO CRÍTICO DESTA TELA. Vazio = NÃO INFORMADA, e o placeholder diz
                isso: "0,00" convidava a ler o vazio como zero, que é exatamente a confusão que
                joga a empresa no Anexo V sem ninguém ter informado a folha. */}
            <label style={rotulo}>Folha anual, com pró-labore (R$)
              <input
                value={folha}
                onChange={(e) => setFolha(e.target.value)}
                inputMode="decimal"
                placeholder="vazio = não informada"
                style={campo}
              />
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.folhaAnual} />}
            </label>
            <label style={rotulo}>Atividade no Lucro Presumido
              <select value={atividade} onChange={(e) => setAtividade(e.target.value)} style={campo}>
                {Object.entries(ATIVIDADES_PRESUMIDO).map(([k, a]) => <option key={k} value={k}>{a.rotulo}</option>)}
              </select>
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.atividadePresumido} />}
            </label>
            <label style={rotulo}>Anexo do Simples
              <select value={anexo} onChange={(e) => setAnexo(e.target.value)} disabled={sujeitoFatorR} style={{ ...campo, opacity: sujeitoFatorR ? 0.5 : 1 }}>
                {Object.entries(ANEXOS).map(([k, a]) => <option key={k} value={k}>{a.nome}</option>)}
              </select>
              {prefill.temEmpresa && !sujeitoFatorR && <OrigemDoCampo campo={prefill.campos.anexo} />}
            </label>
            <label style={rotulo}>Alíquota de ISS do município (%)
              <input value={iss} onChange={(e) => setIss(e.target.value)} inputMode="decimal" placeholder="deixe vazio se não souber" style={campo} />
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.aliquotaIss} />}
            </label>
          </div>

          {/* O regime ATUAL não é entrada do cálculo — é o ponto de partida da conversa ("hoje você
              está no X"). Aparece como leitura, com origem, e some quando não se sabe qual é. */}
          {prefill.temEmpresa && (
            <div style={{ fontSize: "0.78rem", color: prefill.campos.regimeAtual.apurado ? C.muted : C.alerta, lineHeight: 1.45 }}>
              {prefill.campos.regimeAtual.apurado
                ? <>Regime atual da empresa: <strong style={{ color: C.texto }}>{ROTULO_REGIME[prefill.campos.regimeAtual.valor] || prefill.campos.regimeAtual.valor}</strong> · {prefill.campos.regimeAtual.origem}</>
                : <>⚠ {prefill.campos.regimeAtual.motivoAusencia}</>}
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", cursor: "pointer" }}>
            <input type="checkbox" checked={sujeitoFatorR} onChange={(e) => setSujeitoFatorR(e.target.checked)} />
            Atividade sujeita ao Fator R (o anexo passa a sair da folha, não da escolha)
          </label>
          {prefill.temEmpresa && <div style={{ marginTop: -4 }}><OrigemDoCampo campo={prefill.campos.sujeitoFatorR} /></div>}

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
        {/* ⚠ `tom="papel"` NÃO É DETALHE: este portal é escuro, e a tinta dele (`--logo-tinta`,
            `#F8F8F2`) sairia INVISÍVEL no branco da folha. A variante crava o par de fundo claro e
            liga `print-color-adjust: exact`, senão o navegador descarta a cor da cúpula.
            ⚠ E ela precisa estar DENTRO do `[data-print-area]`: a regra do `@media print` é
            `body.imprimindo > * { visibility: hidden }`, e só os descendentes da área voltam. */}
        <LogoAltan tom="papel" altura={22} />
              <h2 style={{ margin: "0 0 2px" }}>Simulação de regime tributário</h2>
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
                {prefill.empresa?.razao || "Simulação livre"}
                {prefill.empresa?.cnpj ? ` · CNPJ ${prefill.empresa.cnpj}` : ""} · ano-base {resultado.anoBase} ·
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

              {/* ⚠⚠ DE ONDE VEIO CADA NÚMERO — IMPRESSO, e não só na tela.
                  Dois PDFs da mesma empresa com números diferentes têm de se distinguir no PAPEL:
                  sem esta tabela, quem recebe não tem como saber se o RBT12 saiu da apuração
                  transmitida, da soma dos lançamentos ou da mão do contador — e a diferença entre
                  os dois documentos parece erro de cálculo. Vale também para a simulação livre,
                  onde a resposta é "informado nesta simulação", que é uma informação, não um vazio. */}
              {prefill.temEmpresa && (
                <table data-print-tabela style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", margin: "0 0 10px" }}>
                  <caption style={{ textAlign: "left", fontWeight: 700, padding: "0 0 3px" }}>
                    Procedência dos dados usados nesta simulação
                    {prefill.referencia ? ` · apuração sobre ${prefill.referencia.janelaRotulo}` : ""}
                  </caption>
                  <tbody>
                    {procedencias.map((l) => (
                      <tr key={l.chave}>
                        <td style={{ padding: "2px 6px 2px 0", whiteSpace: "nowrap" }}>{l.rotulo}</td>
                        <td style={{ padding: "2px 6px", whiteSpace: "nowrap", fontWeight: 700 }}>{valorImpresso(l)}</td>
                        <td style={{ padding: "2px 0" }}>
                          {l.estado === "ausente" ? "não foi possível apurar — " : ""}{l.texto}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
