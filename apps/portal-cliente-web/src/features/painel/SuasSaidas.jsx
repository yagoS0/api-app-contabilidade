// AS SAÍDAS QUE O CLIENTE ACRESCENTA AO PRÓPRIO FLUXO (29/08/2026).
//
// > Dono: *"o cliente pode modificar as saídas, podendo colocar novas saídas, **apenas para
// > visualização deles**. E essas saídas que o cliente digitar aparece para o contador na aba de
// > conferência."* Perguntado se é avulsa ou recorrente: *"as duas coisas"*. Perguntado se ele pode
// > mexer no que o sistema previu: ***"só acrescentar"***.
//
// ⚠⚠ **"SÓ ACRESCENTAR" É O CONTRATO DESTA TELA, E ELE É LITERAL.** Não há edição de linha nenhuma
// aqui — nem das que o cliente criou. O que existe é criar e REMOVER o que ele mesmo criou,
// enquanto o contador não decidiu. Nada nesta tela toca uma guia, uma nota ou a folha.
//
// ⚠⚠ **ISTO NÃO É LANÇAMENTO CONTÁBIL, e a distância é o ponto.** O lançamento que sairia daqui
// seria `D despesa / C caixa` — ele AFIRMA que o dinheiro saiu. Uma saída planejada para o mês que
// vem não saiu de lugar nenhum. Quem lança continua sendo o escritório, e a invariante nº 1 de
// `application/declarados/` (que exige `dataPagamento`) continua intacta.
//
// ⚠ A lista sai do MESMO payload que a tabela desenha (`saidasDoClienteNoFluxo`), nunca de uma
// segunda consulta: duas leituras da mesma coisa divergem, e aí a lista mostraria uma linha que a
// tabela não tem.

import { useState } from "react";
import { api } from "../../api";
import { AlertaErro } from "../../components/ui";
import { brl } from "../../lib/format";
import { lerValorDoCampo, mascararValorDigitado } from "../emitir/lib/valorDaNota";
import {
  TIPO_DA_SAIDA,
  rotuloDoMes,
  saidasDoClienteNoFluxo,
} from "./lib/leituraDoFluxo";

/**
 * ⚠ As três periodicidades são as do SERVIDOR (`PERIODICIDADE`, em `lib/recorrencia.js`), e o
 * vocabulário é fechado dos dois lados. O texto é o de quem lê: ninguém diz "MENSAL" para o dono da
 * empresa, ele diz "todo mês".
 */
const REPETICOES = [
  { chave: "MENSAL", rotulo: "Todo mês" },
  { chave: "TRIMESTRAL", rotulo: "A cada 3 meses" },
  { chave: "ANUAL", rotulo: "Uma vez por ano" },
];

const VAZIO = { descricao: "", valor: "", data: "", repete: false, periodicidade: "MENSAL" };

/**
 * ⚠⚠ A FRASE DE CADA RECUSA — e ela vem do SERVIDOR quando ele manda uma.
 *
 * Estas são só o fallback para quando não vier `message`. ⚠ Nenhuma delas inventa um conserto que a
 * tela não pode oferecer: `saida_ja_decidida` manda falar com o contador, porque é ele quem pode
 * desfazer, e nós não temos essa porta.
 */
const FRASE_DA_RECUSA = Object.freeze({
  descricao_obrigatoria: "Escreva o que é esta saída.",
  valor_invalido: "O valor precisa ser maior que zero.",
  data_invalida: "Escolha a data em que você pretende pagar.",
  periodicidade_invalida: "Escolha de quanto em quanto tempo ela se repete.",
  saida_ja_decidida: "O seu contador já conferiu esta saída, então ela não pode mais ser apagada aqui.",
  serie_ja_decidida: "O seu contador já decidiu sobre esta recorrência, então ela não pode mais ser apagada aqui.",
  serie_nao_declarada: "Esta repetição foi detectada pelo sistema, não escrita por você — fale com o seu contador.",
  saida_nao_encontrada: "Esta saída não existe mais.",
  serie_nao_encontrada: "Esta recorrência não existe mais.",
});

const fraseDoErro = (err) =>
  err?.corpo?.message || FRASE_DA_RECUSA[err?.code] || err?.message || "Não foi possível salvar.";

