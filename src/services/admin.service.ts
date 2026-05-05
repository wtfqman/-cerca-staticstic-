import { DocumentStatus } from '@prisma/client';

import { DocumentRepository } from '../repositories/document.repository';
import { TeamLeadRepository } from '../repositories/teamlead.repository';
import { UserRepository } from '../repositories/user.repository';

export class AdminService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly teamLeadRepository: TeamLeadRepository,
    private readonly documentRepository: DocumentRepository
  ) {}

  async getOverview() {
    const [roleCounts, groups, documents, creators] = await Promise.all([
      this.userRepository.getCountsByRole(),
      this.teamLeadRepository.listGroups(),
      this.documentRepository.listAllDocuments(),
      this.userRepository.listCreators()
    ]);

    const generated = documents.filter((item) => item.status === DocumentStatus.GENERATED).length;
    const sent = documents.filter((item) => item.status === DocumentStatus.SENT_TO_CREATOR).length;
    const signed = documents.filter(
      (item) => item.status === DocumentStatus.SIGNED_UPLOADED || item.status === DocumentStatus.FORWARDED_TO_CHAT
    ).length;

    return {
      roleCounts,
      creators,
      activeGroupLinks: groups.length,
      documents: {
        total: documents.length,
        generated,
        sent,
        signed
      }
    };
  }
}
