jest.mock('../../../config.js',()=>({JWT_SECRET:'unit-test-secret',PORTAL_AUDIENCE:'unit-portal',JWT_EXPIRES_IN:'1h',REFRESH_TOKEN_EXPIRES_IN:'7d',AUTH_USERS:[]}));
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{clientSession:{findUnique:jest.fn(),updateMany:jest.fn()},client:{findUnique:jest.fn()}}}));
jest.mock('../../../infrastructure/db/UserRepository.js',()=>({UserRepository:{findById:jest.fn()}}));
jest.mock('../../../infrastructure/db/ClientRepository.js',()=>({ClientRepository:{}}));
import jwt from 'jsonwebtoken';
import {AuthService} from '../AuthService.js';
import {UserRepository} from '../../../infrastructure/db/UserRepository.js';
import {prisma} from '../../../infrastructure/db/prisma.js';
import {ClientSessionService} from '../ClientSessionService.js';
const user={id:'u',email:'u@example.com',passwordHash:'oldhash',status:'active',role:'user',accountType:'CLIENT'};
beforeEach(()=>jest.clearAllMocks());
test('refresh não autoriza rotas comuns; token de acesso não renova sessão',()=>{
 const access=AuthService.generateToken(user),refresh=AuthService.generateRefreshToken(user);
 expect(AuthService.verifyToken(access).sub).toBe('u');
 expect(()=>AuthService.verifyToken(refresh)).toThrow();
 expect(()=>AuthService.verifyRefreshToken(access)).toThrow();
 expect(AuthService.verifyRefreshToken(refresh).sub).toBe('u');
});
test('recusa assinatura, algoritmo, audiência, expiração e tokens sem validade',()=>{
 const sign=(body,opts={})=>jwt.sign(body,'unit-test-secret',opts);
 for(const token of [sign({sub:'u'}),sign({sub:'u'},{expiresIn:-1}),sign({sub:'u'},{expiresIn:'1h',audience:'other'}),sign({sub:'u'},{expiresIn:'1h',algorithm:'HS384'})])
  expect(()=>AuthService.verifyToken(token)).toThrow();
});
test('troca de senha invalida acesso e refresh anteriores; desativação recusa',async()=>{
 const payload=AuthService.verifyToken(AuthService.generateToken(user));UserRepository.findById.mockResolvedValue(user);
 expect(await AuthService.resolveUserFromPayload(payload)).toMatchObject({id:'u'});
 UserRepository.findById.mockResolvedValue({...user,passwordHash:'newhash'});expect(await AuthService.resolveUserFromPayload(payload)).toBeNull();
 UserRepository.findById.mockResolvedValue({...user,status:'rejected'});expect(await AuthService.resolveUserFromPayload(payload)).toBeNull();
});
test('sessão vinculada revogada ou de outro usuário não autoriza',async()=>{
 const payload=AuthService.verifyToken(AuthService.generateToken({...user,sessionId:'s'}));UserRepository.findById.mockResolvedValue(user);
 prisma.clientSession.findUnique.mockResolvedValue({id:'s',userId:'other',expiresAt:new Date(Date.now()+100000)});expect(await AuthService.resolveUserFromPayload(payload)).toBeNull();
 prisma.clientSession.findUnique.mockResolvedValue({id:'s',userId:'u',revokedAt:new Date(),expiresAt:new Date(Date.now()+100000)});expect(await AuthService.resolveUserFromPayload(payload)).toBeNull();
});
test('renovação usa consumo condicional: perdedor da corrida não recebe refresh',async()=>{
 prisma.clientSession.findUnique.mockResolvedValue({id:'s',userId:'u',expiresAt:new Date(Date.now()+100000)});
 prisma.clientSession.updateMany.mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});
 const results=await Promise.all([ClientSessionService.rotate('a'.repeat(96)),ClientSessionService.rotate('a'.repeat(96))]);
 expect(results.filter(Boolean)).toHaveLength(1);expect(prisma.clientSession.updateMany.mock.calls[0][0].where).toMatchObject({id:'s',revokedAt:null,refreshTokenHash:expect.any(String)});
});
