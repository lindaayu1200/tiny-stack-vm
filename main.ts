// tiny-stack-vm entry: a faithful interpreter of make.fun's tiny stack ISA v1
// (generator/subject/ISA.md in the kit). For each instance under $MAKEFUN_INPUT_DIR it
// runs program.bin on input.bin and writes stdout.bin (the bytes printed) and exit.txt
// (the exit code, trap codes included) under $MAKEFUN_OUTPUT_DIR.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const STACK_MAX = 256, CALLS_MAX = 64, STEP_LIMIT = 1e6, OUT_MAX = 65536, MEM_WORDS = 256;

function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(STACK_MAX), C = new Int32Array(CALLS_MAX), M = new Int32Array(MEM_WORDS);
  const out = [];
  let sp = 0, csp = 0, inPos = 0, pc = 0, steps = 0;
  const t = (c) => ({ out, exit: c });
  for (;;) {
    if (steps === STEP_LIMIT) return t(10);
    if (pc < 0 || pc >= n) return t(9);
    const op = p[pc];
    let imm = 0, pops = 0, pushes = 0, bad = false;
    switch (op) {
      case 0x00: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x34:
      case 0x40: case 0x41: case 0x50: case 0x51: case 0x52: case 0x53: case 0x17: case 0x1b: break;
      case 0x01: imm = 1; break;
      case 0x02: imm = 4; break;
      case 0x30: case 0x31: case 0x32: case 0x33: imm = 2; break;
      default:
        if ((op >= 0x10 && op <= 0x1e) || (op >= 0x20 && op <= 0x22)) break;
        return t(5);
    }
    if (pc + imm >= n) return t(9);
    steps++;
    const next = pc + 1 + imm;
    switch (op) { // pops/pushes per ISA
      case 0x03: case 0x50: case 0x51: case 0x53: case 0x17: case 0x1b: case 0x31: case 0x32: case 0x40: pops = 1; pushes = op === 0x40 ? 1 : 0; break;
      case 0x04: pops = 1; pushes = 2; break;
      case 0x05: pops = 2; pushes = 2; break;
      case 0x06: pops = 2; pushes = 3; break;
      case 0x07: pops = 3; pushes = 3; break;
      case 0x52: pops = 0; pushes = 1; break;
      case 0x41: pops = 2; break;
      case 0x01: case 0x02: pops = 0; pushes = 1; break;
      default: if (op >= 0x10 && op <= 0x1e || op >= 0x20 && op <= 0x22) { pops = 2; pushes = 1; }
    }
    if (sp < pops) return t(2);
    if (sp - pops + pushes > STACK_MAX) return t(3);
    pc = next;
    const pop = () => D[--sp];
    switch (op) {
      case 0x00: return { out, exit: 0 };
      case 0x01: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const x = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = x; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x10: { const b = pop(), a = D[sp - 1]; D[sp - 1] = (a + b) | 0; break; }
      case 0x11: { const b = pop(), a = D[sp - 1]; D[sp - 1] = (a - b) | 0; break; }
      case 0x12: { const b = pop(), a = D[sp - 1]; D[sp - 1] = Math.imul(a, b); break; }
      case 0x13: { const b = pop(), a = D[sp - 1];
        if (b === 0) return t(4);
        D[sp - 1] = a === -2147483648 && b === -1 ? a : (a / b) | 0; break; }
      case 0x14: { const b = pop(), a = D[sp - 1];
        if (b === 0) return t(4);
        D[sp - 1] = b === -1 ? 0 : (a % b) | 0; break; }
      case 0x15: { const b = pop(), a = D[sp - 1];
        if (b === 0) return t(4);
        D[sp - 1] = Math.floor((a >>> 0) / (b >>> 0)) | 0; break; }
      case 0x16: { const b = pop(), a = D[sp - 1];
        if (b === 0) return t(4);
        D[sp - 1] = ((a >>> 0) % (b >>> 0)) | 0; break; }
      case 0x18: { const b = pop(); D[sp - 1] = D[sp - 1] & b; break; }
      case 0x19: { const b = pop(); D[sp - 1] = D[sp - 1] | b; break; }
      case 0x1a: { const b = pop(); D[sp - 1] = D[sp - 1] ^ b; break; }
      case 0x1c: { const b = pop(); D[sp - 1] = D[sp - 1] << (b & 31); break; }
      case 0x1d: { const b = pop(); D[sp - 1] = D[sp - 1] >> (b & 31); break; }
      case 0x1e: { const b = pop(); D[sp - 1] = (D[sp - 1] >>> (b & 31)) | 0; break; }
      case 0x20: { const b = pop(); D[sp - 1] = D[sp - 1] === b ? 1 : 0; break; }
      case 0x21: { const b = pop(); D[sp - 1] = D[sp - 1] < b ? 1 : 0; break; }
      case 0x22: { const b = pop(); D[sp - 1] = (D[sp - 1] >>> 0) < (b >>> 0) ? 1 : 0; break; }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = pop(); take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === CALLS_MAX) return t(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return t(8);
        pc = C[--csp];
        break;
      case 0x40: { const a = D[sp - 1];
        if (a < 0 || a >= MEM_WORDS) return t(6);
        D[sp - 1] = M[a]; break; }
      case 0x41: { const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= MEM_WORDS) return t(6);
        sp -= 2; M[a] = v; break; }
      case 0x50: {
        const s = String(D[sp - 1]);
        if (out.length + s.length > OUT_MAX) return t(11);
        sp--;
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        break;
      }
      case 0x51:
        if (out.length + 1 > OUT_MAX) return t(11);
        out.push(pop() & 255);
        break;
      case 0x52: D[sp++] = inPos < inp.length ? inp[inPos++] : -1; break;
      case 0x53: return { out, exit: pop() & 255 };
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const d = join(I, id);
  const { out, exit } = run(readFileSync(join(d, 'program.bin')), readFileSync(join(d, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(O, id, 'exit.txt'), String(exit));
}
