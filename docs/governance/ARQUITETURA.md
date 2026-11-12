# Arquitetura da Altan

Estas instruções se aplicam a código novo e ao trecho efetivamente alterado. A Altan mantém um monorepo e uma API em monólito modular. A referência operacional, as instruções locais, os perfis e a política de revisão continuam regendo cada entrega. Uma extração técnica preserva as decisões de negócio aprovadas e os contratos observáveis.

## Antes de editar

1. Identifique a operação, seu contexto dono e o ponto de entrada real (HTTP, worker, webhook, interface ou script). Leia as instruções ancestrais e locais. Use o plano de impacto de `scripts/governance/check.mjs` e confira no código quem chama a operação, lê seus dados ou reage aos seus efeitos.
2. No registro existente em `docs/governance/changes/`, indique domínios diretos, consumidores concretos e impacto sobre cada um (inclusive compatibilidade quando o impacto for nulo). Declare efeitos em contrato, permissão por empresa, escrita, auditoria, concorrência e regra operacional quando aplicáveis. Registre testes, risco, pendências e rollback. O mapa de domínios dá um piso; ele não identifica toda dependência indireta.
3. Para fluxos legados, caracterize o comportamento antes de mover responsabilidades. Prefira um caso de uso por incremento reversível. Mudanças de precisão monetária, ordem dos erros, semântica de datas, idempotência ou política de reabertura exigem decisão própria quando alteram o comportamento.

## Direção das dependências

| Camada | Responsabilidade e dependências |
| --- | --- |
| Domínio | Entidades, cálculos e políticas do próprio contexto. Recebe fatos como argumentos e devolve decisões. Não introduzir dependências de Prisma, Express, SDKs, configuração do processo, rede, banco ou sistema de arquivos. Passar datas e valores externos quando influenciam uma decisão. |
| Aplicação | Coordena o caso de uso. Depende do domínio próprio, de operações de leitura/escrita explícitas e da API pública dos contextos fornecedores. O caso de uso recebe capacidades pela composição; não importa a implementação do banco, o roteador ou o cliente de um provedor. |
| Infraestrutura | Implementa persistência, storage e integrações. Traduz os contratos e falhas dos provedores e limita cada adaptador aos dados do seu contexto. O cliente de banco, inclusive o transacional, fica dentro desta fronteira. |
| Apresentação | Rotas, webhooks, pontos de entrada de workers e interfaces interpretam entrada, sessão e resultado. Chamam os casos de uso e traduzem estados e erros públicos. Regras que determinam se uma operação de negócio pode ocorrer pertencem ao contexto dono. |

Na API, para um recorte migrado, use `apps/api/src/modules/<contexto>/` e um ponto público mínimo, como `public.js`. Consumidores externos não importam arquivos internos de outro contexto. O ponto público expõe somente operações/dados utilizados; evite reexportar um módulo inteiro. A composição conecta fábricas concretas. Toda dependência nova entre contextos deve ter direção explícita e não pode introduzir ou ampliar ciclo. Se dois módulos precisam se chamar de volta, examine se um caso de uso pode coordenar ambos ou se uma consulta explícita é suficiente. Um evento exige fato, consumidor e semântica de entrega identificados.

Preserve os pontos de entrada e as fachadas legadas enquanto houver consumidores. Não migre em massa pastas ou linguagens para obter conformidade nominal. Em `packages/shared`, compartilhe apenas contratos ou funções de significado estável e com consumidores identificados; preserve a direção dos workspaces, sem dependência de uma aplicação.

## Quem decide e quem escreve

Um contexto define as invariantes e autoriza as escritas do fato de que é dono. Outro contexto lê uma projeção escopada ou solicita um comando público. Uma tabela física compartilhada pode conter fatos com donos distintos: delimite campos e operações (por exemplo, fechamento contábil na circular ou prefixo de auditoria em AppSetting).

