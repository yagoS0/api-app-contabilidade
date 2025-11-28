import { google } from "googleapis";
import path from "node:path";
import fs from "node:fs";
import { SCOPES, GOOGLE_APPLICATION_CREDENTIALS, log } from "../../config.js";

async function getAuth() {
  if (!GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS ausente no .env");
  }
  
  // Resolve o caminho: se for relativo, resolve a partir do cwd; se for absoluto, usa como está
  let credentialsPath;
  if (path.isAbsolute(GOOGLE_APPLICATION_CREDENTIALS)) {
    credentialsPath = GOOGLE_APPLICATION_CREDENTIALS;
  } else {
    // Caminho relativo: resolve a partir do diretório de trabalho atual
    credentialsPath = path.resolve(process.cwd(), GOOGLE_APPLICATION_CREDENTIALS);
  }
  
  // Validação: verifica se o arquivo existe
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Arquivo de credenciais não encontrado: ${credentialsPath} (resolvido de: ${GOOGLE_APPLICATION_CREDENTIALS})`);
  }
  
  // Validação: verifica se é um arquivo válido
  let stats;
  try {
    stats = fs.statSync(credentialsPath);
    if (!stats.isFile()) {
      throw new Error(`Caminho não é um arquivo: ${credentialsPath}`);
    }
    log.debug({ 
      originalPath: GOOGLE_APPLICATION_CREDENTIALS,
      resolvedPath: credentialsPath, 
      size: stats.size 
    }, "Lendo arquivo de credenciais");
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Arquivo de credenciais não encontrado: ${credentialsPath} (resolvido de: ${GOOGLE_APPLICATION_CREDENTIALS})`);
    }
    throw err;
  }
  
  // Validação: tenta ler e parsear o JSON
  let credentialsContent;
  try {
    const rawContent = fs.readFileSync(credentialsPath, 'utf8');
    credentialsContent = JSON.parse(rawContent);
    
    // Valida campos obrigatórios
    if (!credentialsContent.client_email) {
      throw new Error('Campo "client_email" não encontrado no JSON de credenciais');
    }
    if (!credentialsContent.private_key) {
      throw new Error('Campo "private_key" não encontrado no JSON de credenciais');
    }
    
    // Valida formato da chave privada (deve começar com "-----BEGIN PRIVATE KEY-----")
    const privateKey = credentialsContent.private_key;
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      log.warn('Chave privada pode estar mal formatada (não contém BEGIN PRIVATE KEY)');
    }
    if (!privateKey.includes('-----END PRIVATE KEY-----')) {
      log.warn('Chave privada pode estar mal formatada (não contém END PRIVATE KEY)');
    }
    
    log.debug({ 
      client_email: credentialsContent.client_email,
      private_key_length: privateKey.length,
      private_key_starts_with: privateKey.substring(0, 50) + '...'
    }, "Credenciais JSON válidas");
    
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`JSON de credenciais inválido: ${err.message}`);
    }
    throw err;
  }
  
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: SCOPES,
  });
  return auth.getClient();
}

export async function getDrive() {
  const auth = await getAuth();
  const drive = google.drive({ version: "v3", auth });
  log.debug("Google Drive client inicializado");
  return drive;
}

export async function getSheets() {
  const auth = await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  log.debug("Google Sheets client inicializado");
  return sheets;
}