/** ⚠ Quando a saída acontece, no vocabulário de quem lê — nunca "competência" nem "ciclo". */
function quando(s) {
  if (s.tipo === TIPO_DA_SAIDA.AVULSA) {
    const dia = s.dia ? `dia ${String(s.dia).padStart(2, "0")} de ` : "";
    return `${dia}${rotuloDoMes(s.competencia)}`;
  }
  const r = REPETICOES.find((x) => x.chave === s.periodicidade);
  // ⚠⚠ SEM A PERIODICIDADE, o texto cai na CONTAGEM — e a diferença importa: "todo mês" é o
  // compromisso, "aparece 8× na tabela" descreve a JANELA. Dizer o primeiro sem o dado seria
  // inventar o compromisso a partir do tamanho do horizonte.
  return r ? r.rotulo : `aparece ${s.ocorrencias}× nos próximos meses`;
}

export function SuasSaidas({ companyId, meses, aoMudar }) {
  const saidas = saidasDoClienteNoFluxo(meses);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [removendo, setRemovendo] = useState(null);

  const campo = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  function fechar() {
    setAberto(false);
    setForm(VAZIO);
    setErro(null);
  }

  async function salvar(ev) {
    ev.preventDefault();
    setErro(null);
    const valor = lerValorDoCampo(form.valor);
    /**
     * ⚠⚠ A TELA RECUSA ANTES DE ENVIAR, e diz o que falta — mas o servidor confere tudo de novo.
     * ⚠ `required` do HTML não basta: um ZERO passa pelo navegador e morre no servidor, e é o mesmo
     * defeito que a alíquota de ISS já pagou nesta casa.
     */
    if (!form.descricao.trim()) return setErro({ code: "descricao_obrigatoria" });
    if (!valor || valor <= 0) return setErro({ code: "valor_invalido" });
    if (!form.repete && !form.data) return setErro({ code: "data_invalida" });

    setSalvando(true);
    try {
      await api.criarSaidaDoFluxo(companyId, form.repete
        ? {
          tipo: TIPO_DA_SAIDA.RECORRENTE,
          descricao: form.descricao.trim(),
          valor,
          periodicidade: form.periodicidade,
        }
        : {
          tipo: TIPO_DA_SAIDA.AVULSA,
          descricao: form.descricao.trim(),
          valor,
          data: form.data,
        });
      fechar();
      // ⚠ Quem recarrega é o BLOCO, com a mesma consulta que desenha a tabela: acrescentar a linha
      // aqui na mão faria a lista e a tabela discordarem até a próxima recarga.
      aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(s) {
    setErro(null);
    setRemovendo(s.id);
    try {
      // ⚠ O `tipo` viaja porque as duas formas moram em TABELAS diferentes, e o servidor despacha
      // por ele. Sem o parâmetro ele apagaria a avulsa — que não é esta.
      await api.removerSaidaDoFluxo(companyId, s.id, { tipo: s.tipo });
      aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setRemovendo(null);
    }
  }

  return (
    <section className="fluxo-v4-saidas" aria-label="Saídas que você acrescentou">
      <div className="fluxo-v4-saidas-topo">
        <h3>Suas saídas</h3>
        {/* ⚠ O rótulo diz O QUE o botão faz. Um `+` mudo é o vocabulário de quem EDITA a
            contabilidade dentro da grade, e este portal não faz isso. */}
        <button type="button" className="btn btn-sm" onClick={() => (aberto ? fechar() : setAberto(true))}>
          {aberto ? "Cancelar" : "+ Saída"}
        </button>
      </div>

      {/* ⚠⚠ A FRASE FICA, e ela não descreve uma ausência visível: ela impede a lista de ser lida
          como contabilidade. Sem ela, o cliente pode achar que o que escreveu aqui virou despesa
          lançada — e cobrar do contador um lançamento que ninguém fez. */}
      <p className="fluxo-v4-saidas-nota">
        O que você escrever aqui entra no seu fluxo como <strong>previsão</strong> e aparece para o
        seu contador conferir. Isto não lança nada na contabilidade.
      </p>

      {aberto ? (
        <form className="fluxo-v4-saidas-form" onSubmit={salvar}>
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
            {/*
              ⚠⚠ A MÁSCARA É A MESMA DA EMISSÃO DE NOTA (`mascararValorDigitado`), e ela existe
              porque o que ela substituiu emitia nota por 1/1000 do valor: `Number("1.500,00")` é
              `NaN` e `Number("1.500")` é `1.5`. Aqui o erro seria "só" um fluxo errado, mas a
              gramática do número não pode divergir dentro do MESMO app.
              ⚠ Ela lê o teclado como fluxo de dígitos em centavos: digitar `1500.00` é impossível,
              e ambiguidade que não pode ser escrita não precisa ser resolvida.
            */}
            <input
              inputMode="numeric"
              value={form.valor}
              onChange={(ev) => setForm((f) => ({ ...f, valor: mascararValorDigitado(ev.target.value) }))}
              placeholder="0,00"
            />
          </label>

          {/* ⚠ UMA escolha, não duas telas: "acontece uma vez" × "se repete" é a mesma pergunta com
              duas respostas, e separá-las em dois botões faria a pessoa escolher a porta antes de
              saber o que está criando. */}
          <div className="fluxo-v4-saidas-campo-quando">
            <span className="fluxo-v4-saidas-rotulo">Quando</span>
            <div className="fluxo-v4-saidas-quando">
              <label className="fluxo-v4-saidas-check">
                <input
                  type="checkbox"
                  checked={form.repete}
                  onChange={(ev) => setForm((f) => ({ ...f, repete: ev.target.checked }))}
                />
                Se repete
              </label>
              {form.repete ? (
                <select
                  aria-label="De quanto em quanto tempo"
                  value={form.periodicidade}
                  onChange={campo("periodicidade")}
                >
                  {REPETICOES.map((r) => (
                    <option key={r.chave} value={r.chave}>{r.rotulo}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  aria-label="Data em que você pretende pagar"
                  value={form.data}
                  onChange={campo("data")}
                />
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={salvando}>
            {salvando ? "Salvando…" : "Acrescentar"}
          </button>
        </form>
      ) : null}

      {/*
        ⚠⚠ A FRASE VAI EM `padrao`, NÃO EM `message` — e isto é um defeito que o teste pegou.
        `mensagemDeErro` (`lib/mensagens.js`) resolve por `code` e cai no `padrao`; ela **ignora**
        `err.message` de propósito, para o texto técnico do servidor nunca chegar ao cliente. Quem
        passar a frase como `message` a vê ser descartada em silêncio, e a tela mostra
        "Não foi possível salvar." em todas as recusas.
        ⚠ A ordem certa é esta: o mapa CENTRAL vence (é a tradução única do app), e o que ele não
        conhece cai na frase daqui — que por sua vez prefere a `message` que o servidor mandou.
      */}
      {erro ? <AlertaErro erro={erro} padrao={fraseDoErro(erro)} /> : null}

      {saidas.length ? (
        <ul className="fluxo-v4-saidas-lista">
          {saidas.map((s) => {
            // ⚠ `pendente` vem DERIVADO da leitura: são dois vocabulários de estado (um por
            // tabela) e só um deles casaria com uma comparação escrita aqui. Ver `leituraDoFluxo`.
            const pendente = s.pendente;
            return (
              <li key={s.id} data-saida={s.id} data-estado={s.estado}>
                <div>
                  <strong>{s.rotulo}</strong>
                  <span className="fluxo-v4-saidas-quando-texto">
                    {quando(s)} · {brl(s.valor)}
                    {/* ⚠ A recorrente diz o TOTAL do horizonte também: é o número que responde
                        "quanto isso me custa até o fim da tabela", e ele não é o que foi digitado. */}
                    {s.ocorrencias > 1 ? ` · ${s.ocorrencias}× na tabela (${brl(s.total)})` : ""}
                  </span>
                </div>
                {/*
                  ⚠⚠ O ESTADO É DITO, não só desenhado. "Aguardando o seu contador" e "conferida"
                  pedem coisas diferentes de quem lê: uma ainda pode ser apagada aqui, a outra não.
                  ⚠ E o botão de remover SOME depois da decisão, em vez de aparecer desabilitado: o
                  conserto não é esperar, é falar com o contador — e um botão morto na tela não diz
                  isso. (Onde o botão é a única saída, a regra desta casa é o contrário: ele fica
                  desabilitado COM o motivo. Aqui existe outra saída, e ela é uma pessoa.)
                */}
                {pendente ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => remover(s)}
                    disabled={removendo === s.id}
                  >
                    {removendo === s.id ? "Removendo…" : "Remover"}
                  </button>
                ) : (
                  <span className="fluxo-v4-saidas-conferida">Conferida pelo seu contador</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        // ⚠ Vazio DIZ que está vazio, e diz o que fazer. Uma seção que some quando não há nada
        // esconde que a ação existe — o mesmo argumento do botão que desabilita em vez de sumir.
        <p className="fluxo-v4-saidas-vazio">
          Você ainda não acrescentou nenhuma saída.
        </p>
      )}
    </section>
  );
}
