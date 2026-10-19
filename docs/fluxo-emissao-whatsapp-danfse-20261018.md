# Emissão pelo WhatsApp até o DANFSe — 18/10/2026

Base: `3509b2f47cb34dc31662424f02b59be6c7261de1` (main após PR232).
Branch: `codex/whatsapp-emissao-danfse-20261018`.
Estado: validado localmente com revisões independentes; não publicado.

## Objetivo e regras

Conferir configuração, coleta, resumo, confirmação explícita, emissão, recuperação,
PDF, histórico e entrega. Adequação a R01/R02/R19/R20/R22/R29 existentes; não altera
tributos, papéis, consentimento, público piloto ou condições de emissão. Usuário global
ativo, vínculo empresarial, papel e permissões do contato continuam requisitos distintos.
`EMISSAO_NFSE` não concede `NOTAS_DANFSE`. Nenhuma emissão fictícia em produção,
mensagem real, IA paga, consulta fiscal ou alteração de dados operacionais foi executada.

Referência canônica e cópia versionada conferidas:
SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`.

## Percurso e ajustes

1. O contador configura empresa, perfil fiscal e certificado A1; libera emissão e
   as funções do número. Canal, piloto, janela, identidade e responsável pelo atendimento
   continuam sendo conferidos no servidor. A rejeição administrativa de um usuário agora
   bloqueia a sessão e a autorização fiscal, mesmo que seu vínculo empresarial permaneça ativo.
2. A coleta determinística ou a IA prepara os dados pelas funções existentes. O cliente
   recebe resumo com código. Correções invalidam o resumo anterior. Mudança de configuração
   fiscal na confirmação retorna à revisão e exige novo resumo.
3. A confirmação explícita precede o ato fiscal. PR232 preserva reserva, vínculo durável
   da tentativa, exclusão de concorrentes, revalidação antes do POST e conciliação supervisionada.
   Timeout ou resultado inconclusivo não são autorização para emitir novamente.
4. Emissão confirmada passa à entrega do DANFSe. O gerador existente lê o XML salvo, inclusive
   de ServiceInvoice antes da captura ADN. Ausência de XML e DPS recusada não viram documento
   inventado. Não há nova escrita PortalInvoice nem novo lançamento de receita.
5. A entrega tem reserva própria persistente, identidade do pedido e hash do arquivo.
   O PDF fica no histórico autenticado existente, sujeito à retenção de arquivos WhatsApp.
   Isso registra a versão enviada; não substitui a geração fiscal sob demanda pelo XML.
6. Acesso, identidade, canal e revisão documental são reconferidos antes e depois do upload, antes da mensagem. Recusa comprovada
   nessa guarda fica como falha anterior ao envio. HTTP sem erro reconhecido/documentado, timeout e ausência de identificador
   permanecem incertos, bloqueando nova tentativa automática.
7. Repetir a mesma entrada/ação recupera o comprovante. Um pedido explícito posterior pode
   receber novamente um documento já enviado; não provoca nova emissão fiscal. Uma saída
   incerta continua bloqueada mesmo com nova entrada. Falha comprovadamente anterior ao envio
   permite recuperar somente o arquivo. Recusa explícita Meta tem estado RECUSADO e permite novo pedido; resultado incerto continua bloqueado.
8. Falha documental preserva a nota emitida e encaminha à equipe com texto explícito:
   obter o PDF não exige emitir outra nota. Aceitação pela Meta, entrega e leitura são
   fatos distintos; callbacks atrasados não devem rebaixar entrega/leitura comprovadas.

## Evidências executadas

- Reprodução inicial: teste de confirmação pelo menu esperava uma chamada documental e
  encontrou zero; falha funcional observada antes da implementação.
- Segurança: 112 testes em cinco suítes; após revisão independente, 59 testes Cloud
  confirmaram marcador de interrupção anterior ao POST sem enfraquecer timeout/sem wamid.
- PostgreSQL descartável: `apps/api/scripts/verify-whatsapp-danfse-postgres.mjs` usa registros
  sintéticos, gerador PDF real, armazenamento real, transporte Cloud real com fetch simulado,
  concorrência, replay, novo pedido, hash, callbacks, revogação durante upload e recuperação.
  Falha de XML preserva issued; XML recuperado libera somente documento. Permissão documental
  é independente. Saída incerta permanece bloqueada. Zero tentativas de rede externa.
- PDF: três amostras sintéticas (curta, longa e cancelada com canhoto), renderizadas e
  inspecionadas; página A4 única e três QR Codes decodificados. Descrição longa mantém o
  truncamento indicado pelo gerador existente; não houve mudança de layout. Fixture versionada
  gera aviso de parser preexistente pela quebra no fechamento de `nro`; não é documento real.
- Integração com menu, coleta, confirmação e executor reais: 37 testes; fronteira fiscal e PDF simulados, PDF real coberto separadamente no PostgreSQL. Web completo: 498 suítes/5567 testes aprovados. Portal: 99 suítes/1580 testes aprovados; ambos os builds e 63 testes da governança passaram. Pareceres independentes aprovaram as fontes; bateria completa da API aprovada: 615 suítes/10821 testes; uma suíte/um teste condicional de onboarding não roda no gate comum e passou separadamente no PostgreSQL. Fontes conferidas antes/depois, sem alteração. Respostas HTTP ambíguas: 88 testes/3 suítes; PostgreSQL também comprovou que HTTP500 vazio e HTTP400 JSON inválido bloqueiam novo POST.

## Governança e limites da evidência

Controlador executável iniciado em `2026-10-19T01-20-58-205Z-9f0589ba`. O subprocesso
não conseguiu iniciar Node no seu sandbox e entregou diagnóstico/teste, sem implementação.
O Principal interrompeu o controlador após o executor concluir, durante gates incompletos,
e continuou com delegados nativos. Não se declara aprovação desse run nem se alteram gates.
Journal: `.altan-governance/danfse-intervention.json`. Autores e revisores são distintos.
A revisão independente reprovou a classificação de revogação pós-upload como incerta;
a correção foi devolvida ao executor. A revisão funcional também reprovou o bloqueio permanente após recusa explícita Meta, e a sistêmica reprovou a ausência de nova verificação do canal após upload; ambos retornaram ao executor com testes de regressão. A revisão final também exigiu distinguir HTTP sem prova de recusa; a classificação foi corrigida e novamente aprovada. A primeira bateria API revelou fixture antiga sem usuário global; foi corrigida com regressão de revogação e revisão independente, seguida de 328 testes/8 suítes aprovados e repetição integral. Evidências locais ficam em `.altan-governance`.

Os ensaios não comprovam emissão/entrega externa em produção, disponibilidade atual de A1,
cofre, autorizador ou Meta. A validação completa de certificado continua autoritativa na
emissão; presença em cadastro não certifica validade ou acesso ao cofre. Reservas ACEITO sem conclusão persistida, RESERVADO após interrupção e INDETERMINADO permanecem bloqueadas: esta entrega não acrescenta uma interface de conciliação do transporte. Não apagar reservas nem repetir a mensagem sem conferir evidência; a fila humana recebe o problema. O público piloto
existente não foi expandido e o teste real de IA interrompido pelo usuário não foi reativado.

## Integração e retorno

Sem migration, configuração ou dependência de aplicação nova. Gates e pareceres concluídos sobre as fontes verificadas. Em 19/10/2026, o usuário autorizou PR, integração na main e publicação, condicionados ao CI e às revisões.
A autorização anterior foi consumida pela publicação do PR232.
Rollback de código preserva XMLs, registros fiscais, histórico e reservas. Não apagar reservas
para destravar resultado incerto; consultar evidências com o contador. Reverter a entrega não
reverte emissão nem pagamento e não autoriza repetir atos externos.


