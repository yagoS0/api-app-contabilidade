jest.mock('../../../config.js', () => ({
  USE_GMAIL_API: true, FROM: 'envio@example.test', SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587,
  GMAIL_DELEGATED_USER: 'envio@example.test',
  GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({ client_email: 'service@example.test', private_key: 'synthetic' }),
  log: { info: jest.fn() },
}));
jest.mock('googleapis', () => ({ google: {
  auth: { JWT: jest.fn() }, gmail: jest.fn(),
} }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }));

import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { EmailService } from '../EmailService.js';

const message = { to: 'destino@example.test', subject: 'Guia sintética', html: '<p>Teste</p>', attachments: [] };
let events, dispatch, authorize;
beforeEach(() => {
  jest.clearAllMocks(); events = [];
  dispatch = jest.fn(async () => { events.push('transport'); });
  authorize = jest.fn(async () => { events.push('auth'); });
  google.auth.JWT.mockImplementation(() => ({ authorize }));
  google.gmail.mockImplementation(() => ({ users: { messages: { send: dispatch } } }));
  nodemailer.createTransport.mockImplementation(() => { events.push('prepare'); return { sendMail: dispatch }; });
});

test('Gmail aguarda a guarda após autenticação e antes do transporte', async () => {
  await new EmailService().send({ ...message, beforeDispatch: async () => { await Promise.resolve(); events.push('guard'); } });
  expect(events).toEqual(['auth', 'guard', 'transport']);
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('pausa durante autenticação Gmail impede saída', async () => {
  let enabled = true;
  authorize.mockImplementation(async () => { enabled = false; });
  await expect(new EmailService().send({ ...message, beforeDispatch: async () => {
    if (!enabled) throw new Error('paused');
  } })).rejects.toThrow('paused');
  expect(dispatch).not.toHaveBeenCalled();
});

test.each(['documento alterado', 'destinatário alterado', 'configuração indisponível'])('SMTP recusa %s após preparo', async reason => {
  const beforeDispatch = jest.fn(async () => { events.push('guard'); throw new Error(reason); });
  await expect(new EmailService().sendViaSmtp({ ...message, beforeDispatch })).rejects.toThrow(reason);
  expect(events).toEqual(['prepare', 'guard']);
  expect(dispatch).not.toHaveBeenCalled();
});

test('SMTP aguarda guarda assíncrona e preserva fluxo manual sem callback', async () => {
  await new EmailService().sendViaSmtp({ ...message, beforeDispatch: async () => { await Promise.resolve(); events.push('guard'); } });
  expect(events).toEqual(['prepare', 'guard', 'transport']);
  await new EmailService().sendViaSmtp(message);
  expect(dispatch).toHaveBeenCalledTimes(2);
});

test('falha de autenticação não entra na guarda nem no transporte', async () => {
  authorize.mockRejectedValue(new Error('synthetic auth failure'));
  const beforeDispatch = jest.fn();
  await expect(new EmailService().send({ ...message, beforeDispatch })).rejects.toThrow('Falha na autorização');
  expect(beforeDispatch).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test('preserva aceites SMTP e Buffer preparado antes da guarda sem criar arquivo', async () => {
 const result = { accepted: ['a@example.test'], rejected: ['b@example.test'], pending: ['c@example.test'], messageId: 'synthetic' };
 dispatch.mockResolvedValue(result);
 const content = Buffer.from('%PDF-sintetico');
 const response = await new EmailService().sendViaSmtp({ ...message, attachments: [{ filename: 'guia.pdf', content }], beforeDispatch: async () => events.push('guard') });
 expect(response).toBe(result);
 expect(dispatch.mock.calls[0][0].attachments[0]).toMatchObject({ filename: 'guia.pdf', content });
 expect(events).toEqual(['prepare', 'guard']);
});
test('Gmail devolve identificador e monta MIME a partir do Buffer antes de despachar', async () => {
 dispatch.mockResolvedValue({ data: { id: 'gmail-ficticio' } });
 const result = await new EmailService().send({ ...message, attachments: [{ filename: 'guia.pdf', content: Buffer.from('%PDF-fake') }], beforeDispatch: jest.fn() });
 expect(result).toEqual({ id: 'gmail-ficticio' });
 expect(Buffer.from(dispatch.mock.calls[0][0].requestBody.raw, 'base64').toString()).toContain('guia.pdf');
});
