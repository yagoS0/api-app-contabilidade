# PGDAS-2026-B3.3 — Fontes oficiais e limites da seleção FS12

## Escopo e evidência

Consulta pública em 17/11/2026, para caracterização. Nenhuma transmissão, simulação oficial ou consulta fiscal autenticada foi realizada. Este documento não homologa um payload nem libera os bloqueios B3.2. Não há impacto operacional: nenhuma regra, cadastro, valor, contrato produtivo ou política temporal B1 foi alterado.

O [manifesto de fontes](./pgdas-2026-b33-fontes.json) registra URL final, horário UTC, tamanho e SHA-256 dos corpos obtidos por HTTP público. Não inclui os corpos das páginas/PDFs, documentos de clientes ou credenciais. O hash identifica o conteúdo consultado, não é assinatura da autoridade nem prova de aceite do provedor. Datas de alteração exibidas pela documentação não substituem a data de consulta.

## Fontes e confronto

| Fonte | Versão observada / localização | Conclusão limitada |
|---|---|---|
| [Notícia RFB](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/novembro/pgdas-d-e-atualizado-para-atender-a-reforma-tributaria-a-partir-de-novembro-de-2026) | Publicação 13/11/2026; atualização 16/11/2026 17h17 | A redação atual restringe a exigência para todas as atividades aos PAs 11 e 12/2026. Menciona competência em 2027 e utilização para IBS/CBS; não especifica serialização SERPRO. |
| [Manual PGDAS-D/DEFIS](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf) | Capa: 13/11/2026, 2018–2026; 138 páginas; seções 8.2–8.3 e histórico 14 | A capa anuncia manual específico de 2027. Não extrapolar esta versão. Resultados de busca podem mostrar cópia antiga: a versão identificada aqui é a do PDF aberto diretamente. |
| [Entrada TRANSDECLARACAO11](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_entrada/) | Rodapé 03/11/2026 | `declaracao.folhasSalario` é uma lista de objetos, indicada obrigatória para `pa >= 202611`; cada item possui `pa` AAAAMM e `valor` numéricos. Não resolve lista vazia, cobertura já declarada ou 2027. |
| [Changelog PGDAS-D](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/changelog/) | Cabeçalho 1.0.0 de 23/09/2022; rodapé 03/11/2026 | Registra mudança de obrigatoriedade após 10/2026. A numeração 1.0.0 não distingue sozinha este contrato atualizado. |
| [Mensagens PGDAS-D](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/mensagens/) | Rodapé 03/11/2026 | Há evidência de aproveitamento de folhas anteriores, mas também mensagens históricas que exigem interpretação temporal. Detalhes abaixo. |
| [CONSDECLARACAO13](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/) | v1.0; consulta por ano ou PA | Retorna índices de operações, declarações e DAS. Número, horário e indicação de malha não constituem uma série mensal FS12. Não há valores mensais tipados no contrato mostrado. |
| [CONSULTIMADECREC14](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_ultima_declaracao_recibo/) | v1.0; entrada PA | Retorna número e documentos PDF da última declaração/recibo/MAED. Não oferece série mensal estruturada de folha. “Última” não comprova associação com a revisão local do cálculo. |
| [CONSDECREC15](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_recibo/) | v1.0; entrada número da declaração | Permite endereçar declaração específica, mas os detalhes são documentais, não uma série FS12 tipada. Extração de PDF exigiria contrato próprio, validação de identidade e autorização separada. Não executada aqui. |

### Janela fiscal e início de atividade

O manual 8.2 distingue FS12, encargos incluídos e fontes declaradas de folha. Em 8.2.1, para Fator R: empresa estabelecida utiliza os doze meses anteriores; no mês de abertura considera folha/receita desse PA; nos primeiros meses considera abertura até o mês anterior. A seção 8.2.2 estende a informação aos PAs 11 e 12/2026 independentemente da atividade. A seção 8.3 identifica início de atividade pela inscrição no CNPJ.

**Limite da evidência:** a aplicação da exceção de primeiro mês a atividades sem Fator R, no novo protocolo, precisa de confirmação fiscal específica. A abertura no meio do mês não fundamenta rateio diário da FS12 nem criação de zeros anteriores. A política local B1 opera com mês de abertura, preservada; não constitui prova de aceite remoto dessa seleção.

### Mensagens relevantes para selecionar períodos

- `MSG_ISN_029`: solicita períodos faltantes; admite aproveitar folha informada em transmissão anterior. Se reenviada, a folha informada prevalece no cálculo.
- `MSG_ISN_030`: alerta para efeito da alteração de folha em apurações posteriores; não autoriza retificação automática.
- `MSG_ISN_045`: texto histórico recusa folha sem atividade que a demande. Não usar para retirar a exigência nova de novembro/dezembro nem mudar atividade para satisfazer o serviço.
- `MSG_ISN_047`: recusa período desnecessário. Não define se significa fora da janela, já informado ou outra condição.
- `MSG_ISN_071`: exige valor de folha a partir de 11/2026. Não define representação quando todos os meses já constam no provedor.

