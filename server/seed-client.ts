import { storage } from "./storage";
import { hashPassword } from "./auth";
import { log } from "./logger";
import { db } from "./db";
import { emailTemplates } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function seedTemplatesForClient(clientId: string, campaignKey: string): Promise<void> {
  const existing = await db.select().from(emailTemplates).where(eq(emailTemplates.clientId, clientId));

  const templates = CAMPAIGN_TEMPLATES[campaignKey];
  if (!templates) return;

  const existingNames = new Set(existing.map(e => e.name));
  let inserted = 0;
  for (const t of templates) {
    if (existingNames.has(t.name)) continue;
    await db.insert(emailTemplates).values({
      clientId,
      name: t.name,
      subject: t.subject,
      body: t.body,
      touchNumber: t.touchNumber,
      source: "ai_generated",
    });
    inserted++;
  }
  if (inserted > 0) {
    log(`Seeded ${inserted} new templates for ${campaignKey}`, "seed");
  } else {
    log(`Templates already seeded for ${campaignKey} (${existing.length} found)`, "seed");
  }
}

const CAMPAIGN_TEMPLATES: Record<string, { name: string; subject: string; body: string; touchNumber: number }[]> = {
  texas_cdt: [
    {
      name: "CDT — Initial Outreach",
      touchNumber: 1,
      subject: "Cooling support for your Gulf Coast crews",
      body: `Hi {{contactName}},

I'm reaching out from Texas Cool Down Trailers. We deploy mobile cooling stations for contractors running long shifts inside refineries and chemical plants along the Gulf Coast.

If your crews are supporting plant turnarounds, shutdowns, or any extended outdoor/indoor heat exposure work, our units are built to keep teams safe and productive on-site.

Would it make sense to have a quick conversation about how we support operations like yours?

Best regards`,
    },
    {
      name: "CDT — Follow-up 1",
      touchNumber: 3,
      subject: "Re: Cooling support for your Gulf Coast crews",
      body: `Hi {{contactName}},

Following up on my earlier note. We've been deploying cooling trailers for contractors across the Gulf Coast refinery corridor and wanted to make sure this landed on your radar.

If heat mitigation is part of your safety planning for upcoming projects, I'd be glad to walk you through how our units integrate into active job sites.

Let me know if it's worth a brief call.

Best regards`,
    },
    {
      name: "CDT — Follow-up 2",
      touchNumber: 5,
      subject: "Last note — cooling trailer availability",
      body: `Hi {{contactName}},

I wanted to send one more note before closing the loop. If your teams are working plant-side this season and heat exposure is a factor, our mobile cooling stations are available for short-term or extended deployment.

Happy to send over specs or availability if helpful. Either way, I appreciate your time.

Best regards`,
    },
    {
      name: "CDT — Final Check-in",
      touchNumber: 0,
      subject: "Quick check-in — Texas Cool Down Trailers",
      body: `Hi {{contactName}},

Just a final check-in from Texas Cool Down Trailers. If cooling support isn't a priority right now, no worries at all. We'll be here when the time is right.

If anything changes on your end, feel free to reach out directly.

Take care`,
    },
  ],
  texas_automation: [
    {
      name: "TAS — Initial Outreach",
      touchNumber: 1,
      subject: "Automating your outreach and follow-up",
      body: `Hi {{contactName}},

I'm reaching out from Texas Automation Systems. We build outreach and follow-up systems that help service companies automate prospecting, lead management, and communications so teams spend less time on manual follow-up.

The system is already running inside real businesses — handling lead generation, multi-touch sequencing, call scheduling, and performance tracking without adding headcount.

If your team is doing any kind of outbound prospecting or client follow-up, I'd like to show you how this works in practice.

Would a brief conversation make sense?

Best regards`,
    },
    {
      name: "TAS — Follow-up 1",
      touchNumber: 3,
      subject: "Re: Automating your outreach and follow-up",
      body: `Hi {{contactName}},

Following up on my earlier message. We've built an automation system that handles the repetitive parts of outreach — email sequencing, call scheduling, lead tracking, and follow-up reminders — so your team can focus on conversations that actually close.

This isn't off-the-shelf software. It's a managed system built around how your operation actually works.

If you're open to it, I can walk you through a quick overview. No pressure either way.

Best regards`,
    },
    {
      name: "TAS — Follow-up 2",
      touchNumber: 5,
      subject: "One more note — automation system",
      body: `Hi {{contactName}},

Wanted to send one final note. If your business relies on outbound outreach, follow-up sequences, or lead management, our system is designed to handle that end-to-end — without hiring more people or buying bloated software.

Happy to share a brief walkthrough if the timing works. If not, I appreciate your time.

Best regards`,
    },
    {
      name: "TAS — Final Check-in",
      touchNumber: 0,
      subject: "Closing the loop — Texas Automation Systems",
      body: `Hi {{contactName}},

Just closing the loop on my previous messages. If automating your outreach pipeline isn't a priority right now, completely understood.

If things change or you want to explore what a managed system looks like, you can reach out anytime.

Take care`,
    },
  ],
  lab_850: [
    {
      name: "850 Lab — Initial Outreach",
      touchNumber: 1,
      subject: "Financial education workshop for your members",
      body: `Hi {{contactName}},

I'm reaching out from 850 Lab Workshops. We host financial education and credit optimization workshops designed to help attendees improve their credit profile and understand how stronger credit creates access to business funding, housing opportunities, and financial leverage.

Many organizations offer this as a value-add for their members, employees, or community — and the response has been consistently strong.

Would it make sense to discuss whether a workshop like this fits your programming?

Best regards`,
    },
    {
      name: "850 Lab — Follow-up 1",
      touchNumber: 3,
      subject: "Re: Financial education workshop for your members",
      body: `Hi {{contactName}},

Following up on my earlier note about the 850 Lab Workshops. These are educational sessions — not sales pitches — that give participants real tools to strengthen their financial position.

The host investment is approximately $150 and the value is delivered directly to attendees. Organizations that have hosted these have seen strong engagement and positive feedback.

If this sounds like something your group would benefit from, I'm happy to walk you through the format and logistics.

Best regards`,
    },
    {
      name: "850 Lab — Follow-up 2",
      touchNumber: 5,
      subject: "Last note — workshop availability",
      body: `Hi {{contactName}},

Sending one more note about the 850 Lab financial education workshops. If your organization is looking for programming that helps people build credit knowledge, access funding pathways, or strengthen their financial foundation, this is a straightforward way to deliver that.

Happy to share more details or answer any questions. Either way, I appreciate your time.

Best regards`,
    },
    {
      name: "850 Lab — Final Check-in",
      touchNumber: 0,
      subject: "Closing the loop — 850 Lab Workshops",
      body: `Hi {{contactName}},

Just a final check-in. If financial education workshops aren't a fit right now, no problem at all. We're always available if the timing changes.

Feel free to reach out whenever it makes sense.

Take care`,
    },
  ],
};

