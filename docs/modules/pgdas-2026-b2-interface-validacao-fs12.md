# PGDAS-2026-B2 — interface e validação mensal da FS12

Implementação local delimitada ao executor, sobre base indicada `9921eafad2aa537517d3aff8122fbe3449a0e482`. Não constitui aprovação técnica ou entrega homologada. Confirmação da main remota, registro de governança, capturas e PR pertencem ao Principal. O executor não criou commit, PR, publicação ou subprocessos.

Referência operacional consultada: snapshot integral fornecido ao executor e hash canônico conferido em 16/11/2026, `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`. Aplicam-se R01/R02/R19/R20/R22: identidade por empresa/período, ausência distinta de zero, revisão e estados de erro. Nenhuma nova decisão fiscal. Fontes tributárias são as já documentadas e inspecionadas em A/B1; não houve nova consulta externa ou homologação remota.

## Diagnóstico e plano prévio

O plano do Principal precedeu a implementação: conservar modal/tokens, consultar B1 por GET separado com ACCOUNTANT, ler cadastro/histórico por adaptador específico, apresentar rascunho sem promover origem ou conferência do navegador, manter novo cálculo bloqueado e preservar o envelope recuperado. Sem alterações em FechamentoService, payload, fórmula, regime, schema ou rotinas.

Antes: `FechamentoModal` mostrava a grade apenas quando havia atividade marcada com Fator R. O preenchimento vinha de `getDadosFechamento` → `ApuracaoConfigMemoryService.folhaMensal12`; o mapa por mês descartava duplicatas e `Number(folha[pa] || 0)` preparava doze zeros. O resultado recuperável tinha formulário próprio validado no servidor. `FolhaDerivadaService` fornecia comparação contábil, não prova fiscal. `FatorRService` resolvia agregado atual/anterior sem produzir série autenticada. `folhasSalarioSeAplicavel` filtrava pelo Fator R, sem a nova política temporal. Esses serviços permanecem intactos.

Depois: até 10/2026 conserva-se o fluxo histórico, inclusive sua caracterização conhecida; em 11/12 a nova seção independe do Fator R. Janela vem exclusivamente de B1 no servidor, com abertura e regime mensal comprováveis no cadastro. O rascunho começa vazio, aceita zero explícito, identifica pendência e não alimenta cálculo/salvamento/transmissão. Referências da memória ou do cálculo recuperado são separadas, com duplicatas/divergências visíveis. Nenhum agregado é distribuído e nenhuma soma contábil é promovida a prova. Em 2027 a tela informa homologação pendente e não calcula janela localmente.

## Contratos e arquitetura

| Dono / consumidor | Contrato e compatibilidade |
| --- | --- |
| Identidade / rota de escritório | GET `/firm/companies/:companyId/fechamento/:competencia/fs12`, guarda canônica `ACCOUNTANT`, `no-store`. `companyId` da URL é PortalClient. Query/body não fornecem evidência, regime ou autoria. Erro técnico retorna 503, não zero. |
| Cadastro / adaptador Fiscal | Resolve explicitamente PortalClient → Company; lê dataAbertura e RegimeHistorico. Leitura em transação RepeatableRead, sem escritas. Exige um período inequívoco cobrindo o mês inteiro, datas civis UTC normalizadas e revisão identificada. Não consulta regime atual como fallback nem importa regras NFS-e. |
| Fiscal / aplicação | `consultarFs12` recebe capacidades `lerContexto` e `agora`, coordena B1 com evidências vazias. Não há fonte mensal autenticada no contrato atual; `totalCentavos:null`, `autorizaEfeitoFiscal:false` e `permiteNovoCalculo:false`. Prisma e a transação ficam somente no adaptador; a composição conecta as capacidades. |
| Web / API real | Novo método GET, sem chamadas externas fiscais. Valida identidade/competência e formato da resposta; descarta resposta obsoleta. Não importa módulos de API nem replica a janela B1. |
| Web / modal | `Fs12DeclaratoriaPanel` organiza competências e rascunho; `fs12Formulario` interpreta valores de apresentação sem converter ausências. Novo cálculo bloqueado em botão e handler. Formulário recuperado continua exato, separado do rascunho; ações existentes dependem do mesmo calculoId e das guardas do servidor. |
| Mock | Resposta demonstrativa pendente sem inventar janela, histórico, origem autenticada ou sucesso. Não duplica regra fiscal. |
| Operações e demais consumidores | Compartilham o modal, recebendo a nova apresentação. Endpoints legados de cálculo/transmissão, workers, Guias, Contabilidade, pagamentos, portal e contratos comerciais não foram modificados. |

