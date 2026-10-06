# Plano de atualização do emissor de NFS-e

Data de referência: 05/10/2026. Base analisada: `16e5d73472eea1faadbd376e5b3ace9506277b9b`. Desenvolvimento local na branch `codex/adequacao-nfse-rtc`, após autorização para executar. A carteira utiliza exclusivamente a NFS-e Nacional, conforme informado pelo usuário. Não criar integrações por prefeitura. Os dados de município da prestação/incidência continuam presentes quando exigidos pelo contrato nacional.

## Situação da execução

- Ambiente preparado em `C:\Users\yagoa\code\api-app-contabilidade`, com banco local e serviços de desenvolvimento.
- Fontes oficiais versionadas em `documentacao-tecnica/rtc-2026-10-05`, com URLs, data e SHA-256 no manifesto. Incluem NT 009, Anexos VI/VII, Anexo C, tabela SVRS, manual de DV do CNPJ e XSD de julho.
- Corrigido o bloqueio indevido pelo Anexo VIII no cadastro e no pré-voo. As correlações continuam como sugestões, com indicação explícita na tela.
- Implementada a conferência de cIndOp pelo Anexo C, existência de CST/classificação, relação CST/cClassTrib, indicador de uso em NFS-e e vigência publicada por competência. O cadastro sem competência não é validado contra a data do servidor. A tabela é um snapshot, não um histórico completo de revisões.
- Incluídas opções das tabelas oficiais nos campos do perfil. Nenhum benefício ou enquadramento é escolhido automaticamente.
- CNPJ alfanumérico implementado no percurso de NFS-e: normalização compartilhada, cadastro, tomador/destinatário, ID da DPS, conferência do certificado, importação em lote, captura ADN, DANFSe, memória/reaproveitamento, interfaces e coleta do assistente. Letras e zeros são preservados. O novo formato tem DV validado pelo algoritmo da Receita; cadastros numéricos mantêm a compatibilidade anterior. Isso não significa homologação de CNPJ alfanumérico em todos os produtos externos, como SERPRO.
- Contrato de geração identificado pelo pacote de 27/07/2026, além do atributo `versao="1.01"`. Acrescentado job XSD completo, assinatura real com chave sintética e contraprova de adulteração.
- Corrigidas duas divergências históricas de XML: complemento municipal curto e caracteres incompatíveis nos campos de endereço/e-mail são recusados no pré-voo, antes de reservar numeração. Acentos e o texto livre da descrição permanecem preservados.
- DPS assinada, contrato e configuração fiscal da tentativa são gravados antes do envio. O XML autorizado continua separado. Migration aplicada somente ao banco local. O snapshot descreve a tentativa corrente; não foi criado um histórico imutável de todas as retentativas.
- Parser do DANFSe preparado para finalidade, destinatário e classificação nos caminhos da NT 009, mantendo leitura histórica; versão da calculadora disponível nos metadados. Exercitado com fixtures sintéticas, sem afirmar autorização externa desses novos documentos.
- Ainda pendentes: geração dos novos grupos/finalidades da NT 009, perfis do Simples previstos para o novo contrato, conciliação/exportação fiscal desses fluxos e homologação externa. Pedidos explícitos desses grupos ainda não suportados recebem recusa; não são convertidos silenciosamente em notas regulares.
- Sem publicação ou alteração de configurações de produção. A conclusão desta primeira entrega não representa conformidade integral com todas as fases da reforma.

### Condições mantidas

A consulta pública auxiliar foi mantida numérica até homologar seu fornecedor para o novo CNPJ; cadastro/emissão alfanuméricos permitem preenchimento manual. O regime histórico existente no sistema permanece informativo, conforme a decisão documentada no modelo; esta entrega não passou a usar registros históricos sem validação contábil para alterar a tributação. Implantação de NT, enquadramento e autorização para publicar são condições distintas. O usuário determinou que `main` e produção só sejam alteradas após autorização explícita posterior.

## Diagnóstico do código existente

O emissor nacional já existe. A evolução deve aproveitar os serviços, cadastros, telas e testes atuais.

| Área | Evidência no repositório | Consequência para o plano |
|---|---|---|
| Emissão | `apps/api/src/application/nfse/NfseService.js`: DPS 1.01, assinatura, compressão, envio e consulta | Evoluir o serializador por versão de contrato, sem substituir o serviço inteiro |
| IBS/CBS | `ibscbsDaDps.js` e geração em `NfseService.js` | Grupo condicionado à flag e ao perfil; código instalado não prova ativação em produção |
| Classificação | `ibscbsDaDps.js`: CST com validação de forma; par cIndOp/cClassTrib bloqueado pelo Anexo VIII | Revalidar a fonte de cada bloqueio e acrescentar tabelas oficiais completas |
| Perfil fiscal | `perfilEmissao/campos.js`, modelo no Prisma e telas correspondentes | Acrescentar vigência e campos novos onde forem necessários; reaproveitar cadastro existente |
| CNPJ | `NfseService.js` usa `replace(/\D+/g, "")` para CNPJ; `validators/nfsePayload.js` usa `onlyDigits` | Letras seriam descartadas; auditar o percurso completo antes de aceitar o novo formato |
| DANFSe | `danfse/danfseDados.js` e `danfseLeiaute.js` já leem campos IBS/CBS por caminho | Atualizar caminhos por versão e preservar a representação de notas históricas |
| Testes XML | `__tests__/dpsContraXsd.test.js` | Verificador próprio é parcial: seu cabeçalho exclui atributos, assinatura e alguns limites de ocorrência |
| Novos grupos | Busca nos fontes não encontrou `gIBSCBSAjuste`, `regApIBSCBSSN`, `gTribSN`, `gPgtoVinc`, `vAjusteBC` | Tratar como lacunas para comparação de contrato; não presumir obrigatoriedade universal |

