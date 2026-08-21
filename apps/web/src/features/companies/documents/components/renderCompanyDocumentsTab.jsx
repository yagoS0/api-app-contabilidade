// Aba Documentos da empresa: contrato social, cartão CNPJ, inscrições, alvará.
// Seleção múltipla + barra de ações, no mesmo formato da barra única da aba Guias (Q57), que já
// resolveu esse padrão de "selecionei, e agora?".
//
// Houve uma área de arrastar-e-soltar aqui; foi REMOVIDA por não funcionar de forma confiável.
// O que sobreviveu dela — e vale manter — é a ordem: primeiro o arquivo, e só então a pergunta
// "qual documento é este?". Quem sobe um documento está com o arquivo na mão, não com a
// taxonomia na cabeça.
//
// ⚠⚠ O EXCLUIR SAIU DA LINHA. Havia um botão vermelho por linha, e com três documentos a tela
// mostrava TRÊS vermelhos em repouso — numa tela onde nada está errado. A regra de cor do projeto
// é explícita: cor forte = precisa de ação AGORA; quando o padrão grita, a exceção some. E era
// também um segundo caminho para a mesma ação: a seleção múltipla já existia logo acima, com
// Baixar e Enviar. Hoje há um caminho só, e o vermelho só aparece depois que alguém selecionou
// alguma coisa — ou seja, quando existe mesmo uma ação destrutiva possível.
//
// ⚠ AS CONFIRMAÇÕES DEIXARAM DE SER `window.confirm`. Não é estética: o `confirm` nativo não
// respeita a paleta, não é acessível pelo mesmo caminho do resto e, sobretudo, ele já tinha
// engolido a lista de nomes num alerta que ninguém lê. A regra do projeto — "confirmação repete
// os dados" — continua valendo, e agora os dados ficam LEGÍVEIS.
//
// ⚠ A LARGURA NÃO MORA MAIS AQUI (era `var(--content-wide)`, 90% da tela, escrito nesta linha):
// quem decide é o `CompanyTabLayout`. O grupo "Empresa" inteiro é `leitura` — seis colunas curtas
// cabem folgadas em `--content-max`, e o que se ganha é a sub-aba vizinha abrir na MESMA largura.

import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { Aviso } from "../../../../components/ui/Aviso";

function fmtBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const campo = {
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  padding: "8px 10px",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const rotulo = { display: "block", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 };

export function CompanyDocumentsTab({ docs }) {
  const {
    documentos, tipos, tipoLabels, carregando, enviando, erro, recarregar,
    selecionados, alternarSelecao, limparSelecao,
    enviarArquivo, baixar, baixarSelecionados, excluir, enviarPorEmail,
  } = docs;

  const inputRef = useRef(null);
  const [subindo, setSubindo] = useState(false);
  // Fila de arquivos aguardando a pergunta "qual documento é este?". O tipo NÃO é escolhido antes:
  // quem arrasta um arquivo está com o arquivo na mão, não com a taxonomia na cabeça. O botão
  // segue o mesmo caminho — os dois caem aqui.
  const [fila, setFila] = useState([]);
  const [tipoAtual, setTipoAtual] = useState("CONTRATO_SOCIAL");
  const [nomeAtual, setNomeAtual] = useState("");
  const [confirmando, setConfirmando] = useState(null); // "excluir" | "enviar"
  const [excluindo, setExcluindo] = useState(false);

  const selecionadosDocs = documentos.filter((d) => selecionados.has(d.id));
  const totalSelecionado = selecionados.size;
  const emFila = fila[0] || null;
  // ⚠ Coluna que está vazia em TODAS as linhas não é informação, é uma faixa cinza atravessando a
  // tabela. Validade só existe para alvará/certidão; nas fichas medidas, nenhuma das três linhas
  // tinha o campo. Quando houver, a coluna volta sozinha.
  const temValidade = documentos.some((d) => d.validade);

  function enfileirar(arquivos) {
    const lista = [...(arquivos || [])].filter(Boolean);
    if (!lista.length) return;
    setFila(lista);
    setNomeAtual(lista[0].name);
    setTipoAtual("CONTRATO_SOCIAL");
  }

  function aoEscolherArquivo(e) {
    const arquivos = e.target.files;
    enfileirar(arquivos);
    e.target.value = ""; // permite reenviar o mesmo arquivo depois
  }

  async function confirmarDocumento() {
    if (!emFila) return;
    setSubindo(true);
    try {
      await enviarArquivo({ arquivo: emFila, tipo: tipoAtual, nome: nomeAtual || emFila.name });
    } finally {
      setSubindo(false);
    }
    // Vários arquivos de uma vez: pergunta um a um, porque o tipo raramente é o mesmo.
    const resto = fila.slice(1);
    setFila(resto);
    if (resto.length) {
      setNomeAtual(resto[0].name);
      setTipoAtual("CONTRATO_SOCIAL");
    }
  }

  function cancelarFila() {
    setFila([]);
  }

  // ⚠ SEQUENCIAL, e não aborta no primeiro erro — é o mesmo critério do fechamento em lote da
  // carteira: são escritas, e disparar N em paralelo contra o mesmo backend para ganhar dois
  // segundos não paga o risco.
  async function excluirSelecionados() {
    setExcluindo(true);
    try {
      for (const d of selecionadosDocs) {
        // eslint-disable-next-line no-await-in-loop
        await excluir(d);
      }
      limparSelecao();
    } finally {
      setExcluindo(false);
      setConfirmando(null);
    }
  }

  async function confirmarEnvio() {
    setConfirmando(null);
    await enviarPorEmail();
  }

  const barraDeAdicionar = (
    <>
      <Button onClick={() => inputRef.current?.click()} disabled={subindo}>
        {subindo ? "Enviando…" : "+ Adicionar documento"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={aoEscolherArquivo}
        style={{ display: "none" }}
      />
    </>
  );

  return (
    <div style={{ color: "var(--text)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Documentos</h2>
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
          {carregando ? "carregando…" : `${documentos.length} documento(s)`}
        </span>
        {/* ⚠ SEMPRE no cabeçalho. Ele chegou a ser condicional (`documentos.length > 0`), com a
            segunda cópia dentro do estado vazio — e enquanto a carga estava em curso, com a lista
            ainda vazia, NENHUM dos dois renderizava: a tela ficava sem porta de entrada. */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {barraDeAdicionar}
        </div>
      </div>

      {/* Barra de ações: só aparece com algo selecionado — sem seleção não há ação possível, e é
          isto que mantém o vermelho fora da tela em repouso. */}
      {totalSelecionado > 0 && (
        <div style={{
          display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap",
          padding: "10px 12px", marginBottom: "var(--space-3)", borderRadius: "var(--radius-sm)",
          background: "var(--state-neutral-surface)", border: "1px solid var(--border)",
        }}>
          <strong style={{ fontSize: "0.82rem" }}>{totalSelecionado} selecionado(s)</strong>
          <Button size="sm" variant="secondary" onClick={baixarSelecionados}>⬇ Baixar</Button>
          <Button size="sm" disabled={enviando} onClick={() => setConfirmando("enviar")}>
            {enviando ? "Enviando…" : "✉ Enviar por e-mail"}
          </Button>
          <Button size="sm" variant="danger" disabled={excluindo} onClick={() => setConfirmando("excluir")}>
            {excluindo ? "Excluindo…" : "Excluir"}
          </Button>
          <Button size="sm" variant="secondary" style={{ marginLeft: "auto" }} onClick={limparSelecao}>
            Limpar seleção
          </Button>
        </div>
      )}

      {/* ⚠⚠ "NÃO CARREGOU" NÃO PODE SE PARECER COM "NÃO EXISTE" — e este bloco quase virou o
          contrário disso. O estado vazio ganhou moldura, `--space-6` de respiro e um convite
          ("suba o contrato social…"); com a chamada falhando, a lista também fica vazia, e o
          contador leria uma tela grande e confiante AFIRMANDO que a empresa não tem documento
          nenhum — com o toast do erro já desaparecido.
          É a distinção que o cofre de senhas faz por escrito (`estadoDaCarga`) e que faltava aqui.
          Falha ganha moldura âmbar e um "Tentar de novo"; vazio de verdade continua com o convite. */}
      {!carregando && erro ? (
        <Aviso
          tom="atencao"
          titulo="Não foi possível ler os documentos desta empresa"
          role="status"
          icone="⚠"
          acao={recarregar ? (
            <Button size="sm" variant="secondary" onClick={recarregar}>Tentar de novo</Button>
          ) : null}
        >
          <span style={{ color: "var(--text)" }}>
            {erro} Isto NÃO quer dizer que a empresa está sem documento — quer dizer que a leitura
            não voltou.
          </span>
        </Aviso>
      ) : null}

      {!carregando && !erro && !documentos.length ? (
        /* ⚠ O ESTADO VAZIO GANHOU O BOTÃO. Ele estava sozinho no canto oposto da tela, a mais de
           mil pixels da frase que mandava usá-lo — a tela dizia o que fazer e escondia onde. */
        <div style={{
          border: "1px dashed var(--border)", borderRadius: "var(--radius)",
          padding: "var(--space-6) var(--space-4)", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)",
        }}>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.85rem", maxWidth: 520 }}>
            Nenhum documento guardado. Suba o contrato social, o cartão CNPJ e as inscrições para
            tê-los à mão quando o cliente pedir.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>{barraDeAdicionar}</div>
        </div>
      ) : erro && !documentos.length ? null : (
        <div className="table-wrap">
          <table className="tabela--densa">
            <thead>
              <tr>
                <th className="th-narrow" />
                <th>Tipo</th>
                <th>Nome</th>
                <th>Tamanho</th>
                {temValidade ? <th>Validade</th> : null}
                <th>Enviado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selecionados.has(d.id)}
                      onChange={() => alternarSelecao(d.id)}
                      aria-label={`Selecionar ${d.nome}`}
                    />
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{tipoLabels[d.tipo] || d.tipo}</td>
                  <td>{d.nome}</td>
                  <td style={{ color: "var(--text-muted)" }}>{fmtBytes(d.bytes)}</td>
                  {temValidade ? (
                    <td style={{ color: d.validade ? "var(--state-warn)" : "var(--text-muted)" }}>
                      {fmtData(d.validade)}
                    </td>
                  ) : null}
                  <td style={{ color: "var(--text-muted)" }}>{fmtData(d.createdAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="secondary" onClick={() => baixar(d)}>Baixar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A PERGUNTA. Só aparece depois que o arquivo já está na mão — arrastado ou escolhido.
          Com vários arquivos, pergunta um a um: o tipo raramente é o mesmo para todos. */}
      {emFila && (
        <Modal
          titulo="Qual documento é este?"
          tamanho="sm"
          ocupado={subindo}
          aoFechar={cancelarFila}
          rodape={
            <>
              <Button variant="secondary" disabled={subindo} onClick={cancelarFila}>Cancelar</Button>
              <Button disabled={subindo} onClick={confirmarDocumento}>
                {subindo ? "Enviando…" : "Guardar"}
              </Button>
            </>
          }
        >
          <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: "var(--text-muted)", wordBreak: "break-all" }}>
            {emFila.name}
            {fila.length > 1 && ` · ${fila.length - 1} arquivo(s) na fila`}
          </p>

          <label style={rotulo} htmlFor="doc-tipo">Tipo</label>
          <select
            id="doc-tipo"
            value={tipoAtual}
            onChange={(e) => setTipoAtual(e.target.value)}
            autoFocus
            style={{ ...campo, marginBottom: "var(--space-3)" }}
          >
            {(tipos.length ? tipos : ["OUTRO"]).map((t) => (
              <option key={t} value={t}>{tipoLabels[t] || t}</option>
            ))}
          </select>

          <label style={rotulo} htmlFor="doc-nome">Nome</label>
          <input
            id="doc-nome"
            value={nomeAtual}
            onChange={(e) => setNomeAtual(e.target.value)}
            style={campo}
          />
        </Modal>
      )}

      {/* ⚠ Enviar SAI DO SISTEMA e chega no cliente: a confirmação repete quantos e QUAIS. */}
      {confirmando === "enviar" && (
        <Modal
          titulo="Enviar documentos por e-mail ao cliente"
          tamanho="sm"
          aoFechar={() => setConfirmando(null)}
          rodape={
            <>
              <Button variant="secondary" onClick={() => setConfirmando(null)}>Cancelar</Button>
              <Button onClick={confirmarEnvio}>Enviar {totalSelecionado} documento(s)</Button>
            </>
          }
        >
          <p style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
            Vão para o cliente, como anexo:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem" }}>
            {selecionadosDocs.map((d) => <li key={d.id}>{d.nome}</li>)}
          </ul>
        </Modal>
      )}

      {/* ⚠ Apagar informação repete rótulo E valor — é o mesmo critério do cofre de senhas, onde
          duas linhas "gov.br" só se distinguem pelo login. Aqui dois arquivos podem ter o mesmo
          tipo, e o que os separa é o nome. */}
      {confirmando === "excluir" && (
        <Modal
          titulo={totalSelecionado === 1 ? "Excluir documento" : `Excluir ${totalSelecionado} documentos`}
          tamanho="sm"
          ocupado={excluindo}
          aoFechar={() => setConfirmando(null)}
          rodape={
            <>
              <Button variant="secondary" disabled={excluindo} onClick={() => setConfirmando(null)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={excluindo} onClick={excluirSelecionados}>
                {excluindo ? "Excluindo…" : "Excluir"}
              </Button>
            </>
          }
        >
          <p style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
            Isto apaga do portal, e não tem desfazer:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem" }}>
            {selecionadosDocs.map((d) => (
              <li key={d.id}>
                {d.nome} <span style={{ color: "var(--text-muted)" }}>· {tipoLabels[d.tipo] || d.tipo}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
