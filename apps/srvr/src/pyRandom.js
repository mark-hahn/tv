// Python's random.Random (CPython 3.12): the Mersenne Twister seeded from an
// integer, getrandbits, and sample() of two. The subtitle judge (subJudge.js)
// draws its RANSAC pairs with it so its verdicts are the analysis's, which
// were made in Python with a fixed seed.

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
// sample() picks from a copy of the population up to this size, else by
// drawing indexes until they differ.
const SAMPLE_SETSIZE = 21;

export class PyRandom {
  // seed: a non-negative integer below 2^32, as random.Random(seed).
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.index = N;
    this.#initByArray([seed >>> 0]);
  }

  #initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.index = N;
  }

  #initByArray(key) {
    this.#initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  uint32() {
    const mt = this.mt;
    if (this.index >= N) {
      let kk = 0;
      const twist = (a, b, c) => {
        const y = (a & UPPER_MASK) | (b & LOWER_MASK);
        return (c ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      };
      for (; kk < N - M; kk++) mt[kk] = twist(mt[kk], mt[kk + 1], mt[kk + M]);
      for (; kk < N - 1; kk++) mt[kk] = twist(mt[kk], mt[kk + 1], mt[kk + (M - N)]);
      mt[N - 1] = twist(mt[N - 1], mt[0], mt[M - 1]);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  // k from 0 to 32
  getrandbits(k) {
    return k === 0 ? 0 : this.uint32() >>> (32 - k);
  }

  // An integer in [0, n), n from 1 to 2^32 - 1.
  randbelow(n) {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  // sample(population, 2)
  sample2(population) {
    const n = population.length;
    if (n < 2) throw new Error("sample larger than population");
    if (n <= SAMPLE_SETSIZE) {
      const pool = [...population];
      const j0 = this.randbelow(n);
      const first = pool[j0];
      pool[j0] = pool[n - 1];
      return [first, pool[this.randbelow(n - 1)]];
    }
    const j0 = this.randbelow(n);
    let j1 = this.randbelow(n);
    while (j1 === j0) j1 = this.randbelow(n);
    return [population[j0], population[j1]];
  }
}
