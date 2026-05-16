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
  {
    id: 'apps',
    title: 'Applications',
    items: [
      {
        id: 'app:chrome',
        kind: 'app',
        title: 'Google Chrome',
        subtitle: 'Application',
        value: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        hint: 'Launch',
        accent: 'App',
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

  it('renders launcher action buttons as icon-only controls with tooltip text', () => {
    render(
      <LauncherResults
        sections={sections}
        highlightedIndex={2}
        onSelect={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByText('App')).not.toBeInTheDocument();
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();

    const consoleButton = screen.getByRole('button', {
      name: 'Open target in terminal',
    });
    fireEvent.mouseEnter(consoleButton);

    expect(screen.getByText('Open target in terminal')).toBeInTheDocument();
  });

  it('calls onAction when the console button is clicked', () => {
    const onAction = vi.fn();
    render(
      <LauncherResults
        sections={sections}
        highlightedIndex={2}
        onSelect={vi.fn()}
        onAction={onAction}
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole('button', { name: 'Open target in terminal' }),
    );

    expect(onAction).toHaveBeenCalledWith(sections[2].items[0], 'open_console');
  });
});
