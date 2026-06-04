import { ulid } from "ulid";
import { kv } from "@vercel/kv";

export type App = {
  id: string;
  users: AppUser[];
  groups?: AppGroup[];
  spAcsUrl?: string;
  spEntityId?: string;
  scimBaseUrl?: string;
  scimBearerToken?: string;
};

export type AppUser = {
  email: string;
  firstName: string;
  lastName: string;
};

export type AppGroup = {
  displayName: string;
  // members are referenced by email; member SCIM user IDs are resolved at sync
  // time so that group syncing can stay stateless, just like user syncing.
  memberEmails: string[];
};

function getBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_DUMMYIDP_CUSTOM_DOMAIN ??
    process.env.VERCEL_URL ??
    "https://dummyidp.com";

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return url.startsWith("localhost") ? `http://${url}` : `https://${url}`;
}

export function appIdpEntityId(app: App): string {
  return `${getBaseUrl()}/apps/${app.id}`;
}

export function appIdpRedirectUrl(app: App): string {
  return `${getBaseUrl()}/apps/${app.id}/sso`;
}

export function appIdpMetadataUrl(app: App): string {
  return `${getBaseUrl()}/apps/${app.id}/metadata`;
}

export function appLoginUrl(app: App): string {
  return `${getBaseUrl()}/apps/${app.id}/login`;
}

export async function createApp(): Promise<string> {
  const id = `app_${ulid().toLowerCase()}`;
  await kv.hset(id, {
    id,
    users: [
      { email: "john.doe@example.com", firstName: "John", lastName: "Doe" },
      {
        email: "abraham.lincoln@example.com",
        firstName: "Abraham",
        lastName: "Lincoln",
      },
    ],
    groups: [
      {
        displayName: "Everyone",
        memberEmails: ["john.doe@example.com", "abraham.lincoln@example.com"],
      },
    ],
  });
  return id;
}

export async function getApp(id: string): Promise<App | undefined> {
  const result = await kv.hgetall(id);
  if (!result) {
    return undefined;
  }

  return result as unknown as App;
}

export async function upsertApp(app: App): Promise<void> {
  // get a list of users being deleted, so we can SCIM DELETE them later
  const oldApp = (await kv.hgetall(app.id)) as App | undefined;
  const deletedUserEmails: string[] = [];
  const deletedGroupDisplayNames: string[] = [];
  if (oldApp) {
    // could do this with sets, but NextJS doesn't seem to support
    // set.difference, so there's very little gain
    for (const oldUser of oldApp.users) {
      let found = false;
      for (const newUser of app.users) {
        if (newUser.email === oldUser.email) {
          found = true;
        }
      }

      if (!found) {
        deletedUserEmails.push(oldUser.email);
      }
    }

    // likewise for groups, identified by displayName
    for (const oldGroup of oldApp.groups ?? []) {
      let found = false;
      for (const newGroup of app.groups ?? []) {
        if (newGroup.displayName === oldGroup.displayName) {
          found = true;
        }
      }

      if (!found) {
        deletedGroupDisplayNames.push(oldGroup.displayName);
      }
    }
  }

  // update the app
  await kv.hset(app.id, app);

  // scim sync
  if (app.scimBaseUrl && app.scimBearerToken) {
    // Carry out a scim sync; our approach is stateless and is close to Okta's
    // syncing approach.
    //
    // For each user, list users filtered by email address. If we get a result,
    // PUT against the resulting user ID. If we don't get a result, POST a new
    // user. Do not persist state about assigned user IDs between syncs.
    const scimHeaders = {
      Authorization: `Bearer ${app.scimBearerToken}`,
      "Content-Type": "application/scim+json",
      Accept: "application/scim+json",
    };
    const userBody = (user: AppUser) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: user.email,
      name: {
        givenName: user.firstName,
        familyName: user.lastName,
      },
    });

    for (const user of app.users) {
      const userId = await scimUserByEmail(app, user.email);
      if (userId) {
        await fetch(`${app.scimBaseUrl}/Users/${userId}`, {
          method: "PUT",
          headers: scimHeaders,
          body: JSON.stringify(userBody(user)),
        });
      } else {
        await fetch(`${app.scimBaseUrl}/Users`, {
          method: "POST",
          headers: scimHeaders,
          body: JSON.stringify(userBody(user)),
        });
      }
    }

    // delete removed users
    for (const email of deletedUserEmails) {
      const userId = await scimUserByEmail(app, email);
      if (userId) {
        await fetch(`${app.scimBaseUrl}/Users/${userId}`, {
          method: "DELETE",
          headers: scimHeaders,
        });
      }
    }

    // Sync groups. This mirrors the user sync above and is likewise stateless:
    // for each group, list groups filtered by displayName. If we get a result,
    // the group already exists, so we PATCH its members. If not, POST a new
    // group with its members inline.
    //
    // Members must be referenced by SCIM user ID, so we resolve each member
    // email to its ID at sync time. Users are synced before groups above, so
    // those IDs exist by the time we get here.
    for (const group of app.groups ?? []) {
      const memberIds: string[] = [];
      for (const email of group.memberEmails) {
        const userId = await scimUserByEmail(app, email);
        if (userId) {
          memberIds.push(userId);
        }
      }

      const groupId = await scimGroupByDisplayName(app, group.displayName);
      if (groupId) {
        // PATCH the membership to exactly the resolved set, replacing whatever
        // was there before. Okta and others expect group membership updates as
        // PatchOps rather than a full-resource PUT.
        await fetch(`${app.scimBaseUrl}/Groups/${groupId}`, {
          method: "PATCH",
          headers: scimHeaders,
          body: JSON.stringify({
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [
              {
                op: "replace",
                path: "members",
                value: memberIds.map((value) => ({ value })),
              },
            ],
          }),
        });
      } else {
        await fetch(`${app.scimBaseUrl}/Groups`, {
          method: "POST",
          headers: scimHeaders,
          body: JSON.stringify({
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: group.displayName,
            members: memberIds.map((value) => ({ value })),
          }),
        });
      }
    }

    // delete removed groups
    for (const displayName of deletedGroupDisplayNames) {
      const groupId = await scimGroupByDisplayName(app, displayName);
      if (groupId) {
        await fetch(`${app.scimBaseUrl}/Groups/${groupId}`, {
          method: "DELETE",
          headers: scimHeaders,
        });
      }
    }
  }
}

async function scimUserByEmail(
  app: App,
  email: string,
): Promise<string | undefined> {
  const filter = new URLSearchParams({
    filter: `userName eq "${email}"`,
  });

  const listResponse = await fetch(`${app.scimBaseUrl}/Users?${filter}`, {
    headers: { Authorization: `Bearer ${app.scimBearerToken}` },
  });
  const listBody = await listResponse.json();

  // in practice, SCIM servers put the results into either `resources` or
  // `Resources`
  const resources = listBody?.resources ?? listBody?.Resources ?? [];
  if (resources.length > 0) {
    return resources[0].id;
  }
  return undefined;
}

async function scimGroupByDisplayName(
  app: App,
  displayName: string,
): Promise<string | undefined> {
  const filter = new URLSearchParams({
    filter: `displayName eq "${displayName}"`,
  });

  const listResponse = await fetch(`${app.scimBaseUrl}/Groups?${filter}`, {
    headers: { Authorization: `Bearer ${app.scimBearerToken}` },
  });
  const listBody = await listResponse.json();

  // in practice, SCIM servers put the results into either `resources` or
  // `Resources`
  const resources = listBody?.resources ?? listBody?.Resources ?? [];
  if (resources.length > 0) {
    return resources[0].id;
  }
  return undefined;
}
