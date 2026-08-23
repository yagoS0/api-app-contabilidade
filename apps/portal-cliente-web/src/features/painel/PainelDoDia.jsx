// O PAINEL DE UM DIA DO FLUXO DE CAIXA.
//
// Pedido do dono (23/08/2026), com dois prints na frente: *"mostrando os dias do mês, com ação para
// abrir o dia e ver quais foram as despesas daquele dia específico"*.
//
// ⚠⚠ O SELO SE REPETE AQUI, e isso não é redundância. O diálogo COBRE o bloco — e com ele o selo de
// demonstração que fica lá em cima. A regra que pôs o selo DENTRO do bloco (e não na página) é a
// mesma que o traz para cá: quem lê um valor tem de ter passado por um aviso, e enquanto este painel
// está aberto o aviso do bloco não está na tela.
//
// ⚠⚠ NÃO EXISTE `+` NEM `⋮` — e os dois estão no print do dono. O portal do cliente **não escreve
// contabilidade**: quem lança é o escritório, não há rota para criar nem editar movimento de caixa,
// e um botão que não pode existir é pior que a ausência dele. Travado por teste que conta os botões.
//
// ⚠ O DIÁLOGO COPIA O PADRÃO QUE JÁ EXISTE (`SeletorEmpresa.jsx`, `ConfirmarCancelamento.jsx`): Esc
// pela `window`, fundo por `onMouseDown` com `e.target === e.currentTarget`, `focus()` na caixa
// `tabIndex={-1}`, `role="dialog"` + `aria-modal` + `aria-labelledby`. Este é o TERCEIRO com o mesmo
// miolo — extrair um `Dialogo` comum é a hora certa, mas migrar o `ConfirmarCancelamento` mexe no
// fluxo de CANCELAMENTO de nota fiscal. Fica nomeado como próximo passo, não embutido aqui.

import { useEffect, useRef } from "react";
import { brl } from "../../lib/format";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * `"2026-08-18"` → `"18 de agosto de 2026"`.
 *
 * ⚠ Por fatia de string, sem `new Date`. É a mesma disciplina de `fmtDateBr` (`lib/format.js`), que
 * evita `new Date` justamente para não deslocar o fuso — aqui o dado é data CIVIL, sem hora.
 */
export function porExtenso(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia || ""));
  if (!m) return String(dia || "");
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

export function PainelDoDia({ dias, indice, aoFechar, aoIr }) {
  const caixaRef = useRef(null);
  const d = dias?.[indice];

  useEffect(() => {
    const aoTeclar = (e) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    caixaRef.current?.focus();
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  if (!d) return null;

  // ⚠ AS BORDAS SÃO O FIM DO MÊS, e os botões ficam DESABILITADOS nelas em vez de sumirem — controle
  // que aparece e some conforme o dia deixa a barra instável. Passar do dia 1 para trás ou do último
  // para frente ou trocaria em silêncio a competência da casca, ou mostraria um dia que não está na
  // tabela atrás. A competência é uma só e ela não muda daqui.
  const temAnterior = indice > 0;
  const temProximo = indice < dias.length - 1;
  const saldoDoDia = d.entradas - d.saidas;

  return (
    <div
      className="modal-backdrop modal-backdrop--lateral"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <section
        className="modal painel-dia"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-dia-do-fluxo"
        tabIndex={-1}
        ref={caixaRef}
      >
        <header className="painel-dia-topo">
          <button type="button" className="btn btn-icone" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
          <div className="painel-dia-navegacao">
            <button
              type="button"
              className="btn btn-icone"
              onClick={() => aoIr(indice - 1)}
              disabled={!temAnterior}
              aria-label="Dia anterior"
            >
              ‹
            </button>
            <h2 id="titulo-dia-do-fluxo">{porExtenso(d.dia)}</h2>
            <button
              type="button"
              className="btn btn-icone"
              onClick={() => aoIr(indice + 1)}
              disabled={!temProximo}
              aria-label="Próximo dia"
            >
              ›
            </button>
          </div>
        </header>

        {/* ⚠ Curto de propósito: o selo longo mora no bloco. Aqui ele existe para que o número desta
            lista não seja lido como movimento da empresa — ver o cabeçalho do arquivo. */}
        <p className="alerta alerta-aviso demonstracao-selo" role="status">
          <strong>Dados de demonstração.</strong> Estes lançamentos não são da sua empresa.
        </p>

        <dl className="painel-dia-resumo">
          <div>
            <dt>Entradas</dt>
            <dd className="num">{brl(d.entradas)}</dd>
          </div>
          <div>
            <dt>Saídas</dt>
            <dd className="num">{brl(d.saidas)}</dd>
          </div>
          <div>
            <dt>No dia</dt>
            <dd className="num" data-negativo={saldoDoDia < 0 ? "sim" : undefined}>
              {brl(saldoDoDia)}
            </dd>
          </div>
        </dl>

        {/* ⚠ DIA VAZIO É RESPOSTA, NÃO FALHA — e por isso ele abre como qualquer outro. Sem esta
            frase, o painel vazio se lê como carregamento que não terminou. */}
        {d.lancamentos.length === 0 ? (
          <p className="empty">Nenhum lançamento neste dia.</p>
        ) : (
          <ul className="lancamentos-do-dia">
            {d.lancamentos.map((l) => (
              <li key={l.id} data-tipo={l.tipo}>
                <span className="lancamento-descricao">{l.descricao}</span>
                {/* O sinal é do TIPO, não do número: o valor viaja sempre positivo, e quem decide
                    entrada ou saída é `tipo`. Assim não existe o caso de um valor negativo numa
                    linha de entrada. */}
                <span className="num lancamento-valor" data-negativo={l.tipo === "saida" ? "sim" : undefined}>
                  {l.tipo === "saida" ? `− ${brl(l.valor)}` : `+ ${brl(l.valor)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
