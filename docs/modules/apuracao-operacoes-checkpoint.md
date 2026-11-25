# Checkpoint — Apuração em Operações

Atualizado em 25/11/2026. Entrega incremental, sem aprovação integral da E2 ou de produção.

## Incremento concluído

- Operações mantém o imposto do cálculo transmitido quando há prova causal autenticada, B32/B33 e snapshot correspondente. Histórico somente de leitura não autoriza novo despacho.
- Confirmação fiscal permanece visível com pendência documental. Registro externo fica desabilitado quando a própria transmissão já está confirmada.
- Modal reconhece a resposta causal E2 aninhada, preserva retorno legado até PA10/2026 e recusa confirmação incompleta/2027.
- Impacto: cumprimento de R01/R02/R19/R22 e seção38; nenhuma nova regra operacional. Proteções fiscais, pagamento e contabilidade preservadas.

## Validação reutilizável

Evidências locais em `.altan-governance/e2-validation/final-focal/`:

- `history-api.json`: 35 aprovados, 2 condicionais ignorados; esses dois foram executados em `history-consultas-pg.json` (23 aprovados na suíte completa).
- `history-web.json`: 69 aprovados; `transmission-ui-contract.json`: 14 aprovados.
- `history-custody.json`: 21 aprovados e 2 recusados por configuração de ambiente; `history-custody-pg-explicit-env.json`: os 2 aprovados com URLs explícitas iguais, sem alterar testes.
- Navegador/API/PG reais, provedor fiscal simulado: `e2e-evidence/e2-20261125-256d2053/browser-confirmed-history-324ad9ac-c491-415a-af0d-5041597001e4/report.json` aprovado em desktop/mobile antes/depois de recarga.
- Revisões delimitadas existentes: `review-confirmed-history-static.json` e `review-transmission-ui-contract-static.json`; não repetir sem mudança relevante.

## Cálculo em lote — validação funcional concluída em 25/11/2026

Implementação existente validada sem nova alteração produtiva: Calcular abre a prévia individual; Calcular selecionadas e Confirmar cálculo processam cada empresa com identidade própria. Sucesso parcial não é perdido quando outra empresa falha. Não há mudança de regra operacional; R01/R02/R19/R20/R22 e seção38 preservadas.

Campanha sintética `e2-20261125-256d2053`, PA11/2026, casos T156.7/T156.2/T159.2. A preparação anterior foi concluída: prova de zero despachos nas tentativas antigas, histórico PA10 pela API com `somenteDocumentos:true`, correção somente da classificação sintética para o CNAE existente. Requests antigos REVIEW e FS12 revisão1 preservados. Não repetir esses pedidos nem apagar os arquivos `.once.json`.

Resultado: T156.7 CALCULATED com snapshot/vínculo FS12; T156.2 recusa MSG_ISN_029 recuperada para REVIEW pela evidência causal; T159.2 permanece UNCERTAIN/DESCONHECIDA, bloqueada para repetição. Exatamente um comando SIMULAR e um despacho por empresa, sem transmissão real. Recarga da interface e dois reinícios da API preservaram os resultados; reconciliação não gerou chamadas adicionais ao provedor.

Evidências no diretório da campanha:
- `browser-batch-v2-299381a5-2ce4-4a6d-b79e-5200ce6a1bca/report.json`: PASS, lote e recarga por navegador/API/PG reais.
- `operations-batch-v2-readback-c51f4630-c885-4b82-9578-e7bf8ec3fd85.json` e `operations-batch-v2-readback-354164e6-7cf2-42f8-9e69-b2cf3489ae5f.json`: PASS, custódia/envelope/FS12/snapshot e preservação após reinício. A ordem de referência está no campo previousEvidence do segundo relatório.
- `operations-batch-reconciliation-reconcile-e4f78407-9939-4f0b-9b5d-56b177f3a5cc.json` e `operations-batch-reconciliation-after-restart-98ef84ea-6748-4c83-98d0-4ae0c88c59db.json`: PASS, recusa causal e desconhecido preservados sem reenvio.
- `.altan-governance/e2-validation/final-focal/batch-api.json`: 47 testes aprovados (CalculationService/Recovery).
- `.altan-governance/e2-validation/final-focal/batch-web.json`: 32 testes aprovados (Batch/Recovery/Selection). Nenhuma suíte integral executada.

Falhas de preparo preservadas: primeira inicialização da API não ficou pronta; segunda inicialização aprovada. Uma chamada do verificador foi recusada antes de ação por caminho ausente; corrigido o nome do artefato. Nenhuma delas repetiu cálculo fiscal. Provedor simulado: valores não homologam tributação nem comprovam prontidão produtiva.

## Próximo incremento

Validar o caminho Fator R/FS12 de conferência e transmissão pela interface, reutilizando `prepared-factor-r-ui-transmission` (ainda parcial, não aprovado), sem repetir o lote já concluído. E3, 2027, provedor real e permissões produtivas permanecem fora desta entrega. PR319 depende da base PR318; sem merge/deploy. Código funcional mantido em ef2724e e na base 424d0588; este incremento encerra a validação integrada e atualiza somente este checkpoint.

## Estado de execução e limites

- Controlador `runs/2026-11-25T15-16-43-581Z-4fa57639` interrompido pelo Principal enquanto aguardava complementares, conforme nova orientação incremental. Nenhum gate integral foi iniciado/aprovado neste run; journal e evidências preservados.
- Servidores sintéticos encerrados; PG54661 e bancos preservados. Nunca usar PG57514, reservado ao chat Comunicação.
- Três revisores/executores nativos atingiram limite de uso; não contabilizar suas tarefas incompletas como aprovadas.
- Regressões integrais ficam para integração. Homologação com provedor real, permissões produtivas, E3 e 2027 continuam pendentes. Nenhum merge, deploy ou ato fiscal real autorizado.
- Método atual: diagnóstico reaproveitado, escopo limitado, testes focais e revisão proporcional. Relato curto com funcionalidade, arquivos, testes, pendências, próximo incremento e PR/commit.
