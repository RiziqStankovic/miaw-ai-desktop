import { describe, expect, it } from 'vitest';
import type { LauncherApp, LauncherFile } from '../launcher';
import {
  buildLaunchSearchQueries,
  detectLaunchIntent,
  isLaunchConfirmation,
  isLaunchRejection,
  resolveLaunchTarget,
} from '../launchIntent';

const apps: LauncherApp[] = [
  {
    id: 'chrome',
    title: 'Google Chrome',
    subtitle: 'Application',
    path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk',
  },
  {
    id: 'openvpn',
    title: 'OpenVPN Connect',
    subtitle: 'Application',
    path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\OpenVPN Connect.lnk',
  },
];

const files: LauncherFile[] = [
  {
    id: 'report',
    title: 'Laporan Q1.pdf',
    subtitle: 'Documents',
    path: 'C:\\Users\\User\\Documents\\Laporan Q1.pdf',
    isDirectory: false,
  },
  {
    id: 'chrome-notes',
    title: 'Chrome Notes.txt',
    subtitle: 'Downloads',
    path: 'C:\\Users\\User\\Downloads\\Chrome Notes.txt',
    isDirectory: false,
  },
  {
    id: 'vpn-doc',
    title: 'Open VPN Form_2.0_Dev.docx',
    subtitle: 'Documents',
    path: 'C:\\Users\\User\\Documents\\Open VPN Form_2.0_Dev.docx',
    isDirectory: false,
  },
];

describe('launchIntent', () => {
  it('detects app launch intent from Indonesian phrasing', () => {
    expect(detectLaunchIntent('tolong buka chrome dong')).toEqual({
      kind: 'lookup',
      target: 'chrome',
    });
  });

  it('detects URL launch intent and normalizes bare domains', () => {
    expect(detectLaunchIntent('open github.com/openai')).toEqual({
      kind: 'url',
      target: 'github.com/openai',
      url: 'https://github.com/openai',
    });
  });

  it('builds alias-backed search queries for known app nicknames', () => {
    expect(buildLaunchSearchQueries('wa')).toEqual(['wa', 'whatsapp']);
    expect(buildLaunchSearchQueries('vpn')).toEqual([
      'vpn',
      'openvpn',
      'proton vpn',
      'nordvpn',
    ]);
  });

  it('does not treat ordinary chat questions as a launch intent', () => {
    expect(detectLaunchIntent('kenapa chrome tidak bisa dibuka?')).toBeNull();
  });

  it('auto-opens strong app matches', () => {
    expect(resolveLaunchTarget('openvpn', apps, files)).toMatchObject({
      status: 'auto',
      candidate: {
        kind: 'app',
        title: 'OpenVPN Connect',
      },
    });
  });

  it('prioritizes applications over loosely related files for generic app queries', () => {
    expect(resolveLaunchTarget('vpn', apps, files)).toMatchObject({
      status: 'auto',
      candidate: {
        kind: 'app',
        title: 'OpenVPN Connect',
      },
    });
  });

  it('auto-opens strong file matches when the file intent is explicit', () => {
    expect(resolveLaunchTarget('laporan q1 pdf', apps, files)).toMatchObject({
      status: 'auto',
      candidate: {
        kind: 'file',
        path: 'C:\\Users\\User\\Documents\\Laporan Q1.pdf',
        isDirectory: false,
      },
    });
  });

  it('recognizes short confirmation and rejection replies', () => {
    expect(isLaunchConfirmation('oke')).toBe(true);
    expect(isLaunchRejection('ga')).toBe(true);
  });
});