| Contexto | Responsabilidade relevante |
| --- | --- |
| Guias e Contabilidade | Guias coordena a correção da guia e registra sua evidência e auditoria. Contabilidade decide a elegibilidade de provisões, linhas e competências e responde pelas respectivas escritas. |
| Financeiro e Análise Gerencial | Financeiro distingue movimento, saldo e previsão. Análise consome leituras autorizadas para DRE gerencial, indicadores e cenários. Alterar um relatório não dá autoridade para reclassificar o razão ou modificar o caixa. Confirme a finalidade e o dono de operações de Declarados antes de transferi-las. |
| Fiscal, Notas e Documentos | O contexto fiscal responde pela interpretação, apuração e transmissão; emissão/captura mantém a identidade do documento e Documentos custodia a evidência e a origem. Um anexo recebido não comprova conclusão de uma operação fiscal. |
| DP, Cadastro, Identidade e Comunicação | Respeite o escopo aprovado de folha/pró-labore e a atribuição existente à Nasajon. Cadastro fornece dados da empresa e do responsável. Identidade e Acesso verifica sessão, vínculo de acesso e papel por empresa. Comunicação responde pelo envio e sua comprovação. Disponibilidade de arquivo, autorização de entrega e recebimento são fatos distintos. |
| Operações, Obrigações e demais áreas | Operações coordena etapas e registra progresso, bloqueios e evidências. Cada participante valida o comando e escreve o próprio resultado. Obrigações responde pelas ocorrências e sua vigência. Em outros fluxos, declare explicitamente o dono e valide atribuições ambíguas antes de transferir dados ou comportamento. |

Defina nos contratos públicos os dados mínimos de entrada e saída, empresa, identidade ou finalidade autorizada, recusas observáveis e garantias de consistência/repetição. Preserve o comportamento contratado pelos consumidores existentes. Um contrato de módulo pode ser uma função; não exige serviço HTTP interno, classe abstrata ou repositório genérico.

## Aplicação nos componentes

- **API e workers.** Validar autorização no servidor antes da operação e filtrar dados por empresa também na persistência. O ator vem da sessão ou da identidade de serviço autorizada. Tratar conta global somente conforme a regra existente. Workers preservam reserva, deduplicação e política de retomada quando houver efeito externo incerto.
- **Frontend do escritório e portal do cliente.** Organizar a funcionalidade por fluxo; componentes apresentam estados e disparam operações, e a camada de acesso da feature traduz o contrato HTTP. Validar troca de empresa, respostas atrasadas, estados vazio/erro e sessão expirada quando pertinentes. Não copiar regra fiscal/contábil para autorizar uma escrita na tela. Preservar as revisões UI/UX e os critérios visuais já vigentes.
- **Infraestrutura de runtime e implantação.** Manter Prisma e SDKs nos adaptadores; regras operacionais ficam no módulo dono. Em `infra/`, delimitar serviços consumidores, compatibilidade de configuração, tratamento de segredos e forma de reversão. Não registrar credenciais, PDFs, tokens ou dados de cliente em logs de diagnóstico. Alterações de schema seguem a governança de Prisma, com tratamento explícito dos dados existentes.
- **Transações e auditoria.** Quando uma invariante exige confirmação conjunta, declarar o coordenador e as escritas obrigatórias. Ligar os adaptadores ao mesmo cliente transacional; impedir fallback para cliente global dentro do callback. No piloto, manter Serializable, releitura de guia/provisão/fechamento/revisão, atualização condicional e auditoria na mesma transação. Ler o PDF antes dela. A correção de guia não usa o bloqueio por empresa empregado pelo fechamento contábil. Avaliar a invariante de cada outro fluxo antes de escolher isolamento ou coordenação.

## Qualidade e evidência

Use nomes do vocabulário do negócio e funções proporcionais à decisão. Separe decisão pura de I/O. Preserve a ordem de validação e torne visível o ponto em que um efeito ocorre. Reutilize lógica que já preserva o contrato; não introduza abstração genérica para uma única operação nem misture uma limpeza ampla a uma correção localizada.

Escolha os testes pelo risco: unitários da decisão e da precedência; contrato do ponto de entrada com sucesso, recusas e isolamento entre empresas; integração com PostgreSQL descartável para transações, rollback e concorrência; dublês para serviços externos. Para UI, adicione a evidência visual e funcional exigida pelo escopo. Cobrir o consumidor afetado e a regressão que motivou a mudança. Testes nunca autorizam envio, transmissão, acesso a dados reais ou deploy.

## Verificação automática

