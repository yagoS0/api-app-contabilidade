// A GAVETA — o menu lateral do dia, da saída e do imposto (30/08/2026).
//
// > Dono, com a tela na frente: *"saída não deve ser um botão, ele deve clicar no campo do dia,
// > abre um menu lateral e aí ele digita a saída. Todos os blocos de saída devem e podem ser
// > clicados, isso abre um menu lateral que mostra as saídas naquele dia, com suas descrições."* ·
// > *"o de impostos também, devo poder clicar para ver os impostos no menu lateral."*
//
// ⚠⚠ **UMA GAVETA SERVE TRÊS ENTRADAS, e isso é decisão — não economia de arquivo.** Clicar no
// DIA, na célula de SAÍDA e na de IMPOSTOS abre a MESMA caixa, com o mesmo desenho e o mesmo
// fechar. Três componentes pareceriam três lugares diferentes do app para a mesma pergunta ("o que
// tem aqui dentro?"), e o que os separa é só o FILTRO — que é dado, não estrutura.
//
// ⚠⚠ **AQUI SÓ HÁ LIGAÇÃO.** Quem decide o que entra na lista é `lib/detalheDoDia.js`, com teste
// próprio — e ele tira o balde da MESMA função que desenha a tabela (`linhaDoMes`). É a regra desta
// casa: *"regra de tela vive em `features/<x>/lib/`, e a tela só faz a LIGAÇÃO"*.
//
// ⚠⚠ **ELA NÃO BUSCA DADO NENHUM.** As linhas chegam por prop, do mesmo payload que a tabela
// desenha. Uma consulta própria de "o que tem no dia 05" traria de volta a pergunta *"por que a
// gaveta mostra uma linha que a célula não somou?"* — e as duas seriam defensáveis sozinhas.
//
// ⚠ O ESQUELETO DO DIÁLOGO É O QUE JÁ EXISTE: `.modal-backdrop--lateral` + `.modal`, os mesmos do
// `PainelDoDia` — e `useDialogoModal` para Esc, foco que entra, foco PRESO e foco que volta ao
// gatilho. Reimplementar qualquer uma dessas quatro coisas é reabrir um buraco já fechado: o de
// Shift+Tab escapando de um diálogo que declara `aria-modal="true"`.

import { useState } from "react";
import { api } from "../../api";
import { AlertaErro } from "../../components/ui";
import { brl } from "../../lib/format";
import { useDialogoModal } from "../../lib/hooks";
// ⚠⚠ A MESMA GRAMÁTICA DE NÚMERO DA EMISSÃO DE NOTA, e ela não pode divergir dentro do app:
// `Number("1.500,00")` é `NaN` e `Number("1.500")` é `1.5`. Um segundo parser aqui seria a terceira
// leitura do mesmo campo — e o portal já pagou por isso (ver o cabeçalho de `valorDaNota.js`).
import { lerValorDoCampo, mascararValorDigitado } from "../emitir/lib/valorDaNota";
import { leituraDaProcedencia, rotuloDoMes, TIPO_DA_SAIDA } from "./lib/leituraDoFluxo";
import { linhasDoDia, rotuloDoBalde } from "./lib/detalheDoDia";
// ⚠ Aritmética de STRING, nunca `toISOString()`: às 22h de Brasília o ISO devolveria o dia
// seguinte, e a gaveta do dia 05 gravaria uma saída no dia 06.
import { diasDoMes } from "./lib/dadosDeDemonstracao";

const VAZIO = { descricao: "", valor: "", data: "" };

/**
 * ⚠ AS FRASES DAS RECUSAS QUE ESTE FORMULÁRIO PRODUZ — e só elas.
 *
 * ⚠⚠ Estes três códigos são os mesmos de `SuasSaidas.jsx`, com as mesmas frases, porque são a
 * mesma recusa do mesmo servidor. **Isto é duplicação consciente e ela tem prazo:** o mapa de lá é
 * privado do arquivo, e exportá-lo é editar aquele componente. Quando aparecer o TERCEIRO
 * consumidor, o mapa inteiro sobe para `lib/`, junto com `fraseDoErro`. Enquanto forem dois, três
 * linhas duplicadas custam menos que uma abstração prematura (regra da raiz do projeto).
 * ⚠ O que NÃO se duplica é o parser do valor — aquele é a gramática do número, e uma segunda
 * leitura dele muda a ORDEM DE GRANDEZA do que é gravado.
 */
