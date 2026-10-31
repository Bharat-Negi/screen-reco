import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { CameraView } from './views/CameraView';
import { MainView } from './views/MainView';
import { RegionView } from './views/RegionView';
import { ToolbarView } from './views/ToolbarView';

// One bundle serves three windows; the main process picks the view with the URL hash.
const route = window.location.hash.replace('#', '') || 'main';
document.documentElement.dataset.route = route;

const VIEWS = { toolbar: ToolbarView, region: RegionView, camera: CameraView } as const;
const View = VIEWS[route as keyof typeof VIEWS] ?? MainView;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
