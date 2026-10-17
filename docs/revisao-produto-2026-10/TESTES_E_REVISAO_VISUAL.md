# Testes, critérios de aceite e revisão visual

## 1. Estado desta entrega

Esta é uma matriz de testes a executar na implementação. Nesta entrega foram inspecionadas dez imagens de referência e conferida a documentação; não foram executados testes funcionais do produto. Os resultados históricos registrados em `docs/design-review.md` pertencem àquelas versões e não aprovam as mudanças aqui propostas.

## 2. Dados de teste

Criar fixtures fictícias determinísticas, com valores não redondos, nomes longos e identidades estáveis. Não copiar CNPJ, contatos ou conteúdo de mensagens dos prints para testes. Ambiente de homologação deve bloquear envio real e usar provedores simulados para transmissão, consulta paga e comunicação.

| Fixture | Conteúdo | Propósito |
| --- | --- | --- |
| F01 | Quatro expectativas conhecidas, três documentos válidos, dois enviados | Contagem 3/4 e identificação de faltante |
| F02 | Sem nota importada, fonte incompleta | Não confundir vazio com ausência de movimento |
| F03 | Receita zero confirmada, folha e parcela | Não dispensar obrigações independentes |
| F04 | Parcela por débito automático sem confirmação | Sem falta/envio de guia; financeiro pendente |
| F05 | E-mail enviado, WhatsApp falhou, dois destinatários | Resultado parcial rastreável |
| F06 | Guia original, recalculada e reimportação | Deduplicação e versão vigente |
| F07 | Nota após transmissão e callback antigo | Invalidação de revisão sem retificação automática |
| F08 | Receita no trimestre e mês atual zerado | Periodicidade e histórico |
| F09 | DARF consolidado e complemento | Unidade explícita, condicionado a V03 |
| F10 | Pagamento cliente, confirmação e estorno | Origem e separação contábil |
| F11 | 80 empresas, nomes longos e paginação | Total/lista/seleção, densidade e responsividade |
| F12 | Relatório parcial, cenário tributário incompleto | Ausência não vira zero nem comparabilidade fictícia |

## 3. Matriz integrada

Complementa T01–T21 da fonte viva; não substitui os cenários de calendário ou outras áreas não alteradas.

| ID | Ação e pré-condição | Resultado verificável | Superfícies |
| --- | --- | --- | --- |
| I01 | Em F01 anexar e validar quarta guia | D=4, F=0, S continua 2; sem transmissão implícita | Guias/Empresas/Operações |
| I02 | Falhar processamento do PDF | Documento inválido/processando não conta disponível; motivo visível | Guias/central |
| I03 | Reimportar PDF de F06 | Um item vigente, histórico preservado, sem novo envio | Guias/carteira |
| I04 | Enviar e receber falha parcial F05 | Resultados por canal/destino; D preservado, pagamento inalterado | Guias/WhatsApp/carteira/central |
| I05 | Repetir somente canal falho | Sucesso anterior não reenviado; tentativa identificada | Comunicação/histórico |
| I06 | Em F04 passar vencimento | Não cria guia/envio; pagamento continua não confirmado | Parcelas/Guias/central |
| I07 | Em F03 avaliar competência | Guias aplicáveis mantidas; dispensa apenas fundamentada | Apuração/carteira |
| I08 | Nova nota relevante após transmissão | Pendência com marco/revisão; aprovação dependente invalidada | Notas/apuração/central |
| I09 | Reabrir, clicar duas vezes e recarregar | Uma transição persistida; histórico preservado; nenhuma retransmissão | Domínio escolhido/carteira |
| I10 | Reabertura retorna vazio, erro ou método ausente | Não mostra sucesso nem avança como se persistido | Apuração |
| I11 | Trocar empresa/período com requisição lenta | Resposta antiga ignorada e seleção/rascunho tratados | Todas as telas |
| I12 | Lote com sucesso, falha e timeout | Resultado por item permanece acessível; incerto requer conciliação | Operações |
| I13 | Extrato processado duas vezes | Sem receita/provisão duplicada; vínculo à origem | Lançamentos/circular/relatórios |
| I14 | Registrar pagamento informado e depois confirmar | Origem visível; baixa contábil somente pelo contrato próprio | Guias/parcelas/lançamentos |
| I15 | Recalcular guia e enviar versão liberada | Histórico ligado; nova versão não duplica dívida ou pagamento | Guias/circular |
| I16 | Usuário sem vínculo tenta API/documento | Servidor recusa, sem dados de outra empresa | Todos os domínios |
| I17 | Abrir lista paginada e clicar cartão | Mesmo total, recorte e unidade; página não vira total | Empresas/central |
| I18 | API falha ao atualizar lista com dados anteriores | Última evidência datada e erro; não exibe zero | Todas |
| I19 | Oportunidade recebe vínculo antes de excluir | Servidor revalida e impede exclusão indevida | Onboarding |
| I20 | Aprovar empresa e alterar sua base antes de liberar | Aprovação antiga recusada; demais itens identificados | Conferência/transmissão |
| I21 | Imprimir cenário incompleto F12 | Premissas/ausências preservadas, sem valor fiscal fabricado | Planejamento/relatórios |
| I22 | Consulta fiscal falha ou está restrita | Relatório anterior datado, custo/limite explicado, sem consulta automática ao abrir | Situação fiscal |

