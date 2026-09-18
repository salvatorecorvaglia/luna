/// <reference types="vite/client" />

import type { LunaAPI } from '../../preload/index';

declare global {
  interface Window {
    api: LunaAPI;
  }
}
