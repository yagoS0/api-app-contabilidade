// O BENEFÍCIO MUNICIPAL DESTA NOTA — e a única coisa verdadeira que dá para dizer sobre ele hoje.
//
// ⚠⚠ ESTE COMPONENTE EXISTE PARA IMPEDIR UMA CRENÇA FALSA, não para configurar nada. O contador
// cadastrou um benefício de ISSQN na empresa (dono, 20/08/2026: *"o seletor de benefício, caso o
// cliente tenha algum benefício fiscal"*) e, a partir daí, é natural supor que a nota sai com a
// redução. **Ela não sai.** `buildDpsXml` (`api/application/nfse/NfseService.js`) monta
// `<tribMun>` com DOIS filhos — `tribISSQN` (cravado em `1`) e `tpRetISSQN` — dos SETE que o
// `TCTribMunicipal` admite no XSD oficial 1.01; o grupo `BM` não é escrito. A nota sai com o ISS
// CHEIO.
//
// ⚠ Descobrir isso depois é caro de um jeito específico: nota emitida não se desfaz, e o erro é
// para MENOS imposto do que o contador acreditava ter declarado — ou seja, ele não vai conferir.
//
// ⚠ ELE NÃO BLOQUEIA NADA, e não deve. O benefício não está em `buildMissingFields`; a empresa
// emite normalmente, só sem a redução. Quem responde "esta empresa pode emitir?" continua sendo
// `faltasParaEmitir`, no passo 1.
//
// ⚠ SÓ APARECE PARA QUEM TEM BENEFÍCIO CADASTRADO. Falar de benefício na tela de quem não tem
// nenhum (33 de 33 empresas da carteira, hoje) seria ruído — e ruído numa caixa âmbar treina o
// olho a ignorar a cor que significa "olhe aqui".

import { PANEL } from "./notasStyles";
import {
  ONDE_CONFIGURA_EMISSAO,
  TIPOS_REDUCAO_BM,
  lerNumeroBeneficioMunicipal,
  lerPercentualReducaoBM,
} from "../../../lib/nfse/cadastroEmissaoNfse";

export function BeneficioMunicipalDaNota({ cadastroEmissao }) {
  // Prop ausente ≠ cadastro vazio. Sem o cadastro, esta tela não afirma nada.
  if (!cadastroEmissao) return null;

  const numero = lerNumeroBeneficioMunicipal(cadastroEmissao.beneficioMunicipalNumero);
  const tipo = String(cadastroEmissao.beneficioMunicipalTipoReducao || "").trim();
  if (!numero.preenchido && !tipo) return null;

  const percentual = lerPercentualReducaoBM(cadastroEmissao.beneficioMunicipalPRedBC);
  const rotuloTipo = TIPOS_REDUCAO_BM.find((t) => t.valor === tipo)?.rotulo || null;

  return (
    <div style={{
      border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
      borderRadius: 8, padding: 10, display: "grid", gap: 6,
      fontSize: "0.8rem", color: "var(--state-warn)",
    }}>
      <strong>Esta empresa tem benefício municipal cadastrado — e ele NÃO entra nesta nota.</strong>
      <div style={{ color: PANEL.muted }}>
        {/* ⚠ O número gravado fora da forma NÃO some: mostrar o que está gravado é o que permite
            perceber o erro. Some só a leitura formatada. */}
        Benefício <strong style={{ color: PANEL.text }}>
          {numero.valor || String(cadastroEmissao.beneficioMunicipalNumero || "—")}
        </strong>
        {rotuloTipo ? ` · ${rotuloTipo}` : ""}
        {tipo === "PERCENTUAL" && percentual.valor != null
          ? ` · ${String(percentual.valor).replace(".", ",")}%`
          : ""}
        .
      </div>
      <div>
        O XML da DPS que este sistema monta ainda não leva o grupo “BM”, então a nota sai com o
        <strong> ISS cheio</strong>, sem a redução. Se a redução for indispensável nesta nota, emita
        pelo portal do município. O cadastro fica em <strong>{ONDE_CONFIGURA_EMISSAO}</strong>.
      </div>
    </div>
  );
}
