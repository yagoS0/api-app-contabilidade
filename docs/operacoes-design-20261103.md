# Estado atual da integração — 03/11/2026

Complemento do PR #251: o CI revelou `bad XRef entry` na leitura fria de um PDF sintético válido. A reprodução independente isolou a incompatibilidade do tipo Buffer no leitor antigo, sem relação demonstrada com PostgreSQL ou offsets do arquivo. O consumidor PGDAS agora entrega uma cópia exata em Uint8Array ao mesmo parser. A fixture usa PDFKit já existente e preserva todas as verificações, acrescentando receita, imposto e identidade da declaração. Os dez cenários PostgreSQL do candidato passaram. Não há nova regra fiscal, nova dependência, repetição automática ou consulta real. O CI do código corrigido permanece obrigatório; os três resultados falhos anteriores são preservados.

Os 17 arquivos de correção e os dois ajustes posteriores de testes foram aplicados e revisados. O relato abaixo é histórico da preparação; suas menções a checkout congelado e candidatos não aplicados não descrevem o estado atual.

A API tem cobertura completa de 721 suítes: 12.290 testes aprovados e um teste herdado pendente. Governança (85), portal (1.586) e ambos os builds passaram localmente. A regressão integral da interface será concluída pelo CI oficial sobre a versão integrada com a main; a execução local parcial e suas falhas anteriores permanecem preservadas. O teste atualizado da página passou em 30 casos isolados e recebeu revisão independente. As provas visuais compatíveis e o complemento de Transmitido em computador/celular foram preservados.

O usuário autorizou seguir até a publicação, condicionada aos checks e pareceres finais. Esta nota não declara CI aprovado, merge ou deploy concluídos. As automações continuam dependendo de habilitação explícita; nenhuma ativação, mensagem ou operação fiscal real foi executada nesta validação. Guru permanece em conferência, eNotas ativo e benefício pendente; Sintropia permanece fora da ativação de lembretes.

Registros detalhados: output/rotinas-operacoes-design-20261103 no workspace; resultados complementares não alteram retroativamente os runs interrompidos. O registro de governança da integração e o CI indicarão a versão efetivamente aprovada. Não há nova regra operacional nesta atualização documental.

---

## Histórico preservado da preparação

# Operações D1–D3 — candidato de 03/11/2026

Status: **implementação candidata, não aprovada, não ready_for_human**. Checkout WEB congelado na segunda rodada. Nenhum commit, deploy, ativação, consulta fiscal real, mensagem ou alteração de governança foi executado pelo autor frontend. API pertence a outro autor; seus achados e candidatos não estão aprovados por este relatório.

Base R2D: `d216fe980baf30efdaa3b9af0bc546bcbcbf09b8`. Regras canônicas e locais conferidas anteriormente, SHA256 `5b8a7f46c3065e4fc92b7c9611601ac3fd2d086f942b757ed4ef34f4e4f3721b`. Referências HTML/CSS/JS e capturas preservadas estão disponíveis em output; a afirmação do relatório parcial anterior de que estavam ausentes não descreve esta execução. Não restaurar cópias antigas de CompanyAutomation/realApi/OperationsGuides.

## Delta frontend

- D1: Calculado com receita/imposto/avisos/erros e confirmação explícita da revisão sem transmitir; Confirmado com seleção manual, evidência de autor/data vinculada ao fingerprint e acesso independente a Liberar rotina (todas as confirmadas elegíveis, sem restringir à seleção). Detalhe anterior e fallback de leitura preservados. Transmitido consome DTO documental dedicado, revisão histórica, PDF e ZIP por vínculo, sem texto fiscal fictício.
- D2: composições específicas Disponível/Enviado/Pago, expectativa de guia distinta da lista documental, datas civil/instante e valor pago desconhecido distintos do nominal, histórico e paginação de evidências. Seleção por empresa da competência, consulta explícita de OPEN, captura das integrações existentes e prévia do envio com token/revisão/destinatários. Ações são chamadas somente após confirmação; espécies sem integração remetem ao fluxo individual. **Há correção adicional isolada obrigatória descrita abaixo**.
- D3: Procuração usa leitura salva, vínculo/24h/validade e consulta explícita selecionada; SITFIS permite consulta sem PDF e mantém downloads autenticados, cache e job retomável; gráficos têm legenda visível e parcelamento neutro; Rotinas conta empresas distintas no cartão e ocorrências no detalhe. Destinos conservam companyTabPath e competência.
- Mock dedicado aditivo para leituras documentais locais/ausência explícita e recusa de envio; não inventa transmissão nem arquivo fiscal. Não alterados CompanyAutomation, CompanyGuideTracking, motores fiscais ou serializers dos portais.

## Verificação efetivamente executada

