import { google } from "googleapis";
import { SCOPES, GOOGLE_APPLICATION_CREDENTIALS, log } from "../../config.js";

async function getAuth() {
  if (!GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS ausente no .env");
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_APPLICATION_CREDENTIALS,
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


