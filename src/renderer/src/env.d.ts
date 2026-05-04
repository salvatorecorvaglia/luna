/// <reference types="vite/client" />

import type { LunarAPI } from '../../preload/index';

declare global {
  interface Window {
    api: LunarAPI;
  }
}
