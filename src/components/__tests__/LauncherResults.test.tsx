import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LauncherResults } from '../LauncherResults';
import type { LauncherSection } from '../../config/launcher';

const sections: LauncherSection[] = [
  {
    id: 'primary',
    title: 'Best match',
    items: [
      {
        id: 'ask',
        kind: 'ask',
        title: 'Ask Miaw',
        subtitle: 'chrome issue',
        hint: 'Chat',
        accent: 'AI',
      },
    ],
  },
  {
    id: 'commands',
    title: 'Commands',
    items: [
      {
        id: 'command:/search',
        kind: 'command',
        title: '/search',
        subtitle: 'Agentic web search',
        value: '/search',
        hint: 'Insert',
        accent: 'keyword',
      },
    ],
  },
];

describe('LauncherResults', () => {
  it('renders section headers and options', () => {
    render(
      <LauncherResults
        sections={sections}
        highlightedIndex={0}
        onSelect={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText('Best match')).toBeInTheDocument();
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Ask Miaw')).toBeInTheDocument();
  });

  it('calls onSelect when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      <LauncherResults
        sections={sections}
        highlightedIndex={0}
        onSelect={onSelect}
        onAction={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getAllByRole('option')[1]);
    expect(onSelect).toHaveBeenCalledWith(sections[1].items[0]);
  });

  it('marks the highlighted row as selected', () => {
    render(
      <LauncherResults
        sections={sections}
        highlightedIndex={1}
        onSelect={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });
});
