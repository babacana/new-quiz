import type { AdminDomainContext } from './admin/adminContext';
import { BackupModule } from './admin/backupModule';
import {
  EventCatalogModule,
  generateEventSlug,
  validateEventSettings,
  validateEventWindow,
} from './admin/eventCatalogModule';
import {
  QuestionBankModule,
  normalizeTags,
  validateQuestionInput,
} from './admin/questionBankModule';
import { StaffAuthModule } from './admin/staffAuthModule';
import { StandOperationsModule } from './admin/standOperationsModule';
import { TotemFleetModule } from './admin/totemFleetModule';
import type { AdminCloudPort, Clock, RandomSource } from './ports';
import type {
  AnalyticsDashboardResult,
  AnalyticsQueryOptions,
  AuthSession,
  AuthorizeTotemPairingInput,
  BackupRestoreResult,
  CloneEventOverrides,
  CreateStaffAccountInput,
  DispatchRemoteCommandInput,
  EventConfig,
  EventCustomizations,
  EventCustomizationsPatch,
  EventUpsertInput,
  EventVisualAssetUploadInput,
  OperatorEventSnapshot,
  PaginatedParticipantReportResult,
  PaginatedQuestionsResult,
  ParticipantMatchDetails,
  ParticipantReportFilterOptions,
  PreparedQuestion,
  PrizeClaimRecord,
  Question,
  QuestionFilterOptions,
  QuestionStatsQueryOptions,
  QuestionStatsResult,
  QuestionUpsertInput,
  QuestionsImportMode,
  QuestionsImportResult,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemRecord,
  UserProfile,
  UserRole,
} from './types';

export {
  generateEventSlug,
  validateEventSettings,
  validateEventWindow,
  validateQuestionInput,
};

export interface EventAdminControllerDependencies {
  cloudGateway: AdminCloudPort;
  clock?: Clock;
  random: RandomSource;
}

// Fachada coesa dos casos de uso administrativos e do Operador, compondo os módulos profundos em `src/domain/admin/`.
export class EventAdminController {
  private readonly authModule: StaffAuthModule;
  private readonly catalogModule: EventCatalogModule;
  private readonly questionBankModule: QuestionBankModule;
  private readonly standOperationsModule: StandOperationsModule;
  private readonly totemFleetModule: TotemFleetModule;
  private readonly backupModule: BackupModule;

  constructor(deps: EventAdminControllerDependencies) {
    this.authModule = new StaffAuthModule(deps.cloudGateway);
    const context: AdminDomainContext = {
      cloudGateway: deps.cloudGateway,
      clock: deps.clock,
      random: deps.random,
      auth: this.authModule,
      nowIso: () => (deps.clock ? deps.clock.toISOString() : new Date().toISOString()),
    };

    this.catalogModule = new EventCatalogModule(context);
    this.questionBankModule = new QuestionBankModule(context, this.catalogModule);
    this.standOperationsModule = new StandOperationsModule(context, this.catalogModule);
    this.totemFleetModule = new TotemFleetModule(context);
    this.backupModule = new BackupModule(context, this.catalogModule);
  }

  login(email: string, password: string): Promise<AuthSession> {
    return this.authModule.login(email, password);
  }

  restoreSession(): Promise<AuthSession | null> {
    return this.authModule.restoreSession();
  }

  logout(): Promise<void> {
    return this.authModule.logout();
  }

  getSession(): AuthSession | null {
    return this.authModule.getSession();
  }

  getCurrentRole(): UserRole | null {
    return this.authModule.getCurrentRole();
  }

  canAccessAdminPanel(): boolean {
    return this.authModule.canAccessAdminPanel();
  }

  canAccessOperatorPanel(): boolean {
    return this.authModule.canAccessOperatorPanel();
  }

  listStaffAccounts(): Promise<UserProfile[]> {
    return this.authModule.listStaffAccounts();
  }

  createStaffAccount(input: CreateStaffAccountInput): Promise<UserProfile> {
    return this.authModule.createStaffAccount(input);
  }

  updateStaffRole(profileId: string, role: UserRole): Promise<UserProfile> {
    return this.authModule.updateStaffRole(profileId, role);
  }

  removeStaffAccount(profileId: string): Promise<void> {
    return this.authModule.removeStaffAccount(profileId);
  }

  listEvents(): Promise<EventConfig[]> {
    return this.catalogModule.listEvents();
  }

  getEventQuestionIds(eventId: string): Promise<number[]> {
    return this.catalogModule.getEventQuestionIds(eventId);
  }

  createEvent(input: EventUpsertInput): Promise<EventConfig> {
    return this.catalogModule.createEvent(input);
  }

  updateEvent(eventId: string, patch: Partial<EventUpsertInput>): Promise<EventConfig> {
    return this.catalogModule.updateEvent(eventId, patch);
  }

  setEventActive(eventId: string, isActive: boolean): Promise<EventConfig> {
    return this.catalogModule.setEventActive(eventId, isActive);
  }

  cloneEvent(sourceEventId: string, overrides: CloneEventOverrides): Promise<EventConfig> {
    return this.catalogModule.cloneEvent(sourceEventId, overrides);
  }

  setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    return this.catalogModule.setEventQuestions(eventId, questionIds);
  }

  setEventQuestionsByTags(eventId: string, tags: string[]): Promise<number[]> {
    return this.catalogModule.setEventQuestionsByTags(eventId, tags, normalizeTags);
  }

  uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    return this.catalogModule.uploadEventVisualAsset(input);
  }

  saveEventCustomizations(
    eventId: string,
    customizations: EventCustomizationsPatch | EventCustomizations,
  ): Promise<EventConfig> {
    return this.catalogModule.saveEventCustomizations(eventId, customizations);
  }

  createQuestion(input: QuestionUpsertInput): Promise<Question> {
    return this.questionBankModule.createQuestion(input);
  }

  updateQuestion(id: number, input: QuestionUpsertInput): Promise<Question> {
    return this.questionBankModule.updateQuestion(id, input);
  }

  deleteQuestions(ids: number[]): Promise<number> {
    return this.questionBankModule.deleteQuestions(ids);
  }

  setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    return this.questionBankModule.setQuestionsDisabled(ids, isDisabled);
  }

  listAllQuestions(eventId?: string): Promise<Question[]> {
    return this.questionBankModule.listAllQuestions(eventId);
  }

  queryQuestions(filter: QuestionFilterOptions = {}): Promise<PaginatedQuestionsResult> {
    return this.questionBankModule.queryQuestions(filter);
  }

  previewQuestion(question: Question | QuestionUpsertInput): PreparedQuestion {
    return this.questionBankModule.previewQuestion(question);
  }

  exportQuestionsJson(eventId?: string): Promise<string> {
    return this.questionBankModule.exportQuestionsJson(eventId);
  }

  exportQuestionsCsv(eventId?: string): Promise<string> {
    return this.questionBankModule.exportQuestionsCsv(eventId);
  }

  importQuestionsJson(
    jsonContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    return this.questionBankModule.importQuestionsJson(jsonContent, mode);
  }

  importQuestionsCsv(
    csvContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    return this.questionBankModule.importQuestionsCsv(csvContent, mode);
  }

  authorizeTotemPairing(input: AuthorizeTotemPairingInput): Promise<TotemRecord> {
    return this.totemFleetModule.authorizeTotemPairing(input);
  }

  buildTotemActivationLink(pairingCode: string, baseOrigin = ''): string {
    return this.totemFleetModule.buildTotemActivationLink(pairingCode, baseOrigin);
  }

  listTotems(): Promise<TotemRecord[]> {
    return this.totemFleetModule.listTotems();
  }

  subscribeTotemUpdates(listener: (event: TotemChannelEvent) => void): () => void {
    return this.totemFleetModule.subscribeTotemUpdates(listener);
  }

  deleteTotemsInBatch(totemIds: string[]): Promise<string[]> {
    return this.totemFleetModule.deleteTotemsInBatch(totemIds);
  }

  deleteTotem(totemId: string): Promise<void> {
    return this.totemFleetModule.deleteTotem(totemId);
  }

  dispatchRemoteCommand(input: DispatchRemoteCommandInput): Promise<RemoteCommandPayload> {
    return this.totemFleetModule.dispatchRemoteCommand(input);
  }

  switchTotemEvent(
    target: { totemId?: string; eventId?: string },
    newEventId: string,
  ): Promise<RemoteCommandPayload> {
    return this.totemFleetModule.switchTotemEvent(target, newEventId);
  }

  forceSyncTotems(
    target: { totemId?: string; eventId?: string },
  ): Promise<RemoteCommandPayload> {
    return this.totemFleetModule.forceSyncTotems(target);
  }

  reloadTotemScreen(
    target: { totemId?: string; eventId?: string },
    targetScreen: 'initial-screen' | 'idle-screen' = 'initial-screen',
  ): Promise<RemoteCommandPayload> {
    return this.totemFleetModule.reloadTotemScreen(target, targetScreen);
  }

  getOperatorDashboard(eventId?: string): Promise<OperatorEventSnapshot> {
    return this.standOperationsModule.getOperatorDashboard(eventId);
  }

  confirmPrizeDeliveries(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    return this.standOperationsModule.confirmPrizeDeliveries(claimIds);
  }

  revokePrizeClaims(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    return this.standOperationsModule.revokePrizeClaims(claimIds);
  }

  revokePhonePrizeInEvent(
    eventId: string,
    participantPhone: string,
  ): Promise<PrizeClaimRecord[]> {
    return this.standOperationsModule.revokePhonePrizeInEvent(eventId, participantPhone);
  }

  unlockParticipantPhones(eventId: string, participantPhones: string[]): Promise<number> {
    return this.standOperationsModule.unlockParticipantPhones(eventId, participantPhones);
  }

  deleteParticipantMatches(matchIds: string[]): Promise<string[]> {
    return this.standOperationsModule.deleteParticipantMatches(matchIds);
  }

  queryParticipantReports(
    options: ParticipantReportFilterOptions = {},
  ): Promise<PaginatedParticipantReportResult> {
    return this.standOperationsModule.queryParticipantReports(options);
  }

  getParticipantMatchDetails(matchId: string): Promise<ParticipantMatchDetails> {
    return this.standOperationsModule.getParticipantMatchDetails(matchId);
  }

  exportParticipantsCsv(options: ParticipantReportFilterOptions = {}): Promise<string> {
    return this.standOperationsModule.exportParticipantsCsv(options);
  }

  exportParticipantsJson(options: ParticipantReportFilterOptions = {}): Promise<string> {
    return this.standOperationsModule.exportParticipantsJson(options);
  }

  queryAnalyticsDashboard(
    options: AnalyticsQueryOptions = {},
  ): Promise<AnalyticsDashboardResult> {
    return this.standOperationsModule.queryAnalyticsDashboard(options);
  }

  queryQuestionStats(
    options: QuestionStatsQueryOptions = {},
  ): Promise<QuestionStatsResult> {
    return this.standOperationsModule.queryQuestionStats(options);
  }

  exportFullBackup(): Promise<string> {
    return this.backupModule.exportFullBackup();
  }

  restoreBackup(
    rawJson: string,
    options: { targetEventId?: string } = {},
  ): Promise<BackupRestoreResult> {
    return this.backupModule.restoreBackup(rawJson, options);
  }
}
