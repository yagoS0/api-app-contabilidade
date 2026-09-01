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
// ⚠⚠ AS DUAS METADES DO CAMPO NUMÉRICO VÊM DO MESMO ARQUIVO, E ISSO É O CONSERTO.
// `deCampo` morava solta aqui e `paraCampo` não existia — quem escrevia no input era
// `String(n)`, que produz "888286.09" e é lido como 88.828.609. Ver `lib/campoNumerico.js`.
import {
  paraCampo,
  deCampo as num,
  mascararDinheiro,
  lerDinheiro,
  dinheiroParaCampo,
  colarDinheiro,
  textoDaRecusaDeColarDinheiro,
  lerPercentual,
  textoDoPercentualForaDaFaixa,
} from "../lib/campoNumerico";
import { CardRegime } from "../components/CardRegime";
import { GaugeFatorR } from "../components/GaugeFatorR";
import { TabelaComparativa } from "../components/TabelaComparativa";
import { BlocoIbsCbs } from "../components/BlocoIbsCbs";
import { CENARIO } from "../lib/ibsCbsNoSimples";
import { PainelProLabore } from "../components/PainelProLabore";
import { simularProLaboreParaFatorR } from "../lib/proLabore";
import { montarComparativo } from "../lib/comparativoDeRegimes";
import { BackButton } from "../../../components/ui/BackButton";
import { LogoAltan } from "../../../components/ui/LogoAltan";

