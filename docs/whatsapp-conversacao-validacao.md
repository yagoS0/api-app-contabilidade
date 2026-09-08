# Validação da conversa do WhatsApp

Esta revisão combina regressões de fluxo e contratos com conversas do modelo real. As fixtures são fictícias; não devem ser substituídas por históricos de clientes em um repositório público.

**Estado em 08/09/2026:** alterações locais verificadas, homologação de conversação ainda pendente. A API do modelo interrompeu a segunda rodada com HTTP 400 e categoria `CREDITO_PROVEDOR`. Os últimos ajustes de perfis, prévia de ISS e limites dos encargos passaram nos testes locais, mas ainda precisam da repetição com o modelo real. Não houve publicação desta branch nem atualização da API.

## Falha de compatibilidade reproduzida

Em 08/09/2026, uma saudação com o catálogo completo, Opus 5 e esforço medium falhou com HTTP 400: 19 parâmetros com unions, acima do limite combinado de 16. Converter campos em opcionais ou strings obrigatórias continuou falhando no limite interno de compilação. O mesmo catálogo foi aceito ao reservar a validação do schema de `preparar_emissao` ao servidor e manter as demais ferramentas strict.

Por isso apenas `preparar_emissao` usa `strict: false`. Sua entrada passa por validação de tipos, campos e objetos aninhados antes das consultas; depois passa pelo validador fiscal compartilhado. Campos ausentes não viram zero. A função apenas cria uma pendência: a emissão continua dependente da confirmação por código, das permissões e da autorização verificadas pelo servidor.

A Anthropic descreve tanto limites agregados quanto limites internos e recomenda strict seletivo quando necessário: [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits).

Uma segunda prova com o catálogo ampliado de `fac7050` identificou outro HTTP 400: `Invalid schema: Enum value 'OPEN' does not match declared type '['string', 'null']'`. Os campos `listar_guias.status` e `listar_notas.direcao` combinavam enum e tipo anulável. A API real aceitou o catálogo completo ao representar somente esses dois campos como `anyOf: [{type: "string", enum: [...]}, {type: "null"}]`, respondendo HTTP 200 e `end_turn`. Os valores aceitos, o significado de null e as permissões continuam iguais; a preparação da emissão preserva sua validação local. A aceitação do schema anterior não era prova de compatibilidade do catálogo ampliado.

Antes desse ajuste, os dois novos testes de contrato falharam e os outros 11 testes de `promptEEscopo` passaram. Após o helper localizado, a mesma regressão e as suítes `ferramentas`, `ferramentasContratos` e `revisaoCruzadaFerramentas` passaram **98 testes em quatro suítes**, sem chamadas externas. O probe real comprova que o catálogo compila; a qualidade das conversas continua sendo avaliada separadamente.

## Comportamento esperado

- Opções na apresentação, com liberdade para escrever o pedido. Um pedido substantivo na primeira mensagem continua para a IA.
- Menu e IA compartilham a reserva da conversa. Mensagens curtas já recebidas podem compor um único pedido.
- Dúvidas e respostas como “sim” preservam a pendência, sem executar. Correções geram novo resumo e código. Confirmação acompanhada de alterações exige nova revisão.
- Guias preservam o identificador do PDF, distinguem situação de pagamento de processamento e competência de vencimento. Valores desconhecidos não se tornam zero.
- A busca de notas considera as emitidas recentemente, antes da captura posterior. Filtros e páginas permitem localizar registros fora da primeira lista.
- A resposta reconhece entregas parciais e só anuncia encaminhamento depois de registrá-lo.

## Resultado local integrado — 08/09/2026

A execução iniciada às 19:30:40, horário de Brasília, passou **361 testes em 21 suítes**, sem falhas nem testes pendentes, em 46,422 segundos. Foram usados os caminhos explícitos com `--runTestsByPath`, `--runInBand` e `--watchman=false`. A revisão avaliada foi `aaf40d4` mais as correções locais da revisão cruzada; os arquivos de aplicação permaneceram inalterados durante a execução.

