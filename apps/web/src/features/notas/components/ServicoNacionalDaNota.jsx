// O CÓDIGO DE SERVIÇO DESTA NOTA — só os PRÉ-CADASTRADOS, e com o TEXTO à vista.
//
// ⚠ DECISÃO DO DONO, 16/08/2026:
// > *"na hora de emitir aparecem apenas aqueles pré-cadastrados, existe uma lista da LC116 com
// > texto vs o código, devemos mostrar o texto para que facilite a escolha."*
//
// ⚠⚠ O IMPEDIMENTO QUE ESTE CABEÇALHO DESCREVIA **CAIU EM 18/08/2026**. Ele dizia que a escolha
// por emissão não chegava ao XML e que um seletor aqui seria erro fiscal silencioso. Isso deixou de
// ser verdade, e a medição está aqui para ninguém reintroduzir o veto por ler o texto antigo:
//   • `application/validators/nfsePayload.js` **aceita** `servico.codigoServicoNacional`
//     (ou `servico.cTribNac`, ou `body.codigoServicoNacional`) e normaliza;
//   • `escolherCodigoServicoNacional` (`application/nfse/codigoServicoDaNota.js`) roda no **pré-voo
//     de `issue`**, ANTES de reservar numeração, e só aceita código **do cadastro da empresa** —
//     fora dele é `NFSE_CODIGO_SERVICO_FORA_DA_LISTA`, recusa NOSSA, nada sai da máquina;
//   • `buildDpsXml` lê `data.servico?.codigoServicoNacional` **primeiro**, caindo para o cadastro
//     quando não há escolha.
//
// ⚠ O QUE ESTA TELA FAZ HOJE continua sendo CONFERÊNCIA: ela mostra os códigos cadastrados com a
// descrição oficial e diz **qual a nota vai levar**. O que falta é só a interface de escolha — o
// caminho no servidor está pronto e provado. Enquanto ela não existir, a troca é feita no cadastro.
//
// ⚠ E o pedido do dono (19/08/2026) é exatamente esse: *"código de serviço deve e pode ser
// alterado, mas apenas para aqueles que estão cadastrados pelo contador; se o contador cadastrar
// mais de um, ela deve poder selecionar."* ⚠ Medido em produção no mesmo dia: **0 de 33 empresas
// têm mais de um código cadastrado** (só 2 têm sequer um). O ramo que renderiza hoje é o de um
// código só — o seletor múltiplo é caminho futuro, que acende quando o cadastro plural existir.
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
// O caminho da configuração vem de uma fonte só — ele já mudou de lugar duas vezes.
import { ONDE_CONFIGURA_EMISSAO } from "../../../lib/nfse/cadastroEmissaoNfse";

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
          Para emitir com outro, marque-o em <strong>{ONDE_CONFIGURA_EMISSAO}</strong> e
          salve.
        </div>
      )}
    </div>
  );
}
