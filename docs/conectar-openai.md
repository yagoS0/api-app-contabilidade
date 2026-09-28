# Conectar a OpenAI ao pré-atendimento

## O que você precisa fazer agora

1. Entre na [OpenAI Platform](https://platform.openai.com/). Crie/selecione um projeto para o Altan, para separar o uso do app.
2. Confira [Billing](https://platform.openai.com/account/billing/overview) e habilite o faturamento/créditos necessários para usar a API. Defina um orçamento inicial de testes.
3. Em [API keys](https://platform.openai.com/api-keys), crie uma chave desse projeto. A integração precisa poder criar respostas na Responses API e acessar `gpt-5.4-mini`.
4. No arquivo privado `.env.openai.local`, na raiz de `ia-leads-work`, preencha somente `OPENAI_API_KEY=` com a chave. Não coloque a chave no chat, no código, no frontend ou em arquivos `VITE_*`. O arquivo foi criado sem chave e foi conferido como ignorado pelo Git.
5. Deixe os demais valores desligados. Depois de salvar, avise apenas que a chave está configurada e informe o teto autorizado para os testes — por exemplo, US$ 1. Não precisa copiar a chave para a conversa.

O arquivo é apenas para os testes locais. Criar a chave não publica esta branch, não conecta o WhatsApp e não ativa respostas para clientes.

Fontes: [início rápido oficial](https://developers.openai.com/api/docs/quickstart) e [proteção de chaves em produção](https://developers.openai.com/api/docs/guides/production-best-practices). A disponibilidade e o saldo precisam ser verificados na sua conta; não foram confirmados por esta tarefa.

## Verificação local sem custo

Na raiz de `ia-leads-work`:

```powershell
node apps/api/scripts/verificar-openai.mjs --env-file=.env.openai.local
```

O comando confirma apenas a presença da chave e das flags. Não imprime chave nem telefones e não faz chamadas externas. `conexaoVerificada: false` é esperado nesse modo.

Se `node` não estiver disponível no terminal deste computador, o runtime já utilizado nos testes está em:

```powershell
& 'C:\Users\yago\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' apps/api/scripts/verificar-openai.mjs --env-file=.env.openai.local
```

## Primeiro teste real, depois da autorização de gasto

```powershell
node apps/api/scripts/verificar-openai.mjs --env-file=.env.openai.local --live --max-usd=0.03
```

É uma única chamada com frase fictícia, sem WhatsApp, banco ou dados de clientes. O limite é uma reserva de custo **estimado**, pela tabela do app; a cobrança efetiva é da OpenAI. Não há retentativa automática. O resultado só confirma a integração quando o modelo devolve o contrato esperado; não equivale à aprovação de qualidade do atendimento.

Depois, executar o conjunto de conversas com orçamento autorizado:

```powershell
node apps/api/scripts/eval-leads-openai.mjs --env-file=.env.openai.local --live --max-usd=0.97 --max-requests=160 --conjunto=desenvolvimento --orcamento=test-evidence/orcamento-autorizado-20260927.json
```

Em 27/09 o usuário autorizou US$ 1 no total: US$ 0,03 foram separados para a chamada inicial e US$ 0,97 para o laboratório. Todas as rodadas devem reutilizar o mesmo arquivo de orçamento e o mesmo teto; criar outro arquivo reiniciaria a contagem e exige contabilizar a autorização restante. O saldo de US$ 10 não amplia a autorização.

O laboratório registra a reserva antes de cada chamada e o consumo em milionésimos de dólar; chamadas sem consumo conhecido conservam a reserva inteira. Um bloqueio impede duas rodadas simultâneas no mesmo orçamento. Após interrupção, revisar reservas antes de remover um bloqueio remanescente. A guarda de produção continua usando centavos arredondados para cima.

O teto pode encerrar a avaliação antes das 100 conversas. `--conjunto=desenvolvimento` usa 80 casos; `--conjunto=reservado` usa os 20 separados da calibração. `--repeat-critical=5` repete casos críticos. Para verificar apenas a estrutura, sem custo, usar `--dry-run`. Os relatórios e o consumo são persistidos em `test-evidence`; a revisão humana continua necessária.

Variáveis já presentes no ambiente têm prioridade sobre o arquivo indicado. Os utilitários não importam a configuração completa do app nem leem outros arquivos de ambiente automaticamente.

## Quando chegar a hora de habilitar números internos

### Avaliação de diálogos — autorização de 28/09

O usuário autorizou **mais US$ 5 no total** para os testes desta etapa. Esse orçamento é separado do anterior e todas as novas rodadas reutilizam o mesmo arquivo abaixo; não criar um orçamento novo para cada execução.

```powershell
node scripts/run-dialogos-openai-postgres.mjs "C:\Program Files\PostgreSQL\15\bin" --env-file=.env.openai.local --max-usd=5 --orcamento=test-evidence/orcamento-adicional-20260928.json --conjunto=todos --repeticoes=3
```

Executar na raiz da cópia isolada, com PostgreSQL instalado e a porta local 55444 livre. O comando usa modelo real e banco descartável, captura as respostas do app e encerra o banco ao finalizar. Não envia mensagens a clientes. `--grupo=retomada-completa` restringe aos casos adicionais de retomada; `--conjunto=reservado` restringe aos casos separados da calibração. Não executar rodadas pagas simultâneas no mesmo orçamento.

O arquivo `dialogos.json` de cada rodada contém transcrições fictícias, interpretações, tokens e custo. Para gerar conversas legíveis e métricas, executar `node apps/api/scripts/relatorio-dialogos-leads.mjs CAMINHO_DO_DIALOGOS_JSON`. A média mede o custo da OpenAI por conversa completa do pré-atendimento; a projeção sem cache só é calculada quando todas as chamadas têm uso conhecido. Falhas sem uso conhecido conservam a reserva e não viram custo zero.

### Configuração do piloto

Após avaliação e revisão, as variáveis abaixo pertencem **ao serviço da API**, nunca ao site frontend. O repositório contém configuração de deploy Railway; se esse for o serviço em uso, cadastrar em Variables do backend e reiniciá-lo/republicá-lo após a versão estar disponível:

```dotenv
OPENAI_API_KEY=CHAVE_DO_PROJETO
WHATSAPP_COLETA_COMERCIAL=1
IA_LEADS_OPENAI=1
IA_LEADS_TELEFONES_PILOTO=NUMERO_INTERNO_E164
IA_LEADS_CANAIS_PILOTO=ID_DO_CANAL_COMERCIAL
IA_LEADS_TETO_TOTAL_CENTAVOS=300
```

Substituir `NUMERO_INTERNO_E164` pelo número interno exato observado no WhatsApp (país, DDD e número, sem espaços). Confirmar no cadastro do servidor o ID do canal comercial. As duas listas são obrigatórias; o mesmo celular no canal principal não aciona a nova IA. Não usar números de clientes na homologação. Preservar `INTEGRACAO_IA_COMERCIAL` e `IA_COMERCIAL_TELEFONES_PILOTO`: pertencem ao caminho legado. Para interromper a IA nova, desligar `IA_LEADS_OPENAI`.

O exemplo limita o consumo total deste modelo/finalidade a US$ 3, incluindo reservas de chamadas sem custo confirmado. Não reinicia ao virar o mês, trocar o telefone ou abrir outra conversa. A reserva e a conferência acontecem na mesma transação. Orçamento ausente, zero ou inválido impede chamadas. Na homologação de 28/09, esse valor cabe no restante dos US$ 5 autorizados após US$ 1,708607 contabilizados no laboratório. Novas rodadas locais devem descontar o valor destinado ao piloto; não reutilizar o saldo como uma autorização adicional.

A publicação desta configuração deve ser conferida no servidor. A conexão da API, a validação do modelo e a ativação do piloto são verificações diferentes.

## Como interpretar erros

| Resultado | O que conferir |
| --- | --- |
| `OPENAI_SEM_CHAVE` | Variável/arquivo e reinício do processo |
| `OPENAI_AUTENTICACAO` | Chave correta, ativa e pertencente ao projeto |
| `OPENAI_PERMISSAO` | Permissões da chave/projeto para Responses e modelo |
| `OPENAI_MODELO_INDISPONIVEL` | Acesso do projeto ao modelo configurado |
| `OPENAI_SALDO_INSUFICIENTE` | Faturamento, créditos e limites |
| `OPENAI_LIMITE` | Limite de requisições/uso retornado pela API |
| `OPENAI_TIMEOUT` ou `OPENAI_REDE` | Saída HTTPS; timeout pode ter gerado consumo |
| `OPENAI_VALIDACAO_FALHOU` | Resposta fora do contrato; investigar antes de ativar |

Erros são sanitizados. Não copiar cabeçalhos de autorização ou a chave para logs ou mensagens de suporte.
