import test from 'node:test';
import assert from 'node:assert/strict';
import { isLightScheduleTime, mayDeleteResource, resolveTheme, shouldShowBottomNavigation, semanticIconColor } from '../src/lib/themePolicy.mjs';

test('manual and system theme modes resolve predictably', () => {
  const now = new Date(2026, 0, 1, 12, 0);
  assert.equal(resolveTheme('light', 'dark', now, '06:00', '18:00'), 'light');
  assert.equal(resolveTheme('dark', 'light', now, '06:00', '18:00'), 'dark');
  assert.equal(resolveTheme('system', 'light', now, '06:00', '18:00'), 'light');
  assert.equal(resolveTheme('system', 'dark', now, '06:00', '18:00'), 'dark');
});

test('scheduled theme supports normal and midnight-crossing ranges', () => {
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 6, 0), '06:00', '18:00'), true);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 17, 59), '06:00', '18:00'), true);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 18, 0), '06:00', '18:00'), false);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 23, 0), '20:00', '06:00'), true);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 5, 59), '20:00', '06:00'), true);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 6, 0), '20:00', '06:00'), false);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 20, 0), '20:00', '06:00'), true);
  assert.equal(isLightScheduleTime(new Date(2026, 0, 1, 8, 0), '08:00', '08:00'), false);
});

test('fixed bottom bar is limited to main routes', () => {
  for (const route of ['index', 'lists', 'notes']) assert.equal(shouldShowBottomNavigation(route), true);
  for (const route of ['profile', 'settings', 'list', 'note', 'invite', 'shared']) assert.equal(shouldShowBottomNavigation(route), false);
});

test('delete policy separates local resources and cloud owner permissions', () => {
  assert.equal(mayDeleteResource({ local: true, cloudLinked: false, currentScopeMatches: true }), true);
  assert.equal(mayDeleteResource({ local: true, cloudLinked: false, currentScopeMatches: false }), false);
  assert.equal(mayDeleteResource({ local: true, cloudLinked: true, permission: 'owner', currentScopeMatches: true }), true);
  assert.equal(mayDeleteResource({ local: true, cloudLinked: true, permission: 'editor', currentScopeMatches: true }), false);
  assert.equal(mayDeleteResource({ local: false, cloudLinked: false, currentScopeMatches: true }), false);
});

test('semantic icon roles stay readable and selected dark navigation uses mint', () => {
  assert.equal(semanticIconColor('primary', 'dark'), '#8bd5a5');
  assert.equal(semanticIconColor('primary', 'light'), '#27804d');
  assert.equal(semanticIconColor('destructive', 'dark'), '#ff8d91');
  assert.equal(semanticIconColor('informational', 'light'), '#3176a8');
  assert.equal(semanticIconColor('disabled', 'dark'), '#67727b');
  assert.equal(semanticIconColor('inverse', 'light'), '#ffffff');
});
