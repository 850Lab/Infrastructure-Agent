import { storage } from "./storage";
import { hashPassword } from "./auth";
import { log } from "./logger";

export async function seedTexasCoolDown(): Promise<void> {
  const clients = await storage.getAllClients();
  const exists = clients.find(c => c.clientName === "Texas Cool Down Trailers");
  if (exists) {
    log(`Client "Texas Cool Down Trailers" already exists (${exists.id})`, "seed");
    return;
  }

  const client = await storage.createClient({
    clientName: "Texas Cool Down Trailers",
    machineName: "Gulf Coast Heat Mitigation Engine",
    industryConfig: "industrial",
    territory: "Gulf Coast",
    decisionMakerFocus: "Safety + Site Operations",
    status: "active",
    airtableBaseId: null,
  });

  const seedEmail = process.env.TCDT_USER_EMAIL || "tcdt@texascooldowntrailers.com";
  const seedPassword = process.env.TCDT_USER_PASSWORD;
  if (!seedPassword) {
    log(`TCDT_USER_PASSWORD not set — skipping user seed for ${seedEmail}`, "seed");
  } else {
    const existingUser = await storage.getUserByEmail(seedEmail);
    if (!existingUser) {
      const hashedPw = await hashPassword(seedPassword);
      await storage.createUser({
        username: seedEmail,
        email: seedEmail,
        password: hashedPw,
        role: "client_admin",
        clientId: client.id,
      });
      log(`Seeded TCDT user: ${seedEmail}`, "seed");
    }
  }

  log(`Seeded client: Texas Cool Down Trailers (${client.id})`, "seed");
}
