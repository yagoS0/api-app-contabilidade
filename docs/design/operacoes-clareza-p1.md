# P1 — clareza operacional, evidências e avisos

Base remota confirmada: `cbea0e52fb2d75327056067283759b3a73c9a3cc` (PR #287). Branch `codex/operacoes-clareza-p1-20261115`, worktree `worktrees/operacoes-clareza-p1-20261115`. A autorização atual do usuário libera este recorte de apresentação; os limites históricos da F1 não impedem P1 nem autorizam P2.

## Contratos e impacto

| Superfície | Dono / contrato existente | Mudança e preservação |
| --- | --- | --- |
| Avisos | Notas/Fiscal grava `PendenciaPosFechamento`; `GET /firm/operacoes/avisos` aplica `empresasVisiveis`. `OperationsAlerts` apresenta em Operações. | Situação registrada, empresa/competência, observação integral e orientação de conferência. Estado desconhecido não afirma fechamento. Links, paginação de 200, polling e descarte de resposta tardia preservados. Não resolve avisos nem consulta Fisco. |
| Conferência | `readCalculationDetails` fornece snapshot, auditoria e histórico independentes. `CalculationEvidence` é consumido por `OperationsCalculationDetails` e `OperationsApproval`. | Fontes disponíveis, parciais, ausentes e com erro identificadas; traduções de motivos existentes. Preservados leitor, revisão, `approvalEvidenceError`, comandos e números. |
| Layout | Componentes React e tokens existentes. | Seções de conferência, foco inicial no resumo, tabelas vazias retiradas da navegação e indicação de rolagem móvel. Três containers, indicadores e seus conjuntos intactos. |

O aviso descreve o estado registrado na criação, não uma nova consulta do estado fiscal. Não se deduz causa a partir de texto livre. `CONFERIDA` significa verificação realizada, não aprovação humana; `NAO_CONFERIVEL` não cria bloqueio tributário. Histórico limitado aparece como parcial. Ausência não vira zero ou não aplicável. Simulação, retorno salvo e extrato continuam separados; número/valor iguais não comprovam vínculo com a revisão atual.

Nenhum diff em API, schema, leitores, autorização, reservas, idempotência, pagamento, provisão, fechamento, duplicatas, recuperação, worker ou transporte. Não há nova dependência de domínio/infraestrutura. O plano técnico e o fluxo completo da alternativa B permanecem para incrementos próprios.

## Caracterização e validação

- Antes da edição: 72 testes existentes em cinco suítes (avisos, detalhe, operações de leitura, layout e evidências).
- Candidata inicial: 150 testes em sete suítes, incluindo confirmação e integração do consumidor.
- Regressão final de Operações: 36 suítes, 458 testes aprovados. PostgreSQL 16 descartável: 10 testes de OperationsBatchService aprovados; cluster exclusivo encerrado após o ensaio, sem remover os arquivos.
- Novos testes cobrem estados conhecidos/desconhecidos, observação literal, empresa/competência dos links, carregamento/zero/falha, foco/retorno, fonte ausente/erro, zero monetário, motivos de auditoria, histórico parcial e tabelas vazias.
- 93 testes de governança; build web aprovado. Aviso de bundle grande preexistente, sem mudança de dependências.
- Diagnose: 5023→5023, zero novos achados. Fonte-base de API/verificador conferida como idêntica ao commit de referência; frontend avaliado também por diff e revisão independente.
- Resultados finais de regressão, PostgreSQL e CI estão no PR desta entrega. Nenhuma execução interrompida conta como aprovação.

## Evidências visuais e reprodução

Ensaios em Chrome, componentes React reais e CSS do aplicativo, somente loopback, dados sintéticos e serviços simulados. Comparação antes/depois usa as mesmas fixtures e dimensões. A página completa foi capturada em modo mock, com os três containers. As superfícies delimitadas cobrem avisos, vazio, falha, conexão ausente, carregamento, evidência, fonte parcial e ausência em 1440/390/360.

Para reproduzir manualmente em desenvolvimento isolado: abrir Operações, abrir Notas para revisão, percorrer tabela com teclado/rolagem, conferir empresa/competência e fechar com Escape. Na conferência, verificar as fontes e uma falha parcial; abrir e retornar sem confirmar/transmitir. Usar somente fixtures/doubles para esses cenários. O foco de abertura deve ficar no início, sem saltar para tabela vazia. Conferir zoom 200%, retorno ao gatilho e ausência de rolagem global nas superfícies alteradas.

O ensaio inicial no consumidor real `OperationsApproval` reproduziu foco em extrato vazio e scroll de 795/817 px em 390/360. Após o ajuste local, foco em “Fontes da conferência” e scroll 0 nas três larguras. O `Modal` compartilhado não foi alterado.

| Comparação | Antes | Depois |
| --- | --- | --- |
| Página desktop | [Antes](evidencias-operacoes-p1/before-page-1440.png) | [Depois](evidencias-operacoes-p1/after-page-1440.png) |
| Página celular | [Antes](evidencias-operacoes-p1/before-page-390.png) | [Depois](evidencias-operacoes-p1/after-page-390.png) |
| Avisos desktop | [Antes](evidencias-operacoes-p1/before-alerts-1440.png) | [Depois](evidencias-operacoes-p1/after-alerts-1440.png) |
| Avisos celular | [Antes](evidencias-operacoes-p1/before-alerts-390.png) | [Depois](evidencias-operacoes-p1/after-alerts-390.png) |
| Conferência desktop | [Antes](evidencias-operacoes-p1/before-evidence-1440.png) | [Depois](evidencias-operacoes-p1/after-evidence-1440.png) |
| Conferência celular | [Antes](evidencias-operacoes-p1/before-evidence-390.png) | [Depois](evidencias-operacoes-p1/after-evidence-390.png) |

24 cenários de componente: zero violações automáticas axe WCAG 2/2.1 A/AA, erros JavaScript, tráfego externo ou overflow global. [Resultados](evidencias-operacoes-p1/after-validation.json). [Fonte parcial em 360 px](evidencias-operacoes-p1/partial-360.png), [consumidor real](evidencias-operacoes-p1/consumer-opening-390.png) e [zoom real 200%](evidencias-operacoes-p1/zoom200-partial.png), [medição](evidencias-operacoes-p1/zoom.json). Esses ensaios não equivalem a certificação de acessibilidade.

## Governança e limites

Revisões independentes finais em 15/11/2026: `p1_contratos` (Operações/Fiscal), `p1_ui` (UI/UX) e `p1_arquitetura` (arquitetura/segurança) favoráveis, sem bloqueios no diff revisado. Revisores inspecionaram código e evidências; não reexecutaram as suítes. UI/UX examinou capturas antes/depois e consumidor real. Os ajustes solicitados de histórico parcial, foco e rolagem foram incorporados. Focal final: 59 testes aprovados. Pareceres autorizam recomendação de rascunho, não integração ou P2.

O controlador executável foi iniciado; planner/executor concluíram e o gate de governança passou. A API ampla recusou execução de uma suíte por falta do PostgreSQL descartável obrigatório. O principal interrompeu a rodada durante os gates, preservou logs privados e preparou banco novo para a suíte. O checkpoint `testing` não é resultado final; **não há declaração de `ready_for_human`**. O EPERM do executor Windows e a interrupção estão registrados na mudança. Revisões nativas independentes complementam, sem simular conclusão do controlador.

Sem certificação WCAG, ensaio em telefone físico ou nova homologação NVDA contínua. Overflow preexistente da página completa em 360 px não foi corrigido por CSS global. O PR permanece em rascunho para revisão humana; CI não autoriza integração.

Rollback: reverter apenas este incremento de apresentação e testes. Nenhuma reversão de dados necessária. Não publicar, limpar worktrees, reativar Railway ou iniciar P2.

## Revisão de coordenação do PR #288 — 15/11/2026

Atende ao [comentário de coordenação](https://github.com/yagoS0/api-app-contabilidade/pull/288#issuecomment-6900075941). Esta seção complementa, sem apagar, o histórico anterior.

- `TRANSMITIDA`: “Transmissão registrada na época do aviso”. A consulta continua sendo de evidência histórica; não confirma situação fiscal atual.
- O título das fontes e o carregamento passam pela sequência de Tab. O mesmo `h3` permanece montado na transição carregando → conteúdo/erro, preservando foco e identidade DOM. Não houve mudança no Modal compartilhado, leitores, guardas ou efeitos.
- 109 testes focais aprovados, incluindo sucesso/erro, identidade do nó e navegação. Diagnose 5023→5023, sem acréscimos.

### Acessibilidade: investigação dos inconclusivos

[Relatório detalhado](evidencias-operacoes-p1/accessibility-review.json): 48 cenários comparados (24 da main e 24 da candidata anterior à correção), análise final, elementos, mensagens axe, cores, fragmentos visíveis, teclado, consumidor e hashes dos dois componentes. O arquivo anterior da base não executava axe; portanto não provava equivalência. Essa lacuna foi suprida, não inferida.

| Ocorrência | Origem e resultado |
| --- | --- |
| `scrollable-region-focusable`, cenário sem evidências | Introduzido pela composição P1 após remover tabelas vazias. Reproduzido Tab saindo para body; corrigido com título na sequência de Tab. Resultado final não contém esse inconclusivo. Home/End percorrem o corpo, Tab chega a Fechar e Shift+Tab retorna ao título em 1440/390/360. |
| Perda de foco ao concluir carregamento | Introduzida pela troca do elemento focado `p` por `h3`. Corrigida mantendo `h3`; teste de identidade DOM e foco para conteúdo/erro. Ensaio de navegador confirma Tab e Escape com retorno ao disparador. |
| `color-contrast`, botão `✕` | `nonBmp` na base e candidata: axe não interpreta o símbolo. Cores renderizadas sobre fundo opaco resultam em 7,45:1; nome acessível Fechar preservado. Inconclusivo automático permanece registrado. |
| `color-contrast`, parágrafo introdutório móvel | `elmPartiallyObscuring` na base e candidata. `contrastRatio: 0` é medição inconclusiva, não contraste zero real. Cores efetivas: 14,06:1, sem imagem/opacidade no fundo da caixa. |
| `color-contrast`, dica móvel nova | Mesmo diagnóstico automático, revisado separadamente: 7,45:1, texto visível nas capturas e fragmentos sem obstrução em 390/360. Não foi ocultado o elemento nem desativada a regra. |
| Escape no consumidor OperationsApproval | Retorno ao body reproduzido na main e candidata em 1440/390/360. Limitação preexistente do consumidor; não foi ampliada nem corrigida por este P1. Dentro do diálogo, 16 passos Tab/Shift+Tab permanecem contidos. |

24 cenários finais continuam com zero violações detectadas, mas **24 ocorrências de contraste inconclusivo permanecem** (algumas com mais de um nó). A investigação manual não apaga o resultado da ferramenta nem constitui certificação WCAG/NVDA. [Aviso final em 360 px](evidencias-operacoes-p1/after-alerts-360.png).

### Gates e estado real do controlador

Execução `2026-11-15T19-58-04-602Z-72db47ed`, rodada 0, fingerprint `3f024fe5e2fcaf4a3b13f047a0bf01854f3e09d6579fd68424c0c9c202fa4acd`, HEAD de partida `e7c5c7b9f049e441998c7dd53737d5a37f49d38d` mais o ajuste de carregamento. O catálogo não foi modificado.

[Extrato verificável dos gates e pareceres](evidencias-operacoes-p1/governance-review.json), sem pedido privado ou logs brutos. A documentação foi complementada após os ensaios; os hashes dos componentes no extrato e no relatório de acessibilidade permitem conferir a mesma versão produtiva.

| Gate | Resultado efetivo |
| --- | --- |
| governance-engine | 88 testes aprovados |
| api-regression | 32 lotes; 13.094 testes aprovados, 84 ignorados; 771 suítes aprovadas e 11 ignoradas; zero falhas |
| web-regression | 24 lotes; 6.969 testes, 588 suítes; zero falhas/ignorados |
| portal-regression | 5 lotes; 1.610 testes, 102 suítes; zero falhas/ignorados |
| web-build | Aprovado; avisos de bundle registrados |
| portal-build | Aprovado |

PG16 exclusivamente descartável e loopback; banco próprio na porta 54661, com as três variáveis de teste coerentes, atende à URL literal exigida pelas suítes legadas. Ambos os clusters criados para P1 foram encerrados ao terminar e preservados em disco. Nenhum banco existente ou produtivo foi alterado.

Os três pareceres de domínio e os pareceres de backend, UI e UX do controlador aprovaram a rodada. O revisor sistêmico ficou **inconclusivo** por não encontrar a investigação final de navegador no pacote documental disponível. Os ensaios já existiam fora do Git e estão anexados nesta revisão. O principal interrompeu a repetição automática seguinte para consolidá-los, preservando os registros; o checkpoint `testing` da rodada seguinte não é prontidão. **Não se declara `ready_for_human` do controlador.** Os seis gates completos da rodada 0 não são substituídos pelos testes focais.

Histórico das tentativas: `19-39-28-690Z-33b0592e` interrompida após falta de igualdade DATABASE_URL/URL descartável; `19-43-35-674Z-7e1ead29` interrompida após bloqueio pela URL literal no lote 13; `19-56-56-254Z-97e420d3` terminou `escalated` por arquivos-alvo já modificados. Correções foram preservadas em commit local antes da rodada integral. Nenhuma tentativa interrompida conta como aprovação.

A decisão sistêmica final sobre o pacote documental complementado depende da revisão independente registrada no PR e da decisão humana de integração, conforme POLICY/REVIEW-CONTRACT. Não há dispensa concedida pelo autor nem alteração de gate. CI e SHA final constam no PR; publicação e P2 continuam não autorizados.

Parecer sistêmico complementar `/root/p1_arquitetura`, 15/11/2026: favorável à entrega revisável após inspecionar este documento, os dois relatórios, o diff e a igualdade dos hashes. A lacuna documental foi suprida; nenhum bloqueio adicional de implementação. O parecer não altera o histórico do controlador, não certifica a rodada interrompida e não autoriza integração. Revisão UI/UX final favorável à continuidade de foco; revisão Fiscal/Operações favorável à semântica histórica. CI no SHA final e decisão humana permanecem necessárias.
