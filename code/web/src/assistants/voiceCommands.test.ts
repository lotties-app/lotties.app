import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enCatalog } from '../i18n/catalogEn';
import { ptBRCatalog } from '../i18n/catalogPtBR';
import {
  VOICE_ASSISTANTS,
  VOICE_COMMANDS,
  VOICE_TOPICS,
  commandsOf,
  defaultAssistant,
  type VoiceCommandShape,
} from './voiceCommands';

/*
 * Drift guard of the Voice commands page (docs/VOICE-COMMANDS.md): every intent, tool, Siri phrase
 * and Android shortcut it names exists in the repository files the assistants are built from, every
 * one of those is listed, and every text has its English and Portuguese version.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

const all = (assistant: keyof typeof VOICE_COMMANDS): readonly VoiceCommandShape[] =>
  VOICE_COMMANDS[assistant];

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

interface AlexaModel {
  interactionModel: { languageModel: { intents: { name: string }[] } };
}

function alexaIntents(file: string): Set<string> {
  const model = JSON.parse(read(file)) as AlexaModel;
  return new Set(
    model.interactionModel.languageModel.intents
      .map((intent) => intent.name)
      .filter((name) => !name.startsWith('AMAZON.')),
  );
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** The string at `path` (`a.b.c`) of a catalog, or undefined. */
function at(catalog: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null && Object.hasOwn(node, key)
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalog,
    );
}

function leaves(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('voice commands catalog', () => {
  it('lists exactly the custom intents of both Alexa models', () => {
    const en = alexaIntents('alexa/interaction-model.en-US.json');
    const pt = alexaIntents('alexa/interaction-model.pt-BR.json');
    expect(sorted(pt)).toEqual(sorted(en));
    const listed = all('alexa').map((command) => command.alexaIntent);
    expect(listed.every((intent) => typeof intent === 'string')).toBe(true);
    expect(sorted(listed as string[])).toEqual(sorted(en));
  });

  it('names only MCP tools that exist, and never a medication tool', () => {
    const source = read('code/api/src/Lotties.Api/Assistants/Mcp/McpToolCatalog.cs');
    const tools = matches(source, /\b(?:Read|Write)\(\s*"([a-z_]+)"/g);
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) expect(tool).not.toMatch(/medic/);
    for (const assistant of VOICE_ASSISTANTS) {
      for (const command of all(assistant)) {
        for (const tool of command.tools ?? []) expect(tools, `${assistant}: ${tool}`).toContain(tool);
      }
    }
  });

  it('lists exactly the spoken Siri phrases, with tools the Siri intents call', () => {
    const phrases = (lang: string) =>
      matches(read(`code/mobile/ios/App/App/${lang}.lproj/AppShortcuts.strings`), /^"(.+?)"\s*=/gm);
    expect(sorted(phrases('pt-BR'))).toEqual(sorted(phrases('en')));
    const listed = all('siri').flatMap((command) => command.siriPhrases ?? []);
    expect(sorted(listed)).toEqual(sorted(phrases('en')));
    const intents = read('code/mobile/ios/App/App/LottiesSiriIntents.swift');
    for (const command of all('siri')) {
      for (const tool of command.tools ?? []) expect(intents).toContain(`"${tool}"`);
    }
  });

  it('lists exactly the Android shortcuts, with the tools the voice catalog calls', () => {
    const xml = read('code/mobile/android/app/src/main/res/xml/shortcuts.xml');
    const ids = matches(xml, /android:shortcutId="([a-z_]+)"/g);
    const listed = all('android').flatMap((command) =>
      command.androidShortcut ? [command.androidShortcut] : [],
    );
    expect(sorted(listed)).toEqual(sorted(ids));
    const catalog = read(
      'code/mobile/android/app/src/main/java/app/lotties/app/voice/VoiceCatalog.kt',
    );
    for (const command of all('android')) {
      for (const tool of command.tools ?? []) expect(catalog).toContain(`"${tool}"`);
    }
  });

  it('has every text in English and Portuguese, and no text it does not use', () => {
    const used = new Set<string>();
    for (const assistant of VOICE_ASSISTANTS) {
      used.add(`voiceCommands.tabs.${assistant}`);
      used.add(`voiceCommands.status.${assistant}`);
      used.add(`voiceCommands.start.${assistant}`);
      for (const command of all(assistant)) {
        used.add(`voiceCommands.say.${command.say}`);
        used.add(`voiceCommands.actions.${command.action}.does`);
        used.add(`voiceCommands.actions.${command.action}.answer`);
      }
    }
    for (const topic of VOICE_TOPICS) used.add(`voiceCommands.topics.${topic}`);
    for (const key of used) {
      for (const catalog of [enCatalog, ptBRCatalog]) {
        const text = at(catalog, key);
        expect(typeof text === 'string' && text.trim().length > 0, key).toBe(true);
      }
    }
    const en = leaves(at(enCatalog, 'voiceCommands'), 'voiceCommands');
    const pt = leaves(at(ptBRCatalog, 'voiceCommands'), 'voiceCommands');
    expect(sorted(pt)).toEqual(sorted(en));
    const perCommand = en.filter((key) => /^voiceCommands\.(say|actions)\./.test(key));
    expect(perCommand.filter((key) => !used.has(key))).toEqual([]);
  });

  it('groups by topic and opens on the assistant of this device', () => {
    expect(commandsOf('alexa', 'medication').map((command) => command.say)).toEqual([
      'alexaMedicationLog',
      'alexaMedicationReminder',
    ]);
    // Siri and Android have no medicine command by design (docs/design/32-assistants.md).
    for (const assistant of ['siri', 'android'] as const) {
      expect(commandsOf(assistant, 'medication').map((command) => command.action)).toEqual([
        'medicationNotAvailable',
      ]);
    }
    expect(defaultAssistant('ios')).toBe('siri');
    expect(defaultAssistant('android')).toBe('android');
    expect(defaultAssistant(null)).toBe('alexa');
  });
});
