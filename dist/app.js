import {DEFAULTS, DeviceState, validateSettings} from './protocol.mjs';

const $ = id => document.getElementById(id);
const device = new DeviceState();
let settings = {...DEFAULTS};
try {
  const saved = JSON.parse(localStorage.getItem('trava-bike-settings'));
  if (saved) settings = validateSettings(saved.url, saved.base);
} catch { /* Usa a configuracao do projeto se os dados locais forem invalidos. */ }
$('broker-url').value = settings.url;
$('base-topic').value = settings.base;
let client = null;
let connecting = false;
let pending = null;
let pendingTimer;
let lastLive = false;
const events = [];

function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}

function log(message) {
  events.unshift({message, time: new Date()});
  events.splice(15);
  const items = events.map(event => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = event.time.toISOString();
    time.textContent = event.time.toLocaleTimeString('pt-BR');
    const text = document.createElement('span');
    text.textContent = event.message;
    li.append(time, text);
    return li;
  });
  $('activity').replaceChildren(...items);
}

function render() {
  const live = device.fresh(Date.now());
  $('broker-dot').classList.toggle('active', device.broker);
  $('device-dot').classList.toggle('active', live);
  $('broker-status').textContent = device.broker ? 'Painel conectado ao broker' : connecting ? 'Conectando ao broker…' : 'Painel desconectado';
  $('device-status').textContent = live ? 'ESP32 respondendo' : device.availability === 'OFFLINE' ? 'ESP32 offline' : 'ESP32 sem confirmação';
  $('last-seen').textContent = device.lastSeen === null ? 'Nenhuma resposta ao vivo' : 'Última resposta: ' + new Date(device.lastSeen).toLocaleTimeString('pt-BR');
  $('connect').textContent = client ? 'Desconectar ↗' : 'Conectar dispositivo ↗';
  $('unlock').disabled = !live || Boolean(pending);
  $('lock').disabled = !live || Boolean(pending);
  $('query').disabled = !device.broker;
  const known = device.state !== null;
  const unlocked = device.state === 'DESTRAVADA';
  $('state-badge').textContent = !known ? 'ESTADO DESCONHECIDO' : !live ? 'ÚLTIMO ESTADO RECEBIDO' : unlocked ? 'DESTRAVADA' : 'TRAVADA';
  $('state-badge').className = 'badge' + (live ? unlocked ? ' unlocked' : ' locked' : '');
  $('lock-art').classList.toggle('unlocked', unlocked);
  $('state-title').textContent = !known ? 'Vamos conectar?' : !live ? 'Aguardando confirmação' : unlocked ? 'Cofre aberto para retirar ferramentas.' : 'Cofre de ferramentas da bike travado.';
  $('state-description').textContent = !known ? 'O estado da trava do cofre aparecerá quando o dispositivo responder.' : !live ? 'Último estado: ' + device.state.toLowerCase() + '. Consulte o dispositivo para atualizar.' : unlocked ? 'O cofre será travado automaticamente pelo ESP32.' : 'O ESP32 confirmou a posição da trava do cofre.';
  $('lcd-line1').textContent = device.state || 'AGUARDANDO ESP32';
  $('lcd-line2').textContent = live ? unlocked ? 'AUTOFECHO: 10s' : 'MQTT CONECTADO' : known ? 'ULTIMO ESTADO' : 'CONECTE O PAINEL';
  if (lastLive && !live && device.broker) {
    feedback('O ESP32 parou de confirmar o estado. Confira a simulação no Wokwi.', true);
    log('Sem resposta recente do ESP32. Controles suspensos.');
  }
  lastLive = live;
}

function cancelPending() {
  clearTimeout(pendingTimer);
  pending = null;
}

function disconnect() {
  const previous = client;
  client = null;
  previous?.end(true);
  connecting = false;
  device.broker = false;
  device.lastSeen = null;
  cancelPending();
  render();
}

