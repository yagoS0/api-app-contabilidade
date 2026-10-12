import express from 'express';
import request from 'supertest';
import { createCompanyCredentialsRouter } from '../companyCredentials.js';
import * as service from '../../../application/companies/CompanyCredentialsService.js';

jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({
  requireFirmCompanyAccess: () => (req, res, next) => next(),
}));
jest.mock('../../../application/companies/CompanyCredentialsService.js', () => ({
  criar: jest.fn(),
  CompanyCredentialError: class CompanyCredentialError extends Error {},
}));

test('erro desconhecido com payload de credenciais não aparece no log nem na resposta', async () => {
  const log = { error: jest.fn() };
  const app = express();
  app.use(express.json());
  app.use('/firm/companies/:companyId', createCompanyCredentialsRouter({ log }));
  const erro = Object.assign(new Error('Prisma senhaCifrada=blob-confidencial ClientSecret=segredo-confidencial'), {
    code: 'codigo-com-segredo', causa: { senha: 'segredo-confidencial' },
  });
  service.criar.mockRejectedValue(erro);

  const response = await request(app).post('/firm/companies/empresa/credenciais').send({
    rotulo: 'CBS', login: 'cliente', senha: 'segredo-confidencial',
  });

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ ok: false, error: 'erro_interno', message: 'Erro interno.' });
  expect(log.error).toHaveBeenCalledWith({ companyId: 'empresa', code: 'COFRE_ERRO_INTERNO' }, 'Falha no cofre de credenciais');
  expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/confidencial|codigo-com-segredo|Prisma/);
});
