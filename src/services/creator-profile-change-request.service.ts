import { CreatorProfileChangeRequestStatus, LegalType } from '@prisma/client';

import type { CreatorProfileChangeRequestRepository } from '../repositories/creator-profile-change-request.repository';
import type { TeamLeadRepository } from '../repositories/teamlead.repository';
import type { UserRepository } from '../repositories/user.repository';
import {
  creatorProfileFieldLabels,
  getCreatorProfileEditableFields,
  type CreatorProfileEditableField
} from './creator-profile.service';
import type { AppUser } from '../types/domain';
import { canUseAdminScenario, canUseCreatorScenario, canUseTeamLeadScenario } from '../utils/access';
import { formatCreatorDisplayName, formatRussianDateTime } from '../utils/formatters';

const commonCreatorRequestedFields: CreatorProfileEditableField[] = [
  'contractStartDate',
  'contractDeadlineDate',
  'registrationAddress',
  'inn',
  'bankAccount',
  'bankName',
  'bankBik',
  'bankCorrAccount',
  'phone',
  'email'
];

const noContractCreatorRequestedFields: CreatorProfileEditableField[] = [
  'legalType',
  'fullName',
  'phone',
  'email'
];

const selfEmployedCreatorRequestedFields: CreatorProfileEditableField[] = [
  ...commonCreatorRequestedFields,
  'passportSeries',
  'passportNumber',
  'passportIssuedAt',
  'passportIssuedByInstrumental',
  'passportDepartmentCode'
];

const ipCreatorRequestedFields: CreatorProfileEditableField[] = [
  ...commonCreatorRequestedFields,
  'ogrnip'
];

export const getCreatorProfileChangeRequestFields = (
  legalType?: LegalType | null
): CreatorProfileEditableField[] => {
  const baseFields =
    legalType === LegalType.SELF_EMPLOYED
      ? selfEmployedCreatorRequestedFields
      : legalType === LegalType.IP
        ? ipCreatorRequestedFields
        : noContractCreatorRequestedFields;
  const editableFields = new Set(getCreatorProfileEditableFields(legalType));

  return baseFields.filter((field) => editableFields.has(field));
};

const normalizeRequestedFields = (
  value: unknown
): CreatorProfileEditableField[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((field): field is CreatorProfileEditableField =>
    typeof field === 'string' && field in creatorProfileFieldLabels
  );
};

export const formatCreatorProfileChangeRequestFields = (fields: readonly CreatorProfileEditableField[]) =>
  fields.map((field) => `• ${creatorProfileFieldLabels[field]}`).join('\n');

export class CreatorProfileChangeRequestService {
  constructor(
    private readonly repository: CreatorProfileChangeRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly teamLeadRepository: TeamLeadRepository
  ) {}

  getAllowedFieldsForLegalType(legalType?: LegalType | null) {
    return getCreatorProfileChangeRequestFields(legalType);
  }

  getRequestFields(request: { fields: unknown }) {
    return normalizeRequestedFields(request.fields);
  }

  async createForCreator(creator: AppUser, fields: CreatorProfileEditableField[]) {
    if (!canUseCreatorScenario(creator)) {
      throw new Error('Запрос на изменение данных доступен только креатору.');
    }

    if (!creator.creatorProfile?.profileCompleted) {
      throw new Error('Сначала нужно завершить анкету. После этого можно запросить изменение данных.');
    }

    const allowedFields = this.getAllowedFieldsForLegalType(creator.creatorProfile.legalType);
    const requestedFields = Array.from(new Set(fields));

    if (!requestedFields.length) {
      throw new Error('Выбери, какие данные нужно изменить.');
    }

    const forbiddenField = requestedFields.find((field) => !allowedFields.includes(field));

    if (forbiddenField) {
      throw new Error(`Поле "${creatorProfileFieldLabels[forbiddenField]}" нельзя запросить к изменению.`);
    }

    const existingOpenRequest = await this.repository.findOpenByCreator(creator.id);

    if (existingOpenRequest) {
      throw new Error(
        [
          'У тебя уже есть открытый запрос на изменение данных.',
          `Статус: ${this.formatStatus(existingOpenRequest.status)}.`,
          `Создан: ${formatRussianDateTime(existingOpenRequest.createdAt)}.`
        ].join('\n')
      );
    }

    const link = await this.teamLeadRepository.getActiveTeamLeadForCreator(creator.id);

    if (!link) {
      throw new Error('Тимлид пока не назначен. Напиши администратору, чтобы он назначил тимлида.');
    }

    return this.repository.create({
      creatorUserId: creator.id,
      teamLeadUserId: link.teamLeadUserId,
      fields: requestedFields
    });
  }

  async approve(actor: AppUser, requestId: string) {
    const request = await this.loadRequestForDecision(actor, requestId);

    if (request.status === CreatorProfileChangeRequestStatus.APPROVED) {
      return request;
    }

    if (request.status !== CreatorProfileChangeRequestStatus.PENDING_TEAMLEAD) {
      throw new Error(`Этот запрос уже не ожидает решения. Текущий статус: ${this.formatStatus(request.status)}.`);
    }

    return this.repository.updateStatus(request.id, CreatorProfileChangeRequestStatus.APPROVED, {
      decidedAt: new Date()
    });
  }

