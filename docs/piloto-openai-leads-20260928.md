# Piloto interno OpenAI — 28/09/2026

A homologação usa um remetente interno autorizado e o canal comercial já existente. Os números e a chave são configurações privadas do servidor, fora do repositório. A inclusão neste piloto não libera a IA para os demais contatos.

## Controles

- `IA_LEADS_OPENAI` ativa somente a nova interpretação. O padrão continua desligado.
- `IA_LEADS_TELEFONES_PILOTO` e `IA_LEADS_CANAIS_PILOTO` precisam autorizar simultaneamente o remetente e o canal confirmado no banco. Lista vazia impede chamadas. O piloto legado conserva sua própria lista e configuração.
- `IA_LEADS_TETO_TOTAL_CENTAVOS` precisa ser inteiro positivo. A homologação reserva US$ 3 do saldo dos US$ 5 adicionais já autorizados, após US$ 1,708607 contabilizados no laboratório. Não é um orçamento adicional.
- O teto soma todos os registros do modelo/finalidade, inclusive meses anteriores e reservas incertas. Conferência e reserva acontecem em transação serializável. Os limites existentes por conversa, dia e escritório continuam valendo.
- Intervenção humana, versão alterada, repetição de evento e indisponibilidade do modelo continuam protegidos. Não limpar histórico, reprocessar mensagens antigas nem liberar a IA em conversas assumidas pela equipe para fazer o teste passar.

## Validação específica

Após integrar a main `141c207b`, passaram **1.264 testes de API em 50 suítes**, nove testes do resumo e 13 testes dos utilitários. O PostgreSQL descartável passou **58 verificações**: 19 do canal principal, 27 do comercial e 12 da interpretação simulada. As três verificações novas cobrem concorrência pelo último saldo, permanência do teto entre meses/isolamento por modelo e recusa de configuração inválida. Nenhuma dessas verificações acessou OpenAI, Meta ou serviços fiscais. O banco foi encerrado ao final.

Evidências locais: `test-evidence/piloto-api-final.json`, `piloto-web.json`, `piloto-cli.log` e `leads-postgres-1790621727537/`. Ambiente local Node 24.19; o CI usa Node 20 e inclui agora as verificações específicas da OpenAI, mas ainda depende da publicação da branch para ser executado.

## Estado da publicação

**Publicação em produção autorizada pelo responsável em 28/09.** A autorização abrange publicar esta versão e ativar somente o piloto delimitado acima, após conferir o CI e a saúde dos serviços. Nenhuma chave ou número real consta dos arquivos selecionados para publicação. Se alguma verificação falhar, corrigir antes de ativar. A confirmação da implantação é registrada separadamente após o término.

O prompt/modelo permanecem os da [avaliação real](avaliacao-dialogos-ia-leads-20260928.md). Não houve nova rodada paga para alterar as listas ou o orçamento.

## Roteiro de homologação

1. Publicar API e painel, confirmar saúde da versão e instalar a chave somente na API.
2. Conferir a combinação privada de remetente/canal e o teto antes de ativar a flag.
3. Do celular autorizado, enviar uma mensagem nova ao comercial: “Olá, quero abrir uma empresa”. Responder naturalmente às perguntas.
4. Conferir no Chat as mensagens de entrada e saída, o resumo com evidências, a marcação da interpretação e os registros de custo.
5. Pedir para falar com uma pessoa e confirmar que a automação entrega o atendimento à equipe.
6. Para repetir outro caso após o encaminhamento, usar a retomada operacional normal do app; não apagar registros nem remover travas diretamente do banco.

A confirmação técnica do servidor não substitui o teste pelo WhatsApp real. A homologação só está completa após observar esse percurso e receber o aceite do responsável.
