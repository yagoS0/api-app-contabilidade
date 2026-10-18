# Contratação comercial — incremento DEV de 18/10/2026

Base: `e1e01d483`. Executor delegado, rodada 2 de correção do escopo replanejado. Implementação local para revisão; **não é aprovação técnica, integração ou publicação**. Regras R27/R28 e T31–T38 já aprovadas pelo usuário. Referência consultada: seção 22 da fonte canônica e snapshot SHA256 `6bb908ffec9fe153371b2ca2bbb606043d9a00068ce2f4fd74464e4dbc0e1bef`. As alterações preexistentes da referência e do apontador de governança foram preservadas. Na rodada 0, o patch `implementation-scope-recovery.patch` foi reaplicado com `git apply`, sem alterar o stash ou o registro da interrupção anterior. Esta correção preserva a implementação reaplicada.

## Comportamento e persistência

Entrada normal sem proposta passa a responder `contratacao_necessaria`, inclusive na recuperação de vínculo. Fase manual CONTRATADO e checklist não são provas de contratação. Continuam obrigatórios proposta aceita vigente, opção correspondente, contrato recorrente com assinatura conferida e pagamento desse contrato pelos controles existentes.

Exceção externa é parte do comando explícito de conversão, não um estado previamente aprovado que possa sobreviver a outra contratação. Payload adicional:

```json
{
  "contratacaoExterna": {
    "confirmada": true,
    "versao": 3,
    "justificativa": "Cliente contratado previamente fora da Altan",
    "evidencia": "Referência do contrato externo conferido"
  }
}
```

Somente ficha sem qualquer proposta ou contrato interno é elegível. Justificativa e referência exigem 10–2000 caracteres. Usuário ativo FIRM admin/contador é relido do banco; a autoria não vem do body. Escopo, versão e ausência de contratação interna são conferidos antes e dentro da transação existente. CNPJ, acesso à empresa de recuperação, documentos, dados definitivos, PF e estados encerrados mantêm suas guardas. A reserva por versão antecede a revalidação transacional.

O evento existente `CONVERTIDO` recebe `dados.contratacao` com origem INTERNA e IDs ou EXTERNA com justificativa, evidência, autor, instante, ficha, empresa e versão. O evento é criado pelo relacionamento aninhado na atualização transacional da ficha, junto dos efeitos de conversão. Não se cria proposta, assinatura ou pagamento fictício. Nenhuma coluna, migração ou backfill é necessário.

Assinatura conferida deriva de contrato persistido da opção aceita vigente. A conferência manual existente agora também serializa a versão da ficha e recusa contrato de opção divergente antes da mudança de estado. A criação da checklist permite começar a implantação; não afirma que ela começou ou terminou. Conversão continua sem concluir a implantação.

`contratacaoComercial.js` centraliza os fatos para a política da API e o fallback/mock da interface. Lista e ficha recebem somente o resumo público: flags, IDs e dados intencionais da auditoria externa. Tokens, snapshot de preços e texto contratual não integram esse resumo. A conversa conserva seu painel autorizado. Os marcos persistidos de pagamento/conversão não desaparecem após 30 outros eventos; leituras não escrevem marcos.

O filtro Ganha usa a projeção, não a fase editável. Modal mantém bloqueios, próximos passos e efeitos; mostra exceção apenas quando aplicável à operação. A confirmação externa guarda a versão reconhecida pelo operador. Atualização da ficha preserva os textos e exige nova confirmação, inclusive para recuperação de vínculo. Usam-se Modal, Button, campos nomeados e tokens existentes. Nenhum CSS ou token global foi alterado.

Não foi criada política de gratuidade, dispensa de honorários ou inferência de pagamento pelo valor ausente. O modelo atual não possui decisão persistida de dispensa de pagamento interno; os controles existentes foram mantidos. A exceção externa não exige nem fabrica pagamento interno. Qualquer outro formato de contrato sem pagamento aplicável precisa ser identificado no modelo persistido antes de lhe atribuir uma semântica nova; isso não reabre R27/R28.

## Matriz de requisitos e evidências preparadas