Esses códigos são apresentados aqui sem o prefixo de categoria; a tabela oficial utiliza, por exemplo, `EntradaIncorreta-PGDASD-MSG_ISN_029`. A implementação deve preservar códigos completos existentes.

## Matriz temporal e lacunas do transporte

Fonte complementar: [Saída TRANSDECLARACAO11](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_saida/), rodapé 25/02/2026, registrada no manifesto pelo principal. O retorno descreve identificador/instante da declaração, valores e documentos, sem eco documentado das identidades locais B3.2. Isto delimita a correlação futura, não comprova que um número existente pertença a uma tentativa local.

| PA | Janela local para empresa estabelecida | Exigência declaratória | Estado do transporte nesta entrega |
|---|---|---|---|
| 10/2026 | 10/2025–09/2026, quando aplicável | Política histórica por atividade | Caracterizar legado; não aplicar retroativamente a exigência universal |
| 11/2026 | 11/2025–10/2026 | Todas as atividades abrangidas pela regra nova | Seleção enviada depende de evidência anterior válida e contrato ainda incompleto |
| 12/2026 | 12/2025–11/2026 | Todas as atividades abrangidas pela regra nova | Mesma restrição; não presumir que transmissão de novembro confirmou todos os meses |
| 01/2027 | Não homologar seleção por extrapolação | Política temporal B1 mantém pendência | Bloqueado; novo manual/contrato e revisão fiscal necessários |

Os intervalos da tabela são a janela **local completa**, não uma recomendação de enviar todos esses itens. Empresa recém-aberta deve seguir a fase da política temporal e permanecer sujeita às lacunas explicitadas acima.

| Situação | Evidência disponível | Conclusão segura |
|---|---|---|
| Lista omitida em PA 11/12 | Entrada indica obrigatoriedade | Não considerar aceita sem esclarecimento específico |
| Lista vazia quando todos os meses já foram declarados | MSG 029 permite aproveitamento, sem formato para esse caso | Desconhecido; vazio não equivale a zero comprovado |
| Lista parcial com meses anteriormente declarados | MSG 029 respalda conceito de aproveitamento | Faltam prova da cobertura remota, regras de escolha e compatibilidade dos valores/revisões |
| Lista completa com meses repetidos | Reenvio pode prevalecer no cálculo; MSG 047 é ambígua | Não adotar como fallback automático ou operação sem consequências |
| Valor zero explicitamente confirmado | Número permitido no modelo de entrada | Evidência local de zero não prova por si só aceite remoto do conjunto |
| Mês ausente, fonte incompleta ou revisão divergente | Não há evidência suficiente | Não preencher, copiar valor anterior ou inferir zero |
| Índice de declaração anterior disponível | Serviços 13–15 não fornecem série mensal tipada | Não subtrair meses apenas por existência de declaração ou PDF |

## Critérios antes de integração efetiva

1. Manter distintos: série local completa confirmada, vínculo imutável B3.2 e subconjunto proposto para o provedor.
2. Obter confirmação oficial/documentada para omissão, vazio, todos os meses conhecidos, repetição e início de atividade sem Fator R. Alternativa segura enquanto pendente: preservar bloqueio; não descobrir comportamento com clientes reais.
3. Definir prova de origem, identidade da empresa, competência, declaração e valores de qualquer cobertura reaproveitada. Índice, tentativa e resultado incerto não equivalem a declaração comprovada.
4. Homologar a seleção com revisão fiscal humana e testes de transporte simulado; fixtures caracterizam o software, não homologam a Receita/SERPRO.
5. Tratar correlação de resposta oficial e resultado incerto em incremento aprovado. `indicadorTransmissao=false` ainda envolve serviço externo e não está autorizado neste levantamento.
6. Não alterar Fator R, anexos, regime, payload produtivo ou bloqueios B3.2 com base nesta análise. Aprovação desta documentação não libera despacho, integração ou publicação.

## Limitações e decisão pendente

Não há prova remota de aceite/recusa das combinações acima. A aparente abrangência `>=202611` do schema técnico não supera o limite temporal explícito da notícia/manual. As decisões sobre campos vazios, folha anteriormente declarada e abertura no meio do mês devem permanecer pendentes até esclarecimento fiscal/protocolo. Nenhum mecanismo de leitura automática de PDF, importação de folha ou integração com outros módulos foi introduzido.
