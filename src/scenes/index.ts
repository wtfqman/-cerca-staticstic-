import { Stage } from 'telegraf/scenes';

import type { BotContext } from '../types/bot-context';
import { creatorRegistrationScene } from './creator-registration.scene';
import { creatorSocialLinksScene } from './creator-social-links.scene';
import { documentUploadScene } from './document-upload.scene';
import { monthlyReachMarchAprilScene } from './monthly-reach-march-april.scene';
import { monthlyVideoMarchAprilScene } from './monthly-video-march-april.scene';
import { monthlyVideoScene } from './monthly-video.scene';
import { paymentDocumentUploadScene } from './payment-document-upload.scene';
import { profileChangeRequestScene } from './profile-change-request.scene';
import { profileEditScene } from './profile-edit.scene';
import { weeklyStatsScene } from './weekly-stats.scene';
import { sceneMenuGuardMiddleware } from '../middlewares/scene-menu-guard.middleware';

export const createStage = () => {
  const stage = new Stage<BotContext>([
    creatorRegistrationScene,
    creatorSocialLinksScene,
    profileChangeRequestScene,
    profileEditScene,
    weeklyStatsScene,
    monthlyVideoScene,
    monthlyVideoMarchAprilScene,
    monthlyReachMarchAprilScene,
    documentUploadScene,
    paymentDocumentUploadScene
  ]);

  stage.use(sceneMenuGuardMiddleware);

  return stage;
};
