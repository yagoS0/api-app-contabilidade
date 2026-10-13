# Homologação da consulta CNPJ

O serviço está preparado para validação local com fornecedores simulados e PostgreSQL descartável. BrasilAPI e Minha Receita continuam prioritárias. O runtime mantém `habilitarPago: false` fixo e não recebe adaptadores pagos nem credenciais SERPRO. Aprovação local não equivale a homologação externa nem autoriza publicação ou cobrança.

## Execução reproduzível

Na raiz do repositório, com dependências instaladas:

```powershell
node scripts/homologar-consulta-cnpj.mjs
```

Para incluir concorrência, migration e cache cifrado em um banco descartável local:

```powershell
node scripts/homologar-consulta-cnpj.mjs --postgres-bin 'C:/caminho/postgresql/bin'
```

A opção PostgreSQL usa o executor Windows existente, cria uma instância em `.local/cnpj-postgres-*`, aplica somente a migration CNPJ e encerra a instância ao terminar. Não usa o `DATABASE_URL` da instalação. O caminho deve conter `initdb.exe`, `pg_ctl.exe`, `createdb.exe` e `psql.exe`.

Cada execução grava `test-evidence/cnpj-*/resumo.json`, relatórios Jest e logs. O resumo identifica o commit base, hashes dos arquivos do módulo de consulta, testes aprovados/falhos e execução ou ausência da etapa PostgreSQL. Mudanças locais também entram nos hashes do módulo. O diretório de evidências é ignorado pelo Git. O comando retorna erro se uma etapa falhar ou tiver teste pendente; não ativa serviços pagos, não faz deploy e não confirma cadastros nem emite notas.

## Critérios cobertos automaticamente

Em 13/10/2026, a execução `test-evidence/cnpj-2026-10-13T23-38-37-614Z` passou 309 testes selecionados (185 API, 100 contador e 24 portal) e 18 verificações PostgreSQL. Não houve consulta real ao SERPRO nem alteração de ambiente compartilhado.

| Cenário | Resultado exigido |
|---|---|
| Resposta gratuita suficiente no emissor | Sem reserva e sem chamada SERPRO |
| Primeira fonte gratuita falha ou retorna cadastro insuficiente | Segunda gratuita tentada; dados parciais úteis preservados |
| Gratuitas falham no runtime atual | Retorno controlado e preenchimento manual; nenhuma reserva paga |
| Fallback Básica simulado | Gratuita antes da reserva; reserva antes da chamada; uma tentativa |
| Cadastro efetivo simulado | Gratuita antes de Empresa; sócios somente no fluxo permitido |
| Formulário público | Sem consulta paga e sem divulgação de sócios |
| Cache válido ou consulta concorrente | Sem duplicar consultas; segregação por escopo e modalidade |
| Banco ou leitura do cofre indisponível | Somente consulta gratuita |
| Orçamento concorrente, vencido ou insuficiente | Nenhuma reserva além do teto; preço vigente obrigatório |
| Timeout ou resposta paga incerta | Reserva continua consumindo orçamento; sem retentativa automática |
| Município TOM | Conversão oficial corroborada pelo IBGE; divergência fica parcial |
| Payload tentando habilitar pagamento | Rota rejeita campos extras; runtime não reserva pagamento |
| Formulários | Integração pelo backend e preservação de edição manual/resposta tardia |

Os cenários SERPRO usam dados e autenticação sintéticos. Os testes PostgreSQL usam uma chave de cifragem efêmera local; não validam permissões do cofre de um ambiente implantado. A seleção de testes não representa toda a suíte do monorepo.

## Conferência no ambiente de homologação

Esta etapa permanece pendente até existir um ambiente identificado e autorizado para publicação. Registrar URL, versão exata, responsável, banco exclusivo e resultado de cada item. Manter o mesmo runtime gratuito e orçamento desabilitado com valores zero durante esta fase.

1. Aplicar a migration no banco de homologação e verificar as três tabelas CNPJ. Não executar migração geral sobre produção para esta conferência.
2. Validar cifragem e leitura com o cofre desse ambiente, usando dados de teste aprovados. Confirmar ausência de documentos e conteúdo cadastral em logs. A falha do cofre deve deixar o gratuito utilizável e sem cache persistido.
3. Acessar emissor do contador, portal do cliente e lote com uma empresa autorizada; consultar um CNPJ de teste, repetir e conferir cache. Confirmar que abrir a tela ou emitir uma nota não inicia consulta cadastral adicional.
4. No cadastro inicial, cadastro efetivo e formulário público, conferir preenchimento, preservação de alterações manuais e indisponibilidade. A rota de cadastro completo também permanece gratuita nesta composição.
5. Conferir rejeição de acesso a empresa de outra conta, ausência de autenticação e link público expirado; não deve ocorrer consulta externa nem leitura de cache não autorizado.
6. Como administrador, verificar `GET /firm/cadastro/consumo-cnpj`: `pagoHabilitadoNoRuntime` deve ser `false` e não devem surgir reservas decorrentes destes testes. Usuário sem papel admin recebe 403.
7. Registrar latência, origem, indicação de cache, mensagens de erro e comportamento manual. Não anexar tokens, credenciais, CPF de sócios ou cadastros reais às evidências.

Para simular falhas, usar as fixtures automatizadas. Não provocar indisponibilidade nos fornecedores nem alterar infraestrutura compartilhada.

## Pendências da homologação externa SERPRO

Antes de qualquer chamada real: confirmar credenciais e ambiente disponíveis no contrato, custo de autenticação/consulta quando aplicável, tarifa por modalidade, vigência, teto aprovado, retenção permitida e responsável pela conciliação. Não presumir que um endpoint chamado homologação seja gratuito. Estas informações não estão configuradas nesta entrega.

Uma futura composição exclusiva de homologação precisará injetar adaptadores e habilitar pagamento explicitamente, com preços e orçamento persistidos; não foi criada uma variável ou rota que ative cobrança no runtime atual. Chamadas reais exigem escopo e custo previamente definidos. A habilitação em produção permanece uma decisão posterior.

Se surgir reserva incerta, preservar o registro e seu custo; conferir consumo/faturamento com o fornecedor antes de liberar qualquer valor. Não apagar reservas nem repetir consultas para descobrir se houve cobrança. Para interromper o serviço num ambiente futuro habilitado, desabilitar novas reservas e manter os registros existentes; concluir também as chamadas já em andamento na conciliação.

Referência: [Plano de implementação](plano-consulta-cnpj-2026-10-13.md).
