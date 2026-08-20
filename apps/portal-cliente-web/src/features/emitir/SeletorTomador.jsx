import { useMemo, useRef, useState } from "react";
import {
  buscarTomadores,
  detalheDoTomador,
  rotuloDoTomador,
} from "./lib/tomadoresEmitidos";

/**
 * OS TOMADORES PARA QUEM ESTA EMPRESA JÁ EMITIU — a busca.
 *
 * > Dono (20/08/2026): *"na aba de emissão deve haver um seletor para selecionarmos tomadores já
 * > emitidos."*
 *
 * ⚠⚠ **ENCONTRA, NUNCA ESCOLHE** — a mesma disciplina de `SeletorMunicipio.jsx` e do
 * `CampoComBusca` do portal do escritório, e ela é código, não intenção:
 *   • NADA vem pré-selecionado;
 *   • **resultado único NÃO se autosseleciona**, e `Enter` sem item marcado não elege ninguém —
 *     numa nota fiscal, "só sobrou um" não é o mesmo que "é este";
 *   • toda linha mostra o NOME **e** o DOCUMENTO: é o documento que desempata homônimo, e é ele
 *     que decide para quem a nota sai.
 *
 * ⚠ **`Enter` COM A LISTA ABERTA SEMPRE FAZ `preventDefault`** — sem marcação ele não escolhe
 * ninguém, mas também não pode **enviar o formulário**, que é o que o `Enter` faz por padrão dentro
 * de um `<form>`. Aqui esse formulário emite nota fiscal. É a mesma linha que
 * `SeletorMunicipio.jsx` já carrega, pelo mesmo motivo.
 *
 * ⚠ **A ESCOLHA NÃO TRANCA NADA**: ela preenche campos que continuam editáveis, e o que vale na
 * nota é o que está no campo na hora de emitir.
 *
 * ⚠ **ESTE COMPONENTE NÃO DECIDE SE APARECE.** Quem tem a lista é a página, e é lá que mora a
 * regra *"sem tomadores, sem seletor — e nada é dito"*. Um `if (!lista.length) return null` aqui
 * escondia o mesmo, mas espalharia a decisão por dois arquivos.
 */
export function SeletorTomador({ id, tomadores, aoEscolher, limite = 20 }) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const idLista = `${id}-lista`;
  const campo = useRef(null);

  const resultado = useMemo(
    () => (aberto ? buscarTomadores(tomadores, termo, { limite }) : { itens: [], total: 0 }),
    [aberto, tomadores, termo, limite]
  );
  const itens = resultado.itens;

  function fechar() {
    setAberto(false);
    setAtivo(-1);
  }

  function escolher(indice) {
    const t = itens[indice];
    if (!t) return;
    setTermo("");
    fechar();
    // ⚠ O foco volta para o campo: quem escolheu com o teclado não pode ser deixado sem cursor no
    // meio de um formulário.
    campo.current?.blur();
    aoEscolher(t);
  }

  function aoTeclar(evento) {
    if (!aberto && (evento.key === "ArrowDown" || evento.key === "ArrowUp")) {
      setAberto(true);
      return;
    }
    if (!aberto) return;
    if (evento.key === "Escape") {
      fechar();
      return;
    }
    if (evento.key === "Enter") {
      // ⚠⚠ SEMPRE `preventDefault` com a lista aberta: sem marcação ninguém é eleito, e o Enter
      // NÃO pode escapar para o submit do formulário que emite a nota.
      evento.preventDefault();
      if (ativo >= 0) escolher(ativo);
      return;
    }
    if (itens.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setAtivo((i) => (i + 1) % itens.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setAtivo((i) => (i - 1 + itens.length) % itens.length);
    }
  }

  return (
    <div className="seletor-tomador">
      <label htmlFor={id}>
        Tomador para quem você já emitiu
        <input
          id={id}
          ref={campo}
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
            setAtivo(-1);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => fechar()}
          onKeyDown={aoTeclar}
          placeholder="Buscar por nome ou documento"
          autoComplete="off"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={aberto && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        />
      </label>

      {aberto ? (
        <div
          id={idLista}
          role="listbox"
          aria-label="Tomadores já emitidos"
          className="seletor-tomador-lista"
          // O clique precisa chegar antes de o blur fechar a lista.
          onMouseDown={(e) => e.preventDefault()}
        >
          {itens.length === 0 ? (
            <p className="municipio-vazio">Nenhum tomador com “{termo}”.</p>
          ) : (
            itens.map((t, i) => (
              <button
                key={t.documento}
                id={`${idLista}-${i}`}
                type="button"
                role="option"
                aria-selected={i === ativo}
                data-ativo={i === ativo ? "sim" : undefined}
                data-documento={t.documento}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(i)}
              >
                {/* Nome E documento, sempre — nunca só o nome. */}
                <span className="truncar">{rotuloDoTomador(t)}</span>
                <code>{detalheDoTomador(t)}</code>
              </button>
            ))
          )}
          {resultado.total > itens.length ? (
            // ⚠ Recorte que não se anuncia faz escolher dentro de uma lista parcial achando que é a
            // lista inteira — e o tomador certo pode estar fora dela.
            <p className="municipio-vazio">
              Mostrando {itens.length} de {resultado.total} — refine a busca.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