1. Parsing Babel dos módulos de Operações passou.
2. Primeira rodada Jest WEB: 93/112, 8/10 suites. Resultado retornado no PTY; não há JSON/log persistido dessa primeira rodada. Não simular prova inexistente.
3. Segunda rodada: **144/145, 11/12 suites**, em `output/rotinas-operacoes-design-20261103/web-focais-v2.json` e `.log`. Única falha: prefixo da mensagem de Guias sem API deixou de corresponder ao fallback anterior. Esse é o estado congelado atual.
4. Reparo subsequente chegou a ser aplicado e testado antes de a mensagem de parada ser recebida: **30/30**, Guides+operacoes, `web-fallback-v3.json/.log`. Após a parada, foi preservado externamente e revertido somente o último delta. Esta prova refere-se ao candidato preservado, não ao checkout atual nem a aprovação. Ela não foi originalmente executada em árvore isolada; não renomear seu histórico.
5. Inspeção do consumidor real encontrou lacuna não capturada no mock anterior: realApi.sendGuidesTask retorna ARRAY de resultados e a primeira implementação tratava objeto com ok/message. Também faltava reuso de decidirCanaisAoLiberar/listarContatosWhatsapp. O candidato isolado corrige ambos; precisa validação e revisão independentes.

As expectativas antigas preservadas incluem ausência não virar zero/regularidade, não mutação no mount/filtros, contexto, foco, bloqueios, pagamento independente de envio, liberação global e seleção manual. Ajustes de teste comprovadamente decorrentes do design: cartão combinado Rotinas virou três controles; empresas de Guias passaram a rowheaders; Calculado com API completa abre detalhe de conferência diretamente, enquanto conexão sem essa API mantém o fallback anterior. Não removeram casos de domínio para obter aprovação.

## Correção adicional isolada — sem autorização de aplicação

Diretório `output/rotinas-operacoes-design-20261103/candidato-web-extra`, **13 arquivos de produto/teste**:

- `OperationsGuides.jsx`: restaura prefixo/explicação de indisponibilidade, alinha valor por guideId à expectativa e traduz estados INSS manual. Baseline atual SHA256 `0d6cffa7c4d919c3e7425b3752a4fb0e986dc2f09df8afbbf1ee9582be967d77`; hash candidato atual em HASHES.json; também remove o fallback indevido do instante de confirmação.
- `OperationsGuideActions.jsx`: usa preferência/números ativos por empresa, decisão explícita PERGUNTAR, whatsappRequested congelado na prévia e resultados reais por guia/canal; parcial e indeterminado não viram entrega comprovada.
- `OperationsGuides.test.jsx`: preserva casos de origem/competência e passa a exigir confirmação desconhecida quando só existe data legada, incluindo DTO.registradoEm null.
- `OperationsGuideActions.test.jsx`: contrato real de array, canais, resultados parciais/incertos, alteração de destinatários e lista aceita/recusada. Configuração Jest externa é apenas instrumento para remapear os candidatos sem tocar o produto.

O lote consolidado autorizado somente para preparação externa acrescenta OperationsApproval/teste, OperationsProcurationTable/teste, OperationsFiscalReports/teste, operacoes.css e operationsDetails/teste: 13 paths exatos em candidato-web-extra/MANIFEST.json, com hash de baseline e candidato por arquivo. Foco nos cinco contextos foi reproduzido antes da correção; os candidatos devolvem foco ao gatilho ao cancelar, com regressões usando Modal real. O histórico EXECUTED é tratado como apresentação sem liberar nova execução. CSS proposto compacta etapas/Rotinas sem remover a verificar; Guias evita duplicar expectativa/documento e conserva estado documental fresco prioritário.

Hashes atuais de todos os arquivos WEB e candidatos: `output/rotinas-operacoes-design-20261103/WEB-FONTES.json`. Patches externos registram antes/depois; não substituir o checkout nem declarar convergência do baseline por causa de prova candidata. O Principal consolidará a decisão adicional com os achados API.

## Visual e limitações

Inspeção visual local executada com componentes reais, CSS index+App, dados fictícios, aliases para candidatos externos, perfil temporário e bloqueio de rede externa. A primeira tentativa de harness sem App.css foi identificada como inválida e substituída pela captura com CSS real. Resultado válido: `output/rotinas-operacoes-design-20261103/visual/observacoes.json`, 12 capturas (main 1366/1440/390, seis etapas, Procuração, SITFIS, Disponível móvel), zero erros JS e zero chamadas de escrita externa. Browser e servidor próprios foram encerrados em finally. Não houve overflow horizontal global nas dimensões medidas; tabelas possuem rolagem própria.

**Inspeção pré-correção reprovada (preservada em visual/):** cartões das etapas medem aproximadamente 560 px, contra cerca de 353 px da referência, deslocando Rotinas abaixo da dobra em 1366. Disponível repete expectativa e documento em linhas altas. Cancelar prévias de Calculado, Confirmado, Guias, Procuração e SITFIS deixou o foco em body, reproduzido em Modal real e registrado no JSON. Fechamento dos modais devolveu foco ao gatilho, mas isso não corrige o cancelamento interno.

