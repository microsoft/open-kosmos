import { Content } from './content';
import { freAtom } from '../state';


export function FRE() {
  const [{ visible }, { useShortcutTeaching, rejectFre, goToSettings }] = freAtom.use();
  useShortcutTeaching();

  if (!visible) return null;
  return <Content onGoToSettings={goToSettings} onDismiss={rejectFre} />;
}