Os testes não foram executados por este subprocesso. Evidências posteriores do controlador e do Principal para a rodada 0 estão discriminadas abaixo; não aprovam automaticamente a correção da rodada 1.

| Cenário | Implementação | Teste/evidência preparada | Limite atual |
| --- | --- | --- | --- |
| T31 | Guarda comum à criação e recuperação | Testes de serviço/POST; PostgreSQL complementar recusou ausência de contrato/exceção sem efeito | Gate API da rodada 0 reprovado; renovar |
| T32/T33 | Ganha e implantação pela assinatura; carteira pelo pagamento correspondente | Ensaio PostgreSQL de abertura passou; QA sintético distinguiu assinatura e pagamento | Renovar gates e QA após correção do mock |
| T34 | Exceção explícita e evento de conversão com autoria/escopo | PostgreSQL complementar confirmou recuperação externa auditada | Não equivale a operação externa real |
| T35 | Role ativo relido, escopo, versão e validação; proposta interna impede exceção | PostgreSQL recusou papel/escopo/versão/evidência inválidos; modal bloqueou confirmação desatualizada | Percurso completo por teclado ainda pendente |
| T36 | CAS e evento aninhado na mesma transação; revalidação interna | PostgreSQL verificou rollback de auditoria e recuperação externa concorrente | API integral precisa renovar após isolamento do mock de teste |
| T37 | Projeção comum, marcos históricos, preservação P0 de atualização e rascunhos | QA lista/ficha/conversa concordou antes da recarga e REPROVOU após F5; regressão de recarga ampliada nesta rodada | Nova execução e QA de recarga pendentes |
| T38 | Guardas PF/avulso e registros convertidos preservadas | PostgreSQL complementar recusou PF/avulso encerrado; testes sem transformação de registros | Jornada avulsa completa e gates finais continuam necessários |

Testes antigos foram ajustados por mudança legítima: sucesso sem proposta passa a representar contratação externa explícita; fixtures de contrato assinado incluem a chave da opção aceita; o resumo pago mostra Ganha; eventos antigos de pagamento continuam válidos mesmo fora da antiga janela de 30 marcos. Asserções de dados definitivos, identidade, documentos, permissões e encerramento foram conservadas.

## Comandos e validações reais

- `node scripts/governance/check.mjs plan --base e1e01d483`: falhou antes de carregar o script com `EPERM: lstat C:\Users\yagoa` no sandbox Windows. Nenhuma permissão foi alterada nem o comando repetido por um caminho alternativo.
- `git diff --check -- apps/api apps/web packages/shared`: passou, com avisos de normalização LF/CRLF do Git.
- `git diff --check` global voltou a apontar trailing whitespace/CRLF exclusivamente na referência protegida `REGRAS_OPERACIONAIS.md`, apesar da nota de resolução anterior do Principal. O executor não editou esse arquivo; a divergência fica para o Principal.
- Hash do snapshot conferido e igual ao hash informado pelo Principal.
- Jest, lint, build e PostgreSQL não foram executados neste subprocesso. Logs da rodada 0 foram inspecionados nesta correção; resultados abaixo. Contagens anteriores P0 não validam este diff.
- QA visual desktop/celular complementar foi executado pelo Principal na rodada 0; nova verificação de recarga e percurso completo por teclado continuam pendentes.

### Evidências da rodada 0 e correções da rodada 1

Run `2026-10-18T10-36-41-629Z-bbe24d5f`, fingerprint revisado `2fcbf40dbe2c604c5018bfa974bbaebdf4850f5c0d7892ada0ab0e037f512407`:

