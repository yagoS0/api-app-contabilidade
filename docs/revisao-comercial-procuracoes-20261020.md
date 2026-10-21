# Comercial e procurações — incremento integrado de 20/10/2026

## Adendo final após as duas rodadas funcionais — 20/10/2026

Este adendo atualiza o estado histórico das seções abaixo. HEAD conferido nesta execução: `f8715cca149733278b09a6f1cd4dc6e4dd2bb338`, com árvore inicialmente limpa. Contém as correções funcionais `6e91de8da`, os testes adicionais e o fechamento documental `8f54c3e27` e a infraestrutura `f8715cca1`, originada de `2b9974c7a` em fluxo separado. Nesta execução, somente este relatório foi editado; código, testes, configurações e governança foram preservados.

As **duas rodadas funcionais já foram utilizadas**. A designação técnica “rodada 0” do subprocesso não renova esse orçamento. A execução final cabe ao Principal pelo export público `runOrchestration`, com `maxCorrections: 0`, mantendo os demais limites, gates e revisores. Nova reprovação funcional deve retornar ao Principal para decisão humana, sem iniciar terceira rodada ou editar produto neste fechamento.

O incremento continua funcional, transversal e de risco alto, comparado integralmente com `48dc5efa`. O JSON `paths` abaixo conserva os **27 caminhos funcionais/documentais**; não se limita à última escrita documental e não inclui `scripts/governance`. A tentativa `22-13-50`, cujo plano continha apenas dois documentos, foi rejeitada pelo Principal antes dos testes. Baselines e inventários de fontes não constituem aprovação anterior.

Evidências novas recebidas do Principal e registradas em `.altan-governance/pareceres-nativos.txt`:

- **Testes direcionados: 2 suítes, 27/27 aprovados**, referentes a `formularioContrato.test.jsx` e `coerenciaComercialP0.test.jsx` no incremento `8f54c3e27`. A inspeção dos testes confirma cenários de mudança de versão/opção aceita da proposta na mesma ficha, descarte da edição/prévia anterior, polling integrado do chat preservando prévia e resultado incerto, bloqueio de repetição e descarte de resposta do atendimento anterior após a troca. É resultado recebido, não reexecução pelo executor nem aprovação do gate web completo.
- **Gate web anterior interrompido duas vezes por `EPERM` no rename de `manifest.tmp` para `manifest.json`**, sem teste falho nos resultados parciais informados. As evidências são `web-RoYWmR` e `web-NZHzQW`; o segundo também consta em `.altan-governance/web-retry-principal.log`. Interrupção de infraestrutura não equivale a execução integral aprovada.
- **Infraestrutura corrigida e revisada separadamente:** o registro atribui a revisão independente a `governanca_revisao`, com 35/35 testes, zero falhas/skips e exit 0. Retry Windows limitado à gravação atômica, no máximo 750 ms, sem unlink, falsa aprovação ou alteração de seleção, contagem e timeouts. Esse parecer cobre somente a infraestrutura; não aprova o produto nem substitui os gates deste incremento.
- **QA visual do Principal concluída em 1440/390**, com reinspeção final registrada em `.altan-governance/qa/parecer-visual-principal.txt`. Desde essas capturas houve somente testes, comentário e documentação, sem mudança de comportamento visual. O executor não repetiu a inspeção das imagens. O parecer comercial nativo permanece condicionado aos gates finais; o parecer anterior de procurações não representa aprovação global.

**Nova execução integral e revisões finais ainda pendentes no momento deste adendo.** Não se atribui resultado aos gates deste run antes de sua execução. Permanecem necessários os gates e revisões independentes do conjunto completo descritos abaixo, sem reutilizar aprovações de runs interrompidos ou versões anteriores. Os testes mockados e a QA isolada não exigem novos atos externos: consultas, mensagens, cadastro, assinatura e pagamento reais não foram autorizados como validação.

A referência operacional integral fornecida foi consultada e o hash canônico novamente conferido: `8a0c578e5cac16376fd0e156c32b2712a2b9e8929936a12f051384363d12b302`. Nenhuma nova regra; R02/R19/R22/R27/R28/R31 e guardas backend de 24h permanecem preservadas. O vínculo real Neurogenesis é informação recebida do Principal sobre ação anterior; representação/aceite continuam pendentes do usuário, sem verificação ou mutação produtiva pelo executor.