## Fontes e mudanças normativas a acompanhar

- [Portal RTC](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc), consultado em 05/10/2026: lista NT 009 v1.01, Anexo VI v1.04.01 e Anexo VII v1.03.00. O Anexo VIII é apresentado como trabalho inicial, sem regras de negócio baseadas nele em homologação ou produção. A aplicação hoje é mais restritiva que essa orientação.
- [NT 009 v1.01](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf): reposiciona finalidade/destinatário e CST/cClassTrib; altera ocorrências do grupo IBS/CBS. Prevê ajustes de crédito/débito, ajustes de base, campos do Simples, pagamentos vinculados e versão da calculadora. Também trata CNPJ alfanumérico e operações especiais. A própria NT remete o cronograma de implantação a divulgação específica. Seu texto cita versão do Anexo VII diferente da listagem do portal; conferir artefato e hash antes de gerar tabelas.
- [Documentação de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) e [implantações](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes): verificar contrato aceito por ambiente antes de ativar novos campos. Publicação de NT não comprova implantação.
- [Cronograma da Receita](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria): distingue serviços gerais, específicos e Simples. A carteira ainda não foi analisada; não atribuir um único prazo a todos os clientes.

## Sequência de implementação

### P0 — fechar o contrato e a aplicabilidade (estimativa: 2–3 dias úteis)

1. Integração confirmada: NFS-e Nacional para toda a carteira. Inventariar regime por competência, códigos de serviço e operações efetivas, sem segmentar desenvolvimento por provedor municipal. Solicitar somente dados necessários; não copiar produção para o banco de desenvolvimento.
2. Confirmar, por leitura autorizada de configuração, flags, endpoint e versão efetivos no servidor. Registrar apenas nomes/valores não secretos.
3. Versionar os artefatos oficiais necessários com URL, versão, data e SHA-256, seguindo `docs/leiaute-nfse/documentacao-tecnica/README.md`.
4. Produzir matriz campo → origem (cadastro/operação/retorno) → tipo/ocorrência → regra → vigência → ambiente → teste.
5. Confirmar com a contabilidade os enquadramentos aplicáveis, sem derivar benefícios automaticamente de CNAE ou NBS.

Aceite: cada bloqueio e campo obrigatório tem fonte e condição explícitas; datas de publicação, homologação e produção estão separadas.

### P0 — corrigir validações e preparar CNPJ (3–5 dias)

- Substituir o uso do Anexo VIII como lista exclusiva de autorização por orientação de preenchimento, mantendo bloqueios que tenham fundamento nas tabelas/regras oficiais aplicáveis.
- Validar CST, cClassTrib, indicador da operação e compatibilidades por tabelas oficiais versionadas; não completar CST por prefixo sem regra comprovada.
- Separar normalização de CPF e CNPJ; revisar cadastro, payload, identificação da DPS, certificados, consultas, busca, importação, impressão e integrações.
- Preservar CNPJs numéricos e zeros iniciais. Confirmar o algoritmo oficial de DV e suporte de cada contrato antes de liberar alfanuméricos.

Aceite: casos válidos fora do Anexo VIII não são recusados só por essa ausência; casos oficialmente inválidos são recusados antes de reservar numeração; nenhum CNPJ perde letras.

### P1 — adaptar contrato da emissão (4–7 dias)

- Separar composição dos leiautes em adaptadores identificados pela versão efetivamente aceita no ambiente.
- Ajustar posições/ocorrências de finalidade, destinatário e classificação, incluindo a exigência condicional de `gIBSCBS`.
- Evoluir perfil e formulário para regime IBS/CBS do Simples, atividade e finalidade quando aplicáveis; distinguir dado ausente de zero.
- Tratar bases e campos de retorno sem misturar ISS com IBS/CBS nem aplicar valores futuros à competência passada.
- Preservar XML assinado, resposta, contrato usado e configuração fiscal da emissão para auditoria.

Aceite: XML integral validado contra XSD do ambiente, campos incompatíveis não enviados e notas antigas continuam legíveis. Não basta atualizar a constante DPS_VERSAO.

### P1 — acompanhar os valores autorizados (2–4 dias)

