# PGDAS-2026-B3.3a — planejamento puro da remessa FS12

Base: `2cd0924498a6bb5d94cbfe0fe009c81559974595`. Escopo autorizado pelo proprietário e comentário PR297/6957496618: política pura, testes e minuta sem envio. Complementa a [caracterização B3.3](pgdas-2026-b33-protocolo-fs12.md), sem editar seus documentos ou contratos aprovados.

## Resultado e limite

`planejarRemessaFs12` pertence ao domínio Fiscal e não tem consumidor produtivo. Reutiliza a janela de `determinarPoliticaDeclaratoriaFs12` e a validação completa de `validarSerieManualFs12`. Não modifica B1, B31, B32, payloads, transportes, persistência, cálculos, Fator R ou anexos. Não há leitor de histórico, integração com DP/Drive/eSocial/Contabilidade ou alteração de interface.

Não há protocolo homologado para liberar remessa nem origem oficial mensal disponível em produção. Portanto **todas** as saídas mantêm `mesesPropostos: null`, `autorizaEfeitoFiscal: false` e os impedimentos permanentes `PROTOCOLO_REMESSA_NAO_HOMOLOGADO` e `ORIGEM_OFICIAL_PRODUTIVA_INDISPONIVEL`. Mesmo história completa concordante não permite concluir `[]` ou omitir `folhasSalario`. O parâmetro externo `homologado` não tem efeito. Ausência de erro não autoriza nenhum ato.

## Entrada local de análise

O contrato recebe fatos JSON; não é DTO público, prova de autenticação, assinatura digital nem protocolo externo. Um futuro coordenador terá de resolver identidade, autorização atual, origem e versão no servidor. Nenhum adaptador é criado nesta entrega.

| Campo | Contrato |
| --- | --- |
| `identidade` | `portalClientId`, `companyId`, `cnpj` normalizado de 14 dígitos, `competencia` AAAA-MM, `dataAbertura` civil AAAA-MM-DD. CNPJ é comparado exatamente, sem inferir identidade por similaridade; sua validação cadastral/autorização continuam no servidor. |
| `contexto` | Contexto B1/B31 completo: empresaId, competenciaApuracao, inicioAtividade, regimeDoPeriodo e exigenciaHistorica quando aplicável. Preservar `cadastro` quando fornecido pelo leitor existente. A abertura civil deve concordar com o mês e com o cadastro, se presente. |
| `revisaoManual` | Projeção da confirmação B31: id, escopo, revisao positiva, serie completa em centavos, serieHash, contexto/contextoRevisao, politicaVersao, autorId, confirmadoEm em ISO UTC com milissegundos. `origem: MANUAL_APURACAO` identifica o contrato analítico, não cria coluna ou produtor. |
| `revisaoVigente` | Referência independente da última confirmação, fornecida por leitura consistente do servidor: escopo, id, revisao, serieHash, contextoRevisao, politicaVersao, autorId e confirmadoEm. Snapshot antigo íntegro não comprova atualidade. Sem referência ou com divergência, interromper análise. Não obter esta referência copiando a entrada do navegador. |
| `calculoExistente` | `null` significa explicitamente que não existe cálculo ainda. Omissão é lacuna. Se existente: calculoId, calculoConfirmado e vinculo B32 com id, escopo, revisaoFs12, contextoHash, politicaVersao, calculoConfirmado e calculoHash. Não fabricar cálculo para preencher esse campo. |
| `historicoOficial` | Escopo, CNPJ, estado (`COMPROVADA`, `PARCIAL`, `DESCONHECIDA`, `DIVERGENTE`, `INDISPONIVEL`) e `meses`. Cada mês contém escopo/PA consultado, CNPJ, mes, valorCentavos, numeroDeclaracao, versaoDeclaracao e proveniencia. |
| `proveniencia` mensal | `tipo: SERIE_MENSAL_OFICIAL`, referencia, conteudoHash SHA256 e obtidoEm ISO UTC. Estrutura candidata para fixtures, não afirma disponibilidade de serviço. Índice, PDF, agregado, número ou resultado de tentativa não substituem essa evidência. |
| `historicoOficial.declaracoesVigentes` | Referências independentes de vigência: escopo/CNPJ/PA consultado, numeroDeclaracao, versaoDeclaracao, referencia, conteudoHash e verificadoEm. Cada prova deve coincidir com exatamente uma referência. Ausência, ambiguidade ou retificação exclui a prova; não escolher a versão maior. A capacidade de produzir essa evidência continua inexistente e não foi implementada. |

Recalcular os hashes locais usa SHA256 sobre JSON canônico com chaves ordenadas, conforme B31/B32; a série usa a ordem fiscal B1. Isso detecta adulteração em relação aos hashes recebidos, mas quem altera dados e hashes juntos não é autenticado por essa comparação. Hash de proveniência é somente referência ao conteúdo externo: a função não possui seu corpo nem o autentica. A origem alegada nunca remove os impedimentos permanentes. Datas de confirmação são fatos de entrada; não há relógio implícito ou verificação de atualidade em banco.

## Saída e precedência

