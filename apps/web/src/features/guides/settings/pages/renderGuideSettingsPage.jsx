// ⚠⚠ ÓRFÃO — NENHUM ARQUIVO DESTE APP IMPORTA `GuideSettingsPage`. Medido em 24/08/2026 por
// varredura do nome exportado em todo o `src`, testes inclusive: **zero consumidores**.
// Último commit que o tocou: a8cea00f (19/05/2026).
//
// 27 linhas, o mais antigo dos cinco — sem consumidor há mais de três meses.
//
// ⚠⚠ **ELE NÃO FOI APAGADO, E ISSO É DELIBERADO.** A decisão está escrita neste projeto, a
// propósito do `DefisNaoDevida.jsx`, que ficou no mesmo estado quando o dono mandou tirar a legenda
// da DEFIS: *"não foi apagado — apagar componente é decisão à parte"*. Apagar é irreversível na
// leitura de quem vier depois (some da árvore, some da busca), e "ninguém importa" não é o mesmo que
// "ninguém quer": pode ser tela adiada, pode ser desenho recusado.
//
// ⚠ O que ESTE aviso resolve é o silêncio. Sem ele o arquivo parece vivo — aparece na busca, entra
// nas varreduras, e alguém o "conserta" achando que está consertando uma tela.
//
// **Para o dono:** apagar ou reconectar é decisão sua. Os cinco órfãos estão listados juntos em
// `apps/web/CLAUDE.md`, seção "OS CINCO ÓRFÃOS".

import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";

export function GuideSettingsPage({ pdfReaderConfigured, onBack }) {
  return (
    <PageShell
      title="Guias — configuração"
      subtitle="Upload no portal, extração via pdf-reader e armazenamento no PostgreSQL."
      onBack={onBack}
    >
      <AppShell>
        <section className="panel">
          <h2 className="panel__title">Status</h2>
          <ul className="settings-list text-muted">
            <li>
              Leitor de PDF na API (<code className="code-inline">PDF_READER_URL</code>):{" "}
              <strong className="text-strong">{pdfReaderConfigured ? "OK" : "Ausente"}</strong>
            </li>
          </ul>
          <p className="hint">
            Não há integração com Google Drive para pastas de guias. O e-mail usa o PDF salvo no banco.
          </p>
        </section>
      </AppShell>
    </PageShell>
  );
}
