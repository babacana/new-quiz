import { SupabaseAdminGateway } from '../adapters/supabaseAdminGateway';
import type { AdminCloudPort } from '../domain/ports';
import type { TotemChannelEvent } from '../domain/types';
import { loadSharedInMemoryGateway, resolveSupabaseCredentials } from './cloudFactory';

function createLazyInMemoryAdminProxy(): AdminCloudPort {
  const call = async <K extends keyof AdminCloudPort>(
    method: K,
    ...args: Parameters<Extract<AdminCloudPort[K], (...a: never[]) => unknown>>
  ) => {
    const gw = await loadSharedInMemoryGateway();
    const fn = gw[method] as (...a: unknown[]) => unknown;
    return fn.apply(gw, args);
  };

  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    authenticate: (...args) => call('authenticate', ...args) as ReturnType<AdminCloudPort['authenticate']>,
    signOut: () => call('signOut') as ReturnType<AdminCloudPort['signOut']>,
    getCurrentSession: () => call('getCurrentSession') as ReturnType<AdminCloudPort['getCurrentSession']>,
    listStaffProfiles: () => call('listStaffProfiles') as ReturnType<AdminCloudPort['listStaffProfiles']>,
    createStaffProfile: (...args) =>
      call('createStaffProfile', ...args) as ReturnType<AdminCloudPort['createStaffProfile']>,
    updateStaffProfileRole: (...args) =>
      call('updateStaffProfileRole', ...args) as ReturnType<AdminCloudPort['updateStaffProfileRole']>,
    deleteStaffProfile: (...args) =>
      call('deleteStaffProfile', ...args) as ReturnType<AdminCloudPort['deleteStaffProfile']>,
    listEvents: () => call('listEvents') as ReturnType<AdminCloudPort['listEvents']>,
    saveEvent: (...args) => call('saveEvent', ...args) as ReturnType<AdminCloudPort['saveEvent']>,
    getEventQuestionIds: (...args) =>
      call('getEventQuestionIds', ...args) as ReturnType<AdminCloudPort['getEventQuestionIds']>,
    setEventQuestions: (...args) =>
      call('setEventQuestions', ...args) as ReturnType<AdminCloudPort['setEventQuestions']>,
    listAllQuestions: () => call('listAllQuestions') as ReturnType<AdminCloudPort['listAllQuestions']>,
    saveQuestion: (...args) =>
      call('saveQuestion', ...args) as ReturnType<AdminCloudPort['saveQuestion']>,
    deleteQuestions: (...args) =>
      call('deleteQuestions', ...args) as ReturnType<AdminCloudPort['deleteQuestions']>,
    setQuestionsDisabled: (...args) =>
      call('setQuestionsDisabled', ...args) as ReturnType<AdminCloudPort['setQuestionsDisabled']>,
    replaceAllQuestions: (...args) =>
      call('replaceAllQuestions', ...args) as ReturnType<AdminCloudPort['replaceAllQuestions']>,
    authorizeTotemPairing: (...args) =>
      call('authorizeTotemPairing', ...args) as ReturnType<AdminCloudPort['authorizeTotemPairing']>,
    listTotems: () => call('listTotems') as ReturnType<AdminCloudPort['listTotems']>,
    deleteTotems: (...args) =>
      call('deleteTotems', ...args) as ReturnType<AdminCloudPort['deleteTotems']>,
    dispatchRemoteCommand: (...args) =>
      call('dispatchRemoteCommand', ...args) as ReturnType<AdminCloudPort['dispatchRemoteCommand']>,
    subscribeTotemChannel: (listener: (event: TotemChannelEvent) => void | Promise<void>) => {
      let active = true;
      let innerUnsubscribe: (() => void) | null = null;
      void loadSharedInMemoryGateway().then((gw) => {
        if (active) {
          innerUnsubscribe = gw.subscribeTotemChannel(listener);
        }
      });
      return () => {
        active = false;
        innerUnsubscribe?.();
      };
    },
    listMatches: (...args) => call('listMatches', ...args) as ReturnType<AdminCloudPort['listMatches']>,
    getMatchById: (...args) => call('getMatchById', ...args) as ReturnType<AdminCloudPort['getMatchById']>,
    listMatchesByIds: (...args) =>
      call('listMatchesByIds', ...args) as ReturnType<AdminCloudPort['listMatchesByIds']>,
    listPrizeClaims: (...args) =>
      call('listPrizeClaims', ...args) as ReturnType<AdminCloudPort['listPrizeClaims']>,
    listPrizeClaimsByIds: (...args) =>
      call('listPrizeClaimsByIds', ...args) as ReturnType<AdminCloudPort['listPrizeClaimsByIds']>,
    listGiveUpLockouts: (...args) =>
      call('listGiveUpLockouts', ...args) as ReturnType<AdminCloudPort['listGiveUpLockouts']>,
    updatePrizeClaimsStatus: (...args) =>
      call('updatePrizeClaimsStatus', ...args) as ReturnType<AdminCloudPort['updatePrizeClaimsStatus']>,
    expireGiveUpLockouts: (...args) =>
      call('expireGiveUpLockouts', ...args) as ReturnType<AdminCloudPort['expireGiveUpLockouts']>,
    deleteMatches: (...args) =>
      call('deleteMatches', ...args) as ReturnType<AdminCloudPort['deleteMatches']>,
    uploadEventVisualAsset: (...args) =>
      call('uploadEventVisualAsset', ...args) as ReturnType<AdminCloudPort['uploadEventVisualAsset']>,
    listEventVisualAssets: (...args) =>
      call('listEventVisualAssets', ...args) as ReturnType<AdminCloudPort['listEventVisualAssets']>,
    deleteEventVisualAsset: (...args) =>
      call('deleteEventVisualAsset', ...args) as ReturnType<AdminCloudPort['deleteEventVisualAsset']>,
    importOperationalRecords: (...args) =>
      call('importOperationalRecords', ...args) as ReturnType<AdminCloudPort['importOperationalRecords']>,
  };
}

// Cria a costura administrativa isolada no chunk do painel (#admin e #operador).
export function createAdminCloudPort(): AdminCloudPort {
  const credentials = resolveSupabaseCredentials();
  if (credentials) {
    return new SupabaseAdminGateway(credentials.supabaseUrl, credentials.supabaseKey);
  }
  return createLazyInMemoryAdminProxy();
}
