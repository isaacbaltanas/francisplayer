class FrancisDuckingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.anchorContextTime = 0;
    this.anchorPositionMs = 0;
    this.defaultHighDb = 0;
    this.envelopes = [];
    this.port.onmessage = event => {
      const data = event.data || {};
      if (data.type !== 'configure') return;
      this.anchorContextTime = Number(data.anchorContextTime) || 0;
      this.anchorPositionMs = Number(data.anchorPositionMs) || 0;
      this.defaultHighDb = Number(data.defaultHighDb) || 0;
      this.envelopes = Array.isArray(data.envelopes) ? data.envelopes : [];
    };
  }

  dbAt(positionMs, baselineDb) {
    let result = baselineDb;
    for (let index = 0; index < this.envelopes.length; index += 1) {
      const item = this.envelopes[index];
      if (item.downStartMs > positionMs || item.upEndMs < positionMs) continue;
      let candidate = item.highDb;
      if (positionMs >= item.downEndMs && positionMs <= item.upStartMs) candidate = item.lowDb;
      else if (item.downEndMs > item.downStartMs && positionMs < item.downEndMs) {
        const progress = (positionMs - item.downStartMs) / (item.downEndMs - item.downStartMs);
        candidate = item.highDb + (item.lowDb - item.highDb) * progress;
      } else if (item.upEndMs > item.upStartMs && positionMs > item.upStartMs) {
        const progress = (positionMs - item.upStartMs) / (item.upEndMs - item.upStartMs);
        candidate = item.lowDb + (item.highDb - item.lowDb) * progress;
      }
      result = Math.min(result, candidate);
    }
    return result;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output.length) return true;
    const frames = output[0].length;
    const blockStartMs = this.anchorPositionMs + (currentTime - this.anchorContextTime) * 1000;
    let nextIndex = 0;
    while (nextIndex < this.envelopes.length && blockStartMs >= this.envelopes[nextIndex].startMs) nextIndex += 1;
    for (let sample = 0; sample < frames; sample += 1) {
      const contextAtSample = currentTime + sample / sampleRate;
      const positionMs = this.anchorPositionMs + (contextAtSample - this.anchorContextTime) * 1000;
      while (nextIndex < this.envelopes.length && positionMs >= this.envelopes[nextIndex].startMs) nextIndex += 1;
      const baseline = this.envelopes.length
        ? (nextIndex < this.envelopes.length ? this.envelopes[nextIndex] : this.envelopes[this.envelopes.length - 1]).highDb
        : this.defaultHighDb;
      const gain = Math.pow(10, this.dbAt(positionMs, baseline) / 20);
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][sample] = (input[channel]?.[sample] || input[0]?.[sample] || 0) * gain;
      }
    }
    return true;
  }
}

registerProcessor('francis-ducking', FrancisDuckingProcessor);
