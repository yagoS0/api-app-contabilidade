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
