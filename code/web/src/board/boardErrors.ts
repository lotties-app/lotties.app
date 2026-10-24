import type { ErrorOverrides } from '../api/errorMessages';
import { t } from '../i18n/i18n';

/** Board wording for the API's problem codes (docs/design/36-project-board.md section 3.5). */
export const boardErrorOverrides = (): ErrorOverrides => ({
  board_version_mismatch: () => t('board.errors.versionMismatch'),
  concurrent_modification: () => t('board.errors.concurrent'),
  board_item_deleted: () => t('board.errors.itemDeleted'),
  board_item_not_found: () => t('board.errors.itemNotFound'),
  board_unknown_topic: () => t('board.errors.unknownTopic'),
  board_topic_archived: () => t('board.errors.topicArchived'),
  board_topic_not_allowed: () => t('board.errors.topicNotAllowed'),
  board_admin_required: () => t('board.errors.adminRequired'),
  board_api_key_not_found: () => t('board.errors.keyNotFound'),
  invalid_cursor: () => t('board.errors.invalidCursor'),
  validation_failed: () => t('board.errors.validation'),
});