export async function seedTexasCoolDown(): Promise<void> {
  const clients = await storage.getAllClients();
  const exists = clients.find(c => c.clientName === "Texas Cool Down Trailers");
  if (exists) {
    log(`Client "Texas Cool Down Trailers" already exists (${exists.id})`, "seed");
    await seedTemplatesForClient(exists.id, "texas_cdt");
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

  await seedTemplatesForClient(client.id, "texas_cdt");
  log(`Seeded client: Texas Cool Down Trailers (${client.id})`, "seed");
}

export async function seedTexasAutomation(): Promise<void> {
  const clients = await storage.getAllClients();
  const exists = clients.find(c => c.clientName === "Texas Automation Systems");
  if (exists) {
    log(`Client "Texas Automation Systems" already exists (${exists.id})`, "seed");
    await seedTemplatesForClient(exists.id, "texas_automation");
    return;
  }

  const client = await storage.createClient({
    clientName: "Texas Automation Systems",
    machineName: "Outreach Automation Engine",
    industryConfig: "services",
    territory: "National",
    decisionMakerFocus: "Operations + Business Development",
    status: "active",
    airtableBaseId: null,
  });

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPw) {
    const operatorEmail = "operator@texasautomation.systems";
    const existingUser = await storage.getUserByEmail(operatorEmail);
    if (!existingUser) {
      const hashedPw = await hashPassword(adminPw);
      await storage.createUser({
        username: operatorEmail,
        email: operatorEmail,
        password: hashedPw,
        role: "client_admin",
        clientId: client.id,
      });
      log(`Seeded TAS operator: ${operatorEmail}`, "seed");
    }
  }

  await seedTemplatesForClient(client.id, "texas_automation");
  log(`Seeded client: Texas Automation Systems (${client.id})`, "seed");
}

export async function seed850LabWorkshops(): Promise<void> {
  const clients = await storage.getAllClients();
  const exists = clients.find(c => c.clientName === "850 Lab Workshops");
  if (exists) {
    log(`Client "850 Lab Workshops" already exists (${exists.id})`, "seed");
    await seedTemplatesForClient(exists.id, "lab_850");
    return;
  }

  const client = await storage.createClient({
    clientName: "850 Lab Workshops",
    machineName: "Workshop Outreach Engine",
    industryConfig: "education",
    territory: "National",
    decisionMakerFocus: "Community Programs + Member Services",
    status: "active",
    airtableBaseId: null,
  });

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPw) {
    const operatorEmail = "operator@850labworkshops.com";
    const existingUser = await storage.getUserByEmail(operatorEmail);
    if (!existingUser) {
      const hashedPw = await hashPassword(adminPw);
      await storage.createUser({
        username: operatorEmail,
        email: operatorEmail,
        password: hashedPw,
        role: "client_admin",
        clientId: client.id,
      });
      log(`Seeded 850 Lab operator: ${operatorEmail}`, "seed");
    }
  }

  await seedTemplatesForClient(client.id, "lab_850");
  log(`Seeded client: 850 Lab Workshops (${client.id})`, "seed");
}

export async function seedAllCampaigns(): Promise<void> {
  await seedTexasCoolDown();
  await seedTexasAutomation();
  await seed850LabWorkshops();
}
