import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusBadge from '../components/StatusBadge.jsx';

describe('StatusBadge', () => {
  it('renders children text', () => {
    render(<StatusBadge>SUCCESS</StatusBadge>);
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
  });

  it('applies default neutral tone class', () => {
    const { container } = render(<StatusBadge>Idle</StatusBadge>);
    expect(container.querySelector('.pill-neutral')).toBeInTheDocument();
  });

  it('applies specified tone class', () => {
    const { container } = render(<StatusBadge tone="success">OK</StatusBadge>);
    expect(container.querySelector('.pill-success')).toBeInTheDocument();
  });

  it.each(['danger', 'warning', 'info', 'purple'])('supports %s tone', (tone) => {
    const { container } = render(<StatusBadge tone={tone}>Label</StatusBadge>);
    expect(container.querySelector(`.pill-${tone}`)).toBeInTheDocument();
  });
});