Vigência parcial (inclusive abertura no meio do PA), dados ambíguos, sobreposição ou datas não normalizadas ficam pendentes: B2 não decide enquadramento tributário desses casos. Sem regime/abertura suficientes não há janela fictícia. Referência cadastral não é comprovação oficial de folha.

O bloqueio de novo cálculo é deste consumidor web, não uma nova guarda fiscal global. Clientes antigos, Operações fora desse modal e rotas legadas mantêm contratos existentes. A nova consulta nunca confere ou autoriza fatos enviados pelo navegador. Um bloqueio servidor global ou adaptação do fechamento exige incremento/autorização próprios; não declarar proteção de todos os caminhos pelo estado visual.

## Plano visual implementado

Conservados Modal, Aviso, Button e posição da folha após as atividades. Seção única, título 600, labels 500, texto auxiliar .8125rem, tokens existentes de superfície/borda/texto/atenção/foco. Grade fluida de meses, alvos móveis de 44px, labels permanentes e erros associados por `aria-describedby`. Sem modal adicional ou checkbox de validação oficial. Resumo declara informados/esperados e indisponibilidade do total comprovado; não soma série não autenticada. As atividades continuam identificando Fator R, sem mudar III/V.

Rascunho é somente local e sua perda ao fechar/trocar contexto está explícita. Nova leitura descarta rascunho anterior para não reapresentá-lo sobre contexto cadastral atualizado. Troca empresa/PA remonta o painel; cleanup ignora respostas tardias. Repetir leitura após erro não consulta SERPRO. Cálculo recuperado informa que as ações continuam utilizando exclusivamente os dados anteriores.

## Evidências e validação

Testes adicionados: aplicação B1 integrada à leitura; adaptador por identidade, vigência e ambiguidade; HTTP com guarda real e composição mockada; parsing ausência/zero/duplicatas; contrato mock; modal com/sem Fator R, memória, zero, série incompleta, sem movimento, erro/retry, resposta tardia, troca de empresa/PA, cálculo recuperado, declaração transmitida, foco e Escape. Testes B1 existentes continuam responsáveis pelas evidências conferidas, conteúdo/origem/revisão alterados e total exato; nenhuma interface B2 fabrica tais fatos.

A caracterização A mantém a asserção de zeros até outubro. Para novembro/dezembro/2027 passa a exigir apresentação declaratória e ausência de chamada de cálculo: alteração intencional de comportamento, não remoção silenciosa da verificação.

Comandos tentados pelo executor:

- `node scripts/governance/check.mjs plan --base 9921eafad2aa537517d3aff8122fbe3449a0e482`: não iniciou, EPERM em `lstat C:\Users\yagoa`.
- `npm test --workspace apps/web -- --runInBand pgdas2026FolhaCaracterizacao`: não iniciou, mesmo EPERM, antes da edição.
- `npm test --workspace apps/api -- --runInBand consultarFs12 leituraContextoFs12 apuracaoFs12 politicaDeclaratoriaFs12 evidenciaMensalFs12`: não iniciou, mesmo EPERM.
- `git diff --check`: passou no diff local.

Nenhum teste Jest é declarado aprovado pelo executor. Principal deve executar novos testes e regressões de Apuração/Fator R/fechamento/Operações, build, plano/diagnóstico arquitetural e gates; inspecionar capturas desktop/celular, teclado, overflow e estados. A revisão estática de CSS e os testes escritos não substituem capturas. Não foram realizadas chamadas SERPRO ou acessos a dados reais. Na entrega do executor, os pareceres independentes ainda estavam pendentes; veja o fechamento posterior abaixo.

## Limites, aceite e rollback

