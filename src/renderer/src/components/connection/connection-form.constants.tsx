import type { AuthType } from '@shared/types/connection';
import { FileKey, Key, Lock } from 'lucide-react';

export const AUTH_TYPES: { value: AuthType; label: string; icon: React.ReactNode }[] = [
  { value: 'password', label: 'Password', icon: <Lock className="size-4" /> },
  { value: 'key', label: 'SSH Key', icon: <Key className="size-4" /> },
  {
    value: 'key+passphrase',
    label: 'Key + Pass',
    icon: <FileKey className="size-4" />,
  },
];

export const COLOR_OPTIONS: { hex: string; name: string }[] = [
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#ec4899', name: 'Pink' },
];

export const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.15 } },
};