Escopo adicional de foco reportado ao Principal: OperationsApproval+teste, OperationsProcurationTable+teste, OperationsFiscalReports+teste; GuideActions/teste já são candidatos. Ajuste de proporção requer operacoes.css. Esses reparos foram autorizados pelo Principal somente como candidatos externos e preparados no lote de 13 paths; nenhum foi aplicado no checkout. Capturas pré-correção demonstram o problema, não conformidade aprovada.

Validação isolada v4: 37/39, com duas falhas: harness não remapeava ./OperationsGuides e candidato usava desfechoWhatsapp(...).texto em vez de resumirWhatsapp. Ambos corrigidos apenas externamente e aguardando rodada consolidada. A revisão identificou ainda que paymentConfirmedAt legado não é instante de confirmação; candidato Guides foi ajustado para usar somente DTO.registradoEm e recebeu teste de null/legado. A contagem subsequente consolidada é de 13 arquivos, conforme MANIFEST.json; o lote inicial de quatro arquivos foi ampliado explicitamente pelo Principal após repros. Nenhuma dessas correções adicionais está aplicada no checkout congelado.

Rodada consolidada isolada v5: 152/152 em 11 suites (`web-consolidado-v5.json/.log`). A configuração inicial casava somente .test.jsx e omitiu o arquivo explícito operationsDetails.test.js; o complemento executou exclusivamente esse arquivo, 8/8 (`web-consolidado-v5-details.json/.log`), sem repetir os 152. São 160 testes aprovados nessa versão, com 13 hashes baseline/candidato verificados antes e depois. Configdiff auxiliar preservado.

Revisão posterior identificou projeção Disponível antiga sobrepondo ERROR/NEEDS_REVIEW documental fresco em Guides. Corrigidos somente candidato Guides e seu teste; a expectativa permanece no detalhe e o estado documental real fica visível. Focal afetado v6: 16/16 (`web-guides-v6.json/.log`). Não foi repetida bateria intacta e não se apresenta v5 como execução integral do hash v6. Revisor independente confirmou por leitura o delta e os hashes; parecer visual independente posterior está sendo concluído sobre as capturas finais. Checkout permanece v2, inclusive sua falha conhecida.


Visual posterior concluído sobre o candidato externo de 13 arquivos, sem aplicar ou editar código durante a inspeção: `visual-depois/observacoes.json`, 11 capturas e FONTES-ANTES/FONTES-DEPOIS com hashes idênticos. Retorno de foco ao cancelar passou nos cinco contextos reproduzidos (Calculado, Confirmado, Guias, Procuração, SITFIS). Etapas mediram 353 px em 1366 e 1440; fim de Rotinas em y=804,6, dentro da janela de 900 px. Sem overflow horizontal global, erros JavaScript ou chamadas externas de escrita. Em 390 px os cartões empilham e a tabela conserva rolagem horizontal própria. Os screenshots preservam nomes extensos e valores; Disponível não repete expectativa/documento. Browser e servidor foram encerrados.

Limite explícito de fixture: Empresa Gama está marcada EXECUTED, porém seu snapshot local continua calculada; a interface mantém a vedação para essa combinação inconsistente. Não se alterou a fixture para esconder o estado durante o visual. O teste unitário distinto prova que EXECUTED com snapshot transmitida e evidência compatível não aparece como erro, enquanto uma nova liberação continua vedada. A inspeção visual não comprova conteúdo/entrega fiscal nem substitui gates ou aplicação autorizada. Referência original e capturas pré-correção permanecem preservadas em seus diretórios.


Valor efetivamente pago continua indisponível quando a fonte não prova um escalar; não usar valor nominal/recalculado como substituto. Histórico limitado informa limites. SITFIS usa a própria data e não concilia débito com guia por valor. Captação de parcelamento sem competência permanece no fluxo individual. Guardas de reserva/transporte e defeitos API estão em revisão do autor backend/Principal, sem aprovação implícita frontend.

## Regras e rollback

Impacto: apresentação e coordenação de ações já aprovadas; nenhuma nova regra operacional. R01/R02/R08–R12/R16/R18–R22/R25/R26 e seções 19/26/30/32 preservadas. Liberação global continua todas confirmadas elegíveis; seleção manual é alternativa explícita. Sem mudanças de agenda, pagamento/baixa, expectativa fiscal ou ativação.

Rollback retira apenas deltas deste incremento, preservando R2D e trabalho de outros autores. Não há schema/migração frontend. Não executar reset amplo nem copiar backup antigo. Julgamentos técnicos, sistêmicos e de UI/UX e gates finais permanecem pendentes; este relatório não os substitui.