const FRASE_DA_RECUSA = Object.freeze({
  descricao_obrigatoria: "Escreva o que é esta saída.",
  valor_invalido: "O valor precisa ser maior que zero.",
  data_invalida: "Escolha a data em que você pretende pagar.",
});

const fraseDoErro = (err) =>
  err?.corpo?.message || FRASE_DA_RECUSA[err?.code] || err?.message || "Não foi possível salvar.";

/**
 * `("2026-08", 5)` → `"2026-08-05"`. Por string, e só quando a competência é legível.
 *
 * ⚠ `null` quando não dá para montar a data: um campo pré-preenchido com uma data errada é pior
 * que um campo vazio — a pessoa confere o que ela mesma digitou, não o que já veio escrito.
 */
function dataDoDia(competencia, dia) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || "")) || !Number.isInteger(dia) || dia < 1) return null;
  return `${competencia}-${String(dia).padStart(2, "0")}`;
}

/**
 * O título diz as DUAS coisas: qual recorte e de quando.
 *
 * ⚠ "no mês" é a mesma palavra que a tabela usa na linha sem dia (`fluxo-v3-sem-dia`). Chamá-la
 * aqui de "sem data" ou "projeções" faria a pessoa duvidar de que clicou naquela linha.
 */
function tituloDaGaveta({ competencia, dia, balde }) {
  // ⚠ "sem dia", e não "no mês" (31/08/2026): a LINHA que abre esta gaveta se chama "sem dia", e
  // "no mês" é o TOTAL DO RODAPÉ — outro número. Dois nomes para a mesma coisa numa tela em que o
  // vizinho é uma coisa diferente com o nome antigo é como se lê o número errado.
  // ⚠ O estado vazio desta mesma gaveta já dizia "sem dia neste mês"; era o título que destoava.
  const quando = dia == null
    ? `sem dia · ${rotuloDoMes(competencia)}`
    : `dia ${String(dia).padStart(2, "0")} de ${rotuloDoMes(competencia)}`;
  const rotulo = rotuloDoBalde(balde);
  return rotulo ? `${rotulo} · ${quando}` : quando;
}

/**
 * ⚠⚠ A LINHA — e ela carrega a procedência em TRÊS canais, nunca só na cor.
 *
 * A Lei de cor deste portal (`leituraDoFluxo.js`): **PREVISÃO NUNCA É VERDE**, o FATO também não é,
 * e a palavra *"Previsto"* vai no **TEXTO**. Aqui isso vira: a palavra visível (`rotulo`), o
 * `data-procedencia` no DOM e a classe (`neutro`/`aviso`) que a folha de estilo pinta — nenhuma
 * delas é `ok`. Impressão em preto e branco e daltonismo tiram a cor; as outras duas ficam.
 */
/**
 * ⚠⚠ O QUE O CLIENTE PODE FAZER COM UMA SAÍDA QUE SE REPETE (31/08/2026).
 *
 * > Dono: *"pode ser excluído uma saída pelo usuário. ou alterado a data"* — escopo: *"série
 * > inteira: esse pagamento é sempre dia 10."*
 *
 * ⚠⚠ **SÓ SOBRE `SERIE_DESPESA`.** Guia, imposto projetado, folha e nota emitida NÃO ganham botão
 * nenhum: guia é dívida com a Receita, e mexer nela pelo lado de quem paga é o desfecho que este
 * portal nunca pode oferecer. A lista é FECHADA, e por fonte — não por balde.
 */
const FONTES_QUE_O_CLIENTE_MEXE = Object.freeze(["SERIE_DESPESA"]);

function podeMexer(linha) {
  return FONTES_QUE_O_CLIENTE_MEXE.includes(linha?.fonte)
    && linha?.referencia?.tipo === "serie"
    && Boolean(linha?.referencia?.id);
}

