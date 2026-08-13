// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from '../../../../src/renderer/src/components/connection/FormField';

describe('FormField', () => {
  it('associates the label with the field id', () => {
    render(
      <FormField label="Host" icon={<span aria-hidden="true" />} id="host">
        <input id="host" />
      </FormField>,
    );
    const input = screen.getByLabelText(/Host/);
    expect(input).toBeInTheDocument();
    expect(input.id).toBe('host');
  });

  it('renders a visible required marker and a screen-reader-only "required" label', () => {
    render(
      <FormField label="Host" icon={<span aria-hidden="true">i</span>} id="host" required>
        <input id="host" />
      </FormField>,
    );
    const star = screen.getByTitle('Required');
    expect(star).toHaveAttribute('aria-hidden', 'true');
    // The sr-only span is the screen-reader-equivalent of the visible star.
    expect(screen.getByText('required')).toHaveClass('sr-only');
  });

  it('shows the optional hint when optional is set', () => {
    render(
      <FormField label="Region" icon={<span aria-hidden="true">i</span>} id="region" optional>
        <input id="region" />
      </FormField>,
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('renders an error message with role=alert and an id derived from the field', () => {
    render(
      <FormField
        label="Host"
        icon={<span aria-hidden="true">i</span>}
        id="host"
        error="Host is required"
      >
        <input id="host" aria-describedby="host-error" />
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Host is required');
    expect(alert).toHaveAttribute('id', 'host-error');
  });

  it('omits the error block when no error is supplied', () => {
    render(
      <FormField label="Host" icon={<span aria-hidden="true">i</span>} id="host">
        <input id="host" />
      </FormField>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
