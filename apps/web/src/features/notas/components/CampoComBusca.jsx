// CAMPO COM BUSCA — o autocomplete do assistente de emissão, em um lugar só.
//
// ⚠ A BUSCA ENCONTRA, NUNCA ESCOLHE. Esta frase já governa o seletor de município
// (`SeletorMunicipioIbge`) e o de serviço nacional; aqui ela vira código:
//   • nada vem pré-selecionado;
//   • **resultado único NÃO se autosseleciona** — Enter sem item marcado não escolhe nada. É onde
//     este componente diverge do protótipo de propósito: lá, `Enter` com um resultado só o aplica.
//     Numa nota fiscal, "só sobrou um" não é o mesmo que "é este";
//   • toda linha mostra o identificador (documento, código) **e** o texto — é o identificador que
//     desempata homônimo.
//
// ⚠ ESCOLHER NÃO TRANCA NADA. O que a escolha faz é preencher campos que continuam editáveis; o
// que vale na nota é o que está no campo na hora de emitir, não a origem dele.
//
// A mecânica de teclado e o `preventDefault` no `mousedown` vêm do protótipo (`ligarAutocomplete`),
// que é onde elas foram desenhadas: sem o `preventDefault` o campo perde o foco no `blur` e a lista
// fecha antes de o clique chegar.

import { useId, useMemo, useRef, useState } from "react";
import { PANEL } from "./notasStyles";

const campoBase = {
  background: "var(--bg-page)", border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "8px 10px", fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
};

export function CampoComBusca({
  id,
  rotulo,
  valor,
  onChangeTexto,
  buscar,
  chaveDoItem,
  rotuloDoItem,
  detalheDoItem,
  onEscolher,
  placeholder = "",
  ajuda = null,
  textoVazio = "Nada encontrado com esse texto.",
  aoLadoDoRotulo = null,
  inputMode,
  style = null,
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const idLista = `${useId()}-lista`;
  const fecharPorBlur = useRef(true);

  const resultado = useMemo(
    () => (aberto ? buscar(valor) : { itens: [], total: 0 }),
    [aberto, buscar, valor],
  );
  const itens = resultado.itens || [];

  function fechar() {
    setAberto(false);
    setAtivo(-1);
  }

  function escolher(indice) {
    const item = itens[indice];
    if (!item) return;
    fechar();
    onEscolher(item);
  }

  function aoTeclar(evento) {
    if (!aberto && (evento.key === "ArrowDown" || evento.key === "ArrowUp")) {
      setAberto(true);
      return;
    }
    if (!aberto || itens.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setAtivo((i) => (i + 1) % itens.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setAtivo((i) => (i - 1 + itens.length) % itens.length);
    } else if (evento.key === "Enter") {
      // ⚠ SÓ escolhe o que está marcado. Sem marcação, Enter não elege ninguém — nem quando há um
      // resultado só. Ver o cabeçalho.
      if (ativo >= 0) {
        evento.preventDefault();
        escolher(ativo);
      }
    } else if (evento.key === "Escape") {
      fechar();
    }
  }

  return (
    <div style={{ display: "grid", gap: 4, position: "relative", ...(style || {}) }}>
      <label htmlFor={id} style={{ fontSize: "0.78rem", color: PANEL.muted }}>
        {rotulo}
        {aoLadoDoRotulo}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => { onChangeTexto(e.target.value); setAberto(true); setAtivo(-1); }}
        onFocus={() => setAberto(true)}
        onBlur={() => { if (fecharPorBlur.current) fechar(); }}
        onKeyDown={aoTeclar}
        placeholder={placeholder}
        autoComplete="off"
        inputMode={inputMode}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={aberto && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        style={campoBase}
      />
      {ajuda && <div style={{ fontSize: "0.72rem", color: PANEL.muted }}>{ajuda}</div>}

      {aberto && (
        <div
          id={idLista}
          role="listbox"
          // ⚠ NÃO repetir o rótulo do campo aqui. Com `aria-label={rotulo}`, a lista passa a
          // responder por `getByLabelText(<rótulo>)` junto com o input — dois elementos rotulados
          // igual, e quem procura "o campo" acha dois. O nome da lista é o da lista.
          aria-label="Resultados da busca"
          // O clique precisa chegar antes do blur fechar a lista.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            border: `1px solid ${PANEL.border}`, borderRadius: 6, background: "var(--bg-surface)",
            maxHeight: 220, overflowY: "auto", zIndex: 3,
          }}
        >
          {itens.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: "0.78rem", color: PANEL.muted }}>{textoVazio}</div>
          ) : (
            itens.map((item, i) => (
              <button
                key={chaveDoItem(item)}
                id={`${idLista}-${i}`}
                type="button"
                role="option"
                aria-selected={i === ativo}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(i)}
                style={{
                  display: "flex", justifyContent: "space-between", gap: 12, width: "100%",
                  background: i === ativo ? "var(--state-neutral-surface)" : "none",
                  border: "none", borderBottom: `1px solid ${PANEL.border}`,
                  color: PANEL.text, padding: "7px 10px", cursor: "pointer",
                  fontSize: "0.82rem", textAlign: "left",
                }}
              >
                <span style={{ minWidth: 0 }}>{rotuloDoItem(item)}</span>
                <span style={{ color: PANEL.muted, flex: "0 0 auto", fontSize: "0.76rem" }}>
                  {detalheDoItem(item)}
                </span>
              </button>
            ))
          )}
          {resultado.total > itens.length && (
            /* ⚠ Recorte que não se anuncia faz escolher dentro de uma lista parcial achando que é
               a lista inteira — e o certo pode estar fora. */
            <div style={{ padding: "6px 10px", fontSize: "0.72rem", color: PANEL.muted }}>
              Mostrando {itens.length} de {resultado.total} — refine a busca.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