Dependências de B3 ou incremento próprio: fonte mensal autenticada, persistência/auditoria da conferência e revisão, comprovação cadastral insuficiente/ambígua, revisão de integração ao cálculo e cardinalidade do provedor, novas regras de 2027. Não inicia B3 e não usa confirmação do navegador como prova fiscal. Não altera cálculo anteriormente aprovado ou declaração transmitida, nem provoca retificação.

Aceite exige execução real dos testes listados, capturas e revisões Fiscal/UI/UX/arquitetura/segurança, sem novos contratos sensíveis fora do escopo. Até então, implementação candidata. Rollback: reverter apenas os arquivos B2 do diff e restaurar a caracterização A; remover novo GET e método correspondente conjuntamente. Não há migração, dados persistidos, agenda ativada ou efeitos externos a desfazer. Não reverter trabalhos concorrentes.

## Fechamento da validação pelo Principal — 16/11/2026

Base remota confirmada: `9921eafad2aa537517d3aff8122fbe3449a0e482`. Branch `codex/pgdas-2026-b2-20261116`, worktree própria. Referência operacional canônica e snapshot: SHA-256 `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`.

- Antes: API 560 aprovados/32 suítes e9 PostgreSQL ignorados; web58 aprovados/8 suítes. Dependência local faker inicialmente ausente foi resolvida pela dependência existente da worktree de referência; nenhum pacote versionado alterado.
- Depois: API596 aprovados/36 suítes e mesmos9 PostgreSQL ignorados; web592 aprovados/51 suítes, incluindo Operações. Novos testes HTTP executam roteador e guarda reais com banco/composição simulados. Ensaio do adaptador comprova as duas leituras no mesmo cliente RepeatableRead por double; não representa teste PostgreSQL real.
- Governança88 aprovados; analisador5 aprovados. Diagnose5023→5023, zero novas violações. A consulta e a abertura da transação ficam em infraestrutura; a interpretação cadastral conservadora está em `domain/contextoMensalFs12.js`.
- Dez cenários visuais desktop/mobile sem overflow, erros JS ou violações axe. Teclado/foco/erro associados verificados em1440,390 e720px;720é ensaio de largura reduzida, não teste de zoom nativo. Não houve teste NVDA nesta entrega.
- Ajustes de revisão: aviso de rascunho antes dos campos; orientação própria quando não há janela; interpretação de vigência isolada; fixtures de teste corrigidas sem mudar permissões ou regras fiscais.

Controlador `2026-11-16T17-06-59-960Z-205d2bbf`: terminou **escalated**, timeout de600s do executor, após EPERM no Node do subprocesso. Não concluiu seus gates/juízes e não produziu `ready_for_human`. Principal concluiu ajustes e validação com revisões independentes reais Fiscal/segurança, UI/UX e arquitetura/sistêmica. Resultados locais não substituem CI hospedada; Build aprovado (avisos legados de tamanho de bundle/imports mistos). Pareceres independentes Fiscal/segurança, UI/UX e arquitetura/sistêmica favoráveis após correções; workflows do SHA são registrados no PR.

### Evidências visuais sintéticas

Mesma aplicação, Modal, tokens e CSS reais; APIs em memória, empresa fictícia e rede externa bloqueada. A captura após rolagem mostra o painel no modal; não é uma página separada.

| Estado | Desktop | Celular |
| --- | --- | --- |
| Antes,11/2026 sem Fator R | [captura](../design/evidencias/pgdas-2026-b2/antes-desktop.png) | [captura](../design/evidencias/pgdas-2026-b2/antes-mobile.png) |
| Depois, série ausente | [captura](../design/evidencias/pgdas-2026-b2/depois-desktop-vazia.png) | [captura](../design/evidencias/pgdas-2026-b2/depois-mobile-vazia.png) |
| Início de atividade, zero explícito | — | [captura](../design/evidencias/pgdas-2026-b2/depois-mobile-inicio.png) |
| Cálculo recuperado preservado | [captura](../design/evidencias/pgdas-2026-b2/depois-desktop-recuperado.png) | Inspeção local também realizada |

Capturas comprovam apresentação, não autorização fiscal; testes específicos comprovam a preservação dos argumentos do cálculo recuperado. Revisores inspecionaram código/artefatos, sem alegar reexecução própria. Nenhum efeito real ou mudança no Railway. B3 permanece não iniciado.
