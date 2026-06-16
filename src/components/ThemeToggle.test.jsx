import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  it('cycles light → dark → pink → light, labelling the next step each time', () => {
    const setTweak = vi.fn();
    const { getByRole, rerender } = render(<ThemeToggle t={{ theme: 'dusk' }} setTweak={setTweak}/>);
    const btn = () => getByRole('button');

    expect(btn()).toHaveAttribute('aria-label', 'switch to dark theme');
    fireEvent.click(btn());
    expect(setTweak).toHaveBeenLastCalledWith('theme', 'midnight');

    rerender(<ThemeToggle t={{ theme: 'midnight' }} setTweak={setTweak}/>);
    expect(btn()).toHaveAttribute('aria-label', 'switch to pink theme');
    fireEvent.click(btn());
    expect(setTweak).toHaveBeenLastCalledWith('theme', 'bloom');

    rerender(<ThemeToggle t={{ theme: 'bloom' }} setTweak={setTweak}/>);
    expect(btn()).toHaveAttribute('aria-label', 'switch to light theme');
    fireEvent.click(btn());
    expect(setTweak).toHaveBeenLastCalledWith('theme', 'dusk');
  });

  it('reflects the active theme via the modifier class', () => {
    const { getByRole, rerender } = render(<ThemeToggle t={{ theme: 'bloom' }} setTweak={vi.fn()}/>);
    expect(getByRole('button').className).toContain('aura-theme-toggle--bloom');
    rerender(<ThemeToggle t={{ theme: 'midnight' }} setTweak={vi.fn()}/>);
    expect(getByRole('button').className).toContain('aura-theme-toggle--midnight');
  });

  it('treats an unknown stored theme as dusk', () => {
    const setTweak = vi.fn();
    const { getByRole } = render(<ThemeToggle t={{ theme: 'nonsense' }} setTweak={setTweak}/>);
    expect(getByRole('button').className).toContain('aura-theme-toggle--dusk');
    fireEvent.click(getByRole('button'));
    expect(setTweak).toHaveBeenCalledWith('theme', 'midnight');
  });
});
