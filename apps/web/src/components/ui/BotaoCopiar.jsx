// COPIAR — o gesto que o contador repete o dia inteiro.
//
// ⚠⚠ O RETORNO NÃO MENTE, e é a razão de este componente existir num lugar só.
// `navigator.clipboard` NÃO EXISTE em contexto inseguro (`http://ip:porta`, que é como o portal
// roda em rede local) e a chamada pode ser recusada mesmo onde existe. Nesses casos o botão diz
// "não deu" em vez de piscar "copiado" — um sucesso falso manda a pessoa colar o conteúdo ANTERIOR
// da área de transferência no campo, e ela não tem como saber.
//
// ⚠ MOROU EM `features/companies/list/components/renderCompaniesTable.jsx` até 18/08/2026, onde
// nasceu para o CNPJ. Subiu para cá quando a linha digitável da guia passou a precisar do mesmo
// gesto: uma segunda cópia do bloco significaria duas implementações da promessa "não mente", e a
// que ninguém testasse acabaria mentindo. O teste que a prende continua sendo
// `features/companies/list/components/__tests__/tabelaEmpresasLeitura.test.jsx`, que exercita o
// componente REAL por dentro da tabela — mais o par dele em `features/guides/.../linhaDigitavelNaTela`.
//
// ⚠ O QUE SE COPIA É O VALOR CRU, nunca o formatado. O CNPJ vai sem máscara porque o e-CAC recusa
// `00.000.000/0001-00`; a linha digitável vai nos 48 dígitos porque é o que se digita no banco. A
// máscara existe para o olho conferir, e só.

import { useState } from "react";

/**
 * @param {{valor: string, rotulo: string, titulo?: string}} props
 *   `valor` — o texto CRU que vai para a área de transferência
 *   `rotulo` — `aria-label` (é como o teste e o leitor de tela acham o botão)
 *   `titulo` — `title` no estado parado; no estado "falhou" ele é substituído pelo aviso
 */
export function BotaoCopiar({ valor, rotulo, titulo }) {
  const [estado, setEstado] = useState("parado"); // parado | copiado | falhou

  async function copiar(e) {
    e.stopPropagation();
    const texto = String(valor || "");
    if (!texto) return;
    try {
      if (!navigator?.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
    window.setTimeout(() => setEstado("parado"), 1600);
  }

  const cor = estado === "copiado" ? "var(--state-ok)" : estado === "falhou" ? "var(--state-danger)" : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={copiar}
      title={estado === "falhou" ? "Não foi possível copiar neste navegador — selecione e copie à mão" : titulo}
      aria-label={rotulo}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 18, padding: 0, flex: "0 0 auto",
        background: "transparent", border: "none", borderRadius: 4,
        color: cor, cursor: "pointer", font: "inherit", fontSize: "0.7rem", lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{estado === "copiado" ? "✓" : estado === "falhou" ? "✖" : "⧉"}</span>
    </button>
  );
}
