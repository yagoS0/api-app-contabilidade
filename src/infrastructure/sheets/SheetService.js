import { SHEET_ID } from "../../config.js";
import { getSheets } from "../google/GoogleClients.js";

export class SheetService {
  constructor(sheets) {
    this.sheets = sheets;
  }

  static async create() {
    const sheets = await getSheets();
    return new SheetService(sheets);
  }

  async getClientsNoHeader() {
    const range = "A:B";
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = data.values || [];
    const out = [];
    for (const row of values) {
      const nome = (row[0] || "").toString().trim();
      const email = (row[1] || "").toString().trim();
      if (!nome || !email) continue;
      out.push({ nome, email });
    }
    return out;
  }
}


