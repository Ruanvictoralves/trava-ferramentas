import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

test('painel exige resposta ao vivo, publica sem Retain e espera confirmacao', async t => {
  class Element {
    constructor() { this.textContent = ''; this.disabled = false; this.value = ''; this.listeners = {}; this.classList = {toggle() {}}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append() {}
    replaceChildren() {}
    click() { this.listeners.click?.(); }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const publications = [];
  let socket;
  class Client extends EventEmitter {
    connected = false;
    subscribe(topics, options, callback) { callback(null, topics.map(topic => ({topic, qos: 0}))); }
    publish(topic, payload, options, callback) { publications.push({topic, payload, options}); callback?.(); }
    end() { this.connected = false; this.emit('close'); }
  }
  const previous = {};
  for (const name of ['document', 'window', 'localStorage']) previous[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {getElementById: element, createElement: () => new Element(), addEventListener() {}}});
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {mqtt: {connect() { socket = new Client(); return socket; }}, addEventListener() {}}});
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem() { return null; }, setItem() {}}});
  t.mock.method(globalThis, 'setInterval', () => 0);
  t.after(() => {
    element('connect').click();
    for (const name of Object.keys(previous)) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  });
  await import('../dist/app.js');
  assert.equal(element('unlock').disabled, true);
  element('unlock').click();
  assert.equal(publications.length, 0);
  element('connect').click();
  socket.connected = true;
  socket.emit('connect');
  assert.equal(publications.at(-1).payload, 'CONSULTAR');
  const receive = (channel, text, retain = false) => socket.emit('message', 'bicicleta/ruan-bike-a73f92/' + channel, Buffer.from(text), {retain});
  receive('conexao', 'ONLINE', true);
  receive('estado', 'TRAVADA', true);
  assert.equal(element('unlock').disabled, true);
  receive('estado', 'TRAVADA');
  assert.equal(element('unlock').disabled, false);
  element('unlock').click();
  assert.deepEqual(publications.at(-1), {topic: 'bicicleta/ruan-bike-a73f92/comando', payload: 'DESTRAVAR', options: {qos: 0, retain: false}});
  assert.match(element('feedback').textContent, /Aguardando confirmação/);
  assert.equal(element('unlock').disabled, true);
  assert.equal(element('state-badge').textContent, 'TRAVADA');
  receive('estado', 'DESTRAVADA');
  assert.equal(element('state-badge').textContent, 'DESTRAVADA');
  assert.match(element('feedback').textContent, /Destravamento confirmado/);
  assert.equal(element('lock').disabled, false);
  receive('conexao', 'OFFLINE');
  assert.equal(element('lock').disabled, true);
});
