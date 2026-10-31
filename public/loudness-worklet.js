class FrancisLoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [];
    this.energyCapacity = Math.round(sampleRate * 3);
    this.energy = new Float64Array(this.energyCapacity);
    this.energyIndex = 0;
    this.energyCount = 0;
    this.energySum = 0;
    this.momentaryCapacity = Math.round(sampleRate * .4);
    this.momentaryEnergy = new Float64Array(this.momentaryCapacity);
    this.momentaryIndex = 0;
    this.momentaryCount = 0;
    this.momentarySum = 0;
    this.histogramCounts = new Uint32Array(901);
    this.histogramEnergy = new Float64Array(901);
    this.samples = 0;
    this.reportEvery = Math.round(sampleRate / 10);
    this.peak = 0;
    this.port.onmessage = event => {
      if (event.data === 'reset') {
        this.energy.fill(0); this.energyIndex = 0; this.energyCount = 0; this.energySum = 0;
        this.momentaryEnergy.fill(0); this.momentaryIndex = 0; this.momentaryCount = 0; this.momentarySum = 0;
        this.histogramCounts.fill(0); this.histogramEnergy.fill(0); this.samples = 0; this.peak = 0;
      }
    };
  }

  filter(channel, input) {
    const state = this.channels[channel] || (this.channels[channel] = { s1x1: 0, s1x2: 0, s1y1: 0, s1y2: 0, s2x1: 0, s2x2: 0, s2y1: 0, s2y2: 0 });
    const first = 1.53512485958697 * input - 2.69169618940638 * state.s1x1 + 1.19839281085285 * state.s1x2
      + 1.69065929318241 * state.s1y1 - .73248077421585 * state.s1y2;
    state.s1x2 = state.s1x1; state.s1x1 = input; state.s1y2 = state.s1y1; state.s1y1 = first;
    const second = first - 2 * state.s2x1 + state.s2x2 + 1.99004745483398 * state.s2y1 - .99007225036621 * state.s2y2;
    state.s2x2 = state.s2x1; state.s2x1 = first; state.s2y2 = state.s2y1; state.s2y1 = second;
    return second;
  }

  lufs(energy) { return energy > 0 ? -0.691 + 10 * Math.log10(energy) : -120; }

  addIntegratedBlock(energy) {
    const lufs = this.lufs(energy);
    if (lufs < -70) return;
    const bin = Math.max(0, Math.min(900, Math.round((lufs + 70) * 10)));
    this.histogramCounts[bin] += 1;
    this.histogramEnergy[bin] += energy;
  }

  integratedLufs() {
    let absoluteCount = 0;
    let absoluteEnergy = 0;
    for (let bin = 0; bin < this.histogramCounts.length; bin += 1) {
      absoluteCount += this.histogramCounts[bin];
      absoluteEnergy += this.histogramEnergy[bin];
    }
    if (!absoluteCount) return -120;
    const relativeGate = this.lufs(absoluteEnergy / absoluteCount) - 10;
    const firstBin = Math.max(0, Math.min(900, Math.ceil((relativeGate + 70) * 10)));
    let gatedCount = 0;
    let gatedEnergy = 0;
    for (let bin = firstBin; bin < this.histogramCounts.length; bin += 1) {
      gatedCount += this.histogramCounts[bin];
      gatedEnergy += this.histogramEnergy[bin];
    }
    return this.lufs(gatedEnergy / Math.max(1, gatedCount));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input.length) return true;
    for (let sample = 0; sample < input[0].length; sample += 1) {
      let sum = 0;
      let peak = 0;
      for (let channel = 0; channel < input.length; channel += 1) {
        const value = input[channel][sample] || 0;
        const weighted = this.filter(channel, value);
        sum += weighted * weighted;
        peak = Math.max(peak, Math.abs(value));
      }
      const replaced = this.energyCount === this.energyCapacity ? this.energy[this.energyIndex] : 0;
      this.energy[this.energyIndex] = sum;
      this.energyIndex = (this.energyIndex + 1) % this.energyCapacity;
      this.energyCount = Math.min(this.energyCapacity, this.energyCount + 1);
      this.energySum += sum - replaced;
      const replacedMomentary = this.momentaryCount === this.momentaryCapacity
        ? this.momentaryEnergy[this.momentaryIndex] : 0;
      this.momentaryEnergy[this.momentaryIndex] = sum;
      this.momentaryIndex = (this.momentaryIndex + 1) % this.momentaryCapacity;
      this.momentaryCount = Math.min(this.momentaryCapacity, this.momentaryCount + 1);
      this.momentarySum += sum - replacedMomentary;
      this.samples += 1;
      if (this.samples % this.reportEvery === 0) this.addIntegratedBlock(this.momentarySum / Math.max(1, this.momentaryCount));
      this.peak = Math.max(this.peak, peak);
    }
    if (this.samples % this.reportEvery < input[0].length) {
      this.port.postMessage({
        momentary: this.lufs(this.momentarySum / Math.max(1, this.momentaryCount)),
        shortTerm: this.lufs(this.energySum / Math.max(1, this.energyCount)),
        integrated: this.integratedLufs(), peakDbfs: this.peak > 0 ? 20 * Math.log10(this.peak) : -120
      });
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor('francis-loudness', FrancisLoudnessProcessor);
