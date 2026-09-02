// O QUE O CLIENTE MEXEU NAS SAÍDAS QUE ELE NÃO CRIOU — a QUARTA fila (31/08/2026).
//
// > Dono: *"pode ser excluído uma saída pelo usuário. ou alterado a data"* e, sobre esta tela:
// > *"planeje e pense, como isso vai ser mostrado ao contador."*
//
// ⚠⚠ **POR QUE ELA EXISTE.** A linha de 3.200 da SINCROSAT não foi o cliente que criou — foi a
// regra dos 10%, sozinha. Se ele a exclui e ela simplesmente some, o escritório continua achando
// que a projeção existe, e o fluxo que os dois olham deixa de ser o mesmo fluxo.
//
// ⚠⚠ **ELA NÃO É UMA FILA DE DECISÃO, E O DESENHO TEM DE DIZER ISSO.** As outras três (declarados,
// recorrências, saídas do cliente) pedem uma palavra do contador e ficam paradas até recebê-la.
// Esta é CIÊNCIA: o cliente já decidiu, sobre o fluxo dele, e ele podia. Por isso:
//   • ela **não entra na contagem âmbar** do botão "A lançar" (`/conferencia/pendencias` não a
//     soma) — âmbar permanente treina o olho a ignorar a cor que significa "falta fazer";
//   • o único botão é **Desfazer**, e ele não é obrigatório: não fazer nada é uma resposta válida.
//
// ⚠ Ela NÃO some depois de lida. O estado dela é o estado corrente do fluxo do cliente — "o dia
// desta série é 10, porque ele disse" continua sendo verdade no mês que vem.

import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";

const mexidasApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

/**
 * `"2026-08-31T14:02:00.000Z"` → `"31/08/2026 11:02"`.
 *
 * ⚠ Aqui `new Date` é CORRETO, ao contrário de `dataBr` do painel irmão: lá a data é CIVIL (um dia
 * que a pessoa escolheu) e o construtor a deslocaria; aqui é um INSTANTE, e o fuso local é
 * justamente o que se quer mostrar — "quando ele mexeu", na hora de quem lê.
 */
function quando(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * ⚠⚠ A FRASE DA MEXIDA — e os dois casos NÃO se parecem, de propósito.
 *
 * "Mudou o dia" tem ANTES e DEPOIS; "tirou do fluxo" não tem depois nenhum. Um desenho só, com um
 * traço no lugar do "depois", faria a segunda parecer uma primeira incompleta.
 */
function descrever(m) {
  if (m.excluidaPeloClienteEm) {
    return {
      tipo: "excluida",
      titulo: "Tirou do fluxo",
      // ⚠ "Deixou de aparecer PARA ELE": a série continua aqui, e o texto não pode sugerir que ela
      // sumiu do sistema — senão o contador procura por ela e não entende o que houve.
      corpo: "Esta saída deixou de aparecer no fluxo do cliente. Ela continua aqui, e você pode trazê-la de volta.",
      em: m.excluidaPeloClienteEm,
    };
  }
  const de = Number.isInteger(m.diaEstimado) ? `dia ${m.diaEstimado}` : "sem dia";
  return {
    tipo: "dia",
    titulo: "Mudou o dia",
    corpo: `De ${de} para dia ${m.diaDoCliente}. O dia que o sistema estimou vinha das datas de emissão das notas.`,
    em: m.diaDefinidoEm,
  };
}

export function PainelDeMexidasDoCliente({ companyId, podeEscrever = true }) {
  const [estado, setEstado] = useState({ carregando: true, mexidas: [], indisponivel: false, erro: null });
  const [ocupado, setOcupado] = useState(null);

  async function carregar() {
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    try {
      const r = await mexidasApi.getConferenciaMexidasDoCliente(companyId);
      setEstado({
        carregando: false,
        mexidas: Array.isArray(r?.mexidas) ? r.mexidas : [],
        indisponivel: r?.indisponivel === true,
        erro: null,
      });
    } catch (err) {
      setEstado({ carregando: false, mexidas: [], indisponivel: false, erro: err });
    }
  }

  useEffect(() => {
    if (companyId) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function desfazer(id) {
    setOcupado(id);
    try {
      await mexidasApi.postConferenciaMexidaDesfazer(companyId, id);
      await carregar();
    } catch (err) {
      setEstado((e) => ({ ...e, erro: err }));
    } finally {
      setOcupado(null);
    }
  }

  /**
   * ⚠⚠ VAZIO NÃO DESENHA NADA — e este é o único dos quatro painéis em que isso é certo.
   *
   * Os outros três mostram "nenhuma pendência" porque a ausência ali é uma resposta que o contador
   * foi buscar ("está tudo conferido?"). Aqui ele não foi buscar nada: um card permanente dizendo
   * "o cliente não mexeu em nada" é ruído em toda empresa, todo dia, para dar a notícia de que não
   * houve notícia.
   * ⚠ `indisponivel` é diferente de vazio e APARECE: "não consegui ler" não pode se disfarçar de
   * "não há nada".
   */
  if (estado.carregando) return null;
  if (!estado.indisponivel && !estado.erro && estado.mexidas.length === 0) return null;

  return (
    <section style={{ ...card, marginTop: 16 }} data-teste="mexidas-do-cliente">
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>O cliente mexeu</h3>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {estado.mexidas.length} {estado.mexidas.length === 1 ? "saída" : "saídas"}
        </span>
      </header>
      {/* ⚠ A frase que impede a leitura errada: isto NÃO é uma fila de tarefas. Sem ela, o contador
          lê quatro painéis iguais e presume que este também espera uma decisão dele. */}
      <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
        Mudanças que o cliente fez no fluxo dele. Não é preciso decidir nada — é só para você saber.
      </p>

      {estado.erro ? (
        <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>
          Não consegui ler o que o cliente mexeu. {String(estado.erro?.message || "")}
        </p>
      ) : null}
      {estado.indisponivel ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          A tabela de recorrências ainda não existe neste banco — a migration não foi aplicada.
        </p>
      ) : null}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {estado.mexidas.map((m) => {
          const d = descrever(m);
          return (
            <li
              key={m.id}
              data-tipo={d.tipo}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <strong style={{ fontSize: 14 }}>{m.rotulo}</strong>
                {/* ⚠ A palavra ANTES de qualquer cor: quem lê com leitor de tela recebe a mesma
                    informação. É a mesma regra da tela do cliente. */}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.titulo}</span>
              </div>
              <p style={{ margin: "6px 0", fontSize: 13 }}>{d.corpo}</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Em {quando(d.em)}</p>

              {/* ⚠⚠ Desfazer SÓ na exclusão. O dia que o cliente definiu não se "desfaz" por aqui:
                  ele é a informação de quem paga, e sobrescrevê-la pelo escritório seria dizer que
                  o contador sabe melhor quando o cliente paga a conta dele. */}
              {d.tipo === "excluida" && podeEscrever ? (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 8 }}
                  disabled={ocupado === m.id}
                  onClick={() => desfazer(m.id)}
                >
                  {ocupado === m.id ? "Trazendo de volta…" : "Trazer de volta ao fluxo"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