- Controlador: web 496 suítes/5534 testes e portal 99 suítes/1580 testes passaram; builds web/portal e governança passaram. Lint web exit 0 informado pelo Principal em `principal-findings.txt`.
- API reprovou: `api-2b0SoP/batch-2.stderr.log` registra 1 falha entre 1337 testes. `clearAllMocks` preservava a implementação de `onboardingEvento.findFirst` configurada pelo caso de pagamento, contaminando o descarte sem vínculos. Setup agora usa `mockReset().mockResolvedValue(null)` nesse método. Guarda de demandas vinculadas e suas asserções foram preservadas. Gate API completo precisa ser renovado pelo controlador.
- Principal: `postgres-1792320138001/summary.json` registra 28 verificações agrupadas (11 abertura + 6 contratação + 11 mensagens), aprovadas, banco descartável encerrado, provedores bloqueados e sem gerar Prisma. Inclui concorrência, rollback de auditoria, papel/escopo e histórico; limites HTTP e jornada avulsa estão no próprio relatório.
- QA `surfaces-1792320358220/results.json`: lista/ficha/conversa em 1440/390 concordaram antes de F5, mas ambas as larguras perderam contratação interna após recarga. Este resultado permanece REPROVADO para aquele snapshot. `qa-1792320165312/results.json` passou quatro cenários do modal nas duas larguras; inspeção visual do Principal não encontrou novo impedimento visual. Harness isolado usa componentes reais/dados sintéticos; não comprova shell, autenticação ou operação real. Percurso integrado por teclado, foco e retorno ao acionador ainda sem validação completa.

Correção R27/R28/T37: o armazenamento `mock:onboardings:v1` passa a incluir os Maps comerciais compartilhados entre instâncias: propostas, contratos, links demonstrativos, metadados de documentos e ficha avulsa. Criação/aprovação/aceite e geração do contrato gravam o estado; pagamento mantém o marco idempotente na ficha. Não há reconstrução de assinatura ou pagamento a partir de fase/checklist. Snapshots antigos sem o campo comercial continuam legíveis, sem inventar evidências perdidas.

`funilMock.test.js` agora reinicializa os módulos mantendo sessionStorage em cada marco, inclusive assinatura sem pagamento e após pagamento, verifica igualdade lista/ficha/conversa, IDs, isolamento de outra ficha e replay. Arquivos File não são serializados: somente seus metadados e vínculos sobrevivem, e download após recarga informa indisponibilidade em vez de devolver sucesso vazio. A prova permanece explicitamente demonstrativa; não é binário de assinatura real. Storage indisponível conserva a limitação preexistente de modo em memória.

Rodada 1: tentativa de `node scripts/governance/check.mjs plan --base e1e01d483` novamente bloqueada por EPERM antes de carregar o script; sem contorno de sandbox. `git diff --check` dos quatro arquivos de código/teste corrigidos passou. Testes novos, gates completos e QA pós-correção aguardam controlador/Principal; nenhum parecer de aprovação é inferido.

O ensaio `verify-opening-company-postgres.js` aceita adicionalmente o destino descartável preparado pelo Principal, somente com `ONBOARDING_LOCAL_CHECK=1`, `NODE_ENV=test`, host literal `127.0.0.1`, usuário `lead_test`, banco `onboarding_alignment_check` e porta explícita 1024–65535. Destinos anteriores permanecem. O executor não iniciou banco, não gerou Prisma e não executou esse ensaio.

## Fixtures conciliados no escopo replanejado

Os dois consumidores identificados no run interrompido agora fazem parte da allowlist e foram conciliados:

- `apps/web/src/features/onboarding/components/__tests__/PassosDoLead.test.jsx`: fixture assinada inclui `proposta.opcaoAceita` e `contrato.dados.opcao.chave`, mantendo a exigência de evidência da entrega avulsa.
- `apps/api/scripts/verify-mensagens-onboarding-postgres.mjs`: cria contador sintético ativo no banco descartável e recupera o vínculo com contratação externa explícita, versão, justificativa e referência. Mantém as asserções de concorrência/mensagens e verifica origem e autoria no evento. Não cria autorização de produção ou bypass.

O mock também confere contrato/opção vigente e pertencimento do documento na assinatura, identifica a conferência como demonstração e conserva pagamento idempotente do contrato. O cenário em `funilMock.test.js` verifica documento alheio, ausência de evidência de pagamento, replay e igualdade da projeção em lista/ficha/conversa; a rodada 1 amplia essa cobertura para recarga real dos módulos. A versão ampliada aguarda execução pelo controlador. A inspeção dos demais chamadores de assinatura/conversão não identificou outro fixture que precisasse de edição; isso não substitui os gates completos.

O runtime, governança, permissões globais, dependências, configurações, regras fiscais e os incrementos P1/P2 não foram alterados.

