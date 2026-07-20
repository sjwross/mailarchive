import { Client, ResponseType } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

// Note: isomorphic-fetch is required for Node.js environments

export interface MicrosoftFolder {
  id: string;
  displayName: string;
  childFolderCount?: number;
}

export interface MicrosoftMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  bodyPreview?: string;
  from?: {
    emailAddress: {
      address: string;
      name?: string;
    };
  };
}

export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

// Delegated tokens must use /me — /users/{id} fails for personal Microsoft accounts (@hotmail.com, etc.)
export async function listFolders(client: Client, _userId: string): Promise<MicrosoftFolder[]> {
  const response = await client.api("/me/mailFolders").get();
  return response.value || [];
}

/** Get a well-known folder by name (e.g. junkemail, deleteditems). Returns folder id. */
export async function getWellKnownFolder(
  client: Client,
  _userId: string,
  wellKnownName: "junkemail" | "deleteditems"
): Promise<{ id: string; displayName: string }> {
  const response = await client.api(`/me/mailFolders/${wellKnownName}`).get();
  return { id: response.id, displayName: response.displayName || wellKnownName };
}

/**
 * List messages in a folder. If receivedBefore is set, only messages received before that time
 * are returned (Graph returns newest-first by default). Optional select ensures needed properties
 * (e.g. subject, from) are returned when the default set may omit them.
 */
export async function listMessages(
  client: Client,
  _userId: string,
  folderId: string,
  top: number = 100,
  receivedBefore?: Date,
  select?: string[]
): Promise<MicrosoftMessage[]> {
  let request = client
    .api(`/me/mailFolders/${folderId}/messages`)
    .top(top);
  if (receivedBefore) {
    // Graph requires full ISO 8601 (e.g. 2022-07-11T00:00:00Z); date-only values fail validation.
    const filterValue = receivedBefore.toISOString().replace(/\.\d{3}Z$/, "Z");
    request = request.filter(`receivedDateTime lt ${filterValue}`);
  }
  if (select?.length) {
    request = request.select(select.join(","));
  }
  const response = await request.get();
  return response.value || [];
}

export async function getMessageMime(client: Client, _userId: string, messageId: string): Promise<string> {
  // Request TEXT so we get a string; default handling returns a Stream for message/rfc822 which breaks Drive upload
  const response = await client
    .api(`/me/messages/${messageId}/$value`)
    .responseType(ResponseType.TEXT)
    .get();
  return typeof response === "string" ? response : String(response);
}

export async function moveMessage(
  client: Client,
  _userId: string,
  messageId: string,
  destinationFolderId: string
): Promise<string> {
  const response = await client
    .api(`/me/messages/${messageId}/move`)
    .post({ destinationId: destinationFolderId });
  return response.id as string;
}

export async function deleteMessage(client: Client, _userId: string, messageId: string): Promise<void> {
  await client.api(`/me/messages/${messageId}`).delete();
}

export async function getMe(client: Client): Promise<{ id: string; mail: string }> {
  return client.api("/me").get();
}
