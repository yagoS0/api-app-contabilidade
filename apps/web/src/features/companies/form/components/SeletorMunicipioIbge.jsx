// MUNICÍPIO EMISSOR DA NOTA — o contador ESCOLHE numa lista oficial; o código vem junto da escolha.
//
// ⚠ ESCOLHER NÃO É DERIVAR, e a diferença é a razão desta tela existir.
// O sistema guarda o município da empresa só como TEXTO (`PortalClient.municipio`). Converter esse
// texto no código IBGE por conta própria erraria em homônimo (há cinco "Bom Jesus" no Brasil) e o
// erro apareceria apenas como NOTA EMITIDA NO MUNICÍPIO ERRADO. Aqui a decisão continua sendo do
// contador — o que sai de cena é a transcrição de sete dígitos, não a conferência.
//
// Por isso, e sem exceção:
//   • NADA vem pré-selecionado, nem para a maioria da carteira que é do Rio;
//   • a busca serve para ENCONTRAR, nunca para escolher: um único resultado também não se
//     autosseleciona (com "rio de janeiro" digitado, a linha do RJ e a de outros estados são
//     escolhas diferentes, e quem decide é quem lê);
//   • toda opção mostra MUNICÍPIO **e** UF — é a UF que desambigua o homônimo.
//
// O que a tela FAZ para ajudar a conferir: mostra ao lado o município/UF que o cadastro já tem.
// Divergência entre os dois é INFORMAÇÃO (empresa pode ter mudado de endereço, ou o cadastro pode
// estar velho) — a tela avisa e não corrige nada sozinha.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buscarMunicipios,
  carregarMunicipiosIbge,
  lerCodigoMunicipioIbge,
  municipioPorCodigo,
  normalizarParaBusca,
  rotuloMunicipio,
  MOTIVO_CODIGO_MUNICIPIO,
  PORQUE_ESCOLHA_E_NAO_DEDUCAO,
} from "../../../../lib/municipios/municipioIbge";

const LIMITE_VISIVEL = 40;

const CAIXA = {
  background: "#282A36", border: "1px solid #44475A", borderRadius: 5,
  color: "#F8F8F2", padding: "7px 9px", fontSize: "0.85rem", width: "100%",
  boxSizing: "border-box",
};

