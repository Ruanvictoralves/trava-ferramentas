export const DEFAULTS = Object.freeze({url: 'wss://test.mosquitto.org:8081/mqtt', base: 'bicicleta/ruan-bike-a73f92'});
export function validateSettings(url, base) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.hash)
    throw new Error('Use um endereço wss:// sem usuário ou senha na URL.');
  if (!base || base.length > 120 || /[+#\s\u0000]/.test(base) || base.endsWith('/'))
    throw new Error('Informe o tópico base sem espaços, curingas ou barra no final.');
  return {url: parsed.href, base};
}

export class DeviceState {
  constructor() { this.reset(); }
  reset() {
    this.broker = false;
    this.availability = null;
    this.state = null;
    this.lastSeen = null;
    this.retained = false;
  }
  receive(channel, payload, retained, now) {
    if (channel === 'conexao' && ['ONLINE', 'OFFLINE'].includes(payload)) {
      this.availability = payload;
      if (payload === 'OFFLINE') this.lastSeen = null;
      return true;
    }
    if (channel === 'estado' && ['TRAVADA', 'DESTRAVADA'].includes(payload)) {
      this.state = payload;
      this.retained = retained;
      // Mensagens retidas descrevem o passado e nao provam que o ESP32 responde.
      if (!retained) this.lastSeen = now;
      return true;
    }
    return false;
  }
  fresh(now) {
    return this.broker && this.availability !== 'OFFLINE' && this.lastSeen !== null && now - this.lastSeen < 15000;
  }
}
