import type React from 'react';
import { useEffect, useRef } from 'react';
import type {
  LauncherSection,
  LauncherItem,
  LauncherItemAction,
} from '../config/launcher';
import { Tooltip } from './Tooltip';

const SEARCH_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M10.5 10.5L14 14"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const CALCULATOR_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="3"
      y="2"
      width="10"
      height="12"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <rect x="5" y="4" width="6" height="2" rx="0.8" fill="currentColor" />
    <circle cx="5.5" cy="9" r="0.8" fill="currentColor" />
    <circle cx="8" cy="9" r="0.8" fill="currentColor" />
    <circle cx="10.5" cy="9" r="0.8" fill="currentColor" />
    <circle cx="5.5" cy="11.5" r="0.8" fill="currentColor" />
    <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
    <circle cx="10.5" cy="11.5" r="0.8" fill="currentColor" />
  </svg>
);

const COMMAND_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="1.5"
      y="1.5"
      width="13"
      height="13"
      rx="3"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <path
      d="M5 6.5L7 8L5 9.5M9.5 9.5H11"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const HISTORY_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8 4.8V8L10.4 9.4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const APP_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="2"
      width="12"
      height="12"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path
      d="M5.5 5.5H10.5V10.5H5.5V5.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);

const FILE_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M4 2.5H8.5L12 6V12.5C12 13.0523 11.5523 13.5 11 13.5H4C3.44772 13.5 3 13.0523 3 12.5V3.5C3 2.94772 3.44772 2.5 4 2.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M8.5 2.5V6H12" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const GLOBE_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.5" />
    <ellipse
      cx="8"
      cy="8"
      rx="2.75"
      ry="5.75"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path d="M2.2 8H13.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const COPY_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="5"
      y="3"
      width="8"
      height="10"
      rx="1.8"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path
      d="M3.5 10.5H3C2.44772 10.5 2 10.0523 2 9.5V4C2 3.44772 2.44772 3 3 3H7.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const REVEAL_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M2.5 5.5H6L7.3 7H13.5V11.8C13.5 12.4075 13.0075 12.9 12.4 12.9H3.6C2.99249 12.9 2.5 12.4075 2.5 11.8V5.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 5.5V4.2C2.5 3.59249 2.99249 3.1 3.6 3.1H6.1"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const TERMINAL_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="1.75"
      y="2.5"
      width="12.5"
      height="11"
      rx="1.8"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path
      d="M4.25 6L6.5 8L4.25 10"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 10H11.25"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

function iconForItem(item: LauncherItem): React.ReactNode {
  switch (item.kind) {
    case 'calculation':
      return CALCULATOR_ICON;
    case 'ask':
      return SEARCH_ICON;
    case 'command':
      return COMMAND_ICON;
    case 'conversation':
      return HISTORY_ICON;
    case 'app':
      return APP_ICON;
    case 'file':
      return FILE_ICON;
    case 'web':
      return GLOBE_ICON;
  }
}

interface LauncherResultsProps {
  sections: readonly LauncherSection[];
  highlightedIndex: number;
  onSelect: (item: LauncherItem) => void;
  onAction: (item: LauncherItem, action: LauncherItemAction) => void;
}

function actionsForItem(
  item: LauncherItem,
): Array<{ id: LauncherItemAction; label: string; icon: React.ReactNode }> {
  switch (item.kind) {
    case 'command':
      return [];
    case 'conversation':
      return [];
    case 'ask':
      return [];
    case 'calculation':
      return [{ id: 'copy_path', label: 'Copy result', icon: COPY_ICON }];
    case 'web':
      return [
        { id: 'open_console', label: 'Open target in terminal', icon: TERMINAL_ICON },
        { id: 'copy_path', label: 'Copy URL', icon: COPY_ICON },
      ];
    case 'app':
      return [
        { id: 'open_console', label: 'Open target in terminal', icon: TERMINAL_ICON },
        { id: 'reveal', label: 'Open containing folder', icon: REVEAL_ICON },
        { id: 'copy_path', label: 'Copy path', icon: COPY_ICON },
      ];
    case 'file':
      return [
        {
          id: 'open_console',
          label: item.isDirectory
            ? 'Open folder in terminal'
            : 'Open target folder in terminal',
          icon: TERMINAL_ICON,
        },
        {
          id: 'reveal',
          label: item.isDirectory
            ? 'Reveal folder in Explorer'
            : 'Open containing folder',
          icon: REVEAL_ICON,
        },
        { id: 'copy_path', label: 'Copy path', icon: COPY_ICON },
      ];
  }
}

export function LauncherResults({
  sections,
  highlightedIndex,
  onSelect,
  onAction,
}: LauncherResultsProps) {
  const optionElementsRef = useRef<Array<HTMLLIElement | null>>([]);
  let optionIndex = -1;

  useEffect(() => {
    if (highlightedIndex < 0) return;
    optionElementsRef.current[highlightedIndex]?.scrollIntoView?.({
      block: 'nearest',
    });
  }, [highlightedIndex, sections]);

  return (
    <div
      className="mb-1 rounded-xl border border-surface-border bg-surface-base/98 backdrop-blur-2xl shadow-bar overflow-hidden"
      role="listbox"
      aria-label="Launcher results"
    >
      <div className="max-h-72 overflow-y-auto py-2">
        {sections.map((section) => (
          <div key={section.id} className="px-2">
            <div className="px-2 pt-2 pb-1">
              <span className="text-[10px] font-semibold tracking-wide text-text-secondary uppercase">
                {section.title}
              </span>
            </div>
            <ul role="presentation" className="pb-1">
              {section.items.map((item) => {
                optionIndex += 1;
                const currentIndex = optionIndex;
                const isHighlighted = currentIndex === highlightedIndex;
                const actions = actionsForItem(item);
                return (
                  <li
                    key={item.id}
                    ref={(node) => {
                      optionElementsRef.current[currentIndex] = node;
                    }}
                    role="option"
                    aria-selected={isHighlighted}
                    className={`launcher-row flex items-center gap-3 rounded-lg px-2.5 py-2 cursor-pointer select-none ${
                      isHighlighted
                        ? 'bg-white/9 text-text-primary'
                        : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(item);
                    }}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        isHighlighted
                          ? 'border-primary/25 bg-primary/12 text-primary'
                          : 'border-white/5 bg-white/[0.04] text-text-secondary'
                      }`}
                    >
                      {iconForItem(item)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {item.title}
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {item.subtitle}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {actions.length > 0 ? (
                        <div className="flex items-center gap-1">
                          {actions.map((action) => (
                            <Tooltip key={action.id} label={action.label}>
                              <button
                                type="button"
                                aria-label={action.label}
                                className={`window-no-drag flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors ${
                                  isHighlighted
                                    ? 'hover:border-surface-border hover:bg-white/8 hover:text-text-primary'
                                    : 'hover:border-white/10 hover:bg-white/6 hover:text-text-primary'
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onAction(item, action.id);
                                }}
                              >
                                {action.icon}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
