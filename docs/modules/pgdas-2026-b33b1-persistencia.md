# PGDAS-2026-B3.3b.1 — identidade durável e custódia pré-cálculo

**Desenho e caracterização somente. Não implementar B3.3b.2.** Base conferida: `44f031ce1cbd7264ab94b3ba302db8f9353bae66`. Coordenação recebida do Principal: [PR299, comentário6983908185](https://github.com/yagoS0/api-app-contabilidade/pull/299#issuecomment-6983908185); lida integralmente pelo Principal, sem equivaler a aprovação fiscal. Referência operacional integral fornecida no pedido e hash conferido no arquivo canônico `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`: `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`.

Aplicam-se AGENTS ancestrais, POLICY, ARQUITETURA, CLAUDE da API/fiscal/SERPRO e [B33b integrado](pgdas-2026-b33b-coordenador.md). R01/R02/R04–R06/R19/R20/R22 e seções36/37 preservadas. **Impacto operacional nulo neste diff**: somente este documento, o teste focal e o registro de governança. Risco do desenho: alto (fiscal, persistência, autorização). Não modifica produto, contrato fiscal, payload, schema, migrations, Fator R, III/V, CAIXA/COMPETENCIA, B32 ou governança. B33a continua `mesesPropostos:null`, `autorizaEfeitoFiscal:false`; PA11/12 bloqueados; 2027 pendente. Nenhuma rede fiscal, publicação, ativação, backfill ou escrita contábil.

## 1. Persistência encontrada

Fontes relativas a `apps/api`: `prisma/schema.prisma`; migrations `20261116000000_add_apuracao_fs12_revisoes`, `20261117000000_add_apuracao_fs12_calculos`, `20260802220000_add_serpro_chamadas`, `20260909120000_serpro_respostas_cache`; serviços `src/application/fiscal/serpro/{SerproCallGuard,SerproHttpClient,SerproRespostaCache}.js`; adaptadores `src/modules/fiscal/infrastructure/prisma/{fs12DaApuracao,fs12DoCalculo}.js`.

| Estrutura real | FK/unicidade e limite |
| --- | --- |
| apuracao_fs12_revisoes | FK separada para PortalClient, Company e User. UNIQUE (portalClientId,companyId,competencia,revisao) e (portalClientId,competencia,chaveIdempotencia). Trigger confere PortalClient→Company na inserção. UPDATE/DELETE proibidos por trigger. Não há coluna CNPJ nem FK composta CNPJ/contexto. |
| apuracao_fs12_calculos | calculoId globalmente único; FK composta para a revisão, RESTRICT. Não tem FK para token mutável do snapshot. Trigger confere contexto/política/envelope e rejeita numeroDeclaracao no cálculo congelado. Imutável. |
| apuracao_fs12_calculo_fatos | vinculoId obrigatório, FK RESTRICT; UNIQUE (vinculoId,chaveIdempotencia) e (vinculoId,tentativaId,tipo). Resultado exige tentativa anterior do mesmo vínculo. Não comporta tentativa pré-calculoId. |
| serpro_chamadas | PK id; índices não únicos de assinatura/CNPJ/PortalClient/serviço por data. portalClientId/userId são strings opcionais sem FKs; acaoId não é único. competencia opcional; Company/revisão FS12 ausentes. Estado técnico mutável não é prova fiscal. |
| AppSetting | PK key; marcador serpro_dispatch:reservaId antes do HTTP. JSON chama de companyId o **PortalClientId**, não Company. Sem FK do marcador à reserva ou proteção append-only global. |
| serpro_respostas_cache | PK chave, JSON resposta, expiração; sem FK para reserva/comando/revisão. Upsert/expiração: não é arquivo imutável. Simulação false pode ser reutilizada, transmissão não. |
| apuracao_snapshots | UNIQUE (portalClientId,competencia), registro mutável e CAS por estado/chave. Histórico B32 não depende de mantê-lo intacto. |
| Lease/ciclo | Lease apuracao-calculo:portal:PA em Fechamento; ciclo em AppSetting ciclo_simples:portal:PA com revisão/token. Coordenam execução, não substituem evidência durável. |

`confirmarFs12DaApuracao` usa Serializable, revisão/contexto esperados e replay por hash; adaptador toma FOR SHARE em User, CompanyFirmAccess, PortalClient, Company e regime_historico. Repete transação **local** até duas vezes por conflito. Não toma hoje lock comum de FS12 com CallGuard. FOR SHARE não exclui append de outra revisão.

B32 aceita tx injetado apenas Serializable para escrita; bloqueia snapshot FOR UPDATE, não abre transação aninhada e recusa conflito sem retry. Permite futura composição, mas **Fechamento não faz hoje T3b integrado**. Fechamento gera calculoId após retorno e mantém leases/CAS. Produtor padrão de evidência fiscal B32 retorna null.

CallGuard reserva sob ReadCommitted e advisory global73517001; autentica e autoriza despacho separadamente. Reservada/incerta bloqueiam assinatura mesmo com forçar. Conclusão técnica usa CAS status=reservada. Não expira reserva. HTTP fica fora da transação. HttpClient não relê ACL do usuário nem FS12 após rede.

## 2. Escolha mínima recomendada — proposta

| Opção | Avaliação |
| --- | --- |
| Somente acaoId/lease/ciclo/cache | Insuficiente: acaoId não único, lease expira, ciclo/snapshot mudam, cache sem transmissão ou identidade da tentativa. |
| Acrescentar tudo a SerproChamada | Mistura contexto fiscal imutável com ledger genérico; comando nasce antes da reserva, cache pode evitar reserva. Muitas colunas opcionais/triggers condicionais. |
| AppSetting como journal | JSON sem FKs compostas; validação por prefixo vira schema implícito na tabela compartilhada. |
| Evidência aditiva específica, reutilizando estados/reserva | **Recomendação:** quatro relações append-only: comando/tentativa 1:1, associação à reserva, resposta custodiada, associação ao B32. Nenhum enum novo de execução. |

Cada comando possui **uma tentativa** UUID própria, criada junto; IDs distintos (API usa comando, B32 identifica tentativa). Não criar N tentativas automáticas. Auth abortada comprovada pode exigir novo comando explícito; resultado incerto nunca admite chave nova como fuga. Ledger continua bloqueando assinatura. Reuso de cache não fabrica HTTP: recupera origem comprovada. Cache legado sem cadeia permanece recuperação legada permitida, sem backfill B32/B33.

Ausência de linha significa ausência de evidência, não estado de execução. Fonte operacional permanece ledger/snapshot/ciclo. Não tornar vinculoId opcional.

Congelar PortalClient, Company resolvida, CNPJ normalizado e conferido nos cadastros/envelope, PA YYYY-MM, revisão FS12, serieHash/contextoHash/política B1, intenção SIMULAR/TRANSMITIR/RETIFICAR, ator autenticado e origem. Remapeamento invalida uso novo, sem reescrever histórico.

Idempotência UNIQUE **(portalClientId,competencia,chaveIdempotencia)**, sem Company/intenção/revisão de propósito: chave antiga não pode gerar comando novo após remapeamento. ACL atual antes de replay; hash integral diferente dá conflito. Hash v1 contém identidade acima, revisão esperada de snapshot/ciclo, token de cálculo quando houver, formulário/base material e motivo de retificação. JSON canônico recursivo; arrays ordenados apenas se contrato define conjunto; centavos inteiros seguros; rejeitar undefined/NaN/Infinity, tipos indevidos e campos desconhecidos. Hash não autentica origem. Assinatura mantém algoritmo atual do envelope, independente do hash de intenção. Não construir remessa fiscal a partir de meses não homologados.

## 3. DDL candidato EXATO — NÃO EXECUTAR

**Não aplicado nem aplicável ao descartável nesta entrega.** Somente proposta revisável; não é migration ou schema autorizado. Reutiliza funções imutáveis existentes. Sem backfill, UPDATE histórico ou DROP.

FK composta assegura PortalClient/Company/PA/revisão. CNPJ é fotografia conferida transacionalmente: não existe chave histórica CNPJ na revisão para referenciar. FK ao CNPJ mutável atual impediria correção cadastral e deturparia histórico. Trigger abaixo confere fotografia na inserção; T2/T3b reconferem.

```sql
-- Proposta aditiva sobre evidência existente, sem alterar registros.
CREATE UNIQUE INDEX fs12_calculo_escopo_vinculo_key ON apuracao_fs12_calculos
  (id,"portalClientId","companyId",competencia,"revisaoFs12");
CREATE TABLE fs12_comandos (
  id TEXT PRIMARY KEY,
  "tentativaId" TEXT NOT NULL UNIQUE,
  "portalClientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  cnpj TEXT NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  competencia TEXT NOT NULL CHECK (competencia ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
  "revisaoFs12" INTEGER NOT NULL CHECK ("revisaoFs12" > 0),
  intencao TEXT NOT NULL CHECK (intencao IN ('SIMULAR','TRANSMITIR','RETIFICAR')),
  "vinculoOrigemId" TEXT,
  CHECK ((intencao = 'SIMULAR' AND "vinculoOrigemId" IS NULL)
    OR (intencao IN ('TRANSMITIR','RETIFICAR') AND "vinculoOrigemId" IS NOT NULL)),
  FOREIGN KEY ("vinculoOrigemId","portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_calculos(id,"portalClientId","companyId",competencia,"revisaoFs12")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  "serieHash" TEXT NOT NULL CHECK ("serieHash" ~ '^[a-f0-9]{64}$'),
  "contextoHash" TEXT NOT NULL CHECK ("contextoHash" ~ '^[a-f0-9]{64}$'),
  "politicaVersao" TEXT NOT NULL,
  "chaveIdempotencia" TEXT NOT NULL CHECK ("chaveIdempotencia" ~ '^[a-zA-Z0-9_-]{16,100}$'),
  "comandoHash" TEXT NOT NULL CHECK ("comandoHash" ~ '^[a-f0-9]{64}$'),
  "hashVersao" TEXT NOT NULL CHECK ("hashVersao" = 'FS12_COMANDO_V1'),
  intencao_congelada JSONB NOT NULL CHECK (jsonb_typeof(intencao_congelada) = 'object'),
  esperado JSONB NOT NULL CHECK (jsonb_typeof(esperado) = 'object'),
  "autorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  origem TEXT NOT NULL CHECK (length(trim(origem)) BETWEEN 1 AND 200),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_revisoes("portalClientId","companyId",competencia,revisao)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE ("portalClientId",competencia,"chaveIdempotencia"),
  UNIQUE (id,"portalClientId","companyId",competencia,"revisaoFs12",intencao)
);
CREATE TABLE fs12_comando_reservas (
  "comandoId" TEXT PRIMARY KEY REFERENCES fs12_comandos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reservaId" TEXT NOT NULL UNIQUE REFERENCES serpro_chamadas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assinatura TEXT NOT NULL CHECK (assinatura ~ '^[a-f0-9]{64}$'),
  "envelopeCifrado" JSONB NOT NULL CHECK (jsonb_typeof("envelopeCifrado") = 'object'),
  "envelopeHash" TEXT NOT NULL CHECK ("envelopeHash" ~ '^[a-f0-9]{64}$'),
  rota TEXT NOT NULL CHECK (rota = '/Declarar'),
  "idSistema" TEXT NOT NULL CHECK ("idSistema" = 'PGDASD'),
  "idServico" TEXT NOT NULL CHECK ("idServico" = 'TRANSDECLARACAO11'),
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("comandoId","reservaId")
);
CREATE TABLE fs12_comando_respostas (
  id TEXT PRIMARY KEY,
  "comandoId" TEXT NOT NULL,
  "reservaId" TEXT NOT NULL,
  "marcadorKey" TEXT NOT NULL REFERENCES "AppSetting"(key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "httpStatus" INTEGER NOT NULL CHECK ("httpStatus" BETWEEN 100 AND 599),
  "corpoCifrado" JSONB NOT NULL CHECK (jsonb_typeof("corpoCifrado") = 'object'),
  "corpoHash" TEXT NOT NULL CHECK ("corpoHash" ~ '^[a-f0-9]{64}$'),
  "recebidoEm" TIMESTAMP(3) NOT NULL,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "custodianteId" TEXT NOT NULL CHECK (length(trim("custodianteId")) BETWEEN 1 AND 200),
  "capacidadeId" TEXT NOT NULL CHECK (length(trim("capacidadeId")) BETWEEN 1 AND 200),
  "marcadorObservado" JSONB NOT NULL CHECK (jsonb_typeof("marcadorObservado") = 'object'),
  FOREIGN KEY ("comandoId","reservaId") REFERENCES fs12_comando_reservas("comandoId","reservaId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE (id,"comandoId"),
  UNIQUE ("comandoId","corpoHash","httpStatus"),
  CHECK ("marcadorKey" = 'serpro_dispatch:' || "reservaId")
);

CREATE TABLE fs12_comando_calculos (
  "comandoId" TEXT PRIMARY KEY,
  "respostaId" TEXT NOT NULL,
  FOREIGN KEY ("respostaId","comandoId") REFERENCES fs12_comando_respostas(id,"comandoId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  "vinculoId" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  competencia TEXT NOT NULL,
  "revisaoFs12" INTEGER NOT NULL,
  intencao TEXT NOT NULL CHECK (intencao IN ('SIMULAR','TRANSMITIR','RETIFICAR')),
  "autorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("comandoId","portalClientId","companyId",competencia,"revisaoFs12",intencao)
    REFERENCES fs12_comandos(id,"portalClientId","companyId",competencia,"revisaoFs12",intencao)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("vinculoId","portalClientId","companyId",competencia,"revisaoFs12")
    REFERENCES apuracao_fs12_calculos(id,"portalClientId","companyId",competencia,"revisaoFs12")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX fs12_calculo_unica_origem_simulacao ON fs12_comando_calculos("vinculoId")
  WHERE intencao = 'SIMULAR';
CREATE TRIGGER fs12_comando_imutavel BEFORE UPDATE OR DELETE ON fs12_comandos
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_reserva_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_reservas
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_resposta_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_respostas
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();
CREATE TRIGGER fs12_associacao_imutavel BEFORE UPDATE OR DELETE ON fs12_comando_calculos
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacao_fs12_calculo();

CREATE FUNCTION validar_fs12_comando() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; p RECORD; c RECORD;
BEGIN
  SELECT * INTO r FROM apuracao_fs12_revisoes WHERE "portalClientId"=NEW."portalClientId"
    AND "companyId"=NEW."companyId" AND competencia=NEW.competencia AND revisao=NEW."revisaoFs12";
  SELECT * INTO p FROM "PortalClient" WHERE id=NEW."portalClientId";
  SELECT * INTO c FROM "Company" WHERE id=NEW."companyId";
  IF r.id IS NULL OR p.id IS NULL OR c.id IS NULL
    OR p."companyId" IS DISTINCT FROM NEW."companyId"
    OR regexp_replace(p.cnpj,'[^0-9]','','g') IS DISTINCT FROM NEW.cnpj
    OR regexp_replace(c.cnpj,'[^0-9]','','g') IS DISTINCT FROM NEW.cnpj
    OR r."contextoRevisao" IS DISTINCT FROM NEW."contextoHash"
    OR r."serieHash" IS DISTINCT FROM NEW."serieHash"
    OR r."politicaVersao" IS DISTINCT FROM NEW."politicaVersao" THEN
    RAISE EXCEPTION 'FS12 command identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_comando_validar BEFORE INSERT ON fs12_comandos
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_comando();
CREATE FUNCTION validar_fs12_reserva() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; r RECORD;
BEGIN
  SELECT * INTO c FROM fs12_comandos WHERE id=NEW."comandoId";
  SELECT * INTO r FROM serpro_chamadas WHERE id=NEW."reservaId";
  IF c.id IS NULL OR r.id IS NULL OR r.status IS DISTINCT FROM 'reservada'
    OR r."portalClientId" IS DISTINCT FROM c."portalClientId" OR r.cnpj IS DISTINCT FROM c.cnpj
    OR r.competencia IS DISTINCT FROM c.competencia OR r."acaoId" IS DISTINCT FROM c.id
    OR r.assinatura IS DISTINCT FROM NEW.assinatura OR r.rota IS DISTINCT FROM NEW.rota
    OR r."idSistema" IS DISTINCT FROM NEW."idSistema" OR r."idServico" IS DISTINCT FROM NEW."idServico" THEN
    RAISE EXCEPTION 'FS12 reservation identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_reserva_validar BEFORE INSERT ON fs12_comando_reservas
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_reserva();
```

Limites do SQL: não autentica chamador, não verifica criptograficamente hashes nem implementa CAS/linearização. `esperado` contém exatamente `{snapshotId,snapshotEstado,snapshotChave,cicloRevisao,cicloToken}`; ausência de snapshot/ciclo é null explícito, sem fabricar revisão0. Adaptador futuro valida tipos/chaves e compara origem. `intencao_congelada` é a representação integral versionada usada no hash, sem segredos; adaptador exige igualdade com colunas. Inserções somente por portas confiáveis, nunca SQL de usuário final.

FK de AppSetting impede excluir chave, **não impede mudar JSON**. T3a valida value.reservaId, PortalClient e instante autorizado, congela esses campos em marcadorObservado. Não promove marcador a prova do provedor. SQL privilegiado/administrador continua fora da fronteira; não alterar AppSetting genericamente.

Corpo é o observado pelo adaptador, em serialização canônica documentada (não alegar bytes de wire se Axios já fez parse); hash SHA256 UTF-8 dessa representação. Não guardar tokens, certificado ou headers arbitrários. Limite candidato16MiB: exceder exige custódia alternativa aprovada; **não truncar e declarar sucesso**. Sem corpo recuperável, permanece incerto. Replay com mesmo hash/status retorna a evidência existente. Corpo/status divergentes são outra observação append-only da mesma tentativa, nunca overwrite; impedem promoção automática e exigem conciliação. Conciliação de resposta perdida exige contrato próprio, não UPDATE ou resposta fabricada.

Associação a B32 posterior/append-only: SIMULAR cria cálculo exato/vínculo em T3b. TRANSMITIR/RETIFICAR associam vínculo exato já confirmado, nunca criam calculoId para satisfazer FK. TRANSMITIR/RETIFICAR congelam vinculoOrigemId em T1; T3b deve associar exatamente esse vínculo, não outro cálculo da mesma revisão. Um comando tem uma associação; comandos declaratórios legítimos podem compartilhar vínculo sob guardas existentes. Simulação não produz fato declaratório TENTATIVA_INICIADA/RESULTADO_CONFIRMADO; adaptador B32 só registra fatos fiscais com prova causal própria. Resposta tardia sem promoção fica custodiada, sem vínculo forçado.

O seguinte complemento também é DDL **somente proposto**, não executado. A associação declaratória não pode trocar o cálculo de entrada. A aplicação T3b ainda deve verificar resultado fiscal, autenticidade, ACL e revisão, que uma FK não prova.

```sql
CREATE FUNCTION validar_fs12_associacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM fs12_comandos WHERE id=NEW."comandoId";
  IF c.id IS NULL OR (c.intencao <> 'SIMULAR'
      AND NEW."vinculoId" IS DISTINCT FROM c."vinculoOrigemId") THEN
    RAISE EXCEPTION 'FS12 input calculation mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fs12_associacao_validar BEFORE INSERT ON fs12_comando_calculos
  FOR EACH ROW EXECUTE FUNCTION validar_fs12_associacao();
CREATE INDEX fs12_comando_origem_idx ON fs12_comandos("vinculoOrigemId");
CREATE INDEX fs12_associacao_vinculo_idx ON fs12_comando_calculos("vinculoId");
```

### Representação Prisma futura e fronteira de integridade

Mapear as quatro tabelas propostas para `Fs12Comando`, `Fs12ComandoReserva`, `Fs12ComandoResposta` e `Fs12ComandoCalculo`, com `@@map` dos nomes SQL, IDs String, instante DateTime `@db.Timestamp(3)`, envelopes cifrados Json, relações compostas e `onDelete/onUpdate: Restrict`. Usar UUID gerado no servidor para comando/tentativa/resposta. Comando→reserva 0..1, reserva→respostas 0..N, resposta→associação 0..1 por comando. SQL é a especificação candidata dos constraints; checks, triggers e índice parcial não são substituídos por declarações Prisma. Nenhum model foi incluído em schema.prisma. A migration futura exige validar ambos no PostgreSQL16 e Prisma5.22 já utilizado pelo projeto.

`esperado`, intenção congelada e prova de conferência não são contratos livres do navegador. O adaptador os constrói a partir de leituras autorizadas. Para TRANSMITIR/RETIFICAR, inclui hash/versão da conferência do cálculo exato, origem manual ou liberação automática específica e referência à declaração anterior apenas quando comprovada. Ausência de conferência/liberação impede T2; cálculo e FS12 confirmados não concedem transmissão. Intento RETIFICAR distingue número anterior de qualquer resultado novo.

A assinatura de `SerproChamada` continua calculada pelo algoritmo legado e inclui rota/envelope. `envelopeHash` é SHA256 da serialização canônica versionada do envelope que será despachado; não substitui assinatura nem muda cooldown. Antes da associação à reserva, o adaptador confiável compara envelope, empresa, PA, modo, plano FS12 e assinatura do ledger. Envelope congelado e hash de intenção são provas locais diferentes; nenhum autentica sozinho a Receita. Headers OAuth/certificados nunca entram nos envelopes custodiados.

## 4. T1, T2, T3a e T3b — contratos propostos

Todos recebem identidade resolvida no servidor. Erros novos abaixo são categorias internas propostas, não novos códigos HTTP nesta entrega. Reutilizar a tradução pública vigente na implementação aprovada; nenhum endpoint muda agora.

| Contrato | Entrada/leituras e escrita local | Saída, conflito e repetição |
| --- | --- | --- |
| T1 `prepararComandoFiscalFs12` | Ator autenticado, PortalClient, PA, intenção, chave, revisão/contexto esperados; lê Company/CNPJ/regime, FS12 completa, snapshot/ciclo e eventual vínculo de entrada/conferência. Avalia plano B33a. Transação curta Serializable persiste comando/tentativa juntos e somente CAS operacional autorizado. | Comando congelado ou impedimentos. Replay exige ACL atual e hash integral igual, inclusive Company; mesma chave com intenção diferente conflita. Plano null encerra sem reserva/novo comando fiscal. Não inventar tentativa para povoar tabelas. |
| T2 `autorizarDespachoFiscalFs12` | Comando e envelope construídos no servidor, sem alterar intenção. Autenticação de transporte ocorre fora de SQL. Com mesma coordenação de B31 relê revisão vigente, ACL, mapeamento, CNPJ/contexto, snapshot/ciclo/conferência declaratória quando aplicável/pausas. Adaptação futura reutiliza orçamento/reserva CallGuard, mesma tx local, associação imutável e marcador de despacho. | Reserva e marca única da tentativa; nenhuma rede na transação. Se marcador existe, não entrega outra permissão de envio. Recusa anterior ao despacho conserva semântica de abortada_auth/politica e orçamento. Falha local desfaz o que pertence à mesma transação. Não engolir P2034 ou repetir transporte. |
| T3a `custodiarRespostaFiscalObservada` | Capacidade interna restrita emitida em T2, comando/tentativa/reserva/marcador/envelope identificados; resposta recebida pelo adaptador confiável, inclusive HTTP erro/raw. Lê cadeia histórica, não exige usuário humano ainda ativo. Transação própria curta guarda corpo cifrado/hash e autoria técnica. | ID de observação durável ou replay; commit independente anterior a T3b. Não altera snapshot, confirma declaração ou libera nova chamada. Observações divergentes preservadas e bloqueiam promoção. Sem resposta/corpo recuperável, resultado continua desconhecido. |
| T3b `promoverResultadoFiscalCustodiado` | ID de observação e comando; relê ACL atual, Company, CNPJ/contexto/revisão, conferência prévia apenas para TRANSMITIR/RETIFICAR, snapshot/ciclo por CAS. Valida semanticamente resposta do modo correto e cadeia causal. Em um tx Serializable: SIMULAR cria snapshot/cálculo exato + vínculo B32 + associação; TRANSMITIR/RETIFICAR usam exatamente vínculo de entrada e fatos/estado declaratório com prova específica. | Promoção única ou histórico sem promoção. Falha em qualquer escrita desfaz T3b integralmente; T3a continua gravado. Replay compara vínculo/hash/observação. Resposta de simulação, HTTP200, PDF ou número antigo não geram declaração comprovada. |

Fato B32 `TENTATIVA_INICIADA` de transmissão nasce com vínculo já existente e deve ser ligado à tentativa de T2; o produtor futuro lê a nova cadeia pelo contrato confiável, sem admitir alegação do navegador. T3b pode anexar RESULTADO_CONFIRMADO somente com prova declaratória causal. Resposta tardia após revisão/reabertura fica em T3a; não promover outra revisão nem apagar tentativa anterior.

**Reserva e marca não são a mesma fase.** O guard atual reserva antes de autenticar. A adaptação deve preservar isso: uma curta transação de reserva reutiliza CallGuard e associa o comando; autenticação fora de SQL; T2 final volta à mesma cadeia e marca o despacho após revalidação. O contrato T2 cobre essas duas fases locais, nunca uma transação aberta durante autenticação. Se falhar a associação, não há despacho. Se auth falhar comprovadamente antes da rede, abortada_auth continua liberando orçamento; nova intenção explícita passa por todas as guardas, sem replay automático. Uma implementação futura deve oferecer operações do guard que aceitem o mesmo tx; chamar o guard atual que abre outra transação de dentro do coordenador é proibido.

### Ordem de locks candidata e ponto de linearização

Ordem única proposta para trechos que precisem dos respectivos recursos (sempre pular recursos desnecessários, nunca adquirir em ordem inversa):

1. advisory global SERPRO `73517001`, quando mede/reserva/despacha;
2. advisory ciclo/pausas `73517002`, quando avalia automação;
3. advisory empresarial existente `hashtext('company_automation:' + portalClientId)`;
4. User e CompanyFirmAccess do ator, PortalClient, Company, regime_historico, nessa ordem e IDs ordenados quando múltiplos;
5. chave do ciclo `ciclo_simples:portal:PA`, seguida da revisão FS12 sob escopo congelado;
6. ApuracaoSnapshot FOR UPDATE por PortalClient/PA, comando, reserva e marcador.

**Escolha mínima:** reutilizar `company_automation` para confirmação FS12 e autorização T2, sem outro sistema de bloqueio. Serializa todos os PAs da mesma empresa durante trechos curtos; custo/contensão deve ser medido no ensaio futuro. B31 deve adquirir esse lock antes de suas leituras SHARE; seu retry local existente não inclui rede. T1/T3b usam o mesmo recurso ao decidir vigência. Leases de cálculo, ciclo, CAS de itens e assinaturas permanecem distintos, com suas funções existentes; lease não substitui lock SQL.

A ordem atual difere: reserva global→ciclo→empresa; despacho global→empresa→ciclo. Portanto a ordem acima é **proposta para adaptação coordenada**, não propriedade atual nem prova de deadlock existente. Inventariar escritores de pausa/configuração, ciclo, remapeamento e ACL antes de alterar; nenhum deles pode segurar lock posterior e chamar recurso anterior. Escritores SQL de identidade continuam coordenados pelos row locks. Inserção concorrente em histórico/regime é coberta por revalidação/Serializable, mas exige ensaio específico; não prometer bloqueio de phantom apenas por SHARE. Empresa/regime mudados após marca não cancelam rede ocorrida; T3b recusa contexto obsoleto.

Para evitar snapshot MVCC antigo após esperar advisory lock, a implementação Serializable deve obter o lock em transação local sem confiar em leitura anterior, e demonstrar que conflito de revisão é detectado. Como um lock advisory não atualiza linha, **não basta esperar e reler no mesmo snapshot Serializable antigo**. Proposta exata: reutilizar AppSetting com chave privada `fs12_coord:<portalClientId>` e value `{v:1, sequencia:N}`, sem alterar o JSON de configuração `company_automation`. É um contador técnico de concorrência, não estado fiscal, autorização ou segunda reserva. Sob o advisory empresarial já existente e antes das leituras fiscais, B31/T1/T2/T3a/T3b devem incrementar a mesma linha com escrita SQL; Serializable detecta a linha modificada após o snapshot e recusa a transação obsoleta. Chave ausente é criada no mesmo tx, sem backfill; duas criações concorrentes conflitam de modo seguro. Cada escritor valida forma exata e inteiro seguro antes do incremento; ausência parcial/formato divergente/overflow bloqueiam, nunca zeram contador existente. O contador não é exposto como revisão da FS12. T3a participa apenas da coordenação técnica usando o PortalClient original do comando, sem exigir ACL humana ou FS12 vigentes; isso permite custodiar mesmo após revogação/remapeamento, sem promover o resultado. Não habilitar T2 até provar duas conexões e ambos ordenamentos; a proposta não está aplicada.

Operação SQL candidata, somente documental, após lock e validação de formato; todos os parâmetros são do servidor. Se a inserção não criou, atualizar exatamente o valor lido; zero linhas/conflito SQL aborta sem rede. Para registro existente, `UPDATE` sob Serializable impede usar versão anterior a commit concorrente. Não usar ON CONFLICT DO NOTHING como evidência de que a revisão está vigente.

```sql
INSERT INTO "AppSetting" (key,value,"createdAt","updatedAt")
VALUES ($1, jsonb_build_object('v',1,'sequencia',1), CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
-- Somente no ramo existente, com $2 inteiro N lido/validado na mesma transação:
UPDATE "AppSetting"
SET value=jsonb_build_object('v',1,'sequencia',$2::bigint+1), "updatedAt"=CURRENT_TIMESTAMP
WHERE key=$1 AND value=jsonb_build_object('v',1,'sequencia',$2::bigint)
  AND $2::bigint BETWEEN 1 AND 9007199254740990
RETURNING value;
```

O ramo recém-criado usa sequencia1, sem executar o UPDATE; o ramo existente exige exatamente uma linha. Confirmar FS12 sem esse protocolo continua legado e impede ativação do coordenador. O uso de um registro de conflito compartilhado é necessário porque advisory lock isolado não renova snapshot; isso será validado em banco antes da implementação do consumidor.

A marca T2 comprometida define o limite: revisão anterior deve recusar; revisão posterior pode impedir promoção, nunca apagar custódia. Crash após marca e antes de HTTP continua reservado/incerto e bloqueado; não expira para retry. Falha do commit percebida pelo chamador exige consultar cadeia local; não presumir que commit não aconteceu. Nenhuma repetição de T1/T2 autoriza repetir rede. Retry exclusivamente local de T3a/T3b exige idempotência e nunca inclui transporte.

### Observações divergentes e promoção concorrente

T3a e T3b usam o mesmo lock empresarial e contador técnico `fs12_coord` descritos acima, antes de ler as observações. Assim uma transação Serializable que esperou usando snapshot antigo é recusada pelo contador atualizado. T3a verifica capacidade e cadeia original, mas não exige ACL humana/revisão vigente; bloqueio técnico não se confunde com autorização de custódia. T3b relê todas as observações do comando no mesmo tx antes de promover.

Duas observações de mesmo comando com hash/status diferentes constituem evidência persistente de divergência, derivada das linhas append-only, sem novo enum concorrente. Se T3a divergente vencer, T3b deve recusar. Se T3b vencer antes de chegar a divergência, conservar cálculo/fatos/declaração já registrados e a nova observação; não desfazer silenciosamente o ato anterior. A projeção Fiscal apresenta necessidade de conciliação, e T1/T2/T3b devem consultar divergências históricas do escopo original PortalClient/Company/PA, inclusive comandos anteriores. Nova chave, envelope ou revisão não elimina impedimento. Não há contrato de resolução automática: remoção desse impedimento exige incremento explícito de conciliação auditada; enquanto não existir, permanece bloqueado. Leitura histórica conserva a autorização própria e não dispara rede. A associação já gravada aponta à observação exata usada, tornando visível qual evidência precedeu a divergência.

Essa coordenação é proposta, sem mudanças no legado. Ensaios futuros devem provar ambas ordens T3a↔T3b e chegada após commit, inclusive autor revogado e Company remapeada; mocks atuais não comprovam essa garantia.

## 5. Custódia, autorização e retenção propostas

- Capacidade interna `custodiar_resposta_pgdas` não é novo papel concedido a usuários. É objeto autenticado interno, emitido pelo processo de despacho, limitado a comando/tentativa/reserva/envelope/modo; não aceito do corpo HTTP público. Identidade do custodiante e versão da capacidade ficam registradas. A política deve permitir entrega tardia comprovada sem autorização humana ainda vigente; revogação não autoriza criar reserva ou executar rede.
- T3a verifica cadeia/marcador, hash do envelope e origem pelo adaptador confiável; somente recebeu HTTP não basta para prova fiscal. Não existe hoje credencial/capacidade implementada que forneça isso. A implementação exige revisão de segurança específica, incluindo replay forjado e tentativa de outra empresa.
- `corpoCifrado` e `envelopeCifrado` são objetos versionados AES-256-GCM propostos: `{v,alg,keyId,nonce,ciphertext,tag,aadVersion}`. Nonce aleatório único por chave, tag autenticada e AAD com empresa/PA/comando/tentativa/reserva/tipo da evidência; chave fora do banco e Git, sob custódia independente. Não reutilizar por conveniência a chave de certificados. Escolha do provedor de chave, rotação e recuperação é decisão de segurança antes da implementação; não criar recursos AWS neste incremento.
- Hash calculado sobre representação canônica antes de cifrar. PostgreSQL valida apenas que os campos cifrados são objetos; o DDL não limita seu tamanho ou autentica seu formato. O adaptador valida limites e campos exatos, decifra/verifica tag/hash/AAD e tamanho do conteúdo. Limite de16MiB do corpo decifrado precisa homologação técnica; metadados limitados e logs sem corpo, valores mensais, tokens ou dados fiscais. Nenhum campo livre do provedor é logado como diagnóstico seguro.
- Leitura histórica exige autorização atual da empresa e mapeamento original compatível; remapeamento não transfere evidência ao novo Company. Acesso excepcional ao arquivo histórico exige procedimento administrativo próprio e auditado, não bypass implícito. Separar leitura dos metadados de decifração do corpo, sob menor privilégio.
- Tabelas novas append-only com restrição UPDATE/DELETE; aplicação só por portas do contexto Fiscal. Administrador de banco pode superar controles: isso é limite, não alegação de inviolabilidade. Auditoria de leitura sensível registra quem/qual evidência/finalidade sem copiar o corpo. Trilha de escrita é a própria evidência técnica mais auditoria transacional.
- Retenção fiscal/legal e descarte de chaves precisam de aprovação do custodiante/responsável fiscal. Até essa definição, **não ativar descarte automático**, TTL de cache ou crypto-erasure das evidências. Proposta não fixa prazo legal nem acessa dados reais. Capacidade interna não deve expirar apagando resposta já ocorrida; validade de origem e prevenção de abuso precisam ser verificadas separadamente de autorização de novo ato.

## 6. Correção prospectiva de pa — ainda não implementada

O teste registra `identificarChamada` atual: pa isolado vira null; alias `competencia:'2026-13'` é aceito pelo identificador. A guarda B32 anterior ao transporte já valida PA e bloqueia meses incompatíveis. Isso não autoriza corrigir registros históricos por inferência.

Proposta restrita a PGDASD/TRANSDECLARACAO11: decodificar `pedidoDados.dados` uma vez, admitir pa inteiro AAAAMM ou string exata AAAAMM; aliases legados `periodoApuracao`, `competencia`, `_periodoApuracao` normalizados conforme formatos já aceitos. Validar mês01–12 e ano suportado pelo contrato temporal; valores booleanos, frações, texto parcial ou conflitante recusam nova reserva. Todos os campos presentes devem concordar; não escolher silenciosamente o primeiro. Ausência/malformed recusa novo despacho coordenado e mantém leitura histórica disponível. Não usar guardas temporais para tornar ilegível uma tentativa antiga.

Não alterar o envelope, assinatura canônica, assinatura legada, cooldown, custos ou dados passados. Preencher apenas competencia de novas tentativas após validação e comparar com PA do comando/FS12. Outros serviços mantêm contrato próprio; anoMesParcela não vira PA de transmissão. Matriz futura: pa número/string, ambos aliases concordantes/divergentes, mês00/13, ausência, JSON inválido, simulaçãofalse/transmissãotrue, PA10/11/12/2027. A normalização não libera PA11/12/2027 nem substitui aprovação da seleção B33a.

## 7. Matriz de provas e próximos ensaios

| Cenário | Evidência atual executável nesta entrega | Prova futura obrigatória, dependente de aprovação |
| --- | --- | --- |
| Replay de comando/hash/Company divergente | B31/B32 HTTP e PG validam replay, revisão e mapeamento | Novas unicidades/FKs e colisão de intenção do comando em duas conexões |
| FS12 muda antes de T2, ambas ordens | B31/B32 PG preservam histórico; não são barreira de despacho | Barreiras determinísticas: confirmação vence→T2 recusa; T2 vence→custódia preservada e T3b recusa revisão antiga; testar snapshot após espera |
| Revogação antes/depois T2 | HTTP/PG existentes recusam uso não autorizado | Auth revogada antes marca sem rede; após marca só capacidade restrita T3a, T3b bloqueado; sem transferência a outro usuário |
| Crash após reserva/auth/marca | Focal transporte falso recusa segundo despacho com marcador; não é crash de processo real | Reinício com reserva durável e commit ambíguo, nenhuma retransmissão |
| Incerto seguido de chave/envelope novos | Ledger atual bloqueia assinatura, não prova bloqueio transversal por PA | T1/T2 consultam tentativa incerta/divergente do escopo e recusam bypass mesmo com nova assinatura; sem retransmissão automática |
| Timeout/resposta perdida | Focal produz incerta e forçar não repete | Conciliação explícita com prova causal; sem prova permanece desconhecido |
| Resposta HTTP200/raw erro e falha cache/ledger | Focal demonstra lacuna de custódia e reserva preservada | T3a durável inclusive erro/raw; queda após T3a e antes/depois T3b; corpo cifrado recuperável |
| Rollback promoção | B32 PG rollback snapshot+vínculo no mesmo tx | Nova associação e auditoria no mesmo rollback, T3a de outra tx preservado |
| Reabertura/recálculo/retificação | procedenciaDas e B32 preservam número antigo, histórico e token | Resposta tardia não associada ao cálculo novo ou a outro cálculo da mesma revisão; FK vínculoOrigem |
| Simulação/cache/transmissão | Focal cachefalse recupera sem nova rede; transmissão não cacheada | Recuperação usa origem do comando original e associação comprovada; cache legado sem causalidade não ganha vínculo |
| Company/PortalClient/CNPJ distintos | HTTP/PG já testam isolamento e remapeamento | Constraints novas + AAD + ACL de leitura/custódia e remapeamento durante rede |
| PA10/11/12/2027 | Guardas reais e focal transportefake: PA10 legado; demais bloqueados | Normalizador prospectivo e política homologada em incremento próprio, sem reduzir bloqueios |
| Manual/Operações/lote/rotina/script | Regressões existentes e mapa B33b | Todos os pontos devem fornecer identidade confiável e usar a mesma guarda final; script sem contexto recusa, sem identidade de serviço inferida |

PostgreSQL16 exclusivamente descartável, duas instâncias Prisma independentes, barreiras explícitas com timeout e observação de espera para cenários futuros. Não usar sleeps como prova de concorrência. As novas tabelas/DDL **não foram criadas**; não confundir regressão dos modelos existentes com validação do schema candidato. Nenhum teste-modelo falso do futuro coordenador foi introduzido.

Lote moderno `OperationsBatchService` relê ator/vínculo em dispatchGuard; lote legado `apuracaoBatchWorker` recebe triggeredBy com autorização da rota e CAS de item, sem a mesma revalidação própria. Preservar a diferença; unificá-la exige escopo/aprovação próprios. Manual usa userId no contexto SERPRO mas cálculo não recebe explicitamente esse ator: composição futura deve fornecê-lo. Scripts de payload local não ganham autorização por construírem envelope. Worker, reserva, lease e orçamento não serão substituídos por novo status no comando.

## 8. Evidências desta entrega e limites

Principal executou regressão de **546 testes /35 suítes**, incluindo **62 PostgreSQL16** (43 FS12,19 Operações), zero falhas/ignorados finais. Evidência privada `.altan-governance/b33b1-regression-final.json`; 215 migrations já integradas em cluster loopback55489, banco `altan_piloto_governance_test`, somente fixtures sintéticas. Não foi usado banco de clientes. A primeira invocação usou experimental-vm-modules incompatível com Jest/Babel; repetição correta passou sem alterar código/testes.

Governança:40 testes do comando npm e48 do executor de lotes; arquitetura5 testes; diagnose5023→5023, zero acréscimos. Teste novo `apps/api/src/application/fiscal/serpro/__tests__/fs12B33b1Persistencia.test.js` tem15cenários com implementações atuais/doubles. Primeira execução14passaram/1falhou por asserção global de marcador ao fazer duas intenções; revisão independente exigiu marcador exato da tentativa e dois registros concluídos. Após correção, focal final 15/15 aprovado (b33b1-focal-final.json). Total local 561 testes em36suítes, zero falhas/ignorados finais; PG descartável encerrado e arquivos preservados. CI hospedada será registrada no PR no SHA final.

Controlador `2026-11-18T17-20-37-160Z-efa69a96`: planejamento concluído; executor expirou e controlador retornou **escalated**, exit1/timeouttrue. Houve falha de permissão no subprocesso; gates e permissões não foram alterados. Principal concluiu documento/teste sob permissões existentes e submeteu a revisões independentes. Não declarar ready_for_human. Journal/logs privados preservados. UI/UX não se aplica: nenhuma tela modificada.

## 9. Decisões e menor implementação posterior

1. Aprovar desenho dos quatro registros, vínculo de entrada, observações divergentes, envelope/corpo cifrados, idempotência e limites. Aprovar gestão de chave, retenção/visibilidade e capacidade interna restrita. **Nenhum DDL aprovado por esta entrega.**
2. Revisar e aprovar o contador técnico fs12_coord proposto para coordenação MVCC no mecanismo existente, incluindo todos escritores e ordem de locks. Sem prova nas duas ordens, T2 continua não implementável com segurança.
3. Somente após autorização, implementar persistência local aditiva e constraints/portas, sem integrar despacho. Ensaiar FKs/imutabilidade/replay/cifra/rollback/concorrência em PostgreSQL16 descartável. Não relaxar B32 ou inventar calculoId. Migration separada, expand-only e sem backfill; validar SQL/Prisma e compatibilidade do binário anterior.
4. Implementar coordenação local T1/T2 e custódia/promoção com transporte falso, ainda com guardas ligadas. Testar matriz completa e origem oficial; não liberar somente uma entrada deixando bypass nas demais.
5. Homologação dos meses e contrato SERPRO permanece entrega própria. B33a null, B32 bloqueado e2027 pendente. Integração funcional, produção e B3.3b.2 não estão autorizadas automaticamente.

Rollback desta entrega: reverter documento, teste e registro, sem dados ou produto a desfazer. Em implementação futura com dados novos, desativar consumidor/voltar binário mantendo tabelas/evidências; não apagar custódia ou liberar resultado incerto como rollback. Revisão humana do desenho não é autorização para merge/deploy/atos fiscais.