import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { setLanguage, t } from '../src/i18n/index.js';
import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';

test('mergeConfig accepts the panel layout and validates panel options', () => {
  const config = mergeConfig({ lineLayout: 'panel', panel: { icons: 'nerd', maxAgents: 99, completedRetentionSeconds: -5 } });
  assert.equal(config.lineLayout, 'panel');
  assert.deepEqual(config.panel, { icons: 'nerd', maxAgents: 20, completedRetentionSeconds: 0 });

  const fallback = mergeConfig({ panel: { icons: 'emoji', maxAgents: 'lots' } });
  assert.deepEqual(fallback.panel, { icons: 'none', maxAgents: 5, completedRetentionSeconds: 120 });
});

test('the Spanish locale covers every English message key', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  setLanguage('es');
  try {
    assert.equal(t('label.context'), 'Contexto');
    assert.equal(t('panel.activity'), 'actividad');
  } finally {
    setLanguage('en');
  }
});
