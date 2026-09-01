import { useDialogoModal } from "../../lib/hooks";
import { fmtCnpj, texto } from "../../lib/format";
import { roleLabel } from "../../lib/roles";

/**
 * Troca de empresa.
 *
 * O usuário pode ter mais de um vínculo (`GET /client/companies` devolve uma
 * lista, não uma empresa). Sem esta tela, quem tem duas empresas vê os números
 * de uma delas achando que são os da outra.
 *
 * O papel (`myRole`) aparece porque ele muda o que a pessoa pode fazer ali
 * dentro — e o mesmo e-mail costuma ter papéis diferentes em empresas
 * diferentes.
 *
 * ⚠⚠ `avisoAoTrocar` — O TRABALHO QUE A TROCA DESCARTA, DITO ANTES DO CLIQUE (31/08/2026).
 *
 * Achado em teste de usabilidade: quem conferiu uma planilha de lote e ajustou linhas perdia tudo
 * ao trocar de empresa, **em silêncio**. O descarte em si está certo e é deliberado (conferir a
 * planilha de uma empresa sob o nome de outra prepararia notas no CNPJ errado) — o que faltava era
 * a pessoa **poder decidir**. Aqui o critério do dono manda ficar: é texto que muda uma decisão.
 *
 * ⚠ É um AVISO, não uma confirmação em duas etapas. Quem chegou a este diálogo veio para trocar
 * de empresa; pôr uma segunda pergunta no caminho ensina a clicar sem ler, que é o que a
 * confirmação do lote já evita por não se repetir. `null` ⇒ nada é dito, pela regra deste app:
 * sai a frase que descreve uma ausência, fica a que impede uma perda de ser descoberta depois.
 */
export function SeletorEmpresa({ empresas, ativaId, aoEscolher, aoFechar, avisoAoTrocar = null }) {
  // ⚠ Esc, foco que entra, foco PRESO no diálogo (o Tab não sai) e foco que volta ao fechar — a
  // metade que `aria-modal="true"` promete e que os três diálogos deste app não cumpriam.
  const { caixaRef } = useDialogoModal({ aoFechar });

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-troca-empresa"
        tabIndex={-1}
        ref={caixaRef}
      >
        <h2 id="titulo-troca-empresa">Escolher empresa</h2>
        {/* ⚠ `role="status"`, nunca `alert`: é contexto do que está na tela, e a pessoa acabou de
            abrir este diálogo — um `alert` interromperia a leitura da lista que ela veio ler. */}
        {avisoAoTrocar ? (
          <p className="alerta alerta-aviso" role="status" data-aviso-troca="sim">
            {avisoAoTrocar}
          </p>
        ) : null}
        <ul className="lista-empresas">
          {empresas.map((empresa) => {
            const ativa = empresa.companyId === ativaId;
            return (
              <li key={empresa.companyId}>
                <button
                  type="button"
                  aria-current={ativa ? "true" : undefined}
                  onClick={() => aoEscolher(empresa.companyId)}
                >
                  <span className="razao">{texto(empresa.razao)}</span>
                  <span className="meta">
                    {fmtCnpj(empresa.cnpj)}
                    {empresa.municipio || empresa.uf
                      ? ` · ${[empresa.municipio, empresa.uf].filter(Boolean).join("/")}`
                      : ""}
                    {empresa.myRole ? ` · ${roleLabel(empresa.myRole)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <footer>
          <button type="button" className="btn" onClick={aoFechar}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
