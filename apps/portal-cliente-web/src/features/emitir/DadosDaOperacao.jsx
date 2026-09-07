export function DadosDaOperacao({ form, campo, conferencia, disabled }) {
  return <details>
    <summary>Retenções, obra e destinatário desta nota</summary>
    <fieldset disabled={disabled}>
      <legend>Dados específicos da operação</legend>
      <p className="hint">Preencha quando aplicável, com os valores orientados pelo contador. Destinatário diferente do tomador exige a configuração de IBS/CBS pelo escritório.</p>
      <label htmlFor="emitir-vRetIRRF">IRRF retido (R$)</label>
      <input id="emitir-vRetIRRF" inputMode="decimal" value={form.vRetIRRF} onChange={campo("vRetIRRF")} />
      <label htmlFor="emitir-vRetCP">Contribuição previdenciária retida (R$)</label>
      <input id="emitir-vRetCP" inputMode="decimal" value={form.vRetCP} onChange={campo("vRetCP")} />
      <label htmlFor="emitir-obraTipo">Identificação da obra</label>
      <select id="emitir-obraTipo" value={form.obraTipo} onChange={campo("obraTipo")}>
        <option value="cObra">CNO/CEI</option><option value="cCIB">CIB</option>
      </select>
      <label htmlFor="emitir-obraCodigo">Código da obra</label>
      <input id="emitir-obraCodigo" value={form.obraCodigo} onChange={campo("obraCodigo")} maxLength={30} />
      <label htmlFor="emitir-obraInscricao">Inscrição imobiliária (opcional)</label>
      <input id="emitir-obraInscricao" value={form.obraInscricao} onChange={campo("obraInscricao")} maxLength={30} />
      <label htmlFor="emitir-destinatarioDoc">CPF/CNPJ do destinatário diferente do tomador</label>
      <input id="emitir-destinatarioDoc" value={form.destinatarioDoc} onChange={campo("destinatarioDoc")} />
      <label htmlFor="emitir-destinatarioNome">Nome do destinatário</label>
      <input id="emitir-destinatarioNome" value={form.destinatarioNome} onChange={campo("destinatarioNome")} maxLength={150} />
    </fieldset>
    {!conferencia.ok && <div role="alert">{conferencia.erros.map((e) => <p key={e}>{e}</p>)}</div>}
  </details>;
}