| Escopo | Suítes | Testes aprovados |
| --- | ---: | ---: |
| Todas as suítes de `application/assistente` | 12 | 221 |
| Menu e processamento do webhook | 2 | 58 |
| União das notas emitidas e validador NFS-e | 2 | 38 |
| Listagem, serializer, visibilidade e parcelas de guias | 5 | 44 |
| **Total** | **21** | **361** |

O relatório bruto do Jest está no artefato privado `outputs/validacao-conversacao-integrada-final.json`, fora do repositório. Esta bateria usou modelo, transportes e banco isolados; o teste dos contratos chama os executores e serializers reais com dependências em memória. Não houve mensagem real, consulta fiscal externa, emissão ou cancelamento de nota.

A rodada seguinte passou **375 testes em 22 suítes**, em 20,82 segundos, incluindo os schemas anuláveis, o diagnóstico de erro do provedor e onze casos de histórico de anexos. O runner passou seus **9 testes**. Esses resultados não substituem a avaliação das conversas nem a prova de persistência e concorrência em PostgreSQL, registrada separadamente. `git diff --check` passou; os avisos locais de conversão LF/CRLF não indicaram erros de whitespace.

## Conversas do modelo e revisão independente

A primeira comparação executou 15 cenários e 41 turnos em cada versão. Os checks automáticos aprovaram 13 cenários no baseline e 14 no candidato, mas a leitura independente dos 82 turnos encontrou falhas que esses checks não mediam: reenvio de documento sem pedido, narrativa falsa de falha anterior, regra de pagamento/encargos não retornada pelas ferramentas e orientação de confirmação sem a palavra `CONFIRMAR`. Portanto essas contagens não foram usadas como aprovação da conversa.

Também foram corrigidas duas limitações do simulador: prestador e tomador tinham o mesmo CNPJ sintético em um cenário, e anexos bem-sucedidos não apareciam no histórico do turno seguinte. O cenário CNPJ original foi excluído da comparação qualitativa. O runner agora compartilha o formatador puro `evidenciaDoAnexo` com o serviço real. O formatador preserva identificação e eventos persistidos, distingue aceite de entrega/leitura e não inventa confirmação para registros legados ou indeterminados. O teste de histórico do runner falhou antes do ajuste e passou depois; no serviço, sete regressões falharam antes e os onze casos passaram depois.

A orientação do modelo passou a preservar envios anteriores, atender reenvio explícito, reconhecer limites dos dados fiscais e citar a instrução completa de confirmação quando necessário. O catálogo esclarece que alíquota ausente não foi consultada nem conferida durante a preparação. A nova comparação utiliza os mesmos dados corrigidos e evidência de anexos nas duas versões. Cenários reservados repetem as situações de envio, reenvio, resultado parcial, encargos desconhecidos e confirmação exata. A revisão qualitativa continua obrigatória, mesmo quando os verificadores de estado aprovam.

Na segunda rodada, os três conjuntos candidatos observaram chamadas às **14 ferramentas**. Isso comprova cobertura de escolha e chamada no simulador; não comprova integrações externas reais. O complemento executou o corpo real de preparação de emissão, com validação e declaração compartilhadas e dependências em memória. Preservou CPF, endereço, retenções e alíquota zero após correção, e distinguiu dois tomadores com nomes parecidos. A seleção de perfil revelou um desvio: depois de receber duas opções, o modelo voltou a preparar no mesmo turno. O serviço agora conserva essa exigência durante a resposta e só permite preparar em outro turno, com portão e sessão novamente verificados. A escolha explícita no turno seguinte continua funcionando.

Nos cenários reservados, **oito conversas de documentos passaram na revisão independente**: três sequências contrato/cartão, dois reenvios explícitos e três pedidos com sucesso parcial. Foram 15 envios sintéticos, sem repetição não solicitada nem falsa entrega da nota que falhou. Dois cenários de encargos ainda extrapolaram a evidência: um inventou cálculo até o pagamento e ambos prometeram uma informação no PDF futuro. A preparação agora retorna valor atualizado e data final de cálculo como não apurados, conserva esse limite no resumo pendente e o prompt inclui um exemplo de resposta para a dúvida. A eficácia desta última correção ainda não foi medida no provedor por falta de créditos. As duas repetições reservadas de confirmação também não foram concluídas.

