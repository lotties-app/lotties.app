import {
  apiPaths,
  fromBabyDto,
  fromEventTypeDto,
  type BabyDto,
  type BabyRequest,
  type CreateEventTypeRequest,
  type CreateInviteRequest,
  type CreatedInviteDto,
  type EventTypeDto,
  type EventTypeRequest,
  type InviteDto,
  type MemberDto,
} from '../sync/contract';
import type { Baby, BabyRole, EventType } from '../db/models';
import type { ApiClient } from './apiClient';

/*
 * Online-only server operations (no offline queue): babies, members, invites and custom event
 * types. Each returns the parsed result; failures throw `ApiError` / network `TypeError`.
 */

export async function createBaby(api: ApiClient, request: BabyRequest): Promise<Baby> {
  return fromBabyDto(
    await api.request<BabyDto>(apiPaths.babies(), { method: 'POST', body: request }),
  );
}

/** `PUT` replies with the stored baby; the role is the caller's (Owner), so keep the known one. */
export async function updateBaby(api: ApiClient, id: string, request: BabyRequest): Promise<void> {
  await api.request<unknown>(apiPaths.baby(id), { method: 'PUT', body: request });
}

export function listMembers(api: ApiClient, babyId: string) {
  return api.request<MemberDto[]>(apiPaths.members(babyId));
}

export async function changeMemberRole(
  api: ApiClient,
  babyId: string,
  userId: string,
  role: BabyRole,
): Promise<void> {
  await api.request<unknown>(apiPaths.member(babyId, userId), { method: 'PATCH', body: { role } });
}

export async function removeMember(api: ApiClient, babyId: string, userId: string): Promise<void> {
  await api.request<unknown>(apiPaths.member(babyId, userId), { method: 'DELETE' });
}

export async function leaveBaby(api: ApiClient, babyId: string): Promise<void> {
  await api.request<unknown>(apiPaths.member(babyId, 'me'), { method: 'DELETE' });
}

export function createInvite(api: ApiClient, babyId: string, request: CreateInviteRequest) {
  return api.request<CreatedInviteDto>(apiPaths.invites(babyId), {
    method: 'POST',
    body: request,
  });
}

export function listInvites(api: ApiClient, babyId: string) {
  return api.request<InviteDto[]>(apiPaths.invites(babyId));
}

export async function revokeInvite(api: ApiClient, babyId: string, inviteId: string) {
  await api.request<unknown>(apiPaths.invite(babyId, inviteId), { method: 'DELETE' });
}

/** The token travels in the body, never in the URL path (access logs record paths). */
export async function acceptInvite(api: ApiClient, token: string): Promise<Baby> {
  return fromBabyDto(
    await api.request<BabyDto>(apiPaths.acceptInvite(), { method: 'POST', body: { token } }),
  );
}

export async function createEventType(
  api: ApiClient,
  babyId: string,
  request: CreateEventTypeRequest,
): Promise<EventType> {
  const dto = await api.request<EventTypeDto>(apiPaths.eventTypes(babyId), {
    method: 'POST',
    body: request,
  });
  return fromEventTypeDto(dto);
}

export async function updateEventType(
  api: ApiClient,
  babyId: string,
  typeId: string,
  request: EventTypeRequest,
): Promise<EventType> {
  const dto = await api.request<EventTypeDto>(apiPaths.eventType(babyId, typeId), {
    method: 'PUT',
    body: request,
  });
  return fromEventTypeDto(dto);
}

export async function deleteEventType(api: ApiClient, babyId: string, typeId: string) {
  await api.request<unknown>(apiPaths.eventType(babyId, typeId), { method: 'DELETE' });
}
