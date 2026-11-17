# PGDAS-2026-B3.3 — caracterização do protocolo e seleção FS12

Base remota confirmada em 17/11/2026: `2eb7e9993070129f56b0f23b948127675cbcf104`. Branch `codex/pgdas-fs12-protocolo-b33-20261117`. [Coordenação autorizada](https://github.com/yagoS0/api-app-contabilidade/pull/296#issuecomment-6955182328). Esta entrega contém documentação e testes; não implementa seleção produtiva, altera payload ou retira guardas. A confirmação manual continua exclusivamente na Apuração.

## Evidência e conclusão

As [fontes oficiais e suas versões](pgdas-2026-b33-fontes.md) distinguem obrigação fiscal, formato de entrada e comportamento de aproveitamento de folhas. Nenhum teste local equivale a aceite SERPRO. Campos ausentes nos retornos documentados não podem ser preenchidos por inferência a partir de DAS, recibo, número declaratório, total agregado ou PDF existente.

A série completa confirmada no B3.1 é necessária à validação local. Ela **não é automaticamente a lista a enviar**. MSG029 descreve aproveitamento anterior e prevalência de valores reenviados; MSG030 aponta impacto nos períodos posteriores. MSG045/047 e a obrigatoriedade nova não provam a semântica de lista vazia ou a seleção em todos os estados históricos. Não descobrir essa semântica por tentativa e erro com empresas reais.

## Matriz fiscal e de seleção

| PA | Cobertura B1 para empresa estabelecida | Fator R / demais atividades | Seleção para provedor nesta entrega |
| --- | --- | --- | --- |
| 10/2026 | 10/2025–09/2026 quando exigida historicamente | Exigência histórica permanece; informação declaratória não altera III/V | Caracterizar legado, sem reescrever períodos ou mudar despacho anterior |
| 11/2026 | 11/2025–10/2026 | Exigência declaratória para ambas; Fator R continua próprio | Não definida sem evidência mensal oficial e decisão fiscal sobre protocolo; bloqueio B3.2 mantido |
| 12/2026 | 12/2025–11/2026 | Mesma separação | Mesma restrição; mês de novembro não é herdado como comprovado apenas por haver declaração |
| 01/2027 | B1 retorna homologação pendente, sem janela liberada | Não extrapolar manual 2018–2026 | Campo técnico `pa >= 202611` não homologa 2027; despacho bloqueado |

| Cenário transversal | Cobertura local / comportamento observado | Consequência segura |
| --- | --- | --- |
| Abertura no próprio PA | B1 usa o próprio mês, não doze meses anteriores | Não fabricar folha anterior à abertura; definição da remessa ainda depende do protocolo |
| Abertura em 09/2026, PA11 | Janela B1 09/2026–10/2026 | Não anualizar nem repartir agregado para criar meses |
| Abertura em 15/11, regime inicia em 15/11 | Política pura aceita mês 11; leitor de contexto exige regime cobrindo mês inteiro e não comprova contexto | Lacuna preexistente de início parcial: manter pendência; propor correção delimitada após decisão fiscal, sem forjar vigência desde dia1 |
| Receita zero / sem movimento | Não prova folha zero nem dispensa declaratória | Exigir evidência dos meses aplicáveis; manter trava contra receita zero presumida |
| Zero explícito confirmado | Valor zero da revisão é um fato local distinto de vazio | Preservar zero e sua origem; não preencher meses ausentes com zero |
| Folha ausente, incompleta ou revisão obsoleta | Confirmação/cobertura inválidas | Não construir seleção liberadora, não reaproveitar total anterior |
| Atividade sem Fator R | Em 11/12 obrigação declaratória independente | Não ativar decisão III/V nem reaproveitar filtro legado como dispensa |

## Histórico e alternativas pendentes

| História mensal oficial | Critério necessário | Decisão conservadora atual |
| --- | --- | --- |
| Ausente/desconhecida | Ausência de índice não prova ausência de valores aproveitáveis | Bloquear seleção; não enviar automaticamente a janela inteira |
| Parcial | Cada mês deve ter empresa, valor, declaração/versão, origem e validade correlacionados | Não subtrair meses sem prova individual nem converter restante em lista homologada |
| Completa e concordante | Prova atual de todos os meses e regra documentada de omissão/vazio | Mesmo assim, `[]`/omissão precisam de esclarecimento; não presumir remessa vazia válida |
| Divergente ou declaração retificada | Preservar revisão manual e versão oficial conflitante | Exigir conferência fiscal; não escolher valor maior/mais recente, não retificar automaticamente |
| Inacessível/timeout | Falha de leitura não é lista vazia | Resultado desconhecido e bloqueio, sem consulta repetida automática |

Alternativas para decisão: (A) esclarecer com documentação/suporte do provedor o tratamento de vazio/omissão e obter contrato de leitura mensal identificada; recomendada. (B) avaliar remessa explícita de toda a janela apenas após confirmação escrita da semântica e dos impactos de sobrescrita, nunca como fallback. (C) manter os comandos afetados bloqueados e realizar a obrigação no canal oficial, com tratamento posterior do histórico sem associação causal inventada. A escolha de B ou de qualquer integração requer autorização própria; este documento não a concede.

## Mapa atual e limites de responsabilidade

| Componente | Papel e limite atual |
| --- | --- |
| `modules/fiscal/domain/politicaDeclaratoriaFs12.js`, `evidenciaMensalFs12.js`, `contextoMensalFs12.js` | B1 define cobertura/validação local; não seleciona meses remotos nem autentica prova oficial |
| `modules/fiscal/application/confirmarFs12DaApuracao.js` e composição B3.1 | Confirmação manual autenticada, revisão imutável e empresa/PA; não dispensa histórico remoto |
| `modules/fiscal/application/vincularFs12AoCalculo.js`, `registrarFatoCalculoFs12.js` e `composition/fs12DoCalculo.js` | Vínculo exato e fatos internos B3.2; porta probatória padrão recusa; não há produtor oficial habilitado |
| `application/fiscal/serpro/PgdasSimulacaoService.js` | Builder local converte a lista recebida, sem resolver cobertura/aproveitamento. Fachada bloqueia novos despachos afetados antes do builder |
| `SerproPgdasdService.js` | Envelope `TRANSDECLARACAO11` v1.0 e índice `CONSDECLARACAO13`; cliente concreto mantém guarda final. Cliente falso só observa envelope nos testes |
| `SerproHttpClient.js`, `SerproCallGuard.js` | Autenticação, custo, reserva e resultado técnico; não comprovam relação causal entre folha/cálculo/declaração |
| `PeriodosRecusadosService.js`, `RbtExtratoService.js` | Poda/memória legada, inclusive recusas por assinatura. Não é catálogo oficial de valores mensais de folha; não transformar recusa em valor confirmado |
| `PgdasHistoricoService.js` e recuperação do fechamento | Versões/documentos/histórico preservados; número anterior coexistindo com cálculo novo não prova uso da FS12 |
| `SerproPgdasDeclaracaoService.js` | `CONSULTIMADECREC14` recupera documentos; `parsePgdasDeclarationPdf` não extrai série mensal FS12. `syncPgdasByCompetencia` persiste documentos/circular e pode alcançar provisões: não reutilizar como leitor puro. `CONSDECREC15` consta da documentação oficial, mas não foi localizado como cliente implementado na API |
| Fechamento, Operações, lote e ciclo automático | Coordenadores atuais conservam autorização, pausas, reservas e estados incertos; novos bloqueios continuam em todos os pontos B3.2 |

Fiscal decide interpretação e seleção; infraestrutura traduz o contrato externo; aplicação coordena capacidades específicas. Operações não escolhe meses fiscais. Nenhuma escrita em Guias/Contabilidade ou integração DP/Drive/eSocial é criada aqui.

## Contratos propostos — não implementados nem homologados

`planejarRemessaFs12` deverá receber contexto autorizado (PortalClient/Company/CNPJ/PA/abertura), revisão confirmada (id/versão/hash/política e série em centavos) e história oficial identificada por mês e versão. Deve devolver separadamente `janelaFiscal`, `mesesComProvaOficial`, `mesesPropostos`, `impedimentos`, referências de origem e versão do protocolo. Sem história suficiente, a proposta de seleção deve ser **null**, não `[]`. Repetição da entrada produz o mesmo plano; não há I/O, escrita, coercão de vazio para zero ou escolha de anexo. Não aceitar um booleano do navegador como prova de procedência.

`lerFolhasDeclaradas` será uma porta específica somente após identificar fonte técnica suficiente. O retorno deve distinguir `COMPROVADA`, `PARCIAL`, `DESCONHECIDA`, `DIVERGENTE` e `INDISPONIVEL`, com empresa, PA consultado, meses de folha, valores exatos, declaração/versão e instante. São estados de contrato proposto, **não novos estados persistidos**. Índice/PDF não são adaptadores equivalentes por conveniência.

## Integração futura e atomicidade

A [saída documentada de TRANSDECLARACAO11](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_saida/) contém `status`, mensagens e `dados` serializados, com identificador declaratório, instante, valores devidos e PDFs. Não documenta eco de `calculoId`, revisão FS12 ou tentativa local. `parseRetornoSimulacao` lê o primeiro item, deriva total/tributos e expõe número/instante/raw; não autentica a procedência nem verifica uma relação causal. A correlação futura precisa partir da requisição exata e do retorno observado pelo adaptador confiável, conservando a evidência. Não basta acrescentar um identificador alegado pelo navegador à resposta normalizada.

1. B3.3a: aprovar seleção/protocolo puro, fonte probatória e comportamento por competência; decidir a lacuna de abertura no meio do mês. Provar valores, ausência/zero, meses já declarados, vazio/omissão, ordem, precisão e preservação do payload legado por contrato. Nada disso altera automaticamente as guardas.
2. B3.3b: coordenar autorização atual + revisão/contexto FS12 + snapshot/CAS/reserva + identidade do comando e tentativa em uma transação local adequada. Para a confirmação após simulação, gravar cálculo exato e vínculo B3.2 no mesmo `tx` Serializable, sem fallback global. Antes da primeira simulação ainda não existe cálculo resultante: usar identidade do comando/revisão/reserva existente, não fabricar um `calculoId` confirmado. Se a estrutura atual não permitir essa correlação durável, apresentar desenho e eventual migração antes de implementar.
3. Encerrar transação antes da rede. Toda capacidade de despacho deve exigir a reserva e revisão válidas; revalidação não cria uma transação distribuída. Definir a decisão para mudança concorrente entre preparo e envio, incluindo recusa de resultado obsoleto sem apagá-lo. Autorização local verificada isoladamente não é autorização durável.
4. Após retorno, correlacionar empresa/PA/operação/assinatura da requisição/tentativa/resposta oficial e persistir resultado junto do cálculo/vínculo aplicável. `indicadorTransmissao:false` não comprova declaração. HTTP200, total, número isolado ou PDF não bastam. Dublê sintético não homologa o provedor.
5. Timeout/perda de resposta, falha de persistência após aceite e crash antes de registro mantêm incerteza/reserva; não redespachar. Conciliar por identidade comprovada; se não houver prova causal, conservar DESCONHECIDO. Resposta tardia não conclui outra tentativa nem revisão. Não criar nova máquina paralela de estados ou retry automático.

Os ensaios PostgreSQL B3.2 comprovam transações locais das portas existentes, rollback, concorrência e imutabilidade. **Não comprovam um coordenador B3.3 integrado**, que não foi implementado. Sua prova ponta a ponta, inclusive interrupções antes/depois da rede falsa, é critério obrigatório do incremento posterior.

## Critérios de desbloqueio e rollback

Exigir aprovação fiscal da seleção por PA e da procedência mensal; resposta formal às lacunas de lista vazia/omissão/reenvio; contratos de correlação e atomicidade testados; revisões Fiscal/segurança/arquitetura; CI no SHA final e autorização explícita. Inventariar e testar remoção coordenada das guardas de `FechamentoService` (calcular/salvar/transmitir), `OperationsCalculationService`, `OperationsService`, `CicloSimplesService`, `PgdasSimulacaoService` e `SerproHttpClient`, incluindo script direto, lote e worker. Não remover apenas a guarda visível na interface. 2027 permanece decisão independente.

Rollback desta caracterização: reverter somente documentos/testes deste PR; produção, schema, payload e guardas permanecem idênticos à base. Nenhuma migration nova, backfill, chamada real, deploy ou ativação. O registro de governança identifica testes realmente executados, pareceres, limitações e CI; não confundir plano com execução ou testes locais com homologação fiscal.