const C = { page: "#1A1B26", surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", accent: "#BD93F9", alerta: "#FFB347" };
const campo = { background: "#1A1B26", border: `1px solid ${C.borda}`, borderRadius: 6, color: C.texto, padding: "7px 9px", fontSize: "0.86rem", width: "100%", boxSizing: "border-box" };
const rotulo = { display: "grid", gap: 4, fontSize: "0.76rem", color: C.muted };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });


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
  // ⚠⚠ TRÊS ESTADOS, e o `null` é o que preserva a conta de hoje. Lei 9.249/1995, art. 15, § 4º:
  // serviços com receita até R$ 120.000 podem presumir IRPJ de 16% em vez de 32% — a CSLL continua
  // em 32%. O portal NÃO liga isto sozinho: o § 4º exclui serviços hospitalares, de transporte e de
  // profissão legalmente regulamentada, e exige empresa EXCLUSIVAMENTE prestadora de serviços em
  // geral — três fatos que o cadastro não tem. Quem confirma é o contador.
  const [servicos16, setServicos16] = useState(null);
  // ⚠ A categoria do Presumido pode chegar SUGERIDA pelo CNAE. Enquanto o contador não encostar no
  // seletor, ela continua sendo SUGESTÃO — e a tela diz isso. Tocar no seletor É a confirmação.
  const [categoriaConfirmada, setCategoriaConfirmada] = useState(false);
  const [iss, setIss] = useState("");
  const [margem, setMargem] = useState("");
  const [creditos, setCreditos] = useState("");
  const [abertos, setAbertos] = useState({});
  const [imprimindo, setImprimindo] = useState(false);
  // ⚠ Mora aqui, com os outros, e não junto do `aoColar` lá embaixo: o efeito que limpa o
  // formulário na troca de empresa precisa dele, e estado declarado depois de quem o usa é o tipo
  // de coisa que funciona por closure e confunde quem lê.
  const [recusaDeColagem, setRecusaDeColagem] = useState(null); // { campo, texto }
  const [guardando, setGuardando] = useState(false);
  const [desfechoDoGuardar, setDesfechoDoGuardar] = useState(null); // { tom, texto }
  // ⚠⚠ O CENÁRIO NASCE EM 2026, e isso é decisão: é o ano corrente, e a resposta dele — IBS e CBS
  // são ZERO para o optante — é a que a maioria dos contadores precisa ver primeiro. Abrir em 2027
  // mostraria um número que ainda depende de uma alíquota que não existe.
  const [cenarioIbsCbs, setCenarioIbsCbs] = useState(CENARIO.EM_2026);
  // ⚠ A CBS estimada NÃO tem padrão, nem "os 26,5% que circulam". Campo vazio é a verdade sobre um
  // percentual que o Senado só fixa até 15/12/2026.
  const [cbsEstimada, setCbsEstimada] = useState("");

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

  // ⚠⚠⚠ TROCAR DE EMPRESA LIMPA O FORMULÁRIO INTEIRO — e a ausência disto era o pior defeito
  // desta tela (01/09/2026).
  //
  // O efeito de prefill, logo abaixo, começa com `if (!prefill.temEmpresa) return` e só ESCREVE os
  // campos que a empresa tem. Ele nunca limpou nada — e nem chega a rodar quando se volta para
  // "Simulação livre", porque ali não há empresa. Resultado: **todo estado atravessava a troca**.
  //
  // ⚠⚠ E UM DELES IMPRIME AFIRMAÇÃO FISCAL FALSA. `servicos16` é a confirmação do art. 15, § 4º da
  // Lei 9.249/1995, e `lucroPresumido.js` escreve, com essas letras:
  //
  //     "IRPJ presumido a 16% POR CONFIRMAÇÃO DO CONTADOR"
  //
  // Confirmar "usar 16%" na empresa A e trocar para a B fazia o PDF da B — que vai ao cliente —
  // atribuir a uma PESSOA uma decisão que ela nunca tomou sobre AQUELA empresa. E o § 4º exclui
  // serviços hospitalares, de transporte e de profissão regulamentada: a confirmação herdada pode
  // ser ilegal para a empresa que a herdou, e o número sai menor, que é o erro que ninguém confere.
  //
  // ⚠ Os outros que vazavam, cada um com seu custo: `anexo` e `sujeitoFatorR` (o Fator R da empresa
  // errada — o mesmo defeito que o comentário do prefill já nomeia para a folha), `margem` e
  // `creditos` (entram na conta do Lucro Real), `mesesAtividade` e `serieMensal` (proporcionalizam
  // o RBT12 de uma empresa que não está começando) e `categoriaConfirmada` (faz a sugestão do CNAE
  // aparecer como já conferida).
  //
  // ⚠⚠ A ORDEM É O QUE FAZ ISTO FUNCIONAR: este efeito depende de `empresaId` e roda no INSTANTE da
  // troca; o de prefill depende de `prefill`, que só muda quando a resposta da API chega. Entre um
  // e outro os campos ficam em branco, e isso é a verdade — ainda não sabemos nada da empresa nova.
  // Inverter a ordem faria a limpeza apagar o que o prefill acabou de escrever.
  useEffect(() => {
    setReceita("");
    setRbt12("");
    setMesesAtividade("");
    setSerieMensal([]);
    setFolha("");
    setAnexo("III");
    setSujeitoFatorR(false);
    setAtividade("servicos");
    setServicos16(null);
    setCategoriaConfirmada(false);
    setIss("");
    setMargem("");
    setCreditos("");
    setAbertos({});
    setRecusaDeColagem(null);
    // ⚠ A CBS estimada é premissa DA SIMULAÇÃO, e sai junto com o resto — herdada, ela apareceria
    // no PDF de outra empresa como se alguém a tivesse informado ali.
    setCbsEstimada("");
    // ⚠ O CENÁRIO NÃO se limpa: ele é a lente de quem está olhando, não dado da empresa. Zerá-lo
    // jogaria o contador de volta para 2026 a cada troca, no meio de uma comparação.
  }, [empresaId]);

  // Modo carteira: pré-preenche com o que a empresa já tem. Editável — é cenário, não cadastro.
  //
  // ⚠⚠ CAMPO NÃO APURADO LIMPA O INPUT, não o deixa com o valor da empresa ANTERIOR. Trocar de
  // empresa e herdar a folha da outra é a forma mais silenciosa possível de calcular o Fator R da
  // empresa errada — e o resultado tem cara de certo.
  useEffect(() => {
    if (!prefill.temEmpresa) return;
    const v = prefill.valores;
    // ⚠⚠ `paraCampo`, NUNCA `String(n)`. Era daqui que saía o defeito medido em 25/08/2026: o
    // número JS cru ("888286.09") entra no input e `num` lê o ponto como separador de MILHAR,
    // devolvendo 88.828.609 ao motor. Medido em produção antes do conserto: 12 de 18 empresas com
    // o valor inflado ×100, 3 com o card do Presumido morto ("inelegível") e 7 com o do Simples
    // ("Sem RBT12"). Valor sem centavos passava ileso — e o mock só tinha valores redondos.
    // ⚠ `dinheiroParaCampo`, não `paraCampo`: os campos de dinheiro passaram a ser MASCARADOS
    // (01/09/2026), e o texto que o prefill escreve tem de estar na mesma forma que o teclado
    // produz — senão o primeiro toque na tecla reformata o campo inteiro e o número salta.
    setReceita(dinheiroParaCampo(v.receitaAnual));
    setRbt12(dinheiroParaCampo(v.rbt12));
    setFolha(dinheiroParaCampo(v.folhaAnual));
    // ⚠ O ISS viaja em FRAÇÃO no payload e é PERCENTUAL no campo. A conversão é esta; o que não
    // pode voltar é o `String()` em volta dela (3,5% viraria 35%).
    setIss(v.aliquotaIss == null ? "" : paraCampo(Math.round(v.aliquotaIss * 1e6) / 1e4));
    if (v.sujeitoFatorR != null) setSujeitoFatorR(Boolean(v.sujeitoFatorR));
    if (v.anexo != null) setAnexo(v.anexo);
    // ⚠⚠ PRÉ-SELECIONA A SUGESTÃO, E A MARCA COMO NÃO CONFIRMADA. Sem a sugestão, o seletor caía
    // no default "Serviços em geral" para TODA empresa — inclusive as de comércio, que presumem 8%
    // e não 32%. Pré-selecionar pelo CNAE é estritamente melhor que isso; o que não pode é a tela
    // deixar de dizer que aquilo é proposta, não cadastro.
    if (prefill.presumido?.sugestao) {
      setAtividade(prefill.presumido.sugestao);
      setCategoriaConfirmada(false);
    }
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

  // ⚠⚠ O RBT12 FANTASMA (01/09/2026). O campo mostrava vazio e o ESTADO continuava cheio:
  // `value={mesesInicioAtividade ? "" : rbt12}` esconde a exibição e não toca em `rbt12`.
  //
  // Com a empresa em início de atividade, o RBT12 é DERIVADO (proporcionalizado pela regra da
  // Resolução CGSN 140/2018, art. 22) — o valor digitado antes deixa de valer. Mas ele continuava
  // viajando em `entradas.rbt12`, e daí saíam DOIS números:
  //   · o `GaugeFatorR` lê `resultado.fatorR`, calculado pelo motor sobre o RBT12 PROPORCIONALIZADO;
  //   · o `PainelProLabore` lê `entradas.rbt12`, que era o FANTASMA.
  // Os dois aparecem um embaixo do outro, com percentuais de Fator R DIFERENTES para a mesma
  // empresa — e o PDF imprimia os dois RBT12.
  //
  // ⚠ Limpar o ESTADO (e não só a exibição) é o que dá uma fonte só. Perde-se o que estava digitado
  // ao ligar "meses de atividade", e isso é aceitável: aquele número deixou de ser aplicável, e um
  // valor guardado que não é usado é exatamente o fantasma.
  useEffect(() => {
    if (mesesInicioAtividade) setRbt12("");
  }, [mesesInicioAtividade]);
  const detalhando = podeDetalhar && detalharMeses;

  // Ao abrir, cada mês já vem com a receita uniforme — o usuário EDITA o que sabe, não digita tudo.
  useEffect(() => {
    if (!detalhando) return;
    setSerieMensal((atual) => {
      const media = (lerDinheiro(receita) || 0) / 12;
      // ⚠ MESMO defeito, terceiro lugar: `String(1234.56)` vira 123.456 na volta.
      const padrao = media ? paraCampo(Math.round(media * 100) / 100) : "";
      return Array.from({ length: mesesInicioAtividade }, (_, i) => atual[i] ?? padrao);
    });
  }, [detalhando, mesesInicioAtividade, receita]);

  const receitasMensais = useMemo(() => {
    if (!detalhando) return null;
    return Array.from({ length: mesesInicioAtividade }, (_, i) => lerDinheiro(serieMensal[i]) || 0);
  }, [detalhando, mesesInicioAtividade, serieMensal]);

  // ⚠⚠ COLAR É O CASO PERIGOSO, e é por isso que ele tem gramática própria. Quem cola vem de
  // planilha, e planilha escreve `1234.56` (Excel pt-BR), `1,500.00` (planilha em inglês) ou
  // `R$ 889.286,09` (copiado desta própria tela). Passar o colado pela máscara faria `1500` virar
  // R$ 15,00; passar pelo `deCampo` faria `1234.56` virar 123.456. `colarDinheiro` aceita só o que
  // tem UMA leitura e RECUSA COM MOTIVO o que tem duas (`1.500`, `1,500`) — campo intocado mais uma
  // frase é melhor que um número plausível e errado.
  function aoColar(setter, campo) {
    return (evento) => {
      const colado = evento.clipboardData?.getData("text");
      if (colado == null) return;
      evento.preventDefault();
      const r = colarDinheiro(colado);
      if (r.ok) { setter(r.mascarado); setRecusaDeColagem(null); return; }
      setRecusaDeColagem({ campo, texto: textoDaRecusaDeColarDinheiro(r) });
    };
  }
  /** A frase da recusa, ao lado do campo que a causou — nunca uma barra global. */
  function RecusaDeColagem({ campo }) {
    if (recusaDeColagem?.campo !== campo) return null;
    return (
      <span style={{ display: "block", marginTop: 4, fontSize: "0.72rem", color: "var(--state-warn)" }}>
        {recusaDeColagem.texto}
      </span>
    );
  }

  // ⚠⚠ PERCENTUAL TEM LEITOR PRÓPRIO desde 01/09/2026: `deCampo` remove todo ponto como milhar, e
  // isso é certo para dinheiro e ERRADO aqui — `3.5` virava 35 (um ISS dez vezes maior) e `11.33`
  // virava 1133. Ver `lerPercentual`.
  const issLido = lerPercentual(iss);
  const margemLida = lerPercentual(margem);

  const entradas = useMemo(() => ({
    receitaAnual: lerDinheiro(receita) || 0,
    rbt12: lerDinheiro(rbt12) ?? lerDinheiro(receita),
    // ⚠⚠ `num(folha)`, NÃO `num(folha) || 0`. Campo vazio significa FOLHA NÃO INFORMADA, e o motor
    // trata `null` como ausência: sem folha o Fator R não se calcula e o Simples sai indisponível,
    // em vez de cair no Anexo V (a alíquota maior) por causa de um zero que ninguém digitou. Folha
    // realmente zero continua sendo possível — digite 0.
    folhaAnual: lerDinheiro(folha),
    anexoSimples: anexo,
    sujeitoAoFatorR: sujeitoFatorR,
    atividadePresumido: atividade,
    // ⚠ Fora da faixa NÃO entra na conta — e a tela DIZ isso, logo abaixo do campo. Silenciar aqui
    // faria a margem de "-5" produzir imposto negativo, e o `sort` coroaria o Lucro Real vencedor.
    aliquotaIss: issLido.valor == null ? null : issLido.valor / 100,
    margemLucro: margemLida.valor == null ? null : margemLida.valor / 100,
    creditosPisCofins: lerDinheiro(creditos),
    mesesDeAtividade: mesesInicioAtividade,
    receitasMensais,
    servicosAte120kConfirmado: servicos16,
  }), [receita, rbt12, folha, anexo, sujeitoFatorR, atividade, issLido.valor, margemLida.valor, creditos, mesesInicioAtividade, receitasMensais, servicos16]);

  const temReceita = entradas.receitaAnual > 0;
  const resultado = useMemo(() => (temReceita ? compararRegimes(entradas) : null), [entradas, temReceita]);
  // ⚠ DERIVADA DO RESULTADO, nunca recalculada aqui. Uma segunda conta na tela divergiria do motor
  // na primeira correção — e é o motor que decide o número que vai ao PDF.
  // ⚠ DERIVADO do resultado do motor, nunca recalculado aqui — a tabela REARRANJA o que já foi
  // calculado. Uma segunda conta na camada de apresentação divergiria do motor na primeira correção.
  const comparativo = useMemo(
    () => (resultado ? montarComparativo(resultado, entradas) : null),
    [resultado, entradas],
  );

  const ofertaDo16 = resultado?.regimes?.find((r) => r.regime === "Lucro Presumido")?.servicosAte120k || null;

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

  // ⚠ A conta que o dono nomeou como a mais valiosa do produto. Ela só faz sentido quando a
  // atividade é de Fator R — fora disso o anexo não sai da folha, e a pergunta não existe.
  // ⚠⚠ `economiaAnexo` é a OUTRA METADE: sem ela o painel mostraria só o custo, e a decisão
  // pareceria sempre ruim. Ela vale `null` quando não deu para calcular, e o painel DIZ isso.
  const proLabore = useMemo(() => {
    if (!temReceita || !sujeitoFatorR) return null;
    return simularProLaboreParaFatorR({
      // ⚠⚠ O RBT12 QUE O MOTOR APLICOU, nunca o do campo. Em início de atividade eles são coisas
      // diferentes (o do motor é o proporcionalizado), e ler o do campo aqui punha dois Fator R
      // diferentes na mesma tela, um embaixo do outro. `resultado.inicioAtividade.rbt12` é a mesma
      // fonte que alimenta o `GaugeFatorR`.
      rbt12: resultado?.inicioAtividade?.proporcionalizado ? resultado.inicioAtividade.rbt12 : entradas.rbt12,
      folha12mAtual: entradas.folhaAnual,
      economiaNoDas: economiaAnexo,
      anexoDestino: resultado?.anexoResolvido === "V" ? "III" : (resultado?.anexoResolvido || "III"),
    });
  }, [temReceita, sujeitoFatorR, entradas, economiaAnexo, resultado]);

  const avisoTrava = temReceita && atividade === "servicos" ? avisoTravaServicos16(entradas.receitaAnual) : null;

  // ⚠ A PROCEDÊNCIA DE CADA CAMPO, PARA O PAPEL. O PDF circula sozinho: dois PDFs da mesma empresa
  // com números diferentes têm de se distinguir NELE, senão a diferença parece erro de cálculo.
  // Cada linha diz se o valor veio da empresa (e de onde), se foi digitado por cima, se foi
  // informado nesta simulação, ou se não foi possível apurar.
  const procedencias = useMemo(() => procedenciaDosCampos(prefill, {
    receitaAnual: lerDinheiro(receita),
    rbt12: lerDinheiro(rbt12),
    folhaAnual: lerDinheiro(folha),
    // O regime atual não é editável na tela: ele descreve de onde a empresa está saindo.
    regimeAtual: prefill.valores?.regimeAtual ?? null,
    // ⚠ Sujeito ao Fator R: o anexo do seletor não vale nada (o campo fica desabilitado e quem
    // decide é a folha). Imprimir "Anexo III · informado nesta simulação" nesse caso afirmaria uma
    // escolha que não existiu — a linha tem de dizer que o anexo sai da folha.
    anexo: sujeitoFatorR ? null : anexo,
    sujeitoFatorR,
    aliquotaIss: issLido.valor == null ? null : issLido.valor / 100,
    atividadePresumido: atividade,
  }), [prefill, receita, rbt12, folha, anexo, sujeitoFatorR, issLido.valor, atividade]);

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
  // ⚠ Este é o aviso da faixa LEGAL do ISS (2% a 5%, LC 116). Não confundir com `issLido.fora`,
  // que é o campo ILEGÍVEL — são duas coisas: uma fala da lei, a outra do que foi digitado.
  const issForaDaFaixa = issLido.valor != null
    && (issLido.valor / 100 < ISS_FAIXA_LEGAL.minimo || issLido.valor / 100 > ISS_FAIXA_LEGAL.maximo);

  /**
   * GUARDA A FOTO E GERA O PDF — dois atos, nesta ordem, e o segundo pode falhar sozinho.
   *
   * ⚠⚠ O QUE VAI PARA O SERVIDOR É O QUE A TELA CALCULOU, não um pedido de recálculo. A foto tem
   * de guardar exatamente o que o contador viu — recalcular no servidor devolveria outro número
   * assim que o RBT12 ou as tabelas mudassem, e o PDF deixaria de descrever o que foi entregue.
   */
  async function guardarSimulacao() {
    if (!empresaId || guardando) return;
    setGuardando(true);
    setDesfechoDoGuardar(null);
    try {
      const salvo = await api.salvarSimulacaoPlanejamento(empresaId, {
        competencia: prefill.referencia?.competencia || null,
        entradas,
        resultado,
        // ⚠ A procedência viaja junto: é ela que distingue DOIS PDFs da mesma empresa com números
        // diferentes. Sem ela, a diferença parece erro de cálculo no papel.
        procedencias,
        vigenciaTabelas: resultado?.ibsCbs?.vigencia || null,
      });
      if (!salvo?.ok) {
        setDesfechoDoGuardar({ tom: "erro", texto: salvo?.message || "Não foi possível salvar a simulação." });
        return;
      }
      const doc = await api.gerarDocumentoDaSimulacao(empresaId, salvo.simulacao.id);
      if (!doc?.ok) {
        // ⚠⚠ A FOTO SOBREVIVEU. Dizer só "falhou" mandaria o contador refazer a simulação inteira
        // à toa — e o defeito nem é dele: sem o Volume no Railway o storage recusa.
        setDesfechoDoGuardar({
          tom: "erro",
          texto: doc?.message
            || "A simulação foi salva, mas o PDF não pôde ser guardado. Verifique o armazenamento de arquivos.",
        });
        return;
      }
      setDesfechoDoGuardar({ tom: "ok", texto: "Guardado em Documentos da empresa." });
    } catch (err) {
      setDesfechoDoGuardar({ tom: "erro", texto: err?.message || "Não foi possível guardar." });
    } finally {
      setGuardando(false);
    }
  }

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
              {/* ⚠ `inputMode="numeric"`: o campo é um FLUXO DE DÍGITOS em centavos, e o teclado
                  do celular não deve oferecer separador nenhum — não há o que digitar além de
                  algarismos. */}
              <input
                value={receita}
                onChange={(e) => setReceita(mascararDinheiro(e.target.value))}
                onPaste={aoColar(setReceita, "receita")}
                inputMode="numeric"
                placeholder="0,00"
                style={campo}
              />
              <RecusaDeColagem campo="receita" />
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.receitaAnual} />}
            </label>
            <label style={rotulo}>RBT12 (R$) — receita dos 12 meses anteriores
              <input
                value={mesesInicioAtividade ? "" : rbt12}
                onChange={(e) => setRbt12(mascararDinheiro(e.target.value))}
                onPaste={aoColar(setRbt12, "rbt12")}
                inputMode="numeric"
                disabled={Boolean(mesesInicioAtividade)}
                placeholder={mesesInicioAtividade ? "proporcionalizado — empresa em início de atividade" : "igual à receita anual"}
                style={{ ...campo, opacity: mesesInicioAtividade ? 0.5 : 1 }}
              />
              <RecusaDeColagem campo="rbt12" />
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
                onChange={(e) => setFolha(mascararDinheiro(e.target.value))}
                onPaste={aoColar(setFolha, "folha")}
                inputMode="numeric"
                placeholder="vazio = não informada"
                style={campo}
              />
              <RecusaDeColagem campo="folha" />
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.folhaAnual} />}
            </label>
            <label style={rotulo}>Atividade no Lucro Presumido
              <select
                value={atividade}
                onChange={(e) => { setAtividade(e.target.value); setCategoriaConfirmada(true); }}
                style={campo}
              >
                {Object.entries(ATIVIDADES_PRESUMIDO).map(([k, a]) => <option key={k} value={k}>{a.rotulo}</option>)}
              </select>
              {prefill.temEmpresa && <OrigemDoCampo campo={prefill.campos.atividadePresumido} />}
            </label>
            {/* ⚠⚠ "SUGERIDO, CONFIRME" — a forma que o dono pediu, e a diferença entre SUGERIR e
                DERIVAR. O catálogo de CNAE do portal mapeia ANEXO DO SIMPLES; a presunção é a Lei
                9.249, outra lei. Errar entre 8% e 32% de IRPJ inverte a comparação de regimes.
                ⚠ As EXCEÇÕES aparecem: sem elas o contador confirmaria sem saber o quê. */}
            {prefill.presumido?.sugestao && !categoriaConfirmada ? (
              <div style={{
                gridColumn: "1 / -1", padding: "8px 10px", border: `1px solid ${C.alerta}44`,
                borderRadius: 6, background: "#1A1B26", display: "grid", gap: 6,
              }}>
                <div style={{ fontSize: "0.74rem", color: C.alerta, lineHeight: 1.45 }}>
                  ⚠ <strong>{prefill.presumido.rotulo}</strong> foi <strong>sugerido</strong> pelo CNAE
                  {prefill.presumido.confianca === "media" ? " (confiança média)" : ""} — confirme no seletor acima.
                </div>
                <div style={{ fontSize: "0.7rem", color: C.muted, lineHeight: 1.45 }}>{prefill.presumido.motivo}</div>
                {prefill.presumido.excecoes?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.68rem", color: C.muted, lineHeight: 1.45 }}>
                    {prefill.presumido.excecoes.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {/* ⚠⚠ A PERGUNTA DOS R$ 120.000 (Lei 9.249/1995, art. 15, § 4º) — ela APARECE, e não se
                responde sozinha. `PRESUNCAO_IRPJ.servicosAte120k = 0.16` existia como constante e
                nunca entrava em conta nenhuma; medido em produção, 10 das 18 empresas com dado
                apurado têm receita abaixo do limite, ou seja o simulador presumia o DOBRO do IRPJ
                na maioria da carteira.
                ⚠ Nada é pré-selecionado: valor escolhido pelo sistema fica indistinguível de valor
                conferido por uma pessoa, e o que se afirma aqui é enquadramento fiscal.
                ⚠⚠ E ELE É IRMÃO DO <label> ACIMA, NUNCA FILHO: rótulo dentro de rótulo associa o
                rádio ao controle errado. */}
            {ofertaDo16?.cabe ? (
              <div style={{
                gridColumn: "1 / -1", padding: "8px 10px", border: `1px solid ${C.borda}`,
                borderRadius: 6, background: "#1A1B26", display: "grid", gap: 6,
              }}>
                <div style={{ fontSize: "0.74rem", color: C.texto, lineHeight: 1.45 }}>{ofertaDo16.pergunta}</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.7rem", color: C.muted, lineHeight: 1.45 }}>
                  {ofertaDo16.excecoes.map((e) => <li key={e}>{e}</li>)}
                </ul>
                <div style={{ display: "flex", gap: 14, fontSize: "0.76rem", color: C.texto }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input type="radio" name="servicos16" checked={servicos16 === true} onChange={() => setServicos16(true)} />
                    Enquadra — usar 16%
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input type="radio" name="servicos16" checked={servicos16 === false} onChange={() => setServicos16(false)} />
                    Não enquadra — 32%
                  </label>
                </div>
                {/* ⚠ ENQUANTO NINGUÉM RESPONDE, A TELA DIZ O QUE A OMISSÃO CUSTA. Ausência de
                    resposta não é resposta, e aqui ela deixa o Presumido mais caro do que pode ser. */}
                {servicos16 == null ? (
                  <div style={{ fontSize: "0.7rem", color: C.alerta, lineHeight: 1.4 }}>
                    ⚠ Sem resposta, o comparativo usa 32% — o total do Lucro Presumido pode estar superestimado.
                  </div>
                ) : null}
                {ofertaDo16.aviso ? (
                  <div style={{ fontSize: "0.7rem", color: C.alerta, lineHeight: 1.4 }}>⚠ {ofertaDo16.aviso}</div>
                ) : null}
              </div>
            ) : null}
            <label style={rotulo}>Anexo do Simples
              <select value={anexo} onChange={(e) => setAnexo(e.target.value)} disabled={sujeitoFatorR} style={{ ...campo, opacity: sujeitoFatorR ? 0.5 : 1 }}>
                {Object.entries(ANEXOS).map(([k, a]) => <option key={k} value={k}>{a.nome}</option>)}
              </select>
              {prefill.temEmpresa && !sujeitoFatorR && <OrigemDoCampo campo={prefill.campos.anexo} />}
            </label>
            <label style={rotulo}>Alíquota de ISS do município (%)
              {/* ⚠ PERCENTUAL: continua `inputMode="decimal"` e aceitando vírgula E ponto — de 0 a
                  100 não há separador de milhar, logo não há ambiguidade, e a máscara de centavos
                  aqui transformaria `5` em `0,05`. O que mudou é QUEM LÊ (`lerPercentual`). */}
              <input value={iss} onChange={(e) => setIss(e.target.value)} inputMode="decimal" placeholder="deixe vazio se não souber" style={campo} />
              {issLido.fora && (
                <span style={{ display: "block", marginTop: 4, fontSize: "0.72rem", color: "var(--state-warn)" }}>
                  {textoDoPercentualForaDaFaixa("A alíquota de ISS")}
                </span>
              )}
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
          {/* ⚠⚠ A DIVERGÊNCIA ENTRE O PERFIL DE ATIVIDADES E O CADASTRO APARECE, E NÃO É CORRIGIDA
              EM SILÊNCIO. Ela é o defeito que o dono relatou em 25/08/2026: o Perfil fiscal
              mostrava os dois CNAEs como "III ou V (Fator R) — sim" e esta tela exibia o checkbox
              desmarcado. Hoje a resposta é DERIVADA do perfil; o que sobra é o cadastro estar
              desatualizado, e quem o conserta é o contador. */}
          {prefill.fatorR?.divergencia ? (
            <div style={{ fontSize: "0.72rem", color: C.alerta, lineHeight: 1.4, marginTop: 2 }}>
              ⚠ {prefill.fatorR.divergencia.frase}
            </div>
          ) : null}
          {prefill.temEmpresa && <div style={{ marginTop: -4 }}><OrigemDoCampo campo={prefill.campos.sujeitoFatorR} /></div>}

          {/* O Lucro Real só entra com estes dois — e o card diz isso enquanto faltarem. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, paddingTop: 8, borderTop: `1px solid ${C.borda}` }}>
            <label style={rotulo}>Margem de lucro real (%) — só para comparar com o Lucro Real
              <input value={margem} onChange={(e) => setMargem(e.target.value)} inputMode="decimal" placeholder="não estimamos por você" style={campo} />
              {margemLida.fora && (
                <span style={{ display: "block", marginTop: 4, fontSize: "0.72rem", color: "var(--state-warn)" }}>
                  {/* ⚠⚠ Aqui a guarda é a que impede IMPOSTO NEGATIVO: margem negativa entrava em
                      `custoAnualReal` sem barreira nenhuma, e o `sort` do comparador coroaria o
                      Lucro Real como vencedor por causa disso — num PDF que vai ao cliente. */}
                  {textoDoPercentualForaDaFaixa("A margem de lucro")}
                </span>
              )}
            </label>
            <label style={rotulo}>Créditos anuais de PIS/COFINS (R$)
              <input
                value={creditos}
                onChange={(e) => setCreditos(mascararDinheiro(e.target.value))}
                onPaste={aoColar(setCreditos, "creditos")}
                inputMode="numeric"
                placeholder="não estimamos por você"
                style={campo}
              />
              <RecusaDeColagem campo="creditos" />
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
                          onChange={(e) => setSerieMensal((a) => { const p = [...a]; p[i] = mascararDinheiro(e.target.value); return p; })}
                          onPaste={(evento) => {
                            const colado = evento.clipboardData?.getData("text");
                            if (colado == null) return;
                            evento.preventDefault();
                            const r = colarDinheiro(colado);
                            if (!r.ok) { setRecusaDeColagem({ campo: `serie-${i}`, texto: textoDaRecusaDeColarDinheiro(r) }); return; }
                            setRecusaDeColagem(null);
                            setSerieMensal((a) => { const p = [...a]; p[i] = r.mascarado; return p; });
                          }}
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

            {/* ⚠⚠ A TABELA VEM ANTES DO GAUGE E DO PONTO DE EQUILÍBRIO, e a ordem é o argumento:
                ela é a resposta à pergunta "por que este total?". Os cards dão o número; ela dá a
                composição, e é a composição que sustenta (ou derruba) a conclusão — inclusive a de
                que "o Presumido compensa acima de X", que não vale para quem tem folha. */}
            {comparativo && <TabelaComparativa comparativo={comparativo} />}

            {/* ⚠⚠ IBS/CBS — só para quem É (ou seria) optante pelo Simples. Este bloco responde a
                decisão da janela de setembro, e a opção do art. 41, § 3º da LC 214 é do OPTANTE:
                para uma empresa do Presumido ele não faz pergunta nenhuma, e mostrá-lo ali seria
                oferecer uma decisão que ela não tem para tomar.
                ⚠ A condição é o Simples ter sido CALCULADO — `indisponivel` (folha ausente numa
                atividade de Fator R) significa que nem anexo nem faixa existem, e sem eles o
                crédito não sai. */}
            {(() => {
              const simples = (resultado?.regimes || []).find(
                (x) => /Simples/i.test(x.regime) && x.faixa != null && x.aliquotaEfetiva != null,
              );
              if (!simples) return null;
              return (
                <BlocoIbsCbs
                  cenario={cenarioIbsCbs}
                  aoTrocarCenario={setCenarioIbsCbs}
                  cbsEstimada={cbsEstimada}
                  aoMudarCbs={setCbsEstimada}
                  anexo={resultado.anexoResolvido}
                  faixa={simples.faixa}
                  /* ⚠ `aliquotaEfetiva` é FRAÇÃO no motor (`das = aliquotaEfetiva × receita`) e o
                     módulo trabalha em PONTOS PERCENTUAIS. A conversão é aqui, uma vez — passar a
                     fração adiante daria um crédito cem vezes menor, e plausível. */
                  aliquotaEfetivaPct={simples.aliquotaEfetiva * 100}
                  /* ⚠ O DAS anual e a receita são o que responde "quanto ela PAGA" — sem eles o
                     bloco só saberia dizer quanto de crédito ela transfere, que foi exatamente o
                     defeito relatado. */
                  dasAnual={simples.das}
                  receitaAnual={entradas.receitaAnual}
                  cores={C}
                  rotulo={rotulo}
                  campo={campo}
                />
              );
            })()}

            {resultado.fatorR && <GaugeFatorR fatorR={resultado.fatorR} economiaSeMudar={economiaAnexo} />}

            {/* ⚠ Logo DEPOIS do gauge: ele mostra ONDE o Fator R está, este responde O QUE FAZER. */}
            <PainelProLabore simulacao={proLabore} />

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

            <div data-print-hide style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setImprimindo(true)}
                style={{ background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "6px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}
              >
                🖨 Imprimir / salvar em PDF
              </button>

              {/* ⚠⚠ GUARDAR SÓ EXISTE COM EMPRESA ESCOLHIDA. Em simulação livre não há onde
                  guardar — a foto pertence a uma empresa, e os Documentos são dela. O botão fica
                  DESABILITADO com o motivo, nunca escondido: sumir esconderia que a ação existe.
                  ⚠ Ele é `<button>` e não link: abre um ato, não uma rota. */}
              {empresas.length > 0 && (
                <button
                  type="button"
                  onClick={guardarSimulacao}
                  disabled={!empresaId || guardando}
                  title={empresaId
                    ? "Salva esta simulação e gera o PDF em Documentos da empresa."
                    : "Escolha uma empresa acima: a simulação livre não tem onde ser guardada."}
                  style={{
                    background: "transparent", border: `1px solid ${empresaId ? C.accent : C.borda}`,
                    color: empresaId ? C.accent : C.muted, borderRadius: 6, padding: "6px 12px",
                    font: "inherit", fontSize: "0.8rem",
                    cursor: !empresaId || guardando ? "not-allowed" : "pointer",
                    opacity: empresaId ? 1 : 0.6,
                  }}
                >
                  {guardando ? "Guardando…" : "💾 Guardar em Documentos"}
                </button>
              )}

              {/* ⚠⚠ OS DOIS ATOS TÊM DESFECHOS DIFERENTES, e a frase tem de distinguir: a foto pode
                  ter sido salva e o PDF não (sem o Volume no Railway, o storage recusa). Dizer só
                  "falhou" faria o contador simular tudo de novo à toa. */}
              {desfechoDoGuardar ? (
                <span
                  role="status"
                  style={{
                    fontSize: "0.76rem", lineHeight: 1.5,
                    color: desfechoDoGuardar.tom === "erro" ? "var(--state-warn)" : C.muted,
                  }}
                >
                  {desfechoDoGuardar.texto}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
