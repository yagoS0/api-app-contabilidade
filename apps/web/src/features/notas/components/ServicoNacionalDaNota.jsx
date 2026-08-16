// O CÓDIGO DE SERVIÇO DESTA NOTA — só os PRÉ-CADASTRADOS, e com o TEXTO à vista.
//
// ⚠ DECISÃO DO DONO, 16/08/2026:
// > *"na hora de emitir aparecem apenas aqueles pré-cadastrados, existe uma lista da LC116 com
// > texto vs o código, devemos mostrar o texto para que facilite a escolha."*
//
// ⚠ O QUE ESTA TELA FAZ HOJE, E O QUE ELA AINDA NÃO FAZ — está escrito nela, não só aqui.
// Ela MOSTRA os códigos cadastrados com a descrição oficial, e diz **qual deles a nota vai levar**.
// O que ela NÃO faz é deixar trocar por aqui, e o motivo é concreto: `NfseService.buildDpsXml` monta
// o `cTribNac` a partir de `company.codigoServicoNacional` e de mais nada — não existe campo de
// serviço no payload da emissão (`application/validators/nfsePayload.js` não o declara, e
// `NfseService.js:540` não o lê). Um seletor aqui pareceria funcionar e a nota sairia com o outro
// código: erro fiscal SILENCIOSO, que só apareceria no DANFSe com a descrição de outra atividade.
//
// Enquanto for assim, a troca é feita no cadastro (uma marcação, um salvar) e a tela DIZ isso, com
// o caminho. Ligar a escolha por emissão é uma linha em `buildDpsXml` mais o campo no validador —
// está nomeado no relatório da entrega.
//
// ⚠ ESTE COMPONENTE NÃO BLOQUEIA NADA. Quem responde "esta empresa pode emitir?" continua sendo
// `faltasParaEmitir` (espelho de `buildMissingFields`), no passo 1. Aqui é conferência.

import { useEffect, useMemo, useRef, useState } from "react";
import { PANEL } from "./notasStyles";
import {
  carregarServicosNacionais,
  formatarCodigoServicoNacional,
  lerCodigosServicoNacional,
  servicoPorCodigo,
} from "../../../lib/servicosNacionais/servicoNacional";

export function ServicoNacionalDaNota({ cadastroEmissao }) {
  const [dados, setDados] = useState(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    carregarServicosNacionais()
      .then((d) => { if (vivo.current) setDados(d); })
      // Sem a lista, o código cru ainda é dito — ele é o que vai na nota. Some só o texto.
      .catch(() => {});
    return () => { vivo.current = false; };
  }, []);

  // ⚠ Cai para o campo singular quando a lista está vazia: é o MESMO dado no formato antigo (uma
  // empresa cadastrada antes desta mudança, ou antes de a migration ser aplicada). Sem isso a tela
  // diria "nenhum código cadastrado" para uma empresa que tem um.
  const cadastrados = useMemo(() => {
    const lista = lerCodigosServicoNacional(cadastroEmissao?.codigosServicoNacional).codigos;
    if (lista.length) return lista;
    return lerCodigosServicoNacional(cadastroEmissao?.codigoServicoNacional).codigos;
  }, [cadastroEmissao]);

  const daNota = lerCodigosServicoNacional(cadastroEmissao?.codigoServicoNacional).codigos[0] || null;

  // Prop ausente ≠ cadastro vazio. Sem o cadastro, esta tela não afirma nada.
  if (!cadastroEmissao) return null;
  if (!cadastrados.length) return null; // a falta já é dita pelo bloqueio do passo 1.

  const descrever = (codigo) => {
    if (!dados) return null;
    const s = servicoPorCodigo(dados.servicos, codigo);
    return s ? s[1] : "código fora da lista oficial";
  };

  const soUm = cadastrados.length === 1;

  return (
    <div style={{
      border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10,
      background: "var(--bg-page)", display: "grid", gap: 8,
    }}>
      <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>
        {soUm
          /* ⚠ Com um código só, NÃO se faz a pessoa escolher — mas se MOSTRA qual é. É o que vai
             declarado ao fisco; deixá-lo invisível seria pior que pedir uma escolha inútil. */
          ? "Código de serviço desta nota (o único cadastrado nesta empresa)"
          : `Códigos de serviço cadastrados nesta empresa (${cadastrados.length})`}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {cadastrados.map((codigo) => {
          const vaiNaNota = codigo === daNota;
          return (
            <li
              key={codigo}
              style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                fontSize: "0.82rem",
                color: vaiNaNota ? PANEL.text : PANEL.muted,
                opacity: vaiNaNota || soUm ? 1 : 0.75,
              }}
            >
              <span style={{ flex: "0 0 auto", width: "1.2em" }} aria-hidden="true">
                {vaiNaNota ? "●" : "○"}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <code style={{ color: vaiNaNota ? "var(--accent-cyan)" : PANEL.muted }}>
                  {formatarCodigoServicoNacional(codigo)}
                </code>
                {" — "}
                {descrever(codigo) || "…"}
                {vaiNaNota && !soUm && (
                  <strong style={{ display: "block", color: PANEL.text }}>Esta nota vai com este.</strong>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {!soUm && (
        /* ⚠ Opção que não existe NUNCA fica sem explicação — e aqui a explicação também é o
           caminho para conseguir o que se queria fazer. */
        <div style={{ fontSize: "0.75rem", color: PANEL.muted }}>
          A escolha do código por emissão ainda não está ligada: a nota sai com o código marcado.
          Para emitir com outro, marque-o em <strong>Editar cadastro → Emissão de NFS-e</strong> e
          salve.
        </div>
      )}
    </div>
  );
}
