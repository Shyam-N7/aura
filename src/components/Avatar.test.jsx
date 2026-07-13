import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows the photo when the user has one', () => {
    const { container } = render(<Avatar user={{ name: 'Shyam', avatarUrl: 'https://x/pic.jpg' }} size={40}/>);
    const img = container.querySelector('img.aura-avatar--img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://x/pic.jpg');
  });

  it('falls back to the lowercase initial monogram', () => {
    const { container } = render(<Avatar user={{ name: 'Ravi' }} size={40}/>);
    expect(container.querySelector('img')).toBeNull();
    const span = container.querySelector('.aura-avatar--initial');
    expect(span.textContent).toBe('r');
  });

  it('handles a missing/empty user with a neutral dot', () => {
    const { container } = render(<Avatar user={null}/>);
    expect(container.querySelector('.aura-avatar--initial').textContent).toBe('·');
  });
});
