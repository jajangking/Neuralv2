/** Tiny feed-forward network + genetic operators. Shared by the AI trainer. */

export const INPUTS = 5;
export const HIDDEN = 8;
export const OUTPUTS = 2;

/** input→hidden, hidden bias, hidden→output, output bias */
export const BRAIN_SIZE = INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS + OUTPUTS;

export type Brain = number[];

export type Activation = {
  inputs: number[];
  hidden: number[];
  outputs: number[];
};

export const INPUT_LABELS = ["Kecepatan", "Galat arah", "Offset aspal", "Lengkung (sin)", "Lengkung (cos)"];

export const OUTPUT_LABELS = ["Setir", "Gas"];

export function randomBrain(): Brain {
  return Array.from({ length: BRAIN_SIZE }, () => (Math.random() * 2 - 1) * 1.4);
}

export function mutate(brain: Brain, rate = 0.14, scale = 1.1): Brain {
  const out = new Array<number>(brain.length);
  for (let i = 0; i < brain.length; i++) {
    out[i] = Math.random() < rate ? brain[i] + (Math.random() * 2 - 1) * scale : brain[i];
  }
  return out;
}

/** Plain mutation, a single "gene" at a time — used to breathe life into the champion. */
export function jitter(brain: Brain, index: number, scale = 1): Brain {
  const out = brain.slice();
  out[index] += (Math.random() * 2 - 1) * scale;
  return out;
}

export function forward(brain: Brain, inputs: number[]): Activation {
  const hidden = new Array<number>(HIDDEN);
  for (let h = 0; h < HIDDEN; h++) {
    let sum = brain[INPUTS * HIDDEN + h];
    for (let i = 0; i < INPUTS; i++) sum += brain[i * HIDDEN + h] * inputs[i];
    hidden[h] = Math.tanh(sum);
  }
  const outputs = new Array<number>(OUTPUTS);
  for (let o = 0; o < OUTPUTS; o++) {
    let sum = brain[INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS + o];
    for (let h = 0; h < HIDDEN; h++) sum += brain[INPUTS * HIDDEN + HIDDEN + h * OUTPUTS + o] * hidden[h];
    outputs[o] = Math.tanh(sum);
  }
  return { inputs, hidden, outputs };
}