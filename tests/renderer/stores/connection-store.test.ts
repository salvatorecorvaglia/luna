// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionStore } from '../../../src/renderer/src/stores/connection-store';

describe('connection-store', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      activeConnectionId: null,
      quickConnectValue: '',
      connectionFormOpen: false,
      editingConnectionId: null,
      duplicatingConnectionId: null,
    });
  });

  it('setActiveConnectionId updates the active connection', () => {
    useConnectionStore.getState().setActiveConnectionId('conn-1');
    expect(useConnectionStore.getState().activeConnectionId).toBe('conn-1');

    useConnectionStore.getState().setActiveConnectionId(null);
    expect(useConnectionStore.getState().activeConnectionId).toBeNull();
  });

  it('setQuickConnectValue updates the quick-connect field', () => {
    useConnectionStore.getState().setQuickConnectValue('user@host');
    expect(useConnectionStore.getState().quickConnectValue).toBe('user@host');
  });

  it('openEditForm opens the form in edit mode and clears duplicate mode', () => {
    useConnectionStore.setState({ duplicatingConnectionId: 'stale' });

    useConnectionStore.getState().openEditForm('conn-1');

    expect(useConnectionStore.getState()).toMatchObject({
      connectionFormOpen: true,
      editingConnectionId: 'conn-1',
      duplicatingConnectionId: null,
    });
  });

  it('openCreateForm opens the form with no edit or duplicate target', () => {
    useConnectionStore.setState({
      editingConnectionId: 'stale-edit',
      duplicatingConnectionId: 'stale-dup',
    });

    useConnectionStore.getState().openCreateForm();

    expect(useConnectionStore.getState()).toMatchObject({
      connectionFormOpen: true,
      editingConnectionId: null,
      duplicatingConnectionId: null,
    });
  });

  it('openDuplicateForm opens the form in duplicate mode and clears edit mode', () => {
    useConnectionStore.setState({ editingConnectionId: 'stale-edit' });

    useConnectionStore.getState().openDuplicateForm('conn-2');

    expect(useConnectionStore.getState()).toMatchObject({
      connectionFormOpen: true,
      editingConnectionId: null,
      duplicatingConnectionId: 'conn-2',
    });
  });

  it('closeForm resets form-open, edit, and duplicate state together', () => {
    useConnectionStore.getState().openEditForm('conn-1');

    useConnectionStore.getState().closeForm();

    expect(useConnectionStore.getState()).toMatchObject({
      connectionFormOpen: false,
      editingConnectionId: null,
      duplicatingConnectionId: null,
    });
  });

  it('setEditingConnectionId and setConnectionFormOpen update independently of the open* helpers', () => {
    useConnectionStore.getState().setConnectionFormOpen(true);
    useConnectionStore.getState().setEditingConnectionId('conn-3');

    expect(useConnectionStore.getState().connectionFormOpen).toBe(true);
    expect(useConnectionStore.getState().editingConnectionId).toBe('conn-3');
    // Unlike openEditForm, this direct setter must not touch duplicate state.
    expect(useConnectionStore.getState().duplicatingConnectionId).toBeNull();
  });
});
