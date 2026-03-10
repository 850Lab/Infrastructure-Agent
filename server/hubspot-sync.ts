import { db } from "./db";
import { hubspotTokens } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./logger";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";

async function getAccessToken(clientId: string): Promise<string | null> {
  const [token] = await db.select().from(hubspotTokens).where(eq(hubspotTokens.clientId, clientId)).limit(1);
  if (!token) return null;

  if (new Date(token.expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return token.accessToken;
  }

  try {
    const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        refresh_token: token.refreshToken,
      }),
    });

    if (!resp.ok) {
      log(`[hubspot-sync] Token refresh failed for ${clientId}: ${await resp.text()}`, "hubspot");
      return null;
    }

    const data = await resp.json();
    await db.update(hubspotTokens)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || token.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(hubspotTokens.clientId, clientId));

    return data.access_token;
  } catch (e: any) {
    log(`[hubspot-sync] Token refresh error: ${e.message}`, "hubspot");
    return null;
  }
}

async function hsApi(token: string, path: string, options: RequestInit = {}): Promise<any> {
  const resp = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot ${resp.status}: ${text.slice(0, 300)}`);
  }

  return resp.json();
}

async function findContactByEmail(token: string, email: string): Promise<string | null> {
  try {
    const data = await hsApi(token, `/crm/v3/objects/contacts/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: "email", operator: "EQ", value: email }]
        }],
        properties: ["email", "firstname", "lastname"],
        limit: 1,
      }),
    });
    return data.results?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function findCompanyByName(token: string, companyName: string): Promise<string | null> {
  try {
    const data = await hsApi(token, `/crm/v3/objects/companies/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: "name", operator: "EQ", value: companyName }]
        }],
        properties: ["name"],
        limit: 1,
      }),
    });
    return data.results?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function findDealByName(token: string, dealName: string): Promise<string | null> {
  try {
    const data = await hsApi(token, `/crm/v3/objects/deals/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: "dealname", operator: "EQ", value: dealName }]
        }],
        properties: ["dealname"],
        limit: 1,
      }),
    });
    return data.results?.[0]?.id || null;
  } catch {
    return null;
  }
}

export async function isHubSpotConnected(clientId: string): Promise<boolean> {
  if (!clientId) return false;
  const [token] = await db.select().from(hubspotTokens).where(eq(hubspotTokens.clientId, clientId)).limit(1);
  return !!token;
}

