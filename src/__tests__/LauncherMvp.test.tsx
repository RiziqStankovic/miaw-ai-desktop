import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import {
  emitTauriEvent,
  enableChannelCaptureWithResponses,
  invoke,
} from '../testUtils/mocks/tauri';

async function showOverlay() {
  await act(async () => {
    emitTauriEvent('thuki://visibility', {
      state: 'show',
      selected_text: null,
      window_x: null,
      window_y: null,
      screen_bottom_y: null,
    });
  });
}

describe('launcher MVP', () => {
  it('renders launcher rows for typed ask-bar queries', async () => {
    enableChannelCaptureWithResponses({
      get_provider_settings: {
        provider: 'litellm',
        baseUrl: 'http://127.0.0.1:4000',
        apiKey: null,
        systemPrompt: 'test prompt',
        models: { active: 'gemma4:e2b', all: ['gemma4:e2b'] },
      },
      list_conversations: [],
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    const textarea = screen.getByPlaceholderText('Ask Miaw anything...');
    fireEvent.change(textarea, { target: { value: 'chrome issue' } });

    await waitFor(() => {
      expect(
        screen.getByRole('listbox', { name: /launcher results/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Ask Miaw')).toBeInTheDocument();
    expect(screen.getByText('Search the web')).toBeInTheDocument();
  });

  it('opens the highlighted web fallback from launcher results', async () => {
    enableChannelCaptureWithResponses({
      get_provider_settings: {
        provider: 'litellm',
        baseUrl: 'http://127.0.0.1:4000',
        apiKey: null,
        systemPrompt: 'test prompt',
        models: { active: 'gemma4:e2b', all: ['gemma4:e2b'] },
      },
      list_conversations: [],
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    const textarea = screen.getByPlaceholderText('Ask Miaw anything...');
    fireEvent.change(textarea, { target: { value: 'plain query' } });

    await waitFor(() => {
      expect(screen.getByText('Search the web')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(invoke).toHaveBeenCalledWith('open_url', {
      url: 'https://www.google.com/search?q=plain%20query',
    });
  });

  it('auto-launches an app intent without requiring a slash command', async () => {
    enableChannelCaptureWithResponses({
      get_provider_settings: {
        provider: 'litellm',
        baseUrl: 'http://127.0.0.1:4000',
        apiKey: null,
        systemPrompt: 'test prompt',
        models: { active: 'gemma4:e2b', all: ['gemma4:e2b'] },
      },
      list_conversations: [],
      search_launcher_apps: [
        {
          id: 'chrome',
          title: 'Google Chrome',
          subtitle: 'Application',
          path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk',
        },
      ],
      search_launcher_files: [],
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    const textarea = screen.getByPlaceholderText('Ask Miaw anything...');
    fireEvent.change(textarea, { target: { value: 'tolong buka chrome' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_path', {
        path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk',
      });
    });
    expect(invoke).not.toHaveBeenCalledWith(
      'ask_ollama',
      expect.anything(),
    );
  });

  it('auto-launches direct URLs from natural-language input', async () => {
    enableChannelCaptureWithResponses({
      get_provider_settings: {
        provider: 'litellm',
        baseUrl: 'http://127.0.0.1:4000',
        apiKey: null,
        systemPrompt: 'test prompt',
        models: { active: 'gemma4:e2b', all: ['gemma4:e2b'] },
      },
      list_conversations: [],
    });

    render(<App />);
    await act(async () => {});
    await showOverlay();

    const textarea = screen.getByPlaceholderText('Ask Miaw anything...');
    fireEvent.change(textarea, {
      target: { value: 'open github.com/openai' },
    });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_url', {
        url: 'https://github.com/openai',
      });
    });
  });
});