Verificação local deste adendo: a tentativa de `node scripts/governance/check.mjs plan --base 48dc5efa` voltou a falhar antes da análise por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`. Isso é distinto dos erros de rename do gate web. Não houve contorno de permissões, relançamento do controlador ou delegação. A reversão desta execução consiste apenas em retirar este adendo, preservando todo o trabalho incorporado no HEAD; o rollback funcional continua sujeito à reversão seletiva descrita ao final.

## Estado da entrega e base

Inspeção e fechamento documental pelo executor delegado, rodada 0. Base de comparação: `48dc5efa`; HEAD encontrado: `6e91de8da2a400e7ee84a6a79226254288149d65`. A implementação anterior estava incorporada nesse HEAD, com árvore inicialmente limpa. O conjunto revisável é o diff desde a base, acrescido das alterações locais desta rodada; não apenas a última escrita documental. Não há aprovação técnica nesta declaração.

O incremento é funcional e transversal, de risco **alto**. Domínios obrigatórios: accounting, commercial, communication, documentation, fiscal, guides, operations, portal e web. Accounting, guides e portal entram pelo impacto transitivo conservador; não receberam código novo. Não houve alteração de backend, configuração, governança, permissões, banco ou regras operacionais. Não houve delegação adicional, execução do Orquestrador, commit, merge, publicação ou ato externo pelo executor.

A referência operacional integral fornecida no pedido foi consultada. SHA256 canônico e da cópia local conferidos nesta execução: `8a0c578e5cac16376fd0e156c32b2712a2b9e8929936a12f051384363d12b302`. Decisões posteriores dessa referência prevalecem sobre propostas históricas dos documentos de design. Nenhuma nova regra ou decisão pendente foi aprovada neste incremento.

## Escopo obrigatório para gates e revisão

O runtime usa `paths`, não a descrição textual, para determinar gates e domínios. O plano executável deve conservar todos os 27 caminhos abaixo, mesmo quando a mudança funcional precede esta rodada. Este inventário documental não modifica o plano do runtime nem substitui sua validação pelo Principal/controlador.

```json
{
  "base": "48dc5efa",
  "risk": "high",
  "paths": [
    "apps/web/src/features/comercial/AcompanhamentoComercial.jsx",
    "apps/web/src/features/comercial/__tests__/AcompanhamentoComercial.test.jsx",
    "apps/web/src/features/companies/list/components/__tests__/tabelaEmpresasLeitura.test.jsx",
    "apps/web/src/features/companies/list/components/renderCompaniesTable.jsx",
    "apps/web/src/features/fiscal/serpro/lib/__tests__/procuracao.test.js",
    "apps/web/src/features/fiscal/serpro/lib/procuracao.js",
    "apps/web/src/features/fiscal/serpro/pages/__tests__/resultadosForaFiltro.test.jsx",
    "apps/web/src/features/fiscal/serpro/pages/renderSerproFuncoesPage.jsx",
    "apps/web/src/features/implantacao/__tests__/implantacaoNoOnboarding.test.jsx",
    "apps/web/src/features/onboarding/components/AbrirBiblioteca.jsx",
    "apps/web/src/features/onboarding/components/FluxoComercial.jsx",
    "apps/web/src/features/onboarding/components/FluxoComercial.shared.js",
    "apps/web/src/features/onboarding/components/FormularioContrato.jsx",
    "apps/web/src/features/onboarding/components/PainelComercial.jsx",
    "apps/web/src/features/onboarding/components/PassosDoLead.jsx",
    "apps/web/src/features/onboarding/components/RecursosComerciais.jsx",
    "apps/web/src/features/onboarding/components/__tests__/PassosDoLead.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/bibliotecaMensagens.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/coerenciaComercialP0.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/entradaCliente.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/fluxoComercial.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/formularioContrato.test.jsx",
    "apps/web/src/features/onboarding/components/__tests__/recursosComerciais.test.jsx",
    "apps/web/src/features/onboarding/pages/renderOnboardingDetailPage.jsx",
    "apps/web/src/features/whatsapp/components/AtendimentoComercial.jsx",
    "docs/diagnostico-contato-procuracoes-20261020.md",
    "docs/revisao-comercial-procuracoes-20261020.md"
  ]
}
```

## Comportamento do conjunto preservado

| Requisito | Implementação e consumidores | Evidência a validar |
| --- | --- | --- |
| Rascunhos por ficha e etapa | FluxoComercial mantém etapas visitadas e acessíveis montadas; as ocultas ficam desabilitadas. Troca de ficha remonta o contexto. Etapas que perdem acesso saem da árvore. | Contrato → proposta → contrato conserva cargo; troca de ficha não herda edição; perda de acesso remove ações. |
| Proposta e modelo atuais | FormularioContrato identifica ficha, proposta, versão e opção aceita; seleção do modelo confere id/versão e compatibilidade. Modelo desaparecido não autoriza geração com seleção antiga. | Modelo alterado/ausente exige seleção explícita; rascunho permite prévia, geração exige aprovação; valores aceitos continuam protegidos. |
| Leitura e confirmação distintas | AcompanhamentoComercial exige leitura pronta para id/versão/revisão/API atuais. Descarta leitura tardia e conserva confirmação de POST lento na mesma ficha. Erros de leitura e comando têm estados separados. | Nova versão → falha → recuperação; polling durante POST com sucesso/falha; troca de ficha durante POST; nenhuma nova preparação automática. |
| Propagação sem recarregar página | Detalhe invalida acompanhamento mesmo quando a versão da ficha não muda; jornada e atendimento propagam leituras/ações, distinguindo polling. | Contato persistido aparece nos consumidores; rascunhos continuam em memória; polling não produz marcos comerciais. |
| Procuração documental versus operacional | marcadorProcuracao fornece rótulo documental para evidência ATIVA, vínculo confirmado, validade futura e data de consulta válida não futura. Carteira e Consultas usam a mesma projeção. | Com 24h ou mais permanece Revalidar e fora de Ativas; tentativa vinculada com erro/pendência prevalece; ausência de validade não vira ativa. |
| Conclusão com destino útil | PassosDoLead e FluxoComercial distinguem Implantação de Execução do serviço. Ficha abre área existente; chat aponta para `#implantacao`. | Navegação não conclui implantação/entrega nem converte para carteira. PF/avulso não recebe promessa de carteira. |
| Biblioteca existente | Atalhos abrem categoria por fragmento em `/biblioteca`; ações e ajuda variam por categoria. Variáveis permanecem em seção recolhível. | Modelos, catálogo, escritório e mensagens não se confundem; chaves fixas seguem no payload; aprovação não é implícita. |
| Texto legível e falhas explícitas | Apresentação traduz estados conhecidos e estrutura dados; valores desconhecidos permanecem identificáveis. Integração fiscal desativada orienta administrador da instalação e alternativa limitada existente. | Não substituir desconhecido por sucesso, inventar configuração de UI ou esconder custo/consequência. |