## 4. Camadas de teste

1. **Domínio:** transições, deduplicação, contadores, vigência, vínculo de evidência e permissões. Priorizar bordas com origem/revisão e dados incompletos.
2. **Integração:** comando → persistência → projeção → consumidores; incluir worker, callback, ação manual e retorno incerto. Testar gravação concorrente e recarga.
3. **Interface:** ação real no componente com API controlada; verificar rótulos, motivo, próxima ação, seleção e rejeição de resposta antiga. Testar a ligação ao serviço, não somente a função pura.
4. **Fluxo completo local:** navegar entre telas e comparar os mesmos itens após ações. Provedores simulados não comprovam compatibilidade real SERPRO; essa homologação deve ser registrada separadamente quando aplicável.
5. **Visual e acessibilidade:** comparação humana de capturas e navegação por teclado, além de medidas automatizadas de overflow/contraste.

Testes fiscais que dependem de V01–V08 devem nomear a política assumida e não ser tratados como aprovação de negócio. Não criar teste que só espelha uma nova constante sem verificar consequência.

## 5. Procedimento de revisão visual

### Preparação

- Registrar branch, commit e alterações locais; tela/rota, fixture, empresa fictícia, competência, viewport e estado.
- Capturar antes e depois no mesmo viewport, zoom e conjunto de dados. Esperar fontes e estado final; usar data controlada onde possível.
- Cobrir todas as doze telas principais e o complemento onboarding; não apenas a tela inicial.
- Para cada tela: normal, carregando, vazio legítimo, falha, dado incompleto, nome/texto longo. Para ações relevantes: modal aberto, validação, ocupado, sucesso, recusa e retorno de foco.

### Inspeção

| Verificação | Critério objetivo |
| --- | --- |
| Hierarquia | Título, estado e próxima ação identificáveis sem ler blocos explicativos |
| Densidade | Sem cards vazios grandes ou repetição de identificadores; tabela preserva espaço útil |
| Cores | Tokens existentes; cor de categoria não comunica erro; texto acompanha estado |
| Ações | Uma primária contextual; botão não corta; ação secundária não compete |
| Responsividade | Página sem overflow horizontal; tabela com rolagem local quando necessária |
| Formulários | Rótulos persistentes; erros visíveis; campos não ultrapassam container |
| Modais | Cabeçalho/rodapé alcançáveis, foco contido e devolvido, sem sobreposição indevida |
| Conteúdo crítico | Custo, consequência fiscal, resultado incerto e erro continuam visíveis |
| Dados | Datas/moeda consistentes; desconhecido não aparece como zero |
| Teclado | Tab/Shift+Tab/Enter/Escape funcionam conforme contexto; foco visível |
| Mobile | Alvos adequados, teclado virtual não esconde ação, sem perda de informação essencial |
| Exportação | Empresa, período, fontes, premissas e páginas completas |

Abrir e inspecionar cada imagem produzida. Um script que detecta ausência de overflow não avalia clareza, ordem ou proporção. Comparações automatizadas podem ajudar, mas não dispensam inspeção humana.

### Evidência e correção

Salvar em `test-evidence/revisao-produto/<fase>/<tela>/<viewport>/<estado>.png` e relatório `coverage.md` no checkout de implementação. Screenshots de referência deste pacote não são evidência de teste novo. Registrar problema, prioridade, causa conhecida, correção e nova captura. Após corrigir, repetir os estados afetados e os consumidores do componente compartilhado.

## 6. Classificação e critério de saída

- **P0:** ato fiscal, envio, exclusão ou acesso indevido; perda de evidência; duplicidade externa. Bloqueia entrega.
- **P1:** estado/valor falso, contadores divergentes, ação essencial inacessível, histórico incorreto. Bloqueia entrega.
- **P2:** hierarquia ruim, repetição, inconsistência visual ou dificuldade evitável com caminho funcional. Corrigir no escopo da tela.
- **P3:** refinamento sem prejuízo operacional. Pode ser registrado com destino e motivo.

Fase só termina com cenários aplicáveis passando, nenhuma falha P0/P1, P2 do escopo corrigidas, revisão visual desktop/móvel e ausência de regressão nas superfícies integradas. Estado sem evidência permanece `Não verificado`; build aprovado não o transforma em aprovado.

## 7. Modelo de relatório de entrega

```text
Fase / tela:
Regra e decisão aplicáveis:
Branch / commit / alterações locais:
Problema antes e comportamento depois:
Fixtures e estados executados:
Testes: comando, resultado, quantidade efetivamente executada:
Capturas antes/depois e viewports:
Verificação teclado/foco/contraste:
Persistência e concordância entre telas:
Limitações e decisões pendentes:
Risco e reversão:
```

Não registrar testes como aprovados se o runner executou zero testes, foi interrompido ou utilizou apenas mock onde o contrato exigia persistência.
