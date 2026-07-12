import { BRAND_NAME } from '@shared/constants/branding';
import openkosmosIcon from '../assets/openkosmos/app.svg';

const brandIcons: Record<string, string> = {
  openkosmos: openkosmosIcon,
};

export const appIcon: string = brandIcons[BRAND_NAME] || '';
