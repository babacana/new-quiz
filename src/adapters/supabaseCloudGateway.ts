import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CloudEventSnapshot,
  CloudGateway,
  ListMatchesQueryOptions,
  PushMatchResponse,
  TotemAuthContext,
} from '../domain/ports';
import type {
  AuthSession,
  CreateStaffAccountInput,
  EventConfig,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemHeartbeatPayload,
  TotemPairingAuthorizationPayload,
  TotemPairingRequestInput,
  TotemRecord,
  UserProfile,
} from '../domain/types';
import { SupabaseAdminGateway } from './supabaseAdminGateway';
import { getSharedSupabaseClient } from './supabaseClient';
import { SupabaseTotemGateway } from './supabaseTotemGateway';

// Composição de compatibilidade reunindo as costuras SupabaseTotemGateway e SupabaseAdminGateway.
export class SupabaseCloudGateway implements CloudGateway {
  private readonly totemGateway: SupabaseTotemGateway;
  private readonly adminGateway: SupabaseAdminGateway;

  constructor(supabaseUrl: string, supabaseAnonKey: string, client?: SupabaseClient) {
    const sharedClient = client ?? getSharedSupabaseClient(supabaseUrl, supabaseAnonKey);
    this.totemGateway = new SupabaseTotemGateway(supabaseUrl, supabaseAnonKey, sharedClient);
    this.adminGateway = new SupabaseAdminGateway(supabaseUrl, supabaseAnonKey, sharedClient);
  }

  isOnline(): boolean {
    return this.totemGateway.isOnline();
  }

  pullEventSnapshot(eventId: string, auth?: TotemAuthContext): Promise<CloudEventSnapshot | null> {
    return this.totemGateway.pullEventSnapshot(eventId, auth);
  }

  pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
    auth?: TotemAuthContext;
  }): Promise<PushMatchResponse> {
    return this.totemGateway.pushMatch(payload);
  }

  pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
    auth?: TotemAuthContext;
  }): Promise<{ syncedAt: string }> {
    return this.totemGateway.pushGiveUpLockout(payload);
  }

  requestTotemPairing(input: TotemPairingRequestInput): Promise<TotemRecord> {
    return this.totemGateway.requestTotemPairing(input);
  }

  claimTotemPairing(pairingCode: string): Promise<TotemRecord | null> {
    return this.totemGateway.claimTotemPairing(pairingCode);
  }

  publishTotemHeartbeat(payload: TotemHeartbeatPayload): Promise<TotemRecord | null> {
    return this.totemGateway.publishTotemHeartbeat(payload);
  }

  downloadVisualAsset(url: string): Promise<{ dataUrl: string; mimeType: string }> {
    return this.totemGateway.downloadVisualAsset(url);
  }

  authenticate(email: string, password: string): Promise<AuthSession> {
    return this.adminGateway.authenticate(email, password);
  }

  signOut(): Promise<void> {
    return this.adminGateway.signOut();
  }

  getCurrentSession(): Promise<AuthSession | null> {
    return this.adminGateway.getCurrentSession();
  }

  listStaffProfiles(): Promise<UserProfile[]> {
    return this.adminGateway.listStaffProfiles();
  }

  createStaffProfile(input: CreateStaffAccountInput): Promise<UserProfile> {
    return this.adminGateway.createStaffProfile(input);
  }

  updateStaffProfileRole(profileId: string, role: UserProfile['role']): Promise<UserProfile> {
    return this.adminGateway.updateStaffProfileRole(profileId, role);
  }

  deleteStaffProfile(profileId: string): Promise<void> {
    return this.adminGateway.deleteStaffProfile(profileId);
  }

  listEvents(): Promise<EventConfig[]> {
    return this.adminGateway.listEvents();
  }

  saveEvent(event: EventConfig): Promise<EventConfig> {
    return this.adminGateway.saveEvent(event);
  }

  getEventQuestionIds(eventId: string): Promise<number[]> {
    return this.adminGateway.getEventQuestionIds(eventId);
  }

  setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    return this.adminGateway.setEventQuestions(eventId, questionIds);
  }

  listAllQuestions(): Promise<Question[]> {
    return this.adminGateway.listAllQuestions();
  }

  saveQuestion(question: Question): Promise<Question> {
    return this.adminGateway.saveQuestion(question);
  }

  deleteQuestions(ids: number[]): Promise<number> {
    return this.adminGateway.deleteQuestions(ids);
  }

  setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    return this.adminGateway.setQuestionsDisabled(ids, isDisabled);
  }

  replaceAllQuestions(questions: Question[]): Promise<Question[]> {
    return this.adminGateway.replaceAllQuestions(questions);
  }

  authorizeTotemPairing(input: TotemPairingAuthorizationPayload): Promise<TotemRecord> {
    return this.adminGateway.authorizeTotemPairing(input);
  }

  listTotems(): Promise<TotemRecord[]> {
    return this.adminGateway.listTotems();
  }

  deleteTotems(totemIds: string[]): Promise<string[]> {
    return this.adminGateway.deleteTotems(totemIds);
  }

  dispatchRemoteCommand(command: RemoteCommandPayload): Promise<RemoteCommandPayload> {
    return this.adminGateway.dispatchRemoteCommand(command);
  }

  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void {
    return this.adminGateway.subscribeTotemChannel(listener);
  }

  listMatches(eventId?: string, options?: ListMatchesQueryOptions): Promise<MatchRecord[]> {
    return this.adminGateway.listMatches(eventId, options);
  }

  getMatchById(matchId: string): Promise<MatchRecord | null> {
    return this.adminGateway.getMatchById(matchId);
  }

  listMatchesByIds(matchIds: string[]): Promise<MatchRecord[]> {
    return this.adminGateway.listMatchesByIds(matchIds);
  }

  listPrizeClaims(eventId?: string): Promise<PrizeClaimRecord[]> {
    return this.adminGateway.listPrizeClaims(eventId);
  }

  listPrizeClaimsByIds(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    return this.adminGateway.listPrizeClaimsByIds(claimIds);
  }

  listGiveUpLockouts(eventId?: string): Promise<GiveUpLockoutRecord[]> {
    return this.adminGateway.listGiveUpLockouts(eventId);
  }

  updatePrizeClaimsStatus(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt?: string | null,
  ): Promise<PrizeClaimRecord[]> {
    return this.adminGateway.updatePrizeClaimsStatus(claimIds, status, deliveredAt);
  }

  expireGiveUpLockouts(eventId: string, participantPhones: string[]): Promise<number> {
    return this.adminGateway.expireGiveUpLockouts(eventId, participantPhones);
  }

  deleteMatches(matchIds: string[]): Promise<string[]> {
    return this.adminGateway.deleteMatches(matchIds);
  }

  uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    return this.adminGateway.uploadEventVisualAsset(input);
  }

  importOperationalRecords(payload: {
    matches: MatchRecord[];
    prizeClaims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
    replaceEventIds?: string[];
  }): Promise<void> {
    return this.adminGateway.importOperationalRecords(payload);
  }
}
