import { Button } from "../../../../components/ui/Button";
import { faltasParaEmitir } from "../../../../lib/nfse/cadastroEmissaoNfse";

// Ficha de cadastro — READ-ONLY, no formato da ficha que o escritório já usa em planilha.
// É a tela de consulta do dia a dia: antes, a única forma de ver o cadastro era abrir o
// formulário de edição. Editar é um botão daqui.
//
// Fonte dos dados: `selectedCompany.legacyCompany` (o backend já devolvia porte, capital e
// data de abertura em toda listagem — o frontend é que não lia).

const PANEL = {
  // Mesmo estilo da barra superior: cor sólida + borda roxa nos blocos.
  surface: "#24253a",
  field: "#282A36", border: "rgba(189,147,249,0.22)",
  text: "#F8F8F2", muted: "#A7B0C0", dim: "#6b7280",
};

const REGIME_LABEL = {
  SIMPLES: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
  MEI: "MEI",
};

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCnpj(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 14) return value || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtCpf(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 11) return value || null;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function fmtCep(value) {
  const d = String(value || "").replace(/\D+/g, "");
  if (d.length !== 8) return value || null;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

// Campo da ficha. Valor ausente aparece como "—" em vez de sumir: numa ficha, o vazio
// também é informação (mostra o que falta preencher).
function Campo({ label, value, wide = false }) {
  return (
    <div style={{ gridColumn: wide ? "span 2" : "auto", minWidth: 0 }}>
      <div style={{ fontSize: "0.7rem", color: PANEL.dim, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "0.9rem", color: value ? PANEL.text : PANEL.dim, wordBreak: "break-word" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function Bloco({ titulo, children, cols = 3 }) {
  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "0.95rem", color: PANEL.text, fontWeight: 700 }}>{titulo}</h2>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

export function CompanyFichaTab({ selectedCompany, canEditCompany, onEdit }) {
  const c = selectedCompany || {};
  const lg = c.legacyCompany || {};
  // ⚠ Lido da MESMA linha que `buildMissingFields` lê — a `Company` (`legacyCompany`). A inscrição
  // municipal do topo do payload é do `PortalClient` e pode estar preenchida enquanto a coluna da
  // `Company` não está; a ficha diria "está tudo certo" e a emissão recusaria mesmo assim.
  // ⚠ `cnpj` NÃO está no `legacyCompanySelect` da rota — ele só volta no topo do payload (o
  // `PortalClient`). Sem o fallback a ficha acusaria "falta o CNPJ" em TODA empresa, que é o
  // oposto do que este aviso existe para fazer. É o único campo desta lista com duas fontes.
  const faltasDaEmissao = faltasParaEmitir({ ...lg, cnpj: lg.cnpj || c.cnpj });
  const end = lg.enderecoJson && typeof lg.enderecoJson === "object" ? lg.enderecoJson : {};
  const socios = Array.isArray(lg.partners) ? lg.partners : [];
  const historico = Array.isArray(lg.regimeHistorico) ? lg.regimeHistorico : [];
  const cnaesSec = Array.isArray(lg.cnaesSecundarios) ? lg.cnaesSecundarios : [];
  const regimeAtual = lg.regimeTributario || lg.tipoTributario;

  const th = { padding: "6px 8px", fontSize: "0.7rem", color: PANEL.dim, textTransform: "uppercase", textAlign: "left", fontWeight: 700 };
  const td = { padding: "6px 8px", fontSize: "0.85rem", color: PANEL.text };

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.15rem", color: PANEL.text }}>{c.razao || "Empresa"}</h1>
          <span style={{ fontSize: "0.85rem", color: PANEL.muted }}>{fmtCnpj(c.cnpj)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {c.status === "SUSPENSA" && (
            <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700, color: "#FFB347", background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347" }}>
              Suspensa
            </span>
          )}
          {c.empresaZerada && (
            <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700, color: "#8BE9FD", background: "rgba(139,233,253,0.12)", border: "1px solid #8BE9FD" }}>
              Zerada
            </span>
          )}
          <Button
            variant="secondary"
            onClick={onEdit}
            disabled={!canEditCompany}
            title={!canEditCompany ? "Apenas admin ou contador pode editar." : undefined}
          >
            ✎ Editar
          </Button>
        </div>
      </div>

      <Bloco titulo="Identificação">
        <Campo label="CNPJ" value={fmtCnpj(c.cnpj)} />
        <Campo label="Data de abertura" value={fmtDate(lg.dataAbertura)} />
        <Campo label="Porte" value={lg.porte} />
        <Campo label="Razão social" value={lg.razaoSocial || c.razao} wide />
        <Campo label="Nome fantasia" value={lg.nomeFantasia} />
        <Campo label="Natureza jurídica" value={lg.naturezaJuridica} />
        <Campo label="Abriu com" value={lg.abriuCom} />
        <Campo label="Responsável" value={c.ownerName} />
        <Campo label="E-mail do responsável" value={c.ownerEmail} />
      </Bloco>

      <Bloco titulo="Endereço">
        <Campo label="Logradouro" value={end.rua} wide />
        <Campo label="Número" value={end.numero} />
        <Campo label="Complemento" value={end.complemento} />
        <Campo label="Bairro" value={end.bairro} />
        <Campo label="CEP" value={fmtCep(end.cep)} />
        <Campo label="Município" value={end.cidade || c.municipio} />
        <Campo label="Estado" value={end.uf || c.uf} />
      </Bloco>

      <Bloco titulo="Registros e inscrições">
        <Campo label="Nº de registro" value={lg.numeroRegistro} />
        <Campo label="Tipo de registro" value={lg.tipoRegistro} />
        <Campo label="Diário nº" value={lg.diarioNumero} />
        <Campo label="Inscrição municipal" value={c.inscricaoMunicipal || lg.inscricaoMunicipal} />
        <Campo label="Data da IM" value={fmtDate(lg.inscricaoMunicipalData)} />
        <div />
        <Campo label="Inscrição estadual" value={lg.inscricaoEstadual} />
        <Campo label="Data da IE" value={fmtDate(lg.inscricaoEstadualData)} />
        <div />
        {/* ⚠ O município EMISSOR (código IBGE) não é o mesmo dado que o município do ENDEREÇO logo
            acima: um é texto cadastral, o outro é o `cLocEmi` da nota. Ficam em blocos diferentes
            de propósito — foi tratar os dois como a mesma coisa que produziu a ideia de derivar o
            código a partir do nome. Vazio aqui quer dizer que a empresa não emite NFS-e. */}
        <Campo
          label="Município emissor (IBGE)"
          value={lg.codigoMunicipioIbge}
          wide
        />
        {!lg.codigoMunicipioIbge && (
          <div style={{ gridColumn: "span 3", fontSize: "0.75rem", color: "#FFB347" }}>
            Sem o município emissor esta empresa não emite nota de serviço — o servidor recusa a
            emissão. Preencha em <strong>Editar</strong>, escolhendo o município na lista do IBGE.
          </div>
        )}
      </Bloco>

      {/* ⚠ BLOCO PRÓPRIO, e não mais três linhas soltas em "Registros e inscrições": estes campos
          não descrevem a empresa, descrevem a NOTA que este sistema emite por ela. Eles são o que
          `buildMissingFields` confere, e até agora não apareciam em tela nenhuma — a emissão
          recusava por eles e não havia por onde preenchê-los. */}
      <Bloco titulo="Emissão de NFS-e">
        <Campo label="Código nacional do serviço" value={lg.codigoServicoNacional} />
        <Campo label="Código municipal do serviço" value={lg.codigoServicoMunicipal} />
        <Campo label="Série da DPS" value={lg.rpsSerie} />
        {/* ⚠ CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012). Aparece na FICHA porque é o número que
            a nota IMPRIME ao tomador — conferir isto é trabalho de contador, e até aqui não havia
            onde vê-lo sem abrir o formulário de edição.
            ⚠ `!= null`, nunca `||`: `0` é um percentual conferido (serviço não tem ICMS), e com
            `||` ele apareceria como ausente — a ficha diria "não configurado" sobre um campo que
            o contador preencheu com zero de propósito. */}
        <Campo
          label="Carga aprox. federal (%)"
          value={lg.pTotTribFed != null ? String(lg.pTotTribFed) : null}
        />
        <Campo
          label="Carga aprox. estadual (%)"
          value={lg.pTotTribEst != null ? String(lg.pTotTribEst) : null}
        />
        <Campo
          label="Carga aprox. municipal (%)"
          value={lg.pTotTribMun != null ? String(lg.pTotTribMun) : null}
        />
        {faltasDaEmissao.length > 0 && (
          <div style={{ gridColumn: "span 3", fontSize: "0.75rem", color: "#FFB347" }}>
            {/* ⚠ Nomeia QUAL campo falta E ONDE ele fica. "Configuração incompleta" mandaria o
                contador procurar; e os campos não moram todos no mesmo bloco do formulário — a
                inscrição municipal fica em Inscrições, os outros em Emissão de NFS-e. */}
            Enquanto faltar o que está abaixo, esta empresa <strong>não emite nota de serviço</strong>:
            o servidor recusa a emissão inteira.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {faltasDaEmissao.map((f) => (
                <li key={f.campo}>{f.rotulo} — preencha em <strong>Editar</strong> → {f.onde.replace("Editar cadastro → ", "")}</li>
              ))}
            </ul>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Atividades" cols={1}>
        <Campo label="CNAE principal" value={lg.cnaePrincipal} />
        <Campo
          label="CNAEs secundários"
          value={cnaesSec.length > 0 ? cnaesSec.join(" · ") : null}
        />
      </Bloco>

      {/* Regime: o atual manda no sistema; o histórico é informativo (registro do escritório). */}
      <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text, fontWeight: 700 }}>Regime tributário</h2>
          <span style={{ fontSize: "0.8rem", color: PANEL.muted }}>
            Atual: <strong style={{ color: PANEL.text }}>{REGIME_LABEL[regimeAtual] || regimeAtual || "—"}</strong>
            {lg.desoneracao ? <span style={{ color: "#FFB347", marginLeft: 8 }}>c/ desoneração</span> : null}
          </span>
        </div>

        {historico.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: PANEL.dim }}>
            Nenhum histórico cadastrado. Use Editar para registrar as vigências.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ background: PANEL.field }}>
                  <th style={th}>Regime</th>
                  <th style={th}>De</th>
                  <th style={th}>Até</th>
                  <th style={th}>Impostos</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {REGIME_LABEL[h.regime] || h.regime}
                      {h.desoneracao && <span style={{ color: "#FFB347", fontSize: "0.75rem", marginLeft: 6 }}>c/ desone</span>}
                    </td>
                    <td style={td}>{fmtDate(h.vigenciaInicio)}</td>
                    <td style={{ ...td, color: h.vigenciaFim ? PANEL.text : "#69FF47" }}>
                      {fmtDate(h.vigenciaFim) || "vigente"}
                    </td>
                    <td style={{ ...td, color: PANEL.muted }}>
                      {Array.isArray(h.impostos) && h.impostos.length > 0 ? h.impostos.join("/") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 16, padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text, fontWeight: 700 }}>Sócios</h2>
          <span style={{ fontSize: "0.8rem", color: PANEL.muted }}>
            Capital social: <strong style={{ color: PANEL.text }}>{fmtMoney(lg.capitalSocial) || "—"}</strong>
            {(lg.alteracaoNumero || lg.alteracaoData) && (
              <span style={{ marginLeft: 12, color: PANEL.dim }}>
                {lg.alteracaoNumero ? `${lg.alteracaoNumero}ª alteração` : "Alteração"}
                {lg.alteracaoData ? ` em ${fmtDate(lg.alteracaoData)}` : ""}
              </span>
            )}
          </span>
        </div>

        {socios.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: PANEL.dim }}>
            Nenhum sócio cadastrado. Use Editar para incluir.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: PANEL.field }}>
                  <th style={th}>Nome</th>
                  <th style={th}>CPF</th>
                  <th style={th}>%</th>
                  <th style={th}>Nascimento</th>
                  <th style={th}>RG</th>
                  <th style={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {socios.map((s) => {
                  const saiu = Boolean(s.dataSaida);
                  return (
                    <tr key={s.id} style={{ borderTop: `1px solid ${PANEL.border}`, opacity: saiu ? 0.55 : 1 }}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {s.name}
                        {s.representante && <span style={{ color: "#BD93F9", fontSize: "0.72rem", marginLeft: 6 }}>representante</span>}
                      </td>
                      <td style={td}>{fmtCpf(s.documento)}</td>
                      <td style={td}>{s.participacao != null ? `${Number(s.participacao)}%` : "—"}</td>
                      <td style={td}>{fmtDate(s.dataNascimento) || "—"}</td>
                      <td style={td}>
                        {s.rg || "—"}
                        {s.rgOrgaoEmissor && <span style={{ color: PANEL.dim }}> {s.rgOrgaoEmissor}</span>}
                      </td>
                      <td style={{ ...td, color: saiu ? "#FF6E6E" : "#69FF47" }}>
                        {saiu ? `Saiu em ${fmtDate(s.dataSaida)}` : "Ativo"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Bloco titulo="Contato">
        <Campo label="Telefone" value={lg.telefone || c.telefone} />
        <Campo label="E-mail" value={lg.email || c.email} />
        <Campo label="E-mail para guias" value={c.guideNotificationEmail} />
      </Bloco>
    </div>
  );
}