  async reject(actor: AppUser, requestId: string) {
    const request = await this.loadRequestForDecision(actor, requestId);

    if (request.status !== CreatorProfileChangeRequestStatus.PENDING_TEAMLEAD) {
      throw new Error(`Этот запрос уже не ожидает решения. Текущий статус: ${this.formatStatus(request.status)}.`);
    }

    return this.repository.updateStatus(request.id, CreatorProfileChangeRequestStatus.REJECTED, {
      decidedAt: new Date()
    });
  }

  async cancelApprovedEdit(actor: AppUser, requestId: string) {
    const request = await this.repository.findById(requestId);

    if (!request) {
      throw new Error('Запрос на изменение данных не найден.');
    }

    await this.assertActorCanManageRequest(actor, request);

    if (request.status !== CreatorProfileChangeRequestStatus.APPROVED) {
      throw new Error(`Запрос нельзя отменить в текущем статусе: ${this.formatStatus(request.status)}.`);
    }

    return this.repository.updateStatus(request.id, CreatorProfileChangeRequestStatus.REJECTED, {
      decidedAt: request.decidedAt ?? new Date()
    });
  }

  async assertApprovedEditableRequest(actor: AppUser, requestId: string, creatorUserId?: string) {
    const request = await this.repository.findById(requestId);

    if (!request) {
      throw new Error('Запрос на изменение данных не найден.');
    }

    await this.assertActorCanManageRequest(actor, request);

    if (request.status !== CreatorProfileChangeRequestStatus.APPROVED) {
      throw new Error(`Запрос нельзя редактировать в текущем статусе: ${this.formatStatus(request.status)}.`);
    }

    if (creatorUserId && request.creatorUserId !== creatorUserId) {
      throw new Error('Запрос относится к другому креатору.');
    }

    return {
      request,
      fields: this.getRequestFields(request)
    };
  }

  async complete(actor: AppUser, requestId: string) {
    const request = await this.assertApprovedEditableRequest(actor, requestId);

    return this.repository.updateStatus(request.request.id, CreatorProfileChangeRequestStatus.COMPLETED, {
      completedAt: new Date()
    });
  }

  async getRequestForActor(actor: AppUser, requestId: string) {
    const request = await this.repository.findById(requestId);

    if (!request) {
      throw new Error('Запрос на изменение данных не найден.');
    }

    await this.assertActorCanManageRequest(actor, request);
    return request;
  }

  formatRequestForTeamLead(request: Awaited<ReturnType<CreatorProfileChangeRequestRepository['findById']>>) {
    if (!request) {
      return 'Запрос на изменение данных не найден.';
    }

    const fields = this.getRequestFields(request);

    return [
      'Запрос на изменение регистрационных данных',
      '',
      `Креатор: ${formatCreatorDisplayName(request.creator)}`,
      '',
      'Креатор просит изменить:',
      formatCreatorProfileChangeRequestFields(fields),
      '',
      'Подтверди запрос, если данные действительно нужно обновить. После подтверждения откроется редактирование только выбранных полей.'
    ].join('\n');
  }

  formatStatus(status: CreatorProfileChangeRequestStatus) {
    const labels: Record<CreatorProfileChangeRequestStatus, string> = {
      [CreatorProfileChangeRequestStatus.CREATED]: 'создан',
      [CreatorProfileChangeRequestStatus.PENDING_TEAMLEAD]: 'ожидает решения тимлида',
      [CreatorProfileChangeRequestStatus.APPROVED]: 'подтвержден',
      [CreatorProfileChangeRequestStatus.REJECTED]: 'отклонен',
      [CreatorProfileChangeRequestStatus.COMPLETED]: 'выполнен'
    };

    return labels[status];
  }

  private async loadRequestForDecision(actor: AppUser, requestId: string) {
    const request = await this.repository.findById(requestId);

    if (!request) {
      throw new Error('Запрос на изменение данных не найден.');
    }

    await this.assertActorCanManageRequest(actor, request);
    return request;
  }

  private async assertActorCanManageRequest(
    actor: AppUser,
    request: {
      creatorUserId: string;
      teamLeadUserId: string;
    }
  ) {
    if (canUseAdminScenario(actor)) {
      return;
    }

    if (!canUseTeamLeadScenario(actor)) {
      throw new Error('Обрабатывать запросы на изменение данных может только тимлид или администратор.');
    }

    if (request.teamLeadUserId !== actor.id) {
      throw new Error('Этот запрос относится к другому тимлиду.');
    }

    const link = await this.teamLeadRepository.getActiveTeamLeadForCreator(request.creatorUserId);

    if (!link || link.teamLeadUserId !== actor.id) {
      throw new Error('Этот креатор больше не закреплен за тобой.');
    }
  }
}