- Atualizar parser, DANFSe, detalhe da nota e exportação contábil, reaproveitando os componentes existentes.
- Conciliar classificação, bases e tributos com o XML autorizado; informar divergências sem sobrescrever silenciosamente o documento.
- Preservar versão da calculadora, quando retornada, e contexto para investigação.
- Mostrar claramente quando o cadastro está preenchido mas a integração não está habilitada para aquela emissão.

Aceite: XML, tela, PDF e exportação concordam; cenários históricos e ausência de IBS/CBS continuam corretos.

### P2 — novos fluxos conforme a carteira (3–6 dias ou mais)

- Notas de ajuste de crédito/débito: finalidade, tipo, referência e valores; não reutilizar cancelamento como ajuste.
- Pagamentos vinculados: captura, conciliação e validação conforme contrato. Isso não equivale, sozinho, a implementar split payment.
- Serviços com particularidades (exterior, imóveis, locação, eventos, condomínios): priorizar somente após inventário e disponibilidade do ambiente.

Aceite: cada novo fluxo tem regra documentada, tela, persistência, retorno e testes próprios. Operação não suportada recebe mensagem clara.

### P1 — homologação e ativação (2–4 dias, após as etapas aplicáveis)

- Cobrir emissão normal, retenções, descontos/ajustes, Simples/MEI/regime regular, tomador diferente do destinatário, CNPJ numérico/alfanumérico e mudança de competência.
- Acrescentar validação XSD completa ao verificador parcial existente; testar também rejeições e regras fora do XSD.
- Exercitar timeout após autorização, consulta antes de reenvio, duplicidade, numeração, substituição e cancelamento.
- Homologação externa depende de certificado de teste, empresa habilitada e endpoint confirmado. Testes locais não comprovam autorização fiscal.
- Ativar por empresa e contrato, com primeira nota conferida. Recuar a configuração apenas para contrato ainda aceito pelo autorizador; nunca apagar notas autorizadas.

## Dimensionamento e dependências

Estimativa inicial de engenharia: 13–23 dias úteis para o núcleo (P0/P1), antes de operações especiais. Faixas não são prazo regulatório nem compromisso fechado; dependem da matriz, disponibilidade do ambiente e cobertura da carteira. Revisar após P0.

Entregas sugeridas: (1) fontes e matriz; (2) validações/CNPJ; (3) adaptador e perfil; (4) leitura/DANFSe/exportação; (5) novos fluxos; (6) evidência de homologação e ativação.

Trabalho paralelo de plataforma, fora da mudança fiscal: avaliar migração do Node 20 declarado pelo projeto para LTS suportada, revisar dependências antigas e avisos de bundle. Atualizar o lockfile em mudança separada, após testes; não fazer upgrade amplo junto com o leiaute.

## Pendências para fechar o escopo

Regimes e serviços reais; configuração efetiva de produção; disponibilidade dos novos contratos; acesso de homologação. A integração nacional já foi confirmada pelo usuário; não é uma pendência nem requer lista de provedores municipais. As demais informações não foram inferidas do ambiente local vazio.

## Base de validação disponível

Ambiente local preparado conforme `desenvolvimento-windows.md`. Em 05/10/2026 passaram 862 testes em 41 suítes selecionadas do backend e 261 testes em 12 suítes da interface. Builds dos workspaces aprovados, com avisos de tamanho de bundle. Migrações, login e readiness locais verificados. Os testes existentes comprovam a base atual, não conformidade com leiautes futuros ou autorização pelo ambiente fiscal.

Após a correção das tabelas RTC: 873 testes em 42 suítes do backend e 288 testes em 14 suítes da interface aprovados. Build dos workspaces aprovado, mantendo os avisos de tamanho de bundle. Geração offline das tabelas reproduzida com hash idêntico. Serviços reiniciados com o código atualizado; API, readiness, PDF e interfaces retornaram HTTP 200. Evidências locais: `.local/rtc-tests-final.log`, `.local/rtc-web-tests.log` e `.local/rtc-build.log`. Nenhuma nota foi enviada ao autorizador.

Após CNPJ, auditoria e correções de XML: suíte ampliada com 1.803 testes em 92 suítes do backend, 1.066 testes em 68 suítes do contador e 897 testes em 44 suítes do portal, todos aprovados. O teste adicional de cadastro alfanumérico e a assinatura com PFX sintético foram aprovados no job complementar (31 testes). O validador XSD completo aprovou nove DPS geradas, incluindo uma assinada; a contraprova com ID inválido foi recusada. A assinatura válida foi conferida criptograficamente e a alteração do CNPJ após assinatura foi detectada. Não foi usada chave nem certificado de cliente.

Evidências: `.local/dev-nfse-api-verificado.log`, `.local/dev-nfse-web-verificado.log`, `.local/dev-nfse-portal-verificado.log`, `.local/dev-nfse-xsd-confirmado.log` e `.local/dev-nfse-build-final.log`. Auditoria das migrations aprovada. Prisma Client e colunas novas conferidos contra o banco local; nenhuma migration foi aplicada fora dele. A consulta externa, autorização de nota e habilitação dos novos fluxos da NT 009 permanecem fora dessas evidências.