## Risco e rollback

### Evidências da rodada 1 e correção da rodada 2

Os registros acima preservam os resultados e pendências da rodada 0/1 no momento de sua escrita. Atualização recebida dos revisores e do Principal para o fingerprint `a146a1cdacfbd3cf80c61098e133e226bf653399e2f983b7e86c4b333fddf264`: controlador aprovou API 10565 testes (1 pendente), web 5535 e portal 1580, governança e builds; Principal informou lint web exit 0. As 28 verificações PostgreSQL anteriores continuam aplicáveis às fontes de backend/shared e harnesses sem alteração. Nenhuma dessas contagens foi executada por este subprocesso ou valida automaticamente esta rodada 2.

QA do Principal `surfaces-1792322539959/results.json` confirmou projeções em lista/ficha/conversa e recarga do mock em 1440/390, sem erros ou requisições externas. `qa-1792322518699/results.json` registrou oito cenários do modal aprovados. A reprodução de teclado `keyboard-1792322608872/results.json`, inspecionada nesta rodada, confirmou uma falha independente: aviso de recusa fora da área rolável visível nas duas larguras, sem anúncio e com foco em Criar empresa. A aprovação parcial de teclado/toBeVisible não comprova interseção com o viewport; a comunicação da falha foi REPROVADA pelos revisores. Esses resultados históricos permanecem preservados.

Correção R22: `ConversaoModal.jsx` agora apresenta recusa comum e conflito de CNPJ como `role="alert"`, atômicos e focáveis por código. Após terminar a tentativa, move o foco para o aviso e solicita rolagem imediata até ele. A dependência do término do envio cobre também repetição com o mesmo objeto de erro e a recuperação de vínculo. Campos, confirmação externa versionada, revisão cadastral e botão de recuperação permanecem montados; não há repetição automática de conversão nem mudança de regra comercial.

Regressão acrescentada em `conversaoCompleta.test.jsx`: preenche o formulário, envia, recebe a recusa via estado do componente pai e verifica alerta, foco, chamada de rolagem ao próprio aviso, dados preservados, nova tentativa com a mesma recusa e recuperação de vínculo. JSDOM não mede interseção geométrica nem comprova fala de leitor de tela. **Pendente para controlador/Principal:** executar os testes renovados e repetir QA imediato após falha em 1440/390, verificando `withinScrollableViewport`, anúncio, teclado e recuperação sem rolagem manual. Não se declara aprovação dos revisores.

Nesta rodada, o planejamento Node voltou a falhar antes de carregar o script (`EPERM lstat C:\Users\yagoa`), sem contorno de sandbox. `git diff --check` dos arquivos corrigidos passou; testes, lint, build e browser não foram executados pelo subprocesso. Hash canônico reconferido e preservado. O Principal esclareceu que o aviso global anterior decorre dos bytes CRLF protegidos, sem espaços finais; nenhum byte ou configuração foi modificado para silenciá-lo. Escopo desta correção: modal, sua regressão e este documento; sem alteração de persistência ou dos contratos R27/R28. Rollback específico: retirar seletivamente o tratamento de foco/rolagem e a regressão correspondente, preservando toda a implementação comercial e o histórico; isso reintroduziria a falha R22 conhecida.

Risco alto: condição de entrada na carteira, transação, contrato compartilhado e dados comerciais. Revisões independentes e sistêmica permanecem pendentes; o executor não aprova sua própria mudança. Achados parciais do Principal sobre exposição do snapshot e confirmação com versão silenciosamente atualizada foram tratados no código e em testes, sem pressupor aprovação posterior.

Rollback de código deve ser seletivo, revisado pelo Principal, preservando o checkpoint P0 e alterações concorrentes. Os eventos adicionados usam JSON compatível e devem permanecer como evidência; não apagar empresas, vínculos, documentos, pagamentos ou eventos já gravados. Reverter a guarda pode reintroduzir o caminho antigo sem contratação, portanto exige avaliação explícita de risco na integração. Nenhuma migração reversa é necessária. Sem commit, merge, deploy, produção, mensagem real, assinatura, cobrança ou consulta externa por este executor.
