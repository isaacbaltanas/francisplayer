class FrancisLoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [];
    this.energyCapacity = Math.round(sampleRate * 3);
    this.energy = new Float64Array(this.energyCapacity);
    this.energyIndex = 0;
    this.energyCount = 0;
    this.energySum = 0;
    this.blocks = [];
    this.samples = 0;
    this.reportEvery = Math.round(sampleRate / 10);
    this.port.onmessage = event => {
      if (event.data === 'reset') {
        this.energy.fill(0); this.energyIndex = 0; this.energyCount = 0; this.energySum = 0;
        this.blocks = []; this.samples = 0; this.peak = 0;
      }
    };
  }

  filter(channel, input) {
    const state = this.channels[channel] || (this.channels[channel] = { s1x1: 0, s1x2: 0, s1y1: 0, s1y2: 0, s2x1: 0, s2x2: 0, s2y1: 0, s2y2: 0 });
    const shelfB = [1.53512485958697, -2.69169618940638, 1.19839281085285];
    const shelfA = [-1.69065929318241, 0.73248077421585];
    const passB = [1, -2, 1];
    const passA = [-1.99004745483398, 0.99007225036621];
    const first = shelfB[0] * input + shelfB[1] * state.s1x1 + shelfB[2] * state.s1x2 - shelfA[0] * state.s1y1 - shelfA[1] * state.s1y2;
    state.s1x2 = state.s1x1; state.s1x1 = input; state.s1y2 = state.s1y1; state.s1y1 = first;
    const second = passB[0] * first + passB[1] * state.s2x1 + passB[2] * state.s2x2 - passA[0] * state.s2y1 - passA[1] * state.s2y2;
    state.s2x2 = state.s2x1; state.s2x1 = first; state.s2y2 = state.s2y1; state.s2y1 = second;
    return second;
  }

  lufs(energy) { return energy > 0 ? -0.691 + 10 * Math.log10(energy) : -120; }

  recentAverage(length) {
    const count = Math.min(length, this.energyCount);
    if (!count) return 0;
    let sum = 0;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (this.energyIndex - offset + this.energyCapacity) % this.energyCapacity;
      sum += this.energy[index];
    }
    return sum / count;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    for (let sample = 0; sample < input[0].length; sample += 1) {
      let sum = 0;
      let peak = 0;
      for (let channel = 0; channel < input.length; channel += 1) {
        const value = input[channel][sample] || 0;
        if (output[channel]) output[channel][sample] = value;
        const weighted = this.filter(channel, value);
        sum += weighted * weighted;
        peak = Math.max(peak, Math.abs(value));
      }
      const replaced = this.energyCount === this.energyCapacity ? this.energy[this.energyIndex] : 0;
      this.energy[this.energyIndex] = sum;
      this.energyIndex = (this.energyIndex + 1) % this.energyCapacity;
      this.energyCount = Math.min(this.energyCapacity, this.energyCount + 1);
      this.energySum += sum - replaced;
      this.samples += 1;
      if (this.samples % Math.round(sampleRate * .1) === 0) {
        const blockEnergy = this.recentAverage(Math.round(sampleRate * .4));
        if (this.lufs(blockEnergy) > -70) this.blocks.push(blockEnergy);
      }
      this.peak = Math.max(this.peak || 0, peak);
    }
    if (this.samples % this.reportEvery < input[0].length) {
      const average = values => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
      const preliminary = average(this.blocks);
      const gate = this.lufs(preliminary) - 10;
      const gated = this.blocks.filter(value => this.lufs(value) >= gate);
      this.port.postMessage({
        momentary: this.lufs(this.recentAverage(Math.round(sampleRate * .4))),
        shortTerm: this.lufs(this.energySum / Math.max(1, this.energyCount)),
        integrated: this.lufs(average(gated)), peakDbfs: this.peak > 0 ? 20 * Math.log10(this.peak) : -120
      });
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor('francis-loudness', FrancisLoudnessProcessor);