/**
 * A frase que diz DE ONDE veio o dia.
 *
 * ⚠⚠ Sem ela, "dia 4" se lê como VENCIMENTO — e não é: é a mediana das datas em que as notas foram
 * emitidas. O cliente pagaria por ela. Por isso a frase mostra os dias observados: são 20, 2 e 4 na
 * série real, e o 4 não é óbvio olhando só o resultado.
 */
function fraseDoDia(linha) {
  if (linha.origemDoDia === "cliente") return "Dia definido por você.";
  if (linha.origemDoDia !== "emissao") return null;
  const dias = Array.isArray(linha.diasObservados) ? linha.diasObservados : [];
  return dias.length
    ? `Dia estimado: as notas foram emitidas nos dias ${dias.join(", ")}.`
    : "Dia estimado pelas datas em que as notas foram emitidas.";
}

function LinhaDaGaveta({ linha, aoMudarDia, aoExcluir, ocupada }) {
  const leitura = leituraDaProcedencia(linha.procedencia);
  const [editando, setEditando] = useState(false);
  const [dia, setDia] = useState(linha.dia == null ? "" : String(linha.dia));
  const mexivel = podeMexer(linha);
  const frase = fraseDoDia(linha);

  async function salvarDia(ev) {
    ev.preventDefault();
    // ⚠ Campo vazio LIMPA o dia (volta para a estimativa) — não é "cancelar". Cancelar é o outro
    // botão, e confundir os dois faria o cliente apagar sem querer o que ele mesmo definiu.
    await aoMudarDia(linha.referencia.id, dia.trim() === "" ? null : Number(dia));
    setEditando(false);
  }

  return (
    <li
      className="gaveta-linha"
      data-balde={linha.balde}
      data-fonte={linha.fonte}
      data-procedencia={linha.procedencia}
    >
      <div className="gaveta-linha-topo">
        <span className="gaveta-rotulo">{linha.rotulo}</span>
        <span className="gaveta-valor num">{brl(linha.valor)}</span>
      </div>
      {/* ⚠ A palavra ANTES da cor: quem lê no papel ou com leitor de tela recebe a mesma
          informação que quem vê o âmbar. */}
      <span className="gaveta-marca" data-classe={leitura.classe}>{leitura.rotulo}</span>
      {/*
        ⚠⚠ A FRASE É O QUE RESPONDE *"de onde veio esse número?"* — a camada que a Constituição §3
        tirou da tabela e mandou para o detalhe. Ela vem PRONTA do servidor; a tela não escreve uma
        de reserva, e quando não há frase não aparece parágrafo nenhum (aviso em toda linha vira
        paisagem, e aí ninguém lê o da linha que importa).
      */}
      {linha.frase ? <p className="gaveta-frase">{linha.frase}</p> : null}
      {/* ⚠ A frase do DIA é separada da frase do VALOR: elas respondem perguntas diferentes
          ("por que esta linha existe?" x "por que neste dia?") e juntá-las esconderia a segunda. */}
      {frase ? <p className="gaveta-frase gaveta-frase--dia">{frase}</p> : null}

      {mexivel ? (
        <div className="gaveta-acoes">
          {editando ? (
            <form className="gaveta-dia-form" onSubmit={salvarDia}>
              <label>
                Dia do mês
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                  // ⚠ `inputMode` numérico abre o teclado certo no celular, onde este portal é lido.
                  inputMode="numeric"
                  autoFocus
                />
              </label>
              {/* ⚠⚠ A FRASE DO ESCOPO, e ela não é decoração: o dono escolheu "série inteira", e o
                  cliente precisa saber que não está corrigindo só este mês. Sem ela, ele mudaria
                  setembro achando que outubro fica como estava. */}
              <p className="gaveta-nota">Vale para todos os meses. Deixe em branco para voltar ao dia estimado.</p>
              <div className="gaveta-acoes">
                <button type="submit" className="btn btn-primario" disabled={ocupada}>Salvar</button>
                <button type="button" className="btn" onClick={() => { setDia(linha.dia == null ? "" : String(linha.dia)); setEditando(false); }}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" className="btn btn-pequeno" onClick={() => setEditando(true)} disabled={ocupada}>
                {linha.dia == null ? "Definir o dia" : "Mudar o dia"}
              </button>
              {/* ⚠ "Tirar do fluxo", não "Excluir": nada é apagado — a linha sai da projeção dele e
                  continua visível para o contador, que pode desfazer. O verbo tem de dizer isso. */}
              <button type="button" className="btn btn-pequeno" onClick={() => aoExcluir(linha)} disabled={ocupada}>
                Tirar do fluxo
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * ⚠⚠ O CORPO — separado do invólucro porque `useDialogoModal` NÃO PODE ser chamado
 * condicionalmente. Com a gaveta fechada não há diálogo nenhum, e um `if` antes do hook quebraria
 * a ordem dos hooks na primeira abertura. O invólucro decide existir; este decide o quê mostrar.
 */
function Gaveta({ competencia, dia, balde, linhasDoMes, companyId, aoFechar, aoMudar }) {
  /**
   * ⚠⚠ ABERTA PELO DIA, O CAMPO DE DATA JÁ VEM COM AQUELE DIA — e isso é o pedido do dono lido ao
   * pé da letra: *"ele deve clicar no campo do dia (…) e aí ele digita a saída"*. Quem clicou no
   * dia 05 já disse quando; pedir a data de novo é perguntar duas vezes a mesma coisa, e a segunda
   * resposta pode discordar da primeira.
   *
   * ⚠ Na gaveta do **"no mês"** não há dia para pré-preencher, e o campo abre VAZIO — nunca com o
   * dia 1 "porque é o começo do mês". Inventar o dia é exatamente o que a linha "no mês" existe
   * para não fazer.
   *
   * ⚠ `useState` com inicializador só corre na MONTAGEM; o `key` lá embaixo é o que garante uma
   * gaveta nova (e uma data nova) quando o clique é em outra célula.
   */
  const [form, setForm] = useState(() => ({ ...VAZIO, data: dataDoDia(competencia, dia) || "" }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  // ⚠ `escFecha: !salvando` — enquanto o pedido está no ar, o Esc não fecha: a pessoa acharia que
  // desistiu de uma saída que já foi gravada. Mesmo cuidado do `PopUpDeGuias`.
  const { caixaRef } = useDialogoModal({ aoFechar, escFecha: !salvando });

  // ⚠ `quantosDias` fecha a borda do mês: dia 31 num mês de 30 pertence a "no mês", e é assim que a
  // tabela já o desenha. Sem ele a gaveta mostraria um dia que a tabela não tem.
  const quantosDias = diasDoMes(competencia).length || null;
  const linhas = linhasDoDia(linhasDoMes, { dia, balde, quantosDias });

  /**
   * ⚠⚠ QUANDO O FORMULÁRIO APARECE — e o critério é o do pedido do dono, literal.
   *
   * Ele descreveu DUAS coisas: clicar no dia *"e aí ele digita a saída"*, e clicar num bloco para
   * *"ver"* o que há nele. Então: pelo DIA (sem balde) o formulário vem junto; por uma CÉLULA ele
   * só existe se a célula for de SAÍDA — a gaveta de Impostos e a de Entrada são de leitura.
   *
   * ⚠⚠ Oferecer "acrescentar" na gaveta de IMPOSTOS seria pior que inútil: o cliente escreveria um
   * imposto que cairia no balde `saida` (é `SAIDA_DO_CLIENTE`, e a lista de fontes de imposto é
   * fechada), some da célula que ele clicou e reapareceria em outra coluna. Ele acharia que o
   * sistema perdeu o que ele digitou.
   */
  const podeAcrescentar = !balde || balde === "saida";

  function campo(k) {
    return (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));
  }

  /**
   * ⚠⚠ O CLIENTE DIZ O DIA DA SÉRIE — e a tela NÃO altera a linha na mão (31/08/2026).
   *
   * Quem recarrega é quem tem os dados (`aoMudar`). Mexer na linha aqui faria a gaveta e a tabela
   * discordarem até a próxima consulta — a mesma regra do formulário de acrescentar, logo abaixo.
   */
  async function mudarODia(serieId, dia) {
    setErro(null);
    setSalvando(true);
    try {
      await api.definirDiaDaSaida(companyId, serieId, dia);
      aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setSalvando(false);
    }
  }

  /**
   * ⚠⚠ TIRAR DO FLUXO PERGUNTA ANTES — e a pergunta diz o que realmente acontece.
   *
   * Ela é uma projeção que pode ter entrado sozinha (a regra dos 10%), então tirá-la é barato de
   * errar e chato de descobrir: a linha some e ninguém lembra por quê. ⚠ A frase diz que o contador
   * continua vendo — é o que impede o cliente de achar que apagou algo do escritório.
   */
  async function tirarDoFluxo(linha) {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Tirar "${linha.rotulo}" do seu fluxo?

`
      + "Ela deixa de aparecer nos próximos meses. O seu contador continua vendo, e pode trazê-la de volta.",
    );
    if (!ok) return;
    setErro(null);
    setSalvando(true);
    try {
      await api.removerSaidaDoFluxo(companyId, linha.referencia.id, { tipo: TIPO_DA_SAIDA.RECORRENTE });
      aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setSalvando(false);
    }
  }

  async function salvar(ev) {
    ev.preventDefault();
    setErro(null);
    const valor = lerValorDoCampo(form.valor);
    /**
     * ⚠⚠ A TELA RECUSA ANTES DE ENVIAR e diz o que falta — e o servidor confere tudo de novo.
     * ⚠ **ZERO NÃO PASSA**, e o `required` do HTML deixaria: "0,00" é um campo preenchido para o
     * navegador. Zero é uma AFIRMAÇÃO ("esta saída é de zero reais"), e ela não é verdadeira sobre
     * nada que alguém queira planejar.
     */
    if (!form.descricao.trim()) return setErro({ code: "descricao_obrigatoria" });
    if (!valor || valor <= 0) return setErro({ code: "valor_invalido" });
    // ⚠ A data pode vir pré-preenchida do dia clicado, mas ela continua sendo conferida: a gaveta
    // do "no mês" abre SEM data, e uma avulsa sem data não é avulsa nenhuma.
    if (!form.data) return setErro({ code: "data_invalida" });

    setSalvando(true);
    try {
      /**
       * ⚠⚠ SÓ A AVULSA SAI DAQUI. A recorrente guarda CICLO, nunca data — criá-la a partir de uma
       * célula de dia inventaria o compromisso a partir do lugar onde a pessoa clicou. Ela continua
       * em `SuasSaidas.jsx`, que é onde a pergunta "se repete?" é feita.
       */
      await api.criarSaidaDoFluxo(companyId, {
        tipo: TIPO_DA_SAIDA.AVULSA,
        descricao: form.descricao.trim(),
        // ⚠ NÚMERO, nunca a string mascarada: quem converte é `lerValorDoCampo`, por inteiro de
        // centavos. Mandar "1.500,00" gravaria `NaN` ou 1,5 conforme o lado que tentasse ler.
        valor,
        data: form.data,
      });
      setForm({ ...VAZIO, data: form.data });
      // ⚠ Quem recarrega é quem TEM as linhas — a gaveta não busca nada. Acrescentar a linha aqui
      // na mão faria a gaveta e a tabela discordarem até a próxima consulta.
      aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="modal-backdrop modal-backdrop--lateral"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <section
        className="modal gaveta"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gaveta-do-dia-titulo"
        tabIndex={-1}
        ref={caixaRef}
        data-balde={balde || "tudo"}
        data-dia={dia == null ? "no-mes" : String(dia)}
      >
        <header className="gaveta-topo">
          <h2 id="gaveta-do-dia-titulo">{tituloDaGaveta({ competencia, dia, balde })}</h2>
          <button type="button" className="btn btn-icone" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </header>

        {/* ⚠ VAZIO É RESPOSTA, e ele diz que é resposta. Sem a frase, a gaveta vazia se lê como
            carregamento que não terminou — e aqui não há carregamento nenhum para terminar. */}
        {linhas.length === 0 ? (
          <p className="empty">
            {balde
              ? `Nada em ${rotuloDoBalde(balde)} ${dia == null ? "neste mês" : "neste dia"}.`
              : `Nenhum lançamento ${dia == null ? "sem dia neste mês" : "neste dia"}.`}
          </p>
        ) : (
          <ul className="gaveta-lista">
            {linhas.map((l) => (
              <LinhaDaGaveta
                key={l.chave}
                linha={l}
                ocupada={salvando}
                aoMudarDia={mudarODia}
                aoExcluir={tirarDoFluxo}
              />
            ))}
          </ul>
        )}

        {podeAcrescentar ? (
          <form className="gaveta-form" onSubmit={salvar}>
            <h3>Acrescentar uma saída</h3>
            {/* ⚠⚠ A FRASE FICA: ela não descreve uma ausência visível, ela impede a lista de ser
                lida como contabilidade. Sem ela o cliente cobraria do contador um lançamento que
                ninguém fez. É a mesma de `SuasSaidas`, pelo mesmo motivo. */}
            <p className="gaveta-nota">
              O que você escrever aqui entra no seu fluxo como <strong>previsão</strong> e aparece
              para o seu contador conferir. Isto não lança nada na contabilidade.
            </p>

            <label>
              O que é
              <input
                value={form.descricao}
                onChange={campo("descricao")}
                maxLength={120}
                placeholder="Aluguel da sala, reforma, mensalidade…"
              />
            </label>

            <label>
              Valor
              {/* ⚠ Fluxo de dígitos em centavos: digitar `1500.00` é impossível, e ambiguidade que
                  não pode ser escrita não precisa ser resolvida. Ver `valorDaNota.js`. */}
              <input
                inputMode="numeric"
                value={form.valor}
                onChange={(ev) => setForm((f) => ({ ...f, valor: mascararValorDigitado(ev.target.value) }))}
                placeholder="0,00"
              />
            </label>

            <label>
              Data em que você pretende pagar
              <input type="date" value={form.data} onChange={campo("data")} />
            </label>

            <button type="submit" className="btn btn-primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Acrescentar"}
            </button>
          </form>
        ) : null}

        {/* ⚠ A frase vai em `padrao`, nunca em `message`: `mensagemDeErro` resolve por `code` e
            ignora `err.message` de propósito, para o texto técnico do servidor não chegar ao
            cliente. Quem passa a frase como `message` a vê descartada em silêncio. */}
        {erro ? <AlertaErro erro={erro} padrao={fraseDoErro(erro)} /> : null}
      </section>
    </div>
  );
}

/**
 * A GAVETA DO DIA.
 *
 * @param {object} props
 * @param {boolean}      props.aberta      fechada, ela não existe no DOM — ver o comentário abaixo
 * @param {string}       props.competencia `"2026-08"`, o mês do bloco que foi clicado
 * @param {number|null}  props.dia         o dia clicado; ⚠ `null` é a linha "no mês", caso legítimo
 * @param {string|null}  props.balde       `saida`/`impostos`/…; ausente quando o clique foi no DIA
 * @param {Array}        props.linhasDoMes o `mes.linhas` do payload — a gaveta NÃO consulta nada
 * @param {string}       props.companyId   para onde vai a saída acrescentada
 * @param {() => void}   props.aoFechar
 * @param {() => void}   [props.aoMudar]   avisa quem tem os dados para recarregá-los
 *
 * ⚠⚠ **FECHADA, ELA NÃO FICA ESCONDIDA: ELA NÃO EXISTE.** Um diálogo com `aria-modal="true"`
 * presente no DOM e invisível por CSS continua sendo lido por leitor de tela e continua recebendo
 * Tab — e o `useDialogoModal` prenderia o foco dentro de uma caixa que ninguém vê.
 */
export function GavetaDoDia({ aberta, ...resto }) {
  if (!aberta) return null;
  /**
   * ⚠⚠ O `key` É O QUE FAZ A GAVETA SER OUTRA GAVETA quando o clique é em outra célula. Sem ele,
   * abrir o dia 05, começar a escrever e clicar no dia 12 manteria o formulário do 05 — descrição
   * meio digitada e, pior, a DATA do dia 05 dentro de uma gaveta intitulada "dia 12". O que ele
   * custa é o rascunho não sobreviver à troca de célula, e isso é o certo: o rascunho era de outro
   * dia.
   */
  return <Gaveta key={`${resto.competencia}:${resto.dia}:${resto.balde || ""}`} {...resto} />;
}