Fluxo PJ de transferência/empresa parada conserva nove etapas: CNPJ, procuração, situação fiscal, diagnóstico, apresentação, proposta, contrato, pagamento e implantação/execução. Abertura/PF conserva sete: dados iniciais, diagnóstico, apresentação, proposta, contrato, pagamento e implantação/execução. O teste do mapa cobre contagem e bloqueio das etapas futuras; não representa execução ponta a ponta de cada combinação.

As correções anteriores de TDZ no mapeamento, IDs locais via useId, Router nos testes e confirmação sob POST lento foram preservadas. Nesta rodada, a única edição de código é remover o comentário `eslint-disable-next-line no-await-in-loop` de Consultas. O aviso sem uso foi identificado no lint relatado pelo Principal em `.altan-governance/qa/parecer-visual-principal.txt`; o await sequencial permanece intacto. A tentativa local de repetir lint foi bloqueada antes da análise, conforme abaixo.

## Regras e limites operacionais

- **R02:** ausência/erro não representa vínculo inexistente, evidência fiscal válida, pagamento ou sucesso. Dados insuficientes continuam identificados.
- **R19/R20:** respostas antigas não devem substituir confirmações novas nem atingir outra ficha. Polling lê evidências; não cria assinatura, pagamento, contratação, vínculo ou consulta fiscal.
- **R22:** preservar rascunhos, foco, mensagens de falha, contexto e consequências; usar componentes e tokens existentes. O motivo de Revalidar aparece em texto em Consultas; na carteira compacta fica também em título/nome acessível, cujo tooltip não substitui informação visível no celular.
- **R27/R28:** aprovação do modelo, compatibilidade, proposta aceita, assinatura conferida, valores e pagamento aplicável continuam sujeitos aos controles existentes. Ganha não significa carteira ou implantação concluída. Exceção externa não é fabricada por navegação.
- **R31:** retomada/manualidade e histórico continuam preservados; este incremento não executa retomada, libera automação nem muda a pessoa ou atendimentos relacionados.

