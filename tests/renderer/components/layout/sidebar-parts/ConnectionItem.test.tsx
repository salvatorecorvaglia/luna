// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import type { Connection } from '@shared/types/ipc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { DragControls } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionItem } from '../../../../../src/renderer/src/components/layout/sidebar-parts/ConnectionItem';

vi.mock('@/lib/ssh', () => ({ connectToHost: vi.fn() }));
vi.mock('@/lib/s3', () => ({ connectToS3: vi.fn() }));

const dragControls = { start: vi.fn() } as unknown as DragControls;

/** ConnectionItem reaches for the delete/update mutations, so it needs a client. */
function renderItem(connection: Connection) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectionItem connection={connection} dragControls={dragControls} />
    </QueryClientProvider>,
  );
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    name: 'BSCP',
    provider: 'sftp',
    host: '192.168.0.137',
    port: 22,
    username: 'root',
    authType: 'password',
    folder: 'default',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Connection;
}

describe('ConnectionItem markup', () => {
  /**
   * The row used to be a <button> containing the drag handle <button>.
   * Interactive nesting is invalid HTML and assistive tech cannot represent it.
   */
  it('does not nest the drag handle inside the activate button', () => {
    renderItem(makeConnection());

    const grip = screen.getByLabelText('Drag to reorder BSCP');
    expect(grip.closest('button')).toBe(grip);
    expect(grip.parentElement?.closest('button')).toBeNull();
  });

  it('keeps both controls reachable as siblings', () => {
    renderItem(makeConnection());

    expect(screen.getByLabelText(/^BSCP \(root@192\.168\.0\.137\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Drag to reorder BSCP')).toBeInTheDocument();
  });
});

describe('ConnectionItem accessible name', () => {
  it('describes an SSH connection by user@host', () => {
    renderItem(makeConnection());
    expect(screen.getByLabelText('BSCP (root@192.168.0.137) — disconnected')).toBeInTheDocument();
  });

  it('includes a non-default port', () => {
    renderItem(makeConnection({ port: 2222 }));
    expect(
      screen.getByLabelText('BSCP (root@192.168.0.137:2222) — disconnected'),
    ).toBeInTheDocument();
  });

  /**
   * `host` and `username` are empty for S3 connections, so the old unbranched
   * label announced "my-bucket (@) — disconnected".
   */
  it('describes an S3 connection by endpoint and bucket, not an empty user@host', () => {
    renderItem(
      makeConnection({
        name: 'Backups',
        provider: 's3',
        host: '',
        username: '',
        endpoint: 'https://s3.example.com',
        defaultBucket: 'my-bucket',
      }),
    );
    expect(
      screen.getByLabelText('Backups (https://s3.example.com / my-bucket) — disconnected'),
    ).toBeInTheDocument();
  });

  it('falls back to the region when an S3 connection has no endpoint', () => {
    renderItem(
      makeConnection({
        name: 'Backups',
        provider: 's3',
        host: '',
        username: '',
        region: 'eu-west-1',
      }),
    );
    expect(screen.getByLabelText('Backups (eu-west-1) — disconnected')).toBeInTheDocument();
  });
});