O verificador em `scripts/governance/arquitetura/verificar.cjs` mede imports e chamadas reconhecíveis em `apps/api/src`. Com as dependências instaladas na árvore que fornece o verificador, execute a mesma versão dele nas duas árvores:

```sh
node scripts/governance/arquitetura/verificar.cjs snapshot "$BASE_CHECKOUT" > baseline.json
node scripts/governance/arquitetura/verificar.cjs diagnose "$PR_CHECKOUT" baseline.json
```

Use o merge-base efetivo do PR como referência. Em `diagnose`, os acréscimos aparecem no relatório; um erro técnico de execução falha o diagnóstico. O legado conhecido não concede licença para novas violações. Revise os achados no diff, registre a decisão e preserve a linha de base. O modo bloqueante `check` só deve ser promovido após aprovação específica.

Imports dinâmicos, apelidos do cliente, efeitos indiretos, propriedade por campo, permissões, segurança dos SDKs, comportamento de frontend e atomicidade não são integralmente verificáveis por essa análise. Para esses pontos, a evidência vem do diff, dos testes e dos revisores do fluxo normal. Instruções arquiteturais não mudam os poderes do controlador nem substituem a política de risco.

## Não regressão e exceções temporárias

Avalie cada acréscimo ou ampliação de uma dependência indevida por regra, origem e destino. A remoção de um achado em outro ponto não compensa uma regressão. Durante o diagnóstico, o autor e os revisores tratam cada achado novo no PR: corrigem a violação, demonstram um falso positivo com evidência reproduzível ou registram uma exceção temporária pelo fluxo de risco vigente. Um PR pode ter CI verde em `diagnose` e ainda exigir correção na revisão.

Quando uma restrição concreta de compatibilidade impedir a correção no incremento, registre no arquivo da mudança em `docs/governance/changes/`: regra, caminho e operação exatos; motivo e alternativas avaliadas; domínios e consumidores afetados; risco e teste compensatório; responsável pela remoção; data limite e tarefa rastreável com critério de encerramento. Submeta o registro aos mesmos revisores e à aprovação humana aplicável. Uma exceção arquitetural não dispensa autorização por empresa, proteção de dados, atomicidade contratada ou regras operacionais.

O achado permanece visível. Não altere o baseline, o verificador ou a abrangência do diagnóstico para ocultá-lo. Quem revisa uma mudança no trecho consulta também as exceções ainda abertas: após a integração a ocorrência pode já fazer parte do baseline. O responsável verifica a pendência até a data limite; no vencimento, a autorização expirou. Remova a violação ou apresente nova justificativa, prazo e revisão antes de continuar se apoiando nela. Registre o encerramento com o diff da remoção e o teste correspondente. O verificador atual não lê registros de exceção nem controla prazos.

## Condições para promover o diagnóstico a bloqueio

A promoção requer uma mudança separada de governança. Antes de aprová-la:

1. Nomear as regras, diretórios e eventos cobertos. O `check` atual avalia toda a API; um bloqueio restrito a um piloto exige antes um filtro testado. Definir o resultado esperado para PRs fora do escopo e preservar a CI existente.
2. Comprovar em CI hospedada, no SHA candidato e sobre o merge-base efetivo, que o comando proposto retorna **0** em diff limpo ou que só reduz legado, **1** em fixture com nova violação e **2** em erro técnico. Ter casos aceitos e recusados para cada regra a promover, inclusive substituição de uma ocorrência por outra de chave diferente.
3. Classificar os achados das mudanças representativas de cada regra e resolver todos os falsos positivos impeditivos antes da promoção. Documentar os limites de detecção. Para cada exceção aberta no escopo, demonstrar sua remoção ou testar o tratamento explícito, restrito à ocorrência e com expiração. Sem esse mecanismo, um acréscimo excepcional continua reprovando em `check`.
4. Usar uma versão confiável e identificada do analisador e do parser nas duas árvores; exigir revisão independente de mudanças no verificador e no workflow. Ensaiar retorno a `diagnose` sem perder o relatório, os testes ou o histórico das exceções.
5. Anexar os SHAs, logs e pareceres ao registro da mudança e obter aprovação explícita para ativação. Só então configurar o check obrigatório correspondente. Até lá, o workflow permanece em `diagnose`.