O resumo de ISS compartilhado passou a mostrar “não informada; depende da configuração de emissão” quando a alíquota não foi informada. A seleção de um perfil não é apresentada como consulta ou aplicação de uma taxa ainda não resolvida; zero e outros valores explícitos são preservados. O teste usa o fonte deste checkout para evitar que um `node_modules` compartilhado com outro worktree avalie uma revisão antiga.

A revisão local final passou **390 testes em 23 suítes**, em 6,749 segundos, mais **9 testes do runner**. Inclui a guarda de escolha de perfil, revogação de acesso antes de reutilizar opções, retomada no próximo turno, declaração da alíquota ausente e dados ainda não apurados no recálculo. Esses resultados são posteriores aos ajustes finais; as transcrições da segunda rodada são anteriores a eles e não devem ser apresentadas como homologação da versão final.

## Confirmação em PostgreSQL real — 08/09/2026

O script `apps/api/scripts/verify-whatsapp-confirmacao-postgres.js` passou **8 verificações** em PostgreSQL 16.11 após aplicar as **164 migrations** desta revisão. Foram usadas duas conexões independentes e o serviço de confirmação real. A prova inclui um turno completo válido, reentrega, 12 confirmações concorrentes com uma única execução, duplicatas válidas, duplicata seguida de correção, mais de 12 entradas no mesmo instante, correção commitada antes do `UPDATE` de reserva e atendimento humano assumido antes da reserva.

O modelo, o transporte e os executores fiscais foram substituídos por dublês; o processo proíbe HTTP externo. O script aceita somente o banco local de teste com endereço, porta, nome e usuário fixos e confere a identidade do banco antes de criar fixtures. O container descartável foi removido após a execução. Um client Prisma isolado evitou alterar o `node_modules` compartilhado com outras revisões.

A execução local usou Node 24. O workflow `.github/workflows/whatsapp-confirmacao-postgres.yml` repete a prova com Node 20 e PostgreSQL 16; a execução remota desse workflow ainda depende da publicação da revisão. Nenhum resultado local é apresentado como aprovação do CI remoto.

## Revisão cruzada e regressões

Agentes distintos revisaram o fluxo e as ferramentas um do outro. As falhas centrais abaixo foram executadas antes das respectivas correções: o baseline cruzado do fluxo apresentou quatro falhas e um controle aprovado; o das ferramentas apresentou quatro falhas iniciais. A leitura excessiva da paginação foi reproduzida e corrigida em uma rodada adicional. A bateria integrada inclui os 22 casos de `revisaoCruzadaFerramentas.test.js` e os cinco casos de `revisaoCruzadaFluxo.test.js`.

| Caso reproduzido | Comportamento corrigido e verificado localmente |
| --- | --- |
| Confirmação, duplicata nove segundos depois e correção no décimo segundo | A duplicata não esconde a correção. O ato não executa; a confirmação antiga é invalidada. |
| Nova entrada entre a leitura das mensagens e a reserva do ato | A condição de ausência de mensagens novas integra o mesmo `updateMany` que reserva a confirmação. O teste isolado injeta a correção nessa janela. |
| Competência `2026-13` na preparação da emissão | A ferramenta rejeita mês inválido antes de preparar a pendência; não oferece um resumo cujo payload perdeu a competência. |
| Alíquota explicitamente `0` | O validador compartilhado preserva zero, inclusive na precedência dos aliases, sem transformá-lo em ausência. |
| Uma emissão representada também por projeção antiga com papel nulo | A deduplicação reconhece o CNPJ do emitente cadastrado e exibe a nota uma vez. Recebidas e outra empresa continuam excluídas dessa comparação. |
| Busca exata de emissão ainda não capturada além das 200 mais recentes | Número, nome, documento e competência são filtrados no banco antes do limite. A paginação prossegue por cursor depois da deduplicação. |
| Primeira página de uma empresa com mil emissões já capturadas | O corte pelo prefixo completo do ADN reduziu seis leituras de lotes para uma no cenário reproduzido. |