function connect() {
  if (!window.mqtt) {
    feedback('Não foi possível carregar a biblioteca MQTT. Recarregue a página.', true);
    return;
  }
  disconnect();
  device.reset();
  connecting = true;
  feedback('Conectando ao broker. Deixe a simulação do Wokwi em execução.');
  const current = window.mqtt.connect(settings.url, {
    clientId: 'web-bike-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    clean: true, reconnectPeriod: 5000, connectTimeout: 15000, keepalive: 15,
    resubscribe: false, queueQoSZero: false
  });
  client = current;
  render();
  current.on('connect', () => {
    if (client !== current) return;
    device.reset();
    device.broker = true;
    connecting = false;
    log('Painel conectado ao broker.');
    feedback('Broker conectado. Aguardando uma resposta atual do ESP32.');
    current.subscribe([settings.base + '/estado', settings.base + '/conexao'], {qos: 0}, (error, granted) => {
      if (client !== current) return;
      if (error || !granted || granted.some(item => item.qos === 128)) {
        feedback('O broker não aceitou a assinatura dos tópicos. Confira a configuração.', true);
        log('Falha na assinatura dos tópicos.');
      } else send('CONSULTAR');
    });
    render();
  });
  current.on('message', (topic, payload, packet) => {
    if (client !== current || !topic.startsWith(settings.base + '/')) return;
    const channel = topic.slice(settings.base.length + 1);
    const text = payload.toString();
    const previousState = device.state;
    const wasLive = device.fresh(Date.now());
    if (!device.receive(channel, text, Boolean(packet.retain), Date.now())) return;
    if (channel === 'estado') {
      if (packet.retain) log('Último estado retido: ' + text.toLowerCase() + '.');
      else {
        if (previousState !== text || !wasLive) log('ESP32 confirmou: ' + text.toLowerCase() + '.');
        if (pending && pending.expected === text) {
          const action = pending.command;
          cancelPending();
          feedback(action === 'DESTRAVAR' ? 'Cofre aberto. O ESP32 travará o cofre em aproximadamente 10 segundos.' : 'Trava do cofre confirmada pelo ESP32.');
        } else if (!pending) feedback('ESP32 respondendo. Você já pode controlar a trava.');
      }
    } else if (text === 'OFFLINE') {
      feedback('O broker informou que o ESP32 está offline. Inicie ou confira o Wokwi.', true);
      log('ESP32 offline.');
    }
    render();
  });
  current.on('reconnect', () => {
    if (client !== current) return;
    connecting = true;
    feedback('Tentando reconectar ao broker…');
    render();
  });
  current.on('close', () => {
    if (client !== current) return;
    device.broker = false;
    device.lastSeen = null;
    cancelPending();
    connecting = true;
    feedback('Conexão interrompida. Uma nova tentativa será feita em 5 segundos.', true);
    render();
  });
  current.on('error', error => {
    if (client !== current) return;
    feedback('Falha na conexão WebSocket. Confira a internet e o servidor nas configurações.', true);
    log('Erro de conexão: ' + error.message);
  });
}

function send(command) {
  if (!client?.connected || (command !== 'CONSULTAR' && !device.fresh(Date.now()))) {
    feedback('Conecte o painel e aguarde uma resposta atual do ESP32.', true);
    return;
  }
  if (command !== 'CONSULTAR') {
    cancelPending();
    pending = {command, expected: command === 'DESTRAVAR' ? 'DESTRAVADA' : 'TRAVADA'};
    pendingTimer = setTimeout(() => {
      pending = null;
      feedback('Comando enviado, mas sem confirmação no prazo. Consulte o estado antes de tentar novamente.', true);
      log('Prazo de confirmação encerrado.');
      render();
    }, 6000);
    feedback('Comando enviado. Aguardando confirmação do ESP32…');
  }
  const current = client;
  client.publish(settings.base + '/comando', command, {qos: 0, retain: false}, error => {
    if (client !== current) return;
    if (error) {
      cancelPending();
      feedback('Não foi possível enviar o comando. Confira a conexão.', true);
      render();
    }
  });
  log('Comando enviado: ' + command + '.');
  render();
}

$('connect').addEventListener('click', () => {
  if (client) {
    disconnect();
    feedback('Painel desconectado. O controle local e o fechamento automático continuam no ESP32.');
    log('Painel desconectado pelo usuário.');
  } else connect();
});
$('unlock').addEventListener('click', () => send('DESTRAVAR'));
$('lock').addEventListener('click', () => send('TRAVAR'));
$('query').addEventListener('click', () => send('CONSULTAR'));
$('clear-log').addEventListener('click', () => {
  events.length = 0;
  $('activity').replaceChildren();
  log('Histórico desta sessão limpo.');
});
$('settings').addEventListener('submit', event => {
  event.preventDefault();
  try {
    settings = validateSettings($('broker-url').value.trim(), $('base-topic').value.trim());
    try { localStorage.setItem('trava-bike-settings', JSON.stringify(settings)); } catch { /* Conecta mesmo sem armazenamento. */ }
    connect();
  } catch (error) { feedback(error.message, true); }
});
setInterval(render, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && device.broker) send('CONSULTAR');
});
window.addEventListener('pagehide', disconnect);
render();
