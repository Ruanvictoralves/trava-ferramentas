import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeviceState, DEFAULTS, validateSettings} from '../dist/protocol.mjs';

test('estado retido e ONLINE retido nao habilitam os controles', () => {
  const device = new DeviceState();
  device.broker = true;
  device.receive('conexao', 'ONLINE', true, 1000);
  device.receive('estado', 'TRAVADA', true, 1000);
  assert.equal(device.state, 'TRAVADA');
  assert.equal(device.fresh(1000), false);
  device.receive('estado', 'TRAVADA', false, 2000);
  assert.equal(device.fresh(2000), true);
  assert.equal(device.fresh(16999), true);
  assert.equal(device.fresh(17000), false);
});
test('perda de rede e Last Will invalidam a disponibilidade', () => {
  const device = new DeviceState();
  device.broker = true;
  device.receive('estado', 'DESTRAVADA', false, 2000);
  assert.equal(device.fresh(2001), true);
  device.receive('conexao', 'OFFLINE', false, 2002);
  assert.equal(device.fresh(2002), false);
  device.receive('conexao', 'ONLINE', true, 2003);
  assert.equal(device.fresh(2003), false);
  device.receive('estado', 'TRAVADA', false, 2004);
  assert.equal(device.fresh(2004), true);
  device.broker = false;
  assert.equal(device.fresh(2005), false);
});
test('mensagens desconhecidas nao mudam o estado', () => {
  const device = new DeviceState();
  assert.equal(device.receive('estado', '<script>', false, 1), false);
  assert.equal(device.receive('comando', 'DESTRAVAR', false, 1), false);
  assert.equal(device.lastSeen, null);
});
test('configuracao exige WebSocket seguro e topico sem curingas', () => {
  assert.deepEqual(validateSettings(DEFAULTS.url, DEFAULTS.base), DEFAULTS);
  for (const url of ['ws://example.com', 'https://example.com', 'wss://user:pass@example.com'])
    assert.throws(() => validateSettings(url, DEFAULTS.base));
  for (const base of ['', 'bike/#', 'bike/+', 'bike/ ', 'bike/'])
    assert.throws(() => validateSettings(DEFAULTS.url, base));
});