`janelaFiscal` conserva a janela B1, mesmo quando a análise posterior é impedida. `politicaFiscal` registra versão/situação/regra. `mesesComProvaOficial` contém cópias dos registros estruturalmente válidos no escopo, inclusive valor divergente para conferência; o nome não certifica autenticidade remota. `fontes` separa fundamento B1, manifesto B33, revisão manual, vínculo e referências mensais. Sem histórico suficiente, uma lista de provas vazia significa nenhuma prova aceita na análise, nunca nenhuma folha devida.

Identidade/contexto inválidos interrompem a comparação; depois vêm série completa/revisão, vínculo existente e história. `analiseCandidata` compara cada mês como CONCORDANTE, DIVERGENTE ou SEM_PROVA_SUFICIENTE, sem sugerir subconjunto de envio. Histórico parcial permanece incompleto mesmo com rótulo de cobertura ambíguo. Duplicata igual ou divergente invalida a prova daquele mês, sem escolher versão recente. Mês fora da janela e identidade alheia geram impedimento. Ordem de entrada não muda o resultado; a função não altera objetos recebidos e a saída não compartilha suas referências.

O cálculo existente deve trazer `contribuinteCnpj` igual ao CNPJ analisado, além de PortalClient/PA, revisão e hashes coerentes. Cálculo legado sem CNPJ suficiente permanece não analisável neste contrato novo; isso não altera seu fluxo produtivo. O coordenador futuro deve obter as referências vigentes e verificar permissões, sem tratar este planejador como autenticação ou transação. A análise é relativa aos fatos recebidos, não promete validade futura.

PA10 preserva a exigência histórica B1 e não muda o despacho legado. PA11/12 continuam universais, inclusive atividade sem Fator R. 2027 permanece pendente B1. Abertura no próprio PA e abertura no meio do mês conservam pendências específicas enquanto o mês da abertura participa da janela; uma empresa antiga não recebe esse impedimento só por ter sido aberta depois do dia 1. Não fabricar meses anteriores, regime integral, rateio ou zeros. Uma revisão válida não comprova declaração, e vínculo histórico não é reatribuído a cálculo substituído.

### Matriz de decisão

| Cenário | Análise local | Remessa |
| --- | --- | --- |
| Série completa e revisão vigente, provas concordantes | Comparação mensal identificada | `null`: protocolo pendente |
| Zero explícito confirmado | Zero preservado, comparável a zero oficial | `null` |
| Valor ausente, série parcial ou mês duplicado | Recusa antes da comparação | `null` |
| Revisão substituída, mesmo valor | Recusa pela referência vigente | `null` |
| Cálculo com vínculo, CNPJ ou revisão incompatíveis | Recusa; não reatribuir cálculo | `null` |
| Histórico desconhecido/indisponível/divergente | Nenhuma prova promovida a atual | `null` |
| Prova parcial, duplicada ou de declaração retificada | Excluir prova insuficiente, registrar impedimento | `null` |
| Primeiro PA/meio do mês na janela | Janela B1 preservada; lacuna explícita | `null` |
| PA10 não sujeito à exigência histórica | `NAO_EXIGIDA` B1, sem mudar legado | `null`, não decide omissão |
| PA11/12, com ou sem Fator R | Exigência universal B1, sem decidir III/V | `null` |
| PA01/2027 | Homologação pendente, sem janela liberada | `null` |

As nove fontes oficiais foram reconsultadas em 17/11/2026 às 18:50:33 UTC pelo revisor Fiscal: HTTP 200 e tamanhos/SHA-256 iguais ao [manifesto B3.3](pgdas-2026-b33-fontes.json). Nenhum endpoint fiscal autenticado foi chamado. Permanecem as lacunas descritas na [minuta não enviada](pgdas-2026-b33a-minuta-consulta.md).

## Compatibilidade, evidência e rollback

Regras afetadas na análise: R01/R02/R04–R06/R19/R20 e seções 36/37, com limites B33. Nenhuma regra operacional produtiva muda. Fiscal é dono; API/documentação são caminhos diretos. Web e portal são consumidores conservadores do mapa, com impacto nulo: nenhum import, rota, UI ou contrato consumido foi alterado. Guias, Contabilidade, Operações, leitores e guardas continuam iguais. Sem layout alterado; validação visual não aplicável.

Testes adicionados cobrem zero/ausência, completude, precisão, duplicatas, adulteração, isolamento, determinismo, cópias, vínculos, abertura e matriz temporal. Comandos previstos: `npm test --workspace=@contabilidade/api -- --runInBand --runTestsByPath src/modules/fiscal/domain/__tests__/planejarRemessaFs12.test.js`; regressões devem incluir suítes B1/B31/B32 e `fs12B33Contrato.test.js`, sem banco/rede reais. Resultado efetivo de execução deve acompanhar o relatório do executor/controlador; existência de testes não representa aprovação.

O executor delegado encontrou EPERM em lstat no perfil Windows ao tentar executar comandos Node. O Principal executou os ensaios com suas permissões existentes, sem modificar as permissões dos agentes. O controlador iniciou planejamento, execução e gates: governança passou; foi interrompido pelo Principal durante a regressão ampla após uma falha focal e quatro achados independentes para correção. Estado bruto e logs foram preservados, sem declarar ready_for_human. O registro de governança e o PR distinguem testes finais das execuções interrompidas. Risco fiscal alto mesmo sem consumidores. Rollback: reverter somente os arquivos novos B33a; não há dados ou migrações a reverter. B3.3b, homologação, integração, publicação e consultas externas permanecem fora do escopo.