As provas complementares cobrem entradas no mesmo instante, correção além das 12 bolhas agrupadas e fila maior que o limite de contexto da confirmação. Contexto excedente impede o ato; apenas duplicatas conhecidas do mesmo código permitem uma execução. Menu inicial não consome o pedido substantivo nem interrompe a agregação de suas bolhas. Pendência aberta suprime a apresentação automática; perguntas e “sim” preservam o pedido. Falha do modelo após entrega de arquivo reconhece a entrega já feita e não repete o anexo.

As ferramentas também foram verificadas para pagamento separado do processamento da guia, vencimento separado da competência, identificador utilizável no envio do PDF, total parcial quando falta valor e seleção de registros em outras páginas. As funções de emissão e cancelamento foram exercitadas com executores isolados: não constituem prova de um ato fiscal aceito por provedor real.

## Repetir a avaliação

Na raiz do repositório:

```sh
node --test apps/api/scripts/eval-whatsapp-conversacao.test.mjs
node apps/api/scripts/eval-whatsapp-conversacao.mjs --dry-run --output /tmp/whatsapp-plano.json
node apps/api/scripts/eval-whatsapp-conversacao.mjs --live --schema-only --output /tmp/whatsapp-schema.json
node apps/api/scripts/eval-whatsapp-conversacao.mjs --live --output /tmp/whatsapp-conversas.json
```

O modo live usa a configuração do ambiente e exige chave já configurada. Tem teto de 120 chamadas e US$ 5 estimados por execução, com reserva anterior a cada chamada. `--cases` seleciona cenários. `--code-root`, `--runtime-root` e `--tools-json` permitem avaliar uma revisão numa pasta temporária sem substituir arquivos da aplicação ativa. Não coloque chaves em argumentos ou relatórios.

O runner usa o cliente e o prompt reais, mas suas funções operam apenas em memória. Registra mensagens, chamadas, resultados, entregas fictícias, pendências, latência e uso. Não guarda raciocínio interno e não chama WhatsApp, Receita ou emissores fiscais. Registre a revisão avaliada junto aos resultados; conserve um baseline para repetir os mesmos cenários após cada ajuste.

Os verificadores de estado precisam ser complementados por um avaliador independente das transcrições: pedido atual, continuidade, ação correta, clareza e próximo passo. Uma promessa de entrega sem entrega, valor inventado ou ação indevida reprova o cenário, mesmo com texto natural. Essa combinação segue [Anthropic sobre avaliações](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) e [τ-bench](https://arxiv.org/abs/2406.12045).

Para a bateria local, execute o Jest a partir de `apps/api` com os arquivos informados no relatório JSON e `--runTestsByPath`. As cinco suítes de guias usadas foram `publicoDaGuia`, `valorDaParcelaNaLista`, `linhaDigitavelNaGravacao`, `guideContractParcelamento` e `routes/client/guiasDoClienteAparecem`. Não use `whatsapp` como expressão de seleção: esse termo também está no caminho do checkout de revisão e selecionaria suítes fora do escopo.

## Limites da prova

Conversas com o modelo e funções simuladas comprovam escolha de ferramentas e comunicação. As suítes de contratos verificam executores reais com dependências isoladas. As suítes de PostgreSQL e outbox verificam persistência e concorrência. Nenhuma delas, sozinha, comprova emissão fiscal real ou entrega a um telefone real; essas operações precisam de ambiente e destinatário de teste próprios.

A busca direta por chave ou número evita que uma captura antiga fora da janela recente apareça duplicada. A comparação exclusivamente pela série/nDPS de um XML, quando a emissão não tem chave nem número utilizável, ainda depende da janela legada de 800 projeções. Esse limite foi preservado; ausência de identidade não autoriza ocultar uma nota por aproximação. Os consumidores antigos do helper conservam sua janela padrão de 200 emissões; a leitura paginada é solicitada explicitamente pela ferramenta do WhatsApp.