export async function syncCallToHubSpot(clientId: string, data: {
  companyName: string;
  outcome: string;
  notes?: string;
  dmName?: string;
  dmEmail?: string;
  dmPhone?: string;
  dmTitle?: string;
  callTime?: string;
}): Promise<{ synced: boolean; contactId?: string; companyId?: string; noteId?: string }> {
  if (!clientId) return { synced: false };

  const accessToken = await getAccessToken(clientId);
  if (!accessToken) return { synced: false };

  const result: { synced: boolean; contactId?: string; companyId?: string; noteId?: string } = { synced: false };

  try {
    let hsCompanyId = await findCompanyByName(accessToken, data.companyName);
    if (!hsCompanyId) {
      const created = await hsApi(accessToken, "/crm/v3/objects/companies", {
        method: "POST",
        body: JSON.stringify({ properties: { name: data.companyName } }),
      });
      hsCompanyId = created.id;
      log(`[hubspot-sync] Created company: ${data.companyName} (${hsCompanyId})`, "hubspot");
    }
    result.companyId = hsCompanyId;

    if (data.dmEmail) {
      let hsContactId = await findContactByEmail(accessToken, data.dmEmail);
      if (!hsContactId) {
        const contactProps: Record<string, string> = { email: data.dmEmail };
        if (data.dmName) {
          const parts = data.dmName.trim().split(/\s+/);
          contactProps.firstname = parts[0] || "";
          contactProps.lastname = parts.slice(1).join(" ") || "";
        }
        if (data.dmPhone) contactProps.phone = data.dmPhone;
        if (data.dmTitle) contactProps.jobtitle = data.dmTitle;
        contactProps.company = data.companyName;

        const created = await hsApi(accessToken, "/crm/v3/objects/contacts", {
          method: "POST",
          body: JSON.stringify({ properties: contactProps }),
        });
        hsContactId = created.id;
        log(`[hubspot-sync] Created contact: ${data.dmEmail} (${hsContactId})`, "hubspot");
      } else {
        const updateProps: Record<string, string> = {};
        if (data.dmPhone) updateProps.phone = data.dmPhone;
        if (data.dmTitle) updateProps.jobtitle = data.dmTitle;
        if (Object.keys(updateProps).length > 0) {
          await hsApi(accessToken, `/crm/v3/objects/contacts/${hsContactId}`, {
            method: "PATCH",
            body: JSON.stringify({ properties: updateProps }),
          });
        }
      }
      result.contactId = hsContactId;

      if (hsCompanyId && hsContactId) {
        try {
          await hsApi(accessToken, `/crm/v3/objects/contacts/${hsContactId}/associations/companies/${hsCompanyId}/contact_to_company`, {
            method: "PUT",
          });
        } catch (e: any) {
          log(`[hubspot-sync] Contact-company association failed: ${e.message}`, "hubspot");
        }
      }
    }

    const timestamp = data.callTime ? new Date(data.callTime).getTime() : Date.now();
    const noteBody = `Call outcome: ${data.outcome}${data.notes ? `\nNotes: ${data.notes}` : ""}${data.dmName ? `\nDM: ${data.dmName}` : ""}`;

    try {
      const note = await hsApi(accessToken, "/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            hs_timestamp: new Date(timestamp).toISOString(),
            hs_note_body: noteBody,
          },
        }),
      });
      result.noteId = note.id;

      if (hsCompanyId && note.id) {
        try {
          await hsApi(accessToken, `/crm/v3/objects/notes/${note.id}/associations/companies/${hsCompanyId}/note_to_company`, {
            method: "PUT",
          });
        } catch (e: any) {
          log(`[hubspot-sync] Note-company association failed: ${e.message}`, "hubspot");
        }
      }
      if (result.contactId && note.id) {
        try {
          await hsApi(accessToken, `/crm/v3/objects/notes/${note.id}/associations/contacts/${result.contactId}/note_to_contact`, {
            method: "PUT",
          });
        } catch (e: any) {
          log(`[hubspot-sync] Note-contact association failed: ${e.message}`, "hubspot");
        }
      }
    } catch (e: any) {
      log(`[hubspot-sync] Note creation failed (${e.message}), continuing without note`, "hubspot");
    }

    result.synced = true;
    log(`[hubspot-sync] Call synced: ${data.companyName} → ${data.outcome} (company=${hsCompanyId}, contact=${result.contactId || "none"})`, "hubspot");
  } catch (e: any) {
    log(`[hubspot-sync] Call sync error for ${data.companyName}: ${e.message}`, "hubspot");
  }

  return result;
}