Segundo o pedido atual e o parecer do Principal, Neurogenesis já foi vinculada em produção antes deste executor, com autorização por solicitação direta. Esse é um fato recebido, não uma operação ou verificação desta rodada. Representação/aceite na Receita têm evidências próprias pendentes; contato não as comprova. Nenhum consentimento, cláusula, honorário, pagamento, evidência fiscal ou envio foi inventado. Guardas de identidade, poderes e revalidação backend de 24h permanecem inalteradas. V02/V03/V05–V08 continuam pendentes nos aspectos não decididos expressamente.

## Validação efetivamente disponível

Inspeção estática do diff combinado e dos pontos de integração acima, inventário Git e conferência SHA256 foram realizados. Foram tentados nesta rodada:

`git diff --check` e `git diff --check 48dc5efa` terminaram sem erros após as edições. O JSON documental foi parseado com PowerShell: 27 caminhos, todos existentes e nenhum caminho do diff combinado ausente do inventário. Essa checagem não comprova que o plano executável do runtime contém os mesmos caminhos.

1. Na raiz: `node scripts/governance/check.mjs plan --base 48dc5efa`.
2. Em `apps/web`: `node ../../node_modules/eslint/bin/eslint.js src/features/fiscal/serpro/pages/renderSerproFuncoesPage.jsx`.
3. Na raiz: `npm test --workspace apps/web -- --runInBand --runTestsByPath`, com os 12 arquivos de teste listados no inventário `paths`.

Os três comandos terminaram com código 1 antes de analisar/executar, por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'` no Node v20.20.2. Portanto não há testes, lint ou gate de impacto aprovados pelo executor nesta rodada. Não houve ampliação de permissões nem tentativa de contornar o sandbox.

O parecer visual do Principal em `.altan-governance/qa/parecer-visual-principal.txt` relata fixture isolada em localhost, inspeções 1440/390, preservação de cargo e cadastro, recuperação de falha de leitura, ausência de IDs duplicados, nove etapas PJ e reinspeção de Biblioteca/PF final. Cita `contrato-recuperacao-1440.png`, `contrato-390.png`, `biblioteca-contrato-1440.png`, `biblioteca-contrato-390.png` e `etapas-transferencia.json`. Essas evidências foram recebidas pelo relatório; o executor não repetiu a navegação nem inspecionou pessoalmente as imagens nesta rodada. Etapas artificialmente visitáveis e mocks não homologam backend, permissões reais ou integrações externas.

Runs anteriores não aprovam esta versão: B terminou por timeout; A2 foi interrompido e teve reprovação web por Router, além de revisão stale; o relato de 10978 testes API no checkout irmão não substitui o gate atual. A rodada rejeitada por escopo restrito a dois documentos também não fornece aprovação.

## Pendências, revisão e reversão

O Principal/controlador deve executar novamente, para o conjunto integral e fingerprint final, os gates aplicáveis do catálogo: governance-engine, api-regression, web-regression, portal-regression, web-build e portal-build. Usar mocks e bancos descartáveis quando exigidos. Revisores independentes de domínio, técnicos/UI/UX e sistêmico devem comparar as fontes completas com `48dc5efa`, incluindo working tree. Não há parecer de aprovação emitido pelo executor. Esta rodada não cria o registro de governança, pois esse caminho está explicitamente fora de sua autorização; cabe ao controlador registrar objetivo, impacto, evidências e pendências reais.

A revisão visual final do Principal permanece vinculada à versão final, conforme sua atribuição. Cobertura ainda precisa confirmar o conjunto após as correções nativas, inclusive pré-CNPJ/PF, modelo incompatível/rascunho/ausente, assinatura e pagamento aplicável, canal fechado/ausente e resultado incerto. A existência dos testes não equivale à sua aprovação.

Rollback em desenvolvimento: remover somente as alterações locais desta rodada (relatório, atualização histórica do diagnóstico e remoção do comentário) se necessário; para reverter o incremento funcional, preparar reversão seletiva dos 25 arquivos funcionais desde `48dc5efa`, conservando alterações concorrentes. Não usar reset global. Não há migração ou mutação de dados a desfazer. Integração/publicação e atos reais permanecem fora desta entrega.
