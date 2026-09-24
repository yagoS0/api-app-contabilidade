jest.mock('../../../config.js',()=>({USE_GMAIL_API:false,FROM:'office@example.invalid',SMTP_HOST:'smtp.example.invalid',SMTP_PORT:587,SMTP_USER:'test',SMTP_PASS:'test',log:{info:jest.fn()}}));
jest.mock('nodemailer',()=>({__esModule:true,default:{createTransport:jest.fn(()=>({sendMail:jest.fn(async()=>({}))}))}}));
import nodemailer from 'nodemailer';
import {EmailService} from '../EmailService.js';
import {log} from '../../../config.js';
beforeEach(()=>jest.clearAllMocks());
test('mensagem de autenticação exige TLS e omite destinatário/código do log',async()=>{
 await new EmailService().send({to:'private@example.invalid',subject:'Access',html:'12345678',sensitive:true});
 expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({requireTLS:true,secure:false}));
 expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/private@example|12345678/);
});
test('mensagem comum conserva configuração anterior do transporte',async()=>{
 await new EmailService().send({to:'customer@example.invalid',subject:'Guide',html:'Guide'});
 expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({requireTLS:false}));
 expect(log.info).toHaveBeenCalledWith(expect.objectContaining({to:'customer@example.invalid'}),expect.any(String));
});