export async function syncDealToHubSpot(clientId: string, data: {
  companyName: string;
  dealName: string;
  stage?: string;
  amount?: number;
  closeDate?: string;
  contactEmail?: string;
}): Promise<{ synced: boolean; dealId?: string }> {
  if (!clientId) return { synced: false };

  const accessToken = await getAccessToken(clientId);
  if (!accessToken) return { synced: false };

  try {
    const existingDealId = await findDealByName(accessToken, data.dealName);

    if (existingDealId) {
      const updateProps: Record<string, string> = {};
      if (data.stage) updateProps.dealstage = mapStageToPipeline(data.stage);
      if (data.amount) updateProps.amount = String(data.amount);
      if (data.closeDate) updateProps.closedate = data.closeDate;

      if (Object.keys(updateProps).length > 0) {
        await hsApi(accessToken, `/crm/v3/objects/deals/${existingDealId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: updateProps }),
        });
        log(`[hubspot-sync] Deal updated: ${data.dealName} (${existingDealId})`, "hubspot");
      }
      return { synced: true, dealId: existingDealId };
    }

    const dealProps: Record<string, string> = {
      dealname: data.dealName,
      dealstage: mapStageToPipeline(data.stage || "Qualified"),
    };
    if (data.amount) dealProps.amount = String(data.amount);
    if (data.closeDate) dealProps.closedate = data.closeDate;

    const deal = await hsApi(accessToken, "/crm/v3/objects/deals", {
      method: "POST",
      body: JSON.stringify({ properties: dealProps }),
    });

    const hsCompanyId = await findCompanyByName(accessToken, data.companyName);
    if (hsCompanyId && deal.id) {
      try {
        await hsApi(accessToken, `/crm/v3/objects/deals/${deal.id}/associations/companies/${hsCompanyId}/deal_to_company`, {
          method: "PUT",
        });
      } catch {}
    }

    if (data.contactEmail && deal.id) {
      const hsContactId = await findContactByEmail(accessToken, data.contactEmail);
      if (hsContactId) {
        try {
          await hsApi(accessToken, `/crm/v3/objects/deals/${deal.id}/associations/contacts/${hsContactId}/deal_to_contact`, {
            method: "PUT",
          });
        } catch {}
      }
    }

    log(`[hubspot-sync] Deal created: ${data.dealName} (${deal.id}) for ${data.companyName}`, "hubspot");
    return { synced: true, dealId: deal.id };
  } catch (e: any) {
    log(`[hubspot-sync] Deal sync error for ${data.companyName}: ${e.message}`, "hubspot");
    return { synced: false };
  }
}

export async function syncContactToHubSpot(clientId: string, data: {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  title?: string;
  companyName?: string;
}): Promise<{ synced: boolean; contactId?: string }> {
  if (!clientId || !data.email) return { synced: false };

  const accessToken = await getAccessToken(clientId);
  if (!accessToken) return { synced: false };

  try {
    let hsContactId = await findContactByEmail(accessToken, data.email);

    const props: Record<string, string> = { email: data.email };
    if (data.firstName) props.firstname = data.firstName;
    if (data.lastName) props.lastname = data.lastName;
    if (data.phone) props.phone = data.phone;
    if (data.title) props.jobtitle = data.title;
    if (data.companyName) props.company = data.companyName;

    if (hsContactId) {
      await hsApi(accessToken, `/crm/v3/objects/contacts/${hsContactId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: props }),
      });
    } else {
      const created = await hsApi(accessToken, "/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties: props }),
      });
      hsContactId = created.id;
    }

    if (data.companyName) {
      const hsCompanyId = await findCompanyByName(accessToken, data.companyName);
      if (hsCompanyId && hsContactId) {
        try {
          await hsApi(accessToken, `/crm/v3/objects/contacts/${hsContactId}/associations/companies/${hsCompanyId}/contact_to_company`, {
            method: "PUT",
          });
        } catch {}
      }
    }

    log(`[hubspot-sync] Contact synced: ${data.email} (${hsContactId})`, "hubspot");
    return { synced: true, contactId: hsContactId || undefined };
  } catch (e: any) {
    log(`[hubspot-sync] Contact sync error for ${data.email}: ${e.message}`, "hubspot");
    return { synced: false };
  }
}

function mapStageToPipeline(stage: string): string {
  const stageMap: Record<string, string> = {
    "Qualified": "qualifiedtobuy",
    "SiteWalk": "presentationscheduled",
    "QuoteSent": "decisionmakerboughtin",
    "DeploymentScheduled": "contractsent",
    "Won": "closedwon",
    "Lost": "closedlost",
  };
  return stageMap[stage] || "qualifiedtobuy";
}
