import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface ProviderSettings {
  provider: string;
  baseUrl: string;
  apiKey: string | null;
  systemPrompt: string;
  models: {
    active: string;
    all: string[];
  };
}

interface PingResult {
  ok: boolean;
  latencyMs: number;
  status: number | null;
  message: string;
  models?: string[];
}

interface SettingsPanelProps {
  settings: ProviderSettings | null;
  onSaved: (settings: ProviderSettings) => void;
}

function toEditableModelList(settings: ProviderSettings | null) {
  return settings?.models.all.join(', ') ?? '';
}

export function SettingsPanel({ settings, onSaved }: SettingsPanelProps) {
  const [provider, setProvider] = useState('litellm');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [modelList, setModelList] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pingState, setPingState] = useState<'idle' | 'testing'>('idle');
  const [pingResult, setPingResult] = useState<PingResult | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProvider(settings.provider);
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey ?? '');
    setActiveModel(settings.models.active);
    setModelList(toEditableModelList(settings));
    setSystemPrompt(settings.systemPrompt);
    setSaveState('idle');
    setPingResult(null);
  }, [settings]);

  const normalizedPayload = useMemo(() => {
    const parsedModels = modelList
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const normalizedActive =
      activeModel.trim() || parsedModels[0] || 'gemma-3-4b-it';
    const mergedModels = [normalizedActive, ...parsedModels].filter(
      (item, index, array) => item && array.indexOf(item) === index
    );

    return {
      provider: provider.trim() || 'litellm',
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      systemPrompt: systemPrompt.trim(),
      models: mergedModels
    };
  }, [provider, baseUrl, apiKey, activeModel, modelList, systemPrompt]);

  const canSave =
    normalizedPayload.baseUrl.length > 0 && normalizedPayload.models.length > 0;

  const handleSave = async () => {
    if (!canSave) {
      return;
    }

    setSaveState('saving');
    const saved = await invoke<ProviderSettings>('update_provider_settings', normalizedPayload);
    setActiveModel(saved.models.active);
    setModelList(saved.models.all.join(', '));
    setSaveState('saved');
    onSaved(saved);
    window.setTimeout(() => setSaveState('idle'), 1200);
  };

  const handlePing = async () => {
    if (!canSave) {
      return;
    }

    setPingState('testing');
    setPingResult(null);
    const result = await invoke<PingResult>('ping_provider_connection', normalizedPayload);
    setPingResult(result);
    setPingState('idle');
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-[rgba(24,19,16,0.98)] shadow-chat backdrop-blur-2xl">
      <div className="px-4 py-3 border-b border-surface-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">Miaw Runtime Settings</p>
            <p className="text-[11px] text-text-secondary">
              Change provider config without restarting Miaw.
            </p>
          </div>
          <div className="rounded-full border border-primary/15 bg-primary/8 px-2 py-1 text-[10px] font-medium text-primary">
            Runtime
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
            Provider
          </span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="litellm">LiteLLM</option>
            <option value="openai">OpenAI Compatible</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
            API Base URL
          </span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://eay.cloudfren.id"
            className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/60"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
            API Key
          </span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder="sk-..."
            className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/60"
          />
        </label>

        <div className="grid grid-cols-[1fr_1.2fr] gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
              Active Model
            </span>
            <input
              value={activeModel}
              onChange={(event) => setActiveModel(event.target.value)}
              placeholder="customai-tunning"
              className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/60"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
              Models
            </span>
            <input
              value={modelList}
              onChange={(event) => setModelList(event.target.value)}
              placeholder="customai-tunning, another-model"
              className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/60"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
            System Prompt
          </span>
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={4}
            placeholder="Optional system prompt override"
            className="resize-none rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary/60"
          />
        </label>

        {pingResult && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${
              pingResult.ok
                ? 'border-green-500/20 bg-green-500/8 text-green-200'
                : 'border-red-500/20 bg-red-500/8 text-red-200'
            }`}
          >
            <div className="font-medium">
              {pingResult.ok ? 'Connection OK' : 'Connection Failed'}
            </div>
            <div>{pingResult.message}</div>
            <div className="opacity-80">
              {pingResult.status ? `HTTP ${pingResult.status} • ` : ''}
              {pingResult.latencyMs} ms
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handlePing}
            disabled={!canSave || pingState === 'testing'}
            className="rounded-xl border border-surface-border bg-white/4 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-white/8 disabled:opacity-40"
          >
            {pingState === 'testing' ? 'Testing...' : 'Test Ping'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saveState === 'saving'}
            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-neutral transition-colors hover:bg-[#ff996a] disabled:opacity-40"
          >
            {saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
                ? 'Saved'
                : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