export function SeletorMunicipioIbge({
  valor,
  onChange,
  municipioCadastrado = null,
  ufCadastrado = null,
  inputId = "codigoMunicipioIbge",
}) {
  const [lista, setLista] = useState(null);
  const [erroCarga, setErroCarga] = useState(null);
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    carregarMunicipiosIbge()
      .then((dados) => { if (vivo.current) setLista(dados); })
      .catch(() => { if (vivo.current) setErroCarga("Não foi possível carregar a lista de municípios do IBGE."); });
    return () => { vivo.current = false; };
  }, []);

  const leitura = lerCodigoMunicipioIbge(valor);
  const selecionado = useMemo(
    () => (lista && leitura.valor ? municipioPorCodigo(lista, leitura.valor) : null),
    [lista, leitura.valor],
  );
  const resultado = useMemo(
    () => (lista && aberto ? buscarMunicipios(lista, termo, { limite: LIMITE_VISIVEL }) : { itens: [], total: 0 }),
    [lista, aberto, termo],
  );

  function escolher(municipio) {
    onChange(municipio[0]);
    setAberto(false);
    setTermo("");
  }

  // ⚠ Conferência, não correção. O cadastro diz uma coisa e a escolha diz outra? A tela mostra as
  // duas e para por aí: empresa muda de endereço, e "arrumar" sozinha o município emissor de uma
  // nota fiscal a partir de um campo de texto é exatamente o que este seletor existe para evitar.
  const textoCadastro = [municipioCadastrado, ufCadastrado].filter(Boolean).join(" / ");
  const divergeDoCadastro =
    Boolean(selecionado && municipioCadastrado)
    && normalizarParaBusca(selecionado[1]) !== normalizarParaBusca(municipioCadastrado);

  return (
    <div className="full" style={{ display: "grid", gap: 6 }}>
      <label htmlFor={inputId} style={{ display: "block" }}>
        Município emissor da nota (código IBGE)
      </label>

      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        {MOTIVO_CODIGO_MUNICIPIO} {PORQUE_ESCOLHA_E_NAO_DEDUCAO}
      </div>

      {textoCadastro && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          No cadastro desta empresa o endereço diz: <strong style={{ color: "#F8F8F2" }}>{textoCadastro}</strong>
          {" "}— confira contra o que você escolher. É texto, não código; por isso não serve para escolher sozinho.
        </div>
      )}

      {erroCarga && (
        <div style={{ fontSize: 12, color: "var(--state-danger)" }}>
          {erroCarga} Recarregue a página para tentar de novo — sem a lista não dá para escolher o município,
          e digitar o código à mão não é oferecido aqui de propósito.
        </div>
      )}

      {/* ── O que está gravado hoje ─────────────────────────────────────────── */}
      {leitura.valor ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          border: "1px solid #44475A", borderRadius: 6, padding: "8px 10px", background: "#282A36",
        }}>
          <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>
            {selecionado ? rotuloMunicipio(selecionado) : (lista ? "município fora da lista" : "carregando…")}
          </strong>
          <code style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{leitura.valor}</code>
          <button
            type="button"
            onClick={() => { setAberto(true); setTermo(""); }}
            style={{ background: "none", border: "1px dashed #44475A", color: "var(--accent-cyan)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: "0.78rem" }}
          >
            Trocar município
          </button>
          <button
            type="button"
            onClick={() => { onChange(""); setAberto(true); setTermo(""); }}
            style={{ background: "none", border: "none", color: "var(--state-danger)", cursor: "pointer", fontSize: "0.78rem" }}
          >
            Limpar
          </button>
        </div>
      ) : (
        // ⚠ A AUSÊNCIA APARECE NO CADASTRO, com o que ela impede — e não só na hora de emitir.
        // Antes desta guarda o `padStart` fabricava "0000000" e a Receita rejeitava com E0037.
        <div style={{
          border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
          borderRadius: 6, padding: "8px 10px", fontSize: "0.8rem", color: "var(--state-warn)",
        }}>
          <strong>Município emissor não cadastrado.</strong>{" "}
          Enquanto ficar assim, esta empresa <strong>não emite nota de serviço</strong>: o servidor
          recusa a emissão inteira por falta do município emissor. A captura de notas e o resto do
          portal seguem funcionando.
        </div>
      )}

      {/* ── A escolha ───────────────────────────────────────────────────────── */}
      {(!leitura.valor || aberto) && (
        <div style={{ display: "grid", gap: 6 }}>
          <input
            id={inputId}
            value={termo}
            onFocus={() => setAberto(true)}
            onChange={(event) => { setTermo(event.target.value); setAberto(true); }}
            placeholder={lista ? "Buscar por nome do município, UF ou código (ex.: bom jesus rs)" : "Carregando a lista do IBGE…"}
            disabled={!lista}
            autoComplete="off"
            style={CAIXA}
          />
          {lista && termo.trim() !== "" && (
            resultado.total === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Nenhum município com “{termo}”. Tente só o nome, ou nome + UF.
              </div>
            ) : (
              <>
                <ul
                  role="listbox"
                  aria-label="Municípios encontrados"
                  style={{
                    listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflowY: "auto",
                    border: "1px solid #44475A", borderRadius: 6, background: "#282A36",
                  }}
                >
                  {resultado.itens.map((m) => (
                    <li key={m[0]}>
                      <button
                        type="button"
                        onClick={() => escolher(m)}
                        style={{
                          display: "flex", justifyContent: "space-between", gap: 12, width: "100%",
                          background: "none", border: "none", borderBottom: "1px solid #2b2d45",
                          color: "#F8F8F2", padding: "7px 10px", cursor: "pointer",
                          fontSize: "0.85rem", textAlign: "left",
                        }}
                      >
                        {/* Nome E UF, sempre — nunca só o nome. */}
                        <span>{m[1]} <span style={{ color: "var(--text-muted)" }}>/ {m[2]}</span></span>
                        <code style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{m[0]}</code>
                      </button>
                    </li>
                  ))}
                </ul>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {resultado.total > resultado.itens.length
                    /* ⚠ Recorte que não se anuncia faz o contador escolher dentro de uma lista
                       parcial achando que é a lista inteira — e o município dele pode estar fora. */
                    ? `Mostrando ${resultado.itens.length} de ${resultado.total} — refine a busca (acrescente a UF).`
                    : `${resultado.total} município(s) encontrado(s).`}
                </div>
              </>
            )
          )}
        </div>
      )}

      {divergeDoCadastro && (
        <div style={{ fontSize: 11, color: "var(--state-warn)" }}>
          ⚠ O município escolhido ({selecionado[1]}) é diferente do que está no endereço do cadastro
          ({municipioCadastrado}). Pode estar certo — a empresa pode ter mudado, ou o endereço pode estar
          desatualizado. Confira antes de salvar; a tela não altera nenhum dos dois por conta própria.
        </div>
      )}
    </div>
  );
}
